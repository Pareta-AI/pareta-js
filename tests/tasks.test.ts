import { describe, expect, it } from "vitest";
import { Leaderboard, ParetaError, Task, TaskMatch } from "../src/index.js";
import { jsonResponse, makeClient } from "./_helpers.js";

describe("tasks", () => {
  it("list returns typed Task objects (unwraps {tasks})", async () => {
    const pa = makeClient((url) => {
      expect(new URL(url).pathname).toBe("/v1/tasks");
      return jsonResponse(200, {
        tasks: [
          { id: "invoice-extraction", default_scorer: "field_f1", has_blob_input: true },
          { id: "intent-classification", default_scorer: "macro_f1", has_blob_input: false },
        ],
      });
    });
    const tasks = await pa.tasks.list();
    expect(tasks.map((t) => t.id)).toEqual(["invoice-extraction", "intent-classification"]);
    expect(tasks[0]).toBeInstanceOf(Task);
    expect(tasks[0]!.hasBlobInput).toBe(true);
  });

  it("match sends {query, top_k:5} and returns a typed TaskMatch", async () => {
    let body: Record<string, unknown> = {};
    const pa = makeClient((_url, init) => {
      body = JSON.parse(init.body as string);
      return jsonResponse(200, {
        query: body.query,
        matched: true,
        chosen: { task_id: "contract-key-fields", score: 0.71, confidence: "high" },
        candidates: [{ task_id: "contract-key-fields", score: 0.71, confidence: "high" }],
        ambiguous: false,
        matcher: "keyword",
      });
    });
    const m = await pa.tasks.match("extract dates from a contract");
    expect(body).toEqual({ query: "extract dates from a contract", top_k: 5 });
    expect(m).toBeInstanceOf(TaskMatch);
    expect(m.matched).toBe(true);
    expect(m.chosen!.taskId).toBe("contract-key-fields");
    expect(m.chosen!.confidence).toBe("high");
    expect(m.matcher).toBe("keyword");
  });

  it("match rejects an empty query synchronously", () => {
    const pa = makeClient(() => jsonResponse(200, {}));
    expect(() => pa.tasks.match("   ")).toThrow(ParetaError);
  });

  it("leaderboard + recommended (Slice 4)", async () => {
    const handler = (url: string) => {
      expect(new URL(url).pathname).toBe("/v1/tasks/invoice-extraction/leaderboard");
      return jsonResponse(200, {
        task_id: "invoice-extraction",
        metric: "F1",
        cost_unit: "$/1k invoices",
        recommended: "qwen-vl-1",
        frontier: { name: "claude-opus-4-7", quality: 0.919, cost_per_request_micro_usd: 28800 },
        models: [
          { name: "claude-opus-4-7", kind: "frontier", quality: 0.919, cost_per_request_micro_usd: 28800 },
          { name: "qwen-vl-1", kind: "open", quality: 0.926, cost_per_request_micro_usd: 3800 },
        ],
      });
    };
    const lb = await makeClient(handler).tasks.leaderboard("invoice-extraction");
    expect(lb).toBeInstanceOf(Leaderboard);
    expect(lb.recommended).toBe("qwen-vl-1");
    expect(lb.metric).toBe("F1");
    expect(lb.frontier!.name).toBe("claude-opus-4-7");
    expect(new Set(lb.models.map((m) => m.name))).toEqual(new Set(["claude-opus-4-7", "qwen-vl-1"]));

    const rec = await makeClient(handler).tasks.recommended("invoice-extraction");
    expect(rec).toBe("qwen-vl-1");
  });
});
