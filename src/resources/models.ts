/**
 * `client.models` — list the deployed models (endpoints) your org can call.
 *
 * OpenAI-compatible: only deployed, url-bearing endpoints appear. Each
 * `Model.id` is an endpoint id usable as `chat.completions.create({ model })`.
 */

import type { Transport } from "../client.js";
import { ModelList } from "../models.js";

const PATH = "/v1/models";

export class Models {
  constructor(private readonly client: Transport) {}

  list(): Promise<ModelList> {
    return this.client.request<ModelList>("GET", PATH, {
      cast: (raw) => new ModelList(raw as Record<string, unknown>),
    });
  }
}
