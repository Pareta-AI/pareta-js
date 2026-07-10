/**
 * `pa.rerank(...)` + `pa.embeddings(...)` — the Retrieval capability lanes
 * (the RAG stack: embeddings for recall, reranking for precision).
 *
 * Both are dedicated routes, not `chat.completions`:
 *   POST /v1/rerank      {query, documents[], top_n?} -> ordered
 *                        {index, relevance_score} rows (calibrated P(relevant))
 *   POST /v1/embeddings  {input[], input_type?}       -> unit-normalized vectors
 *
 * Rerank is metered per document scored; embeddings per input token. You never
 * pick a serving model — Pareta resolves the lane (`pareta-rerank-1` / `bge-1`),
 * exactly as `model:"auto"` does for chat.
 *
 * Exposed as callable client fields (`pa.rerank(...)`) rather than resource
 * objects — call-parity with the Python SDK, and neither lane has sub-methods.
 */

import type { Transport } from "../client.js";
import { ParetaError } from "../errors.js";
import { Embeddings, Rerank } from "../models.js";

export interface RerankOptions {
  /** Truncate the response to the best N (all documents are still scored and metered). */
  topN?: number;
}

export type RerankFn = (query: string, documents: string[], opts?: RerankOptions) => Promise<Rerank>;

export interface EmbeddingsOptions {
  /** `"query"` embeds a retrieval QUERY (asymmetric); default embeds documents raw. */
  inputType?: "query" | "document";
}

export type EmbeddingsFn = (input: string | string[], opts?: EmbeddingsOptions) => Promise<Embeddings>;

export function makeRerank(client: Transport): RerankFn {
  return (query, documents, opts = {}) => {
    if (!query || !query.trim()) throw new ParetaError("query is required");
    if (!Array.isArray(documents) || documents.length === 0) {
      throw new ParetaError("documents must be a non-empty array of strings");
    }
    const body: Record<string, unknown> = { query, documents };
    if (opts.topN !== undefined) body.top_n = opts.topN;
    return client.request<Rerank>("POST", "/v1/rerank", {
      body,
      cast: (raw) => new Rerank(raw as Record<string, unknown>),
    });
  };
}

export function makeEmbeddings(client: Transport): EmbeddingsFn {
  return (input, opts = {}) => {
    const texts = typeof input === "string" ? [input] : input;
    if (!Array.isArray(texts) || texts.length === 0 || texts.some((t) => typeof t !== "string" || !t.trim())) {
      throw new ParetaError("input must be a non-empty string or array of non-empty strings");
    }
    if (opts.inputType !== undefined && opts.inputType !== "query" && opts.inputType !== "document") {
      throw new ParetaError('inputType must be "query" or "document"');
    }
    const body: Record<string, unknown> = { input: texts };
    if (opts.inputType !== undefined) body.input_type = opts.inputType;
    return client.request<Embeddings>("POST", "/v1/embeddings", {
      body,
      cast: (raw) => new Embeddings(raw as Record<string, unknown>),
    });
  };
}
