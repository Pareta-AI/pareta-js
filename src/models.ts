/**
 * Response objects — hand-written wrappers over the raw server JSON, a faithful
 * port of the Python `_models.py`. Each keeps the raw payload on `.raw` and
 * exposes it via `.toDict()`, so nothing the API returns is lost behind the
 * typed layer.
 *
 * Alias / D3 boundary (a BACKEND contract, the SDK adds no alias logic):
 * `EvalResult.modelId` and `run.candidateModels` are per-task PUBLIC aliases —
 * real open-weights ids never cross. Frontier (vendor) ids are in the clear.
 */

import { dollarsFlooredToCents } from "./money.js";

type Raw = Record<string, any>;

/** Base: holds the raw payload, dict-style escape hatches. */
export class BaseModel {
  /** The raw server JSON, untouched. */
  readonly raw: Raw;
  constructor(raw?: Raw) {
    this.raw = raw ?? {};
  }
  /** The raw server JSON (alias of `.raw`, mirrors Python `.to_dict()`). */
  toDict(): Raw {
    return this.raw;
  }
  /** Read an arbitrary key off the raw payload. */
  get<T = unknown>(key: string, fallback?: T): T {
    const v = this.raw[key];
    return (v === undefined ? (fallback as T) : (v as T));
  }
}

// ── inference ──────────────────────────────────────────────────────────
export class Usage extends BaseModel {
  get promptTokens(): number | null { return this.raw.prompt_tokens ?? null; }
  get completionTokens(): number | null { return this.raw.completion_tokens ?? null; }
  get totalTokens(): number | null { return this.raw.total_tokens ?? null; }
}

export class Message extends BaseModel {
  get role(): string | null { return this.raw.role ?? null; }
  get content(): string | null { return this.raw.content ?? null; }
}

export class Choice extends BaseModel {
  get index(): number | null { return this.raw.index ?? null; }
  get finishReason(): string | null { return this.raw.finish_reason ?? null; }
  get message(): Message { return new Message(this.raw.message ?? {}); }
  /** Streaming chunks carry `delta` instead of `message`. */
  get delta(): Message { return new Message(this.raw.delta ?? {}); }
}

export class ChatCompletion extends BaseModel {
  get id(): string | null { return this.raw.id ?? null; }
  get model(): string | null { return this.raw.model ?? null; }
  get created(): number | null { return this.raw.created ?? null; }
  get choices(): Choice[] { return (this.raw.choices ?? []).map((c: Raw) => new Choice(c)); }
  get usage(): Usage { return new Usage(this.raw.usage ?? {}); }
}

/** One SSE delta. `chunk.choices[0].delta.content` is the incremental text. */
export class ChatCompletionChunk extends ChatCompletion {}

export class Model extends BaseModel {
  get id(): string | null { return this.raw.id ?? null; }
  get ownedBy(): string | null { return this.raw.owned_by ?? null; }
  get created(): number | null { return this.raw.created ?? null; }
}

/** The OpenAI-compatible `/v1/models` list. Exposes `.data` and is iterable. */
export class ModelList extends BaseModel implements Iterable<Model> {
  get data(): Model[] { return (this.raw.data ?? []).map((m: Raw) => new Model(m)); }
  get length(): number { return (this.raw.data ?? []).length; }
  [Symbol.iterator](): Iterator<Model> { return this.data[Symbol.iterator](); }
}

// ── tasks ──────────────────────────────────────────────────────────────
export class Task extends BaseModel {
  get id(): string | null { return this.raw.id ?? null; }
  get defaultScorer(): string | null { return this.raw.default_scorer ?? null; }
  get hasBlobInput(): boolean { return Boolean(this.raw.has_blob_input); }
}

/** GET /v1/tasks → {"tasks": [...]}. */
export function taskList(raw: unknown): Task[] {
  return (((raw as Raw)?.tasks as Raw[]) ?? []).map((t) => new Task(t));
}

export class TaskMatchCandidate extends BaseModel {
  get taskId(): string | null { return this.raw.task_id ?? null; }
  get score(): number | null { return this.raw.score ?? null; }
  get confidence(): string | null { return this.raw.confidence ?? null; }
}

