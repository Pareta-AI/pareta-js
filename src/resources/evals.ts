/**
 * `client.evals` — eval sets + runs (bring-your-own-data evaluation).
 *
 *   // An eval set is DATA + INTENT (v2, breaking): intent REQUIRED, task
 *   // OPTIONAL — the binder resolves your intent + the data's shape.
 *   await pa.evals.proposeContract({ items: [...], intent: "…" });   // preview
 *   const set = await pa.evals.sets.create({ items: [...], intent: "…" });  // auto-binds
 *   await pa.evals.sets.uploadDocument(set.id, file, { idx, fieldName });   // blob tasks
 *   const run = await pa.evals.runs.create({ evalSet: set.id, models: [...], wait: true });
 *   // or, in one call: runs.create({ items, intent: "…", models, wait: true })
 *
 * `create` (and the inline `runs.create` sugar) require `intent`; with no
 * `task` they call `proposeContract` and auto-bind ONLY a clean single
 * high/medium match — a conflict, split, or ambiguity throws with the
 * proposals so you pin `task`.
 *
 * Runs are metered (the org balance is debited for compute); `run.cost` is the
 * billed total in dollars (floored to cents). `frontier` accepts an explicit
 * list of ids, or the "all"/"benchmarked"/"none" roster keywords (resolved via
 * `frontierModels()`).
 */

import type { Transport } from "../client.js";
import { ParetaError } from "../errors.js";
import {
  EvalRun,
  EvalSet,
  FrontierModel,
  ProposalResult,
  evalSetFromCreate,
  evalSetList,
  frontierModels as castFrontierModels,
  proposalResult,
} from "../models.js";

const BASE = "/v1/eval-sets";
const PROPOSE = "/v1/eval-sets/propose-contract";
const RUNS = "/v1/eval-runs";
const FRONTIER = "/v1/eval/frontier-models";
const INLINE_MAX = 5 * 1024 * 1024; // matches backend _ATTACH_BLOB_INLINE_MAX

/** "all" | "benchmarked" | "none" | an explicit list of frontier ids. */
export type FrontierSpec = "all" | "benchmarked" | "none" | string[] | null;

/** A document for `uploadDocument`: a filesystem path (Node), Blob, or bytes. */
export type FileInput = string | Blob | ArrayBuffer | Uint8Array;

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  tiff: "image/tiff",
  tif: "image/tiff",
  bmp: "image/bmp",
  txt: "text/plain",
  json: "application/json",
  jsonl: "application/jsonl",
  csv: "text/csv",
};

function guessMime(filename: string, override?: string): string {
  if (override) return override;
  const ext = filename.split(".").pop()?.toLowerCase();
  return (ext && MIME_BY_EXT[ext]) || "application/octet-stream";
}

/** Normalize any FileInput → a Blob + filename + size (path read is Node-only). */
async function toBlob(
  file: FileInput,
  mimeOverride?: string,
): Promise<{ blob: Blob; filename: string; size: number; mime: string }> {
  if (typeof file === "string") {
    // Path → lazy node:fs so the browser/edge bundle stays clean.
    const [{ readFile }, { basename }] = await Promise.all([
      import("node:fs/promises"),
      import("node:path"),
    ]);
    const buf = await readFile(file);
    const filename = basename(file);
    const mime = guessMime(filename, mimeOverride);
    return { blob: new Blob([buf as BlobPart], { type: mime }), filename, size: buf.byteLength, mime };
  }
  if (file instanceof Blob) {
    const mime = mimeOverride || file.type || "application/octet-stream";
    const blob = mimeOverride ? new Blob([file], { type: mime }) : file;
    return { blob, filename: "upload", size: file.size, mime };
  }
  const bytes = file instanceof Uint8Array ? file : new Uint8Array(file);
  const mime = mimeOverride || "application/octet-stream";
  return { blob: new Blob([bytes as BlobPart], { type: mime }), filename: "upload", size: bytes.byteLength, mime };
}

/**
 * CB1 (v2 breaking): an eval set is DATA + INTENT — the same rows can mean
 * different tasks, and only the caller knows which. Enforced client-side so the
 * error is actionable before the request (the server also 400s an intent-less
 * create, which is how pre-v2 SDKs surface the change).
 */
