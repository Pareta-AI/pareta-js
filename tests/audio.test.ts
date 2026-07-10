import { describe, expect, it } from "vitest";
import { ParetaError, Speech, Transcription } from "../src/index.js";
import { bytesToBase64 } from "../src/resources/audio.js";
import { jsonResponse, makeClient } from "./_helpers.js";

describe("audio.transcriptions", () => {
  it("base64-encodes raw bytes and returns a typed Transcription", async () => {
    const raw = new Uint8Array([82, 73, 70, 70, 1, 2, 3]); // "RIFF..."
    let body: Record<string, unknown> = {};
    const pa = makeClient((url, init) => {
      expect(new URL(url).pathname).toBe("/v1/audio/transcriptions");
      body = JSON.parse(init.body as string);
      return jsonResponse(200, { text: "hello world", language: "English", duration_s: 1.5 });
    });
    const out = await pa.audio.transcriptions(raw, { language: "en" });
    expect(out).toBeInstanceOf(Transcription);
    expect(out.text).toBe("hello world");
    expect(out.durationS).toBe(1.5);
    expect(String(out)).toBe("hello world");
    expect(body.language).toBe("en");
    expect(body.audio_base64).toBe(bytesToBase64(raw));
  });

  it("passes pre-encoded {base64} through untouched and omits language", async () => {
    let body: Record<string, unknown> = {};
    const pa = makeClient((_url, init) => {
      body = JSON.parse(init.body as string);
      return jsonResponse(200, { text: "ok", language: null, duration_s: 0.4 });
    });
    await pa.audio.transcriptions({ base64: "Zm9v" });
    expect(body).toEqual({ audio_base64: "Zm9v" });
  });

  it("rejects empty input locally", async () => {
    const pa = makeClient(() => jsonResponse(200, {}));
    await expect(pa.audio.transcriptions(new Uint8Array(0))).rejects.toThrow(ParetaError);
    await expect(pa.audio.transcriptions({ base64: "  " })).rejects.toThrow(ParetaError);
  });
});

describe("audio.speech", () => {
  it("posts text + voice and decodes the returned audio", async () => {
    const audioBytes = new Uint8Array([1, 2, 3, 4]);
    let body: Record<string, unknown> = {};
    const pa = makeClient((url, init) => {
      expect(new URL(url).pathname).toBe("/v1/audio/speech");
      body = JSON.parse(init.body as string);
      return jsonResponse(200, {
        audio_base64: bytesToBase64(audioBytes),
        sample_rate: 24000,
        duration_s: 0.5,
        format: "wav",
      });
    });
    const out = await pa.audio.speech("hello", { voice: "af_bella" });
    expect(out).toBeInstanceOf(Speech);
    expect(body).toEqual({ text: "hello", voice: "af_bella" });
    expect(Array.from(out.audio)).toEqual([1, 2, 3, 4]);
    expect(out.sampleRate).toBe(24000);
    expect(out.format).toBe("wav");
  });

  it("save() writes decoded bytes (Node)", async () => {
    const audioBytes = new Uint8Array([9, 8, 7]);
    const pa = makeClient(() =>
      jsonResponse(200, { audio_base64: bytesToBase64(audioBytes), sample_rate: 24000, duration_s: 0.1, format: "wav" }),
    );
    const out = await pa.audio.speech("hi");
    const { mkdtemp, readFile, rm } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const dir = await mkdtemp("pareta-audio-test-");
    try {
      const path = join(dir, "out.wav");
      await out.save(path);
      expect(Array.from(new Uint8Array(await readFile(path)))).toEqual([9, 8, 7]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects empty text locally", () => {
    const pa = makeClient(() => jsonResponse(200, {}));
    expect(() => pa.audio.speech("   ")).toThrow(ParetaError);
  });
});