/** Result of `tasks.match()`: `.matched`, `.chosen` (best or null), `.candidates`. */
export class TaskMatch extends BaseModel {
  get query(): string | null { return this.raw.query ?? null; }
  get matched(): boolean { return Boolean(this.raw.matched); }
  get chosen(): TaskMatchCandidate | null {
    return this.raw.chosen ? new TaskMatchCandidate(this.raw.chosen) : null;
  }
  get candidates(): TaskMatchCandidate[] {
    return (this.raw.candidates ?? []).map((c: Raw) => new TaskMatchCandidate(c));
  }
  get ambiguous(): boolean { return Boolean(this.raw.ambiguous); }
  get matcher(): string | null { return this.raw.matcher ?? null; }
}

// ── evals ──────────────────────────────────────────────────────────────
export class EvalSet extends BaseModel {
  get id(): string | null { return this.raw.id ?? null; }
  get taskId(): string | null { return this.raw.task_id ?? null; }
  get name(): string | null { return this.raw.name ?? null; }
  get itemCount(): number | null { return this.raw.item_count ?? null; }
  get scoringStrategy(): string | null { return this.raw.scoring_strategy ?? null; }
  /** The one-sentence success criterion this set was created with (CB1:
   * DATA + INTENT). Required at create. */
  get intent(): string | null { return this.raw.intent ?? null; }
}

/** POST /v1/eval-sets → {"eval_set": {...}}. */
export function evalSetFromCreate(raw: unknown): EvalSet {
  return new EvalSet((raw as Raw)?.eval_set ?? {});
}
/** GET /v1/eval-sets → {"eval_sets": [...]}. */
export function evalSetList(raw: unknown): EvalSet[] {
  return (((raw as Raw)?.eval_sets as Raw[]) ?? []).map((e) => new EvalSet(e));
}

/**
 * One proposed grading contract for an uploaded dataset (a row of
 * `ProposalResult.proposals`). `warning` is set on the custom-eval floor when
 * the data looks extraction-shaped (judge grading is weaker there).
 */
export class ContractProposal extends BaseModel {
  get taskId(): string | null { return this.raw.task_id ?? null; }
  get confidence(): string | null { return this.raw.confidence ?? null; }
  get evidence(): Raw { return this.raw.evidence ?? {}; }
  get warning(): string | null { return this.raw.warning ?? null; }
}

/**
 * The binder's answer for `evals.proposeContract` (POST
 * /v1/eval-sets/propose-contract): which grading contract(s) fit your data
 * under your stated intent. Nothing is persisted — confirm by passing the
 * chosen `taskId` (or letting `create` auto-bind a clean single proposal).
 */
export class ProposalResult extends BaseModel {
  get proposals(): ContractProposal[] {
    return (this.raw.proposals ?? []).map((p: Raw) => new ContractProposal(p));
  }
  get homogeneous(): boolean { return Boolean(this.raw.homogeneous); }
  get split(): Raw | null { return this.raw.split ?? null; }
  get conflict(): Raw | null { return this.raw.conflict ?? null; }
  get closestTask(): string | null { return this.raw.closest_task ?? null; }
  get intent(): string | null { return this.raw.intent ?? null; }
  get message(): string | null { return this.raw.message ?? null; }
  /** True when the binder matched exactly ONE homogeneous SPECIFIC contract at
   * high/medium confidence and no conflict/split — the case `create` auto-binds
   * without a human confirming. The `custom-eval` universal FLOOR is EXCLUDED:
   * the binder offers it only when no specific contract fits, and per the
   * precision ladder the floor is a CHOICE — the user opts in with
   * `task: "custom-eval"`, never a silent auto-bind. */
  get isClean(): boolean {
    const props = this.proposals;
    return (this.homogeneous && this.conflict == null && this.split == null
      && props.length === 1
      && (props[0].confidence === "high" || props[0].confidence === "medium")
      && Boolean(props[0].taskId)
      && props[0].taskId !== "custom-eval");
  }
  /** The task `create` would auto-bind, or null if the result isn't clean. */
  get boundTask(): string | null {
    return this.isClean ? this.proposals[0].taskId : null;
  }
}