function requireIntent(intent: string | undefined): string {
  const s = (intent ?? "").trim();
  if (!s) {
    throw new ParetaError(
      'intent is required: one sentence describing what the model should do ' +
      'with each item (e.g. "extract vendor, total and date from each ' +
      'invoice"). Pass intent to evals.create / proposeContract.');
  }
  return s.slice(0, 500);
}

function itemsJsonl(
  task: string,
  items: Array<Record<string, unknown>>,
  intent: string,
  name?: string,
): { files: Record<string, { filename: string; content: string; contentType: string }>; data: Record<string, string> } {
  if (!items || items.length === 0) throw new ParetaError("items is required and must be non-empty");
  const jsonl = items.map((it) => JSON.stringify(it)).join("\n");
  return {
    files: { items: { filename: `items.${task}.jsonl`, content: jsonl, contentType: "application/jsonl" } },
    data: { task_id: task, intent, name: name || `sdk eval set (${items.length} items)` },
  };
}

function proposeMultipart(
  items: Array<Record<string, unknown>>,
  intent: string,
): { files: Record<string, { filename: string; content: string; contentType: string }>; data: Record<string, string> } {
  if (!items || items.length === 0) throw new ParetaError("items is required and must be non-empty");
  const jsonl = items.map((it) => JSON.stringify(it)).join("\n");
  return {
    files: { items: { filename: "items.jsonl", content: jsonl, contentType: "application/jsonl" } },
    data: { intent },
  };
}

/** Turn a non-clean propose result into an actionable create-time error. */
function bindError(result: ProposalResult): ParetaError {
  const intent = result.intent ?? "";
  if (result.conflict) {
    const c = result.conflict;
    return new ParetaError(
      `intent '${intent}' describes a different job than the data's shape ` +
      `supports (reads as '${c.intended_task}': ${c.reasoning}). Pass a task ` +
      "to pin a contract, or revise the intent.");
  }
  if (result.split) {
    const s = result.split;
    return new ParetaError(
      `the dataset looks MIXED — ${s.validated_n}/${s.total_n} items fit ` +
      `'${s.closest_task}', the rest a different shape. Split the set or pass a task.`);
  }
  // Zero-fit: the binder offers the custom-eval universal FLOOR (judged
  // win-rate vs the anchor). Per the precision ladder that's the user's
  // CHOICE — surface it explicitly rather than silently binding it.
  const props = result.proposals;
  if (props.length === 1 && props[0].taskId === "custom-eval") {
    const warn = props[0].warning ? ` (${props[0].warning})` : "";
    return new ParetaError(
      `no specific grading contract fits this data for intent '${intent}'. The ` +
      "custom-eval universal floor is available — it grades by judged win-rate " +
      `vs the frontier anchor.${warn} Pass task: "custom-eval" to use it, or ` +
      "revise the data/intent for a specific contract.");
  }
  const options = props.map((p) => p.taskId).filter(Boolean);
  if (options.length === 0 && result.closestTask) options.push(result.closestTask);
  const hint = options.length ? ` Candidates: ${options.join(", ")}.` : "";
  return new ParetaError(
    `could not confidently bind a grading contract for intent '${intent}'.${hint} ` +
    "Pass a task to pin one, or inspect evals.proposeContract({ items, intent }).");
}

function mergeCandidates(models: string[], frontierIds: string[]): string[] {
  // Order matters: open models first, then frontier ids; no sort/dedupe.
  const cands = [...(models ?? []), ...(frontierIds ?? [])];
  if (cands.length === 0) throw new ParetaError("models is required (the open candidates to evaluate)");
  return cands;
}

function resolveFrontierFromRoster(frontier: string, roster: FrontierModel[]): string[] {
  if (frontier === "all") return roster.map((m) => m.id!).filter((x): x is string => x != null);
  if (frontier === "benchmarked") {
    return roster.filter((m) => m.benchmarked).map((m) => m.id!).filter((x): x is string => x != null);
  }
  throw new ParetaError(
    `unknown frontier keyword '${frontier}' (use 'all'/'benchmarked'/'none' or a list)`,
  );
}

