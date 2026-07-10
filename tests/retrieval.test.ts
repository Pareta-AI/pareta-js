import { describe, expect, it } from "vitest";
import { Embeddings, ParetaError, Rerank, RerankResult } from "../src/index.js";
import { jsonResponse, makeClient } from "./_helpers.js";

describe("rerank", () => {
  it("posts the Cohere-shaped body and returns a typed Rerank", async () => {
    let body: Record<string, unknown> = {};
    const pa = makeClient((url, init) => {
      expect(new URL(url).pathname).toBe("/v1/rerank");
      body = JSON.parse(init.body as string);
      return jsonResponse(200, {
        results: [
          { index: 2, relevance_score: 0.93 },
          { index: 0, relevance_score: 0.41 },
        ],
        model: "pareta-rerank-1",
        pairs: 3,
      });
    });
    const docs = ["irrelevant", "meh", "governing law of Delaware"];
    const out = await pa.rerank("governing law", docs, { topN: 2 });
    expect(body).toEqual({ query: "governing law", documents: docs, top_n: 2 });
    expect(out).toBeInstanceOf(Rerank);
    expect(out.model).toBe("pareta-rerank-1");
    expect(out.pairs).toBe(3);
    expect(out.results[0]).toBeInstanceOf(RerankResult);
    expect(out.results[0]!.index).toBe(2);
    expect(out.results[0]!.relevanceScore).toBe(0.93);
    expect(out.topDocuments(docs)).toEqual(["governing law of Delaware", "irrelevant"]);
  });

  it("omits top_n when not given and rejects bad input locally", async () => {
    let body: Record<string, unknown> = {};
    const pa = makeClient((_url, init) => {
      body = JSON.parse(init.body as string);
      return jsonResponse(200, { results: [], model: "pareta-rerank-1", pairs: 1 });
    });
    await pa.rerank("q", ["a"]);
    expect(body).not.toHaveProperty("top_n");
    expect(() => pa.rerank("", ["a"])).toThrow(ParetaError);
    expect(() => pa.rerank("q", [])).toThrow(ParetaError);
  });

  it("topDocuments ignores out-of-range indices", () => {
    const out = new Rerank({
      results: [
        { index: 9, relevance_score: 0.9 },
        { index: 0, relevance_score: 0.5 },
      ],
    });
    expect(out.topDocuments(["only"])).toEqual(["only"]);
  });
});

describe("embeddings", () => {
  it("posts input list and returns index-sorted unit vectors", async () => {
    let body: Record<string, unknown> = {};
    const pa = makeClient((url, init) => {
      expect(new URL(url).pathname).toBe("/v1/embeddings");
      body = JSON.parse(init.body as string);
      return jsonResponse(200, {
        object: "list",
        data: [
          { object: "embedding", index: 1, embedding: [0, 1] },
          { object: "embedding", index: 0, embedding: [1, 0] },
        ],
        model: "bge-1",
        usage: { prompt_tokens: 42, total_tokens: 42 },
      });
    });
    const out = await pa.embeddings(["a", "b"]);
    expect(body).toEqual({ input: ["a", "b"] });
    expect(out).toBeInstanceOf(Embeddings);
    expect(out.vectors).toEqual([[1, 0], [0, 1]]); // sorted by index
    expect(out.model).toBe("bge-1");
    expect(out.promptTokens).toBe(42);
    expect(out.length).toBe(2);
  });

  it("wraps a single string and forwards inputType", async () => {
    let body: Record<string, unknown> = {};
    const pa = makeClient((_url, init) => {
      body = JSON.parse(init.body as string);
      return jsonResponse(200, { data: [], model: "bge-1", usage: {} });
    });
    await pa.embeddings("what governs?", { inputType: "query" });
    expect(body).toEqual({ input: ["what governs?"], input_type: "query" });
  });

  it("rejects bad input locally", () => {
    const pa = makeClient(() => jsonResponse(200, {}));
    expect(() => pa.embeddings([])).toThrow(ParetaError);
    expect(() => pa.embeddings("   ")).toThrow(ParetaError);
    // @ts-expect-error — runtime guard for JS callers
    expect(() => pa.embeddings("x", { inputType: "banana" })).toThrow(ParetaError);
  });
});