/** POST /v1/eval-sets/propose-contract → the proposal object (flat). */
export function proposalResult(raw: unknown): ProposalResult {
  return new ProposalResult((raw as Raw) ?? {});
}

/**
 * One scored item inside `EvalResult.perItem`. `prediction` is the model's raw
 * output, truncated server-side — present only on items that reached scoring
 * (not pool/build errors), there to debug a 0.0 `score` without re-running.
 */
export class EvalItemResult extends BaseModel {
  get idx(): number | null { return this.raw.idx ?? null; }
  get score(): number | null { return this.raw.score ?? null; }
  get prediction(): string | null { return this.raw.prediction ?? null; }
  get error(): string | null { return this.raw.error ?? null; }
}

/**
 * One model's aggregate on an eval run. `modelId` is the per-task public alias;
 * `kind` ('open' | 'frontier') is populated by the Slice-4 result schema.
 */
export class EvalResult extends BaseModel {
  get modelId(): string | null { return this.raw.model_id ?? null; }
  get kind(): string | null { return this.raw.kind ?? null; }
  get qualityMean(): number | null { return this.raw.quality_mean ?? null; }
  get qualityCiLow(): number | null { return this.raw.quality_ci_low ?? null; }
  get qualityCiHigh(): number | null { return this.raw.quality_ci_high ?? null; }
  // Raw integer — sub-cent unit rate, NOT floored (see money.ts).
  get meanCostMicroUsd(): number | null { return this.raw.mean_cost_micro_usd ?? null; }
  get nSucceeded(): number | null { return this.raw.n_succeeded ?? null; }
  get errorCount(): number | null { return this.raw.error_count ?? null; }
  /** Per-item rows (idx/score/prediction/error); empty when not persisted. */
  get perItem(): EvalItemResult[] {
    return (this.raw.per_item ?? []).map((it: Raw) => new EvalItemResult(it));
  }
}

/** A vendor frontier model you can evaluate against (from the eval pool). */
export class FrontierModel extends BaseModel {
  get id(): string | null { return this.raw.id ?? null; }
  get vendor(): string | null { return this.raw.vendor ?? null; }
  get vision(): boolean { return Boolean(this.raw.vision); }
  /** Only meaningful when a task was given: it has benchmark results on that task. */
  get benchmarked(): boolean { return Boolean(this.raw.benchmarked); }
}

export function frontierModels(raw: unknown): FrontierModel[] {
  return (((raw as Raw)?.frontier_models as Raw[]) ?? []).map((m) => new FrontierModel(m));
}

/**
 * Wraps the GET /v1/eval-runs/{id} envelope `{"run": {...}, "results": [...]}`.
 * `cost` is the billed total as a floored fixed-2dp dollar string (§6);
 * `costMicroUsd` is the raw integer.
 */
export class EvalRun extends BaseModel {
  private get run(): Raw { return this.raw.run ?? {}; }
  get id(): string | null { return this.run.id ?? null; }
  get evalSetId(): string | null { return this.run.eval_set_id ?? null; }
  get status(): string | null { return this.run.status ?? null; }
  get isTerminal(): boolean {
    return this.run.status === "completed" || this.run.status === "failed";
  }
  get candidateModels(): string[] { return [...(this.run.candidate_model_ids ?? [])]; }
  get errorDetail(): string | null { return this.run.error_detail ?? null; }
  /** Raw billed micro-USD integer. */
  get costMicroUsd(): number { return Number(this.run.total_cost_micro_usd ?? 0); }
  /** Billed total, floored to whole cents, as a fixed-2dp dollar string ("1.23"). */
  get cost(): string { return dollarsFlooredToCents(this.run.total_cost_micro_usd); }
  get results(): EvalResult[] {
    return (this.raw.results ?? []).map((r: Raw) => new EvalResult(r));
  }
}

// ── retrieval (rerank + embeddings) ────────────────────────────────────

