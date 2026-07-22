import { describe, expect, it } from "vitest";
import { EvalRun, EvalSet, FrontierModel, ParetaError, ProposalResult } from "../src/index.js";
import { jsonResponse, makeClient } from "./_helpers.js";

describe("eval sets", () => {
  it("create sends a multipart JSONL body (one row per line)", async () => {
    let fd: FormData | undefined;
    const pa = makeClient((_url, init) => {
      fd = init.body as FormData;
      return jsonResponse(201, {
        eval_set: { id: "es_1", task_id: "intent-classification", item_count: 2, scoring_strategy: "macro_f1" },
      });
    });
    const es = await pa.evals.sets.create({
      task: "intent-classification",
      prompt: "classify each utterance's intent",
      items: [
        { input: { text: "a" }, expected: "x" },
        { input: { text: "b" }, expected: "y" },
      ],
    });
    expect(es).toBeInstanceOf(EvalSet);
    expect(es.id).toBe("es_1");
    expect(es.itemCount).toBe(2);
    expect(fd).toBeInstanceOf(FormData);
    expect(fd!.get("task_id")).toBe("intent-classification");
    expect(fd!.get("prompt")).toBe("classify each utterance's intent");
    const items = fd!.get("items") as Blob;
    const text = await items.text();
    expect(text).toContain('"text":"a"');
    expect(text.trim().split("\n").length).toBe(2);
  });

  it("create rejects empty items", async () => {
    const pa = makeClient(() => jsonResponse(201, { eval_set: {} }));
    await expect(pa.evals.sets.create({ task: "t", prompt: "do it", items: [] })).rejects.toThrow(ParetaError);
  });

  it("create requires a non-empty prompt (v3)", async () => {
    const pa = makeClient(() => jsonResponse(201, { eval_set: {} }));
    await expect(
      pa.evals.sets.create({ task: "t", prompt: "   ", items: [{ input: {}, expected_output: {} }] }),
    ).rejects.toThrow(/prompt is required/);
  });

  it("propose_contract binds; a task-less create auto-binds a clean match", async () => {
    const posts: string[] = [];
    const pa = makeClient((url, init) => {
      const p = new URL(url).pathname;
      posts.push(p);
      if (p === "/v1/eval-sets/propose-contract") {
        return jsonResponse(200, {
          proposals: [{ task_id: "intent-classification", confidence: "high", evidence: { validated_n: 5, total_n: 5 } }],
          homogeneous: true, split: null, prompt: "classify each utterance",
        });
      }
      if (p === "/v1/eval-sets") {
        return jsonResponse(201, { eval_set: { id: "es_bound", task_id: "intent-classification" } });
      }
      return jsonResponse(200, {});
    });
    const items = Array.from({ length: 5 }, () => ({ input: { text: "a" }, expected_output: { label: "x" } }));
    const result = await pa.evals.proposeContract({ items, prompt: "classify each utterance" });
    expect(result).toBeInstanceOf(ProposalResult);
    expect(result.boundTask).toBe("intent-classification");
    expect(result.isClean).toBe(true);

    const es = await pa.evals.sets.create({ items, prompt: "classify each utterance" }); // no task
    expect(es.id).toBe("es_bound");
    expect(posts).toEqual(["/v1/eval-sets/propose-contract", "/v1/eval-sets/propose-contract", "/v1/eval-sets"]);
  });

  it("a task-less create does NOT auto-bind the custom-eval floor offer", async () => {
    const posted: string[] = [];
    const pa = makeClient((url) => {
      const p = new URL(url).pathname;
      posted.push(p);
      if (p === "/v1/eval-sets/propose-contract") {
        return jsonResponse(200, {
          proposals: [{ task_id: "custom-eval", confidence: "medium", evidence: { validated_n: 5, total_n: 5 } }],
          homogeneous: true, split: null, prompt: "grade the tone of each reply",
          message: "no specific grading contract fits this shape",
        });
      }
      return jsonResponse(201, { eval_set: { id: "es_x" } });
    });
    const items = Array.from({ length: 5 }, () => ({ input: { t: "a" }, expected_output: { r: "b" } }));
    const result = await pa.evals.proposeContract({ items, prompt: "grade the tone of each reply" });
    expect(result.boundTask).toBeNull();
    expect(result.isClean).toBe(false);
    await expect(pa.evals.sets.create({ items, prompt: "grade the tone of each reply" })).rejects.toThrow(
      /custom-eval/,
    );
    expect(posted).not.toContain("/v1/eval-sets"); // only propose ran, never a create POST
  });

  it("a task-less create throws on a conflict, quoting the prompt", async () => {
    const pa = makeClient(() =>
      jsonResponse(200, {
        proposals: [{ task_id: "intent-classification", confidence: "low", evidence: {} }],
        homogeneous: true, split: null, prompt: "summarize each utterance",
        conflict: { intended_task: "summarization", reasoning: "prompt says summarize" },
      }),
    );
    const items = Array.from({ length: 5 }, () => ({ input: { text: "a" }, expected_output: { label: "x" } }));
    await expect(pa.evals.sets.create({ items, prompt: "summarize each utterance" })).rejects.toThrow(
      /summarize each utterance/,
    );
  });

  it("list + delete", async () => {
    const seen: Array<[string, string]> = [];
    const pa = makeClient((url, init) => {
      seen.push([init.method as string, new URL(url).pathname]);
      if (init.method === "GET") return jsonResponse(200, { eval_sets: [{ id: "es_1", name: "n" }] });
      return new Response(null, { status: 204 });
    });
    const sets = await pa.evals.sets.list();
    expect(sets.map((s) => s.id)).toEqual(["es_1"]);
    await pa.evals.sets.delete("es_1");
    expect(seen).toContainEqual(["DELETE", "/v1/eval-sets/es_1"]);
  });

  it("uploadDocument uses the inline path for a small file", async () => {
    let path = "";
    let fd: FormData | undefined;
    const pa = makeClient((url, init) => {
      path = new URL(url).pathname;
      fd = init.body as FormData;
      return jsonResponse(200, { kind: "blob", uri: "gs://b/x", mime: "application/pdf" });
    });
    const out = (await pa.evals.sets.uploadDocument("es_1", new Uint8Array([37, 80, 68, 70]), {
      idx: 0,
      fieldName: "document",
      mime: "application/pdf",
    })) as { uri: string };
    expect(out.uri).toBe("gs://b/x");
    expect(path).toBe("/v1/eval-sets/es_1/attach-blob");
    expect(fd!.get("field_name")).toBe("document");
    expect(fd!.get("idx")).toBe("0");
  });
});

