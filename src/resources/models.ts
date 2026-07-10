/**
 * `client.models` — the OpenAI-compatible `/v1/models` list of model ids your
 * org can call. Each `Model.id` is usable as
 * `chat.completions.create({ model })`.
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
