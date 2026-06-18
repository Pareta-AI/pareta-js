import { describe, expect, it } from "vitest";
import { EvalRun, EvalSet, FrontierModel, ParetaError } from "../src/index.js";
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
    const items = fd!.get("items") as Blob;
    const text = await items.text();
    expect(text).toContain('"text":"a"');
    expect(text.trim().split("\n").length).toBe(2);
  });

  it("create rejects empty items", () => {
    const pa = makeClient(() => jsonResponse(201, { eval_set: {} }));
    expect(() => pa.evals.sets.create({ task: "t", items: [] })).toThrow(ParetaError);
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
        results: [{ model_id: "qwen-1", kind: "open", quality_mean: 0.91, n_succeeded: 5, error_count: 0 }],
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