describe("eval runs", () => {
  it("create then wait polls to terminal; money is floored", async () => {
    let polls = 0;
    const pa = makeClient((url, init) => {
      const p = new URL(url).pathname;
      if (init.method === "POST" && p === "/v1/eval-runs") {
        const body = JSON.parse(init.body as string);
        expect(body.eval_set_id).toBe("es_1");
        expect(body.candidate_model_ids).toEqual(["qwen-1", "claude-opus-4-7"]); // merged
        return jsonResponse(202, { run_id: "run_1", status: "queued" });
      }
      polls += 1;
      const status = polls >= 2 ? "completed" : "running";
      return jsonResponse(200, {
        run: {
          id: "run_1",
          eval_set_id: "es_1",
          status,
          candidate_model_ids: ["qwen-1", "claude-opus-4-7"],
          total_cost_micro_usd: 1_234_567,
        },
        results: [{
          model_id: "qwen-1", kind: "open", quality_mean: 0.91, n_succeeded: 5, error_count: 0,
          per_item: [{ idx: 0, score: 0.0, prediction: "the model said this" },
                     { idx: 1, score: 1.0, prediction: "ok" }],
        }],
      });
    });
    const run = await pa.evals.runs.create({
      evalSet: "es_1",
      models: ["qwen-1"],
      frontier: ["claude-opus-4-7"],
      wait: true,
      pollInterval: 0,
    });
    expect(run).toBeInstanceOf(EvalRun);
    expect(run.status).toBe("completed");
    expect(run.cost).toBe("1.23"); // floored to cents
    expect(run.costMicroUsd).toBe(1_234_567);
    expect(run.results[0]!.modelId).toBe("qwen-1");
    expect(run.results[0]!.qualityMean).toBe(0.91);
    // per_item carries the raw prediction so a 0.0 score is debuggable
    const items = run.results[0]!.perItem;
    expect(items[0]!.idx).toBe(0);
    expect(items[0]!.score).toBe(0.0);
    expect(items[0]!.prediction).toBe("the model said this");
  });

  it("create from items auto-creates the eval set", async () => {
    const seen: Array<[string, string]> = [];
    const pa = makeClient((url, init) => {
      const p = new URL(url).pathname;
      seen.push([init.method as string, p]);
      if (p === "/v1/eval-sets") return jsonResponse(201, { eval_set: { id: "es_auto", item_count: 1 } });
      if (p === "/v1/eval-runs") {
        expect(JSON.parse(init.body as string).eval_set_id).toBe("es_auto");
        return jsonResponse(202, { run_id: "run_2", status: "queued" });
      }
      return jsonResponse(200, {});
    });
    const run = await pa.evals.runs.create({
      task: "intent-classification",
      prompt: "classify each utterance",
      items: [{ input: { text: "a" }, expected: "x" }],
      models: ["qwen-1"],
      wait: false,
    });
    expect(run.id).toBe("run_2");
    expect(seen).toContainEqual(["POST", "/v1/eval-sets"]);
    expect(seen).toContainEqual(["POST", "/v1/eval-runs"]);
  });
});

