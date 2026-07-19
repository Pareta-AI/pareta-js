/**
 * `pa.images` — the image-generation capability lane, TS parity with the
 * Python SDK's `client.images`.
 *
 * Dedicated route, not `chat.completions`:
 *   POST /v1/images/generations {prompt, size?, seed?} -> {created, model,
 *                                                          data: [{b64_json}], size}
 *
 * Generation runs on Pareta's open image model (`hidream-1`) and is metered
 * at a FLAT price per image — every size costs the same (the model renders
 * at full 2K quality internally regardless of the delivery size). The
 * `X-Pareta-Billed` response header carries the per-request receipt in
 * micro-USD. Delivery sizes today (server-authoritative): 1024x1024
 * (default), 2048x2048, 2304x1728, 1728x2304, 2560x1440, 1440x2560.
 */

import type { Transport } from "../client.js";
import { ParetaError } from "../errors.js";
import { ImageGeneration } from "../models.js";

const PATH = "/v1/images/generations";

export interface ImageGenerateOptions {
  /** Delivery size, e.g. "2560x1440" (omit for 1024x1024). Flat price. */
  size?: string;
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
}