const sleep = (seconds: number): Promise<void> => new Promise((r) => setTimeout(r, seconds * 1000));

export class EvalSets {
  constructor(private readonly client: Transport) {}

  /**
   * Persist an eval set from your rows. `intent` is REQUIRED (v2): one sentence
   * on what the model should do with each item. `task` is OPTIONAL — omit it and
   * the binder resolves your intent + the data's shape to a grading contract
   * (auto-binds a clean single match; throws with the proposals otherwise). Pass
   * `task` to pin one explicitly.
   */
  async create(params: {
    items: Array<Record<string, unknown>>;
    intent: string;
    task?: string;
    name?: string;
  }): Promise<EvalSet> {
    const intent = requireIntent(params.intent);
    let task = params.task;
    if (task == null) {
      const proposal = await this.proposeContract(params.items, intent);
      task = proposal.boundTask ?? undefined;
      if (task == null) throw bindError(proposal);
    }
    const { files, data } = itemsJsonl(task, params.items, intent, params.name);
    return this.client.request<EvalSet>("POST", BASE, { files, data, cast: evalSetFromCreate });
  }

  /** Internal: the binder call `create` uses when no task is pinned. Public on
   * `Evals` as `proposeContract`; kept here so `sets.create` can reach it. */
  proposeContract(items: Array<Record<string, unknown>>, intent: string): Promise<ProposalResult> {
    const { files, data } = proposeMultipart(items, requireIntent(intent));
    return this.client.request<ProposalResult>("POST", PROPOSE, { files, data, cast: proposalResult });
  }

  list(): Promise<EvalSet[]> {
    return this.client.request<EvalSet[]>("GET", BASE, { cast: evalSetList });
  }

  async retrieve(evalSetId: string): Promise<EvalSet> {
    const raw = await this.client.request<Record<string, unknown>>("GET", `${BASE}/${evalSetId}`);
    return new EvalSet(((raw ?? {}).eval_set as Record<string, unknown>) ?? {});
  }

  async delete(evalSetId: string): Promise<void> {
    await this.client.request("DELETE", `${BASE}/${evalSetId}`);
  }

  /**
   * Attach a binary doc (PDF/image) to one row's blob field. Collapses the
   * 3-call signed-URL flow (or the inline path for small files) into one call.
   * `idx` is the 0-based row, `fieldName` the blob input field.
   */
  async uploadDocument(
    evalSetId: string,
    file: FileInput,
    opts: { idx: number; fieldName: string; mime?: string },
  ): Promise<unknown> {
    const { blob, filename, size, mime } = await toBlob(file, opts.mime);
    if (size < INLINE_MAX) {
      return this.client.request("POST", `${BASE}/${evalSetId}/attach-blob`, {
        files: { file: { filename, content: blob, contentType: mime } },
        data: { idx: String(opts.idx), field_name: opts.fieldName, mime },
      });
    }
    // Large file → signed-URL direct-to-storage (raw PUT to GCS, no Pareta auth).
    const minted = await this.client.request<{ upload_url: string; storage_uri: string }>(
      "POST",
      `${BASE}/${evalSetId}/blob-upload-url`,
      { body: { idx: opts.idx, field_name: opts.fieldName, mime, file_size: size } },
    );
    const put = await globalThis.fetch(minted.upload_url, {
      method: "PUT",
      body: blob,
      headers: { "Content-Type": mime },
      signal: AbortSignal.timeout(600_000),
    });
    if (put.status !== 200 && put.status !== 201) {
      throw new ParetaError(`blob upload PUT failed: ${put.status}`);
    }
    return this.client.request("POST", `${BASE}/${evalSetId}/blob-upload-complete`, {
      body: { idx: opts.idx, field_name: opts.fieldName, storage_uri: minted.storage_uri, mime },
    });
  }
}

export interface EvalRunCreateParams {
  evalSet?: string;
  task?: string;
  items?: Array<Record<string, unknown>>;
  intent?: string;
  models: string[];
  frontier?: FrontierSpec;
  name?: string;
  wait?: boolean;
  pollInterval?: number;
  timeout?: number;
}