describe("frontier roster + resolution (Slice 4)", () => {
  it("frontierModels returns the roster (+ task-filtered benchmarked)", async () => {
    const pa = makeClient((url) => {
      const task = new URL(url).searchParams.get("task");
      return jsonResponse(200, {
        frontier_models: [
          { id: "gpt-5.5", vendor: "openai", vision: true, benchmarked: task === "contract-key-fields" },
          { id: "claude-opus-4-7", vendor: "anthropic", vision: true, benchmarked: false },
        ],
        task,
      });
    });
    const roster = await pa.evals.frontierModels();
    expect(roster.every((m) => m instanceof FrontierModel)).toBe(true);
    expect(new Set(roster.map((m) => m.id))).toEqual(new Set(["gpt-5.5", "claude-opus-4-7"]));
    const benched = await pa.evals.frontierModels("contract-key-fields");
    expect(benched.some((m) => m.id === "gpt-5.5" && m.benchmarked)).toBe(true);
  });

  it("runs.create resolves the 'benchmarked' keyword, preserving merge order", async () => {
    let cands: string[] = [];
    const pa = makeClient((url, init) => {
      const p = new URL(url).pathname;
      if (p === "/v1/eval/frontier-models") {
        return jsonResponse(200, {
          frontier_models: [
            { id: "gpt-5.5", vendor: "openai", vision: true, benchmarked: true },
            { id: "gemini-x", vendor: "google", vision: true, benchmarked: false },
          ],
        });
      }
      if (p === "/v1/eval-runs") {
        cands = JSON.parse(init.body as string).candidate_model_ids;
        return jsonResponse(202, { run_id: "r1", status: "queued" });
      }
      return jsonResponse(200, {});
    });
    await pa.evals.runs.create({
      evalSet: "es_1",
      task: "contract-key-fields",
      models: ["pareta-distilled-kie-1"],
      frontier: "benchmarked",
    });
    expect(cands).toEqual(["pareta-distilled-kie-1", "gpt-5.5"]); // only benchmarked, models first
  });

  it("frontier 'none' resolves to [] and an explicit list passes through", async () => {
    const seen: string[][] = [];
    const pa = makeClient((url, init) => {
      if (new URL(url).pathname === "/v1/eval-runs") {
        seen.push(JSON.parse(init.body as string).candidate_model_ids);
      }
      return jsonResponse(202, { run_id: "r", status: "queued" });
    });
    await pa.evals.runs.create({ evalSet: "es", models: ["qwen-1"], frontier: "none" });
    await pa.evals.runs.create({ evalSet: "es", models: ["qwen-1"], frontier: ["gpt-5.5"] });
    expect(seen).toEqual([["qwen-1"], ["qwen-1", "gpt-5.5"]]);
  });

  it("a frontier keyword with no resolvable task throws", async () => {
    const pa = makeClient((url) => {
      if (new URL(url).pathname.startsWith("/v1/eval-sets/")) {
        return jsonResponse(200, { eval_set: { id: "es_1" } }); // no task_id
      }
      return jsonResponse(202, { run_id: "x", status: "queued" });
    });
    await expect(
      pa.evals.runs.create({ evalSet: "es_1", models: ["qwen-1"], frontier: "benchmarked" }),
    ).rejects.toThrow(/cannot resolve a frontier keyword/);
  });
});
