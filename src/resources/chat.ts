/**
 * `client.chat.completions` — OpenAI-compatible chat completions.
 *
 * `model` is an endpoint id from `endpoints.deploy(...)` (or any model id the
 * caller's org can reach). The call is metered: a successful completion debits
 * the org's balance; a zero balance raises `InsufficientCreditsError` (402).
 */

import type { Transport } from "../client.js";
import { ParetaError } from "../errors.js";
import { ChatCompletion, ChatCompletionChunk } from "../models.js";

const PATH = "/v1/chat/completions";

/** An OpenAI-style chat message. `content` is a string or content-block array. */
export interface ChatMessage {
  role: string;
  content: string | Array<Record<string, unknown>>;
  [key: string]: unknown;
}

/** Params for `chat.completions.create`. Extra OpenAI params pass through. */
export interface ChatCompletionCreateParams {
  /** An endpoint id from `endpoints.deploy(...)`. */
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  /** temperature, max_tokens, top_p, … — forwarded verbatim. */
  [key: string]: unknown;
}

function buildBody(params: ChatCompletionCreateParams): Record<string, unknown> {
  const { model, messages, stream, ...extra } = params;
  if (!model) throw new ParetaError("model is required (an endpoint id from endpoints.deploy)");
  if (!messages || messages.length === 0) {
    throw new ParetaError("messages is required and must be non-empty");
  }
  const body: Record<string, unknown> = { model, messages, ...extra };
  if (stream) body.stream = true;
  return body;
}

export class Completions {
  constructor(private readonly client: Transport) {}

  /**
   * Create a chat completion.
   *
   * `stream: false` (default) → `Promise<ChatCompletion>`.
   * `stream: true`  → `AsyncIterable<ChatCompletionChunk>`
   *   (`chunk.choices[0].delta.content` is the incremental text).
   */
  create(params: ChatCompletionCreateParams & { stream: true }): AsyncIterable<ChatCompletionChunk>;
  create(params: ChatCompletionCreateParams & { stream?: false }): Promise<ChatCompletion>;
  create(
    params: ChatCompletionCreateParams,
  ): Promise<ChatCompletion> | AsyncIterable<ChatCompletionChunk> {
    const body = buildBody(params);
    if (params.stream) {
      return this.client.stream<ChatCompletionChunk>("POST", PATH, {
        body,
        cast: (raw) => new ChatCompletionChunk(raw as Record<string, unknown>),
      });
    }
    return this.client.request<ChatCompletion>("POST", PATH, {
      body,
      cast: (raw) => new ChatCompletion(raw as Record<string, unknown>),
    });
  }
}

export class Chat {
  readonly completions: Completions;
  constructor(client: Transport) {
    this.completions = new Completions(client);
  }
}