/** One row of `Rerank.results` — a document's position + calibrated score. */
export class RerankResult extends BaseModel {
  /** Position of this document in YOUR request's documents array. */
  get index(): number { return Number(this.raw.index ?? -1); }
  /** Calibrated P(relevant) in (0, 1) — thresholdable, not just ordinal. */
  get relevanceScore(): number { return Number(this.raw.relevance_score ?? 0); }
}

/** Result of `pa.rerank(...)`: `.results` ordered most-relevant-first;
 * `.pairs` is the number of documents scored (the metered unit). */
export class Rerank extends BaseModel {
  get results(): RerankResult[] {
    return (this.raw.results ?? []).map((r: Raw) => new RerankResult(r));
  }
  get model(): string | null { return this.raw.model ?? null; }
  get pairs(): number | null { return this.raw.pairs ?? null; }
  /** Map the ranked indices back onto the documents you sent — best first. */
  topDocuments(documents: string[]): string[] {
    return this.results
      .filter((r) => r.index >= 0 && r.index < documents.length)
      .map((r) => documents[r.index]!);
  }
}

/** Result of `pa.embeddings(...)`: unit-normalized vectors in input order
 * (cosine similarity is a plain dot product); `.promptTokens` is metered. */
export class Embeddings extends BaseModel {
  get vectors(): number[][] {
    const rows = [...((this.raw.data ?? []) as Raw[])];
    rows.sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0));
    return rows.map((r) => (r.embedding as number[]) ?? []);
  }
  get model(): string | null { return this.raw.model ?? null; }
  get promptTokens(): number | null { return this.raw.usage?.prompt_tokens ?? null; }
  get length(): number { return ((this.raw.data ?? []) as Raw[]).length; }
}

// ── audio (ASR + TTS) ──────────────────────────────────────────────────

/** Browser-safe base64 → Uint8Array (Buffer in Node, atob elsewhere). */
function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"));
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Speech-to-text result from `audio.transcriptions(...)`. `.durationS` is
 * the metered input audio length (per minute). */
export class Transcription extends BaseModel {
  get text(): string | null { return this.raw.text ?? null; }
  get language(): string | null { return this.raw.language ?? null; }
  get durationS(): number | null { return this.raw.duration_s ?? null; }
  toString(): string { return this.text ?? ""; }
}

/** Text-to-speech result from `audio.speech(...)`. `.audio` is decoded
 * bytes; `.durationS` is the metered output audio length (per minute). */
export class Speech extends BaseModel {
  /** The synthesized audio, base64-decoded to raw bytes. */
  get audio(): Uint8Array {
    const b64 = (this.raw.audio_base64 as string) || "";
    return b64 ? base64ToBytes(b64) : new Uint8Array(0);
  }
  get audioBase64(): string | null { return this.raw.audio_base64 ?? null; }
  get sampleRate(): number | null { return this.raw.sample_rate ?? null; }
  get durationS(): number | null { return this.raw.duration_s ?? null; }
  /** Container/codec of the returned audio (e.g. "wav"). */
  get format(): string | null { return this.raw.format ?? null; }
  /** Write the decoded audio to `path` (Node only — lazy node:fs). */
  async save(path: string): Promise<this> {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path, this.audio);
    return this;
  }
}

/** Image result from `images.generate(...)`. `.image` is decoded PNG bytes;
 * `.size` is the ACTUAL delivered size. Billed flat per image (the
 * `X-Pareta-Billed` response header carries the receipt). */
export class ImageGeneration extends BaseModel {
  /** The generated image, base64-decoded to raw PNG bytes. */
  get image(): Uint8Array {
    const b64 = this.b64Json ?? "";
    return b64 ? base64ToBytes(b64) : new Uint8Array(0);
  }
  get b64Json(): string | null {
    const data = (this.raw.data as Array<Record<string, unknown>>) ?? [];
    return (data[0]?.b64_json as string) ?? null;
  }
  get size(): string | null { return this.raw.size ?? null; }
  get model(): string | null { return this.raw.model ?? null; }
  get created(): number | null { return this.raw.created ?? null; }
  /** Write the decoded PNG to `path` (Node only — lazy node:fs). */
  async save(path: string): Promise<this> {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path, this.image);
    return this;
  }
}
