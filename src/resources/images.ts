/**
 * `pa.images` — the image capability lanes (generate + edit), TS parity with
 * the Python SDK's `client.images`.
 *
 * Dedicated routes, not `chat.completions`:
 *   POST /v1/images/generations {prompt, size?, seed?}       -> {created, model,
 *                                                                data: [{b64_json}], size}
 *   POST /v1/images/edits       {prompt, image (b64), seed?} -> same shape
 *
 * Both run on Pareta's open image model (`hidream-1`) and are metered at a
 * FLAT price per call — generation by image (every size costs the same;
 * the model renders at full 2K internally), editing by edit (the output
 * keeps the reference's aspect ratio). The `X-Pareta-Billed` response
 * header carries the per-request receipt in micro-USD. Delivery sizes for
 * generation (server-authoritative): 1024x1024 (default), 2048x2048,
 * 2304x1728, 1728x2304, 2560x1440, 1440x2560.
 *
 * Edit input follows the audio FileInput convention: a string is a FILE
 * PATH (read via lazy node:fs — browser/edge bundles stay clean);
 * Blob/ArrayBuffer/Uint8Array are raw bytes; `{ base64 }` passes
 * pre-encoded image data through untouched.
 */

import type { Transport } from "../client.js";
import { ParetaError } from "../errors.js";
import { ImageGeneration } from "../models.js";
import { bytesToBase64 } from "./audio.js";

const PATH = "/v1/images/generations";
const EDIT_PATH = "/v1/images/edits";

export type ImageInput = string | Blob | ArrayBuffer | Uint8Array | { base64: string };

async function toBase64(image: ImageInput): Promise<string> {
  if (typeof image === "string") {
    const { readFile } = await import("node:fs/promises");
    return bytesToBase64(new Uint8Array(await readFile(image)));
  }
  if (typeof image === "object" && image !== null && "base64" in image) {
    if (!image.base64 || !image.base64.trim()) throw new ParetaError("image.base64 is empty");
    return image.base64;
  }
  if (image instanceof Blob) return bytesToBase64(new Uint8Array(await image.arrayBuffer()));
  const bytes = image instanceof Uint8Array ? image : new Uint8Array(image);
  if (bytes.byteLength === 0) throw new ParetaError("image is empty");
  return bytesToBase64(bytes);
}

export interface ImageGenerateOptions {
  /** Delivery size, e.g. "2560x1440" (omit for 1024x1024). Flat price. */
  size?: string;
  /** Pin the noise seed for reproducibility. */
  seed?: number;
}

export interface ImageEditOptions {
  /** Pin the noise seed for reproducibility. */
  seed?: number;
}

export class Images {
  constructor(private readonly client: Transport) {}

  /** Generate one image from a text prompt. Returns an `ImageGeneration`
   * whose `.image` is decoded PNG bytes (`.save(path)` writes a file in
   * Node). Billed flat per image. */
  generate(prompt: string, opts: ImageGenerateOptions = {}): Promise<ImageGeneration> {
    if (!prompt || !prompt.trim()) throw new ParetaError("prompt is required");
    const body: Record<string, unknown> = { prompt };
    if (opts.size) body.size = opts.size;
    if (opts.seed !== undefined) body.seed = opts.seed;
    return this.client.request<ImageGeneration>("POST", PATH, {
      body,
      cast: (raw) => new ImageGeneration(raw as Record<string, unknown>),
    });
  }

  /** Edit one reference image with a plain-language instruction (no mask).
   * `image` is a file path, raw bytes, a Blob, or `{ base64 }` (≤25MB
   * decoded). The output keeps the reference's aspect ratio. Billed flat
   * per edit. */
  async edit(image: ImageInput, prompt: string, opts: ImageEditOptions = {}): Promise<ImageGeneration> {
    if (!prompt || !prompt.trim()) throw new ParetaError("prompt is required");
    const body: Record<string, unknown> = { prompt, image: await toBase64(image) };
    if (opts.seed !== undefined) body.seed = opts.seed;
    return this.client.request<ImageGeneration>("POST", EDIT_PATH, {
      body,
      cast: (raw) => new ImageGeneration(raw as Record<string, unknown>),
    });
  }
}
