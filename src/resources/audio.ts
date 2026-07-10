/**
 * `pa.audio` — the Speech capability lanes (ASR + TTS), TS parity with the
 * Python SDK's `client.audio`.
 *
 * Dedicated routes, not `chat.completions`:
 *   POST /v1/audio/transcriptions {audio_base64, language?} -> {text, language, duration_s}
 *   POST /v1/audio/speech         {text, voice?}            -> {audio_base64, sample_rate, duration_s, format}
 *
 * Both are metered PER MINUTE of audio (input duration for ASR, output
 * duration for TTS). You never pick a serving model — Pareta resolves the
 * lane, exactly as `model:"auto"` does for chat.
 *
 * Audio input follows the evals FileInput convention: a string is a FILE
 * PATH (read via lazy node:fs — browser/edge bundles stay clean);
 * Blob/ArrayBuffer/Uint8Array are raw bytes; `{ base64 }` passes
 * pre-encoded audio through untouched.
 */

import type { Transport } from "../client.js";
import { ParetaError } from "../errors.js";
import { Speech, Transcription } from "../models.js";

const BASE = "/v1/audio";

export type AudioInput = string | Blob | ArrayBuffer | Uint8Array | { base64: string };

/** Browser-safe Uint8Array → base64 (Buffer in Node, chunked btoa elsewhere). */
export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

async function toBase64(audio: AudioInput): Promise<string> {
  if (typeof audio === "string") {
    // Path → lazy node:fs so the browser/edge bundle stays clean.
    const { readFile } = await import("node:fs/promises");
    return bytesToBase64(new Uint8Array(await readFile(audio)));
  }
  if (typeof audio === "object" && audio !== null && "base64" in audio) {
    if (!audio.base64 || !audio.base64.trim()) throw new ParetaError("audio.base64 is empty");
    return audio.base64;
  }
  if (audio instanceof Blob) return bytesToBase64(new Uint8Array(await audio.arrayBuffer()));
  const bytes = audio instanceof Uint8Array ? audio : new Uint8Array(audio);
  if (bytes.byteLength === 0) throw new ParetaError("audio is empty");
  return bytesToBase64(bytes);
}

export interface TranscriptionOptions {
  /** Optional ISO language hint (omit to auto-detect). */
  language?: string;
}

export interface SpeechOptions {
  /** Optional voice id (omit for the default voice). */
  voice?: string;
}

export class Audio {
  constructor(private readonly client: Transport) {}

  /** Speech-to-text (the `asr` lane). `audio` is a file path, raw bytes, a
   * Blob, or `{ base64 }`. Metered per minute of input audio. */
  async transcriptions(audio: AudioInput, opts: TranscriptionOptions = {}): Promise<Transcription> {
    const body: Record<string, unknown> = { audio_base64: await toBase64(audio) };
    if (opts.language) body.language = opts.language;
    return this.client.request<Transcription>("POST", `${BASE}/transcriptions`, {
      body,
      cast: (raw) => new Transcription(raw as Record<string, unknown>),
    });
  }

  /** Text-to-speech (the `tts` lane). Returns a `Speech` whose `.audio` is
   * decoded bytes (`.save(path)` writes a file in Node). Metered per minute
   * of output audio. */
  speech(text: string, opts: SpeechOptions = {}): Promise<Speech> {
    if (!text || !text.trim()) throw new ParetaError("text is required");
    const body: Record<string, unknown> = { text };
    if (opts.voice) body.voice = opts.voice;
    return this.client.request<Speech>("POST", `${BASE}/speech`, {
      body,
      cast: (raw) => new Speech(raw as Record<string, unknown>),
    });
  }
}