export class EvalRuns {
  constructor(
    private readonly client: Transport,
    private readonly sets: EvalSets,
  ) {}

  private async frontierIds(frontier: FrontierSpec | undefined, evalSet: string | undefined, task?: string): Promise<string[]> {
    if (frontier == null || frontier === "none") return [];
    if (Array.isArray(frontier)) return [...frontier];
    if (typeof frontier !== "string") {
      throw new TypeError("frontier must be null, a list of ids, or 'all'/'benchmarked'/'none'");
    }
    let resolveTask = task;
    if (!resolveTask && evalSet) resolveTask = (await this.sets.retrieve(evalSet)).taskId ?? undefined;
    if (!resolveTask) throw new ParetaError("cannot resolve a frontier keyword without a task");
    const roster = await this.client.request<FrontierModel[]>("GET", FRONTIER, {
      params: { task: resolveTask },
      cast: castFrontierModels,
    });
    return resolveFrontierFromRoster(frontier, roster);
  }

  async create(params: EvalRunCreateParams): Promise<EvalRun> {
    let evalSet = params.evalSet;
    if (evalSet == null) {
      if (!params.items) {
        throw new ParetaError("pass evalSet: <id>, or items (+ intent) to create one");
      }
      evalSet = (await this.sets.create({
        items: params.items, intent: params.intent as string,
        task: params.task, name: params.name,
      })).id ?? undefined;
    }
    const frontierIds = await this.frontierIds(params.frontier, evalSet, params.task);
    const candidateModelIds = mergeCandidates(params.models, frontierIds);
    const started = await this.client.request<{ run_id: string; status?: string }>("POST", RUNS, {
      body: { eval_set_id: evalSet, candidate_model_ids: candidateModelIds },
    });
    if (params.wait) {
      return this.wait(started.run_id, { pollInterval: params.pollInterval, timeout: params.timeout });
    }
    // Thin stub (not a fetch) — cost reads "0.00" until you retrieve().
    return new EvalRun({ run: { id: started.run_id, status: started.status } });
  }

  retrieve(runId: string): Promise<EvalRun> {
    return this.client.request<EvalRun>("GET", `${RUNS}/${runId}`, {
      cast: (raw) => new EvalRun(raw as Record<string, unknown>),
    });
  }

  async wait(runId: string, opts: { pollInterval?: number; timeout?: number } = {}): Promise<EvalRun> {
    const pollInterval = opts.pollInterval ?? 3;
    const timeout = opts.timeout ?? 900;
    const deadline = Date.now() + timeout * 1000;
    for (;;) {
      const run = await this.retrieve(runId);
      if (run.isTerminal) return run;
      if (Date.now() >= deadline) {
        throw new ParetaError(`eval run ${runId} did not finish within ${Math.round(timeout)}s`);
      }
      await sleep(pollInterval);
    }
  }
}

export class Evals {
  readonly sets: EvalSets;
  readonly runs: EvalRuns;

  constructor(client: Transport) {
    this.sets = new EvalSets(client);
    this.runs = new EvalRuns(client, this.sets);
    this.client = client;
  }
  private readonly client: Transport;

  /**
   * Which grading contract fits your data under your stated `intent`? Stateless
   * discovery — nothing is persisted. Returns a ProposalResult (ranked
   * proposals, the auto-bind decision, conflict/split reporting). `sets.create`
   * calls this under the hood; use it directly to preview the binding first.
   */
  proposeContract(params: { items: Array<Record<string, unknown>>; intent: string }): Promise<ProposalResult> {
    return this.sets.proposeContract(params.items, params.intent);
  }

  /**
   * The frontier (vendor) roster you can evaluate against. With `task`, each is
   * annotated `benchmarked` + the roster is vision-filtered for document tasks.
   */
  frontierModels(task?: string): Promise<FrontierModel[]> {
    const params = task ? { task } : undefined;
    return this.client.request<FrontierModel[]>("GET", FRONTIER, { params, cast: castFrontierModels });
  }
}
