/**
 * Response objects — hand-written wrappers over the raw server JSON, a faithful
 * port of the Python `_models.py`. Each keeps the raw payload on `.raw` and
 * exposes it via `.toDict()`, so nothing the API returns is lost behind the
 * typed layer.
 *
 * Alias / D3 boundary (a BACKEND contract, the SDK adds no alias logic):
 * `Endpoint.model`, `EvalResult.modelId`, leaderboard names and
 * `run.candidateModels` are per-task PUBLIC aliases — real open-weights ids
 * never cross. Frontier (vendor) ids are in the clear.
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

/**
 * A deployed endpoint. `id` (== name) is what you pass to
 * `chat.completions.create({ model })`. `model` is the per-task public alias.
 */
export class Endpoint extends BaseModel {
  get id(): string | null { return this.raw.id ?? this.raw.name ?? null; }
  get name(): string | null { return this.raw.name ?? null; }
  get model(): string | null { return this.raw.model ?? null; }
  get status(): string | null { return this.raw.status ?? null; }
  // Live list sends camelCase `taskName`; the detail record sends `task`.
  get task(): string | null { return this.raw.taskName ?? this.raw.task ?? null; }
  get url(): string | null { return this.raw.url ?? null; }
  get isLive(): boolean { return this.raw.status === "live"; }
}

/** GET /v1/endpoints returns a BARE JSON array. */
export function endpointList(raw: unknown): Endpoint[] {
  return ((raw as Raw[]) ?? []).map((e) => new Endpoint(e));
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
}

export class LeaderboardEntry extends BaseModel {
  get name(): string | null { return this.raw.name ?? null; }
  get kind(): string | null { return this.raw.kind ?? null; }
  get quality(): number | null { return this.raw.quality ?? null; }
  // Raw integer — sub-cent unit rate, NOT floored (see money.ts).
  get costPerRequestMicroUsd(): number | null { return this.raw.cost_per_request_micro_usd ?? null; }
  get contextK(): number | null { return this.raw.context_k ?? null; }
  get runMode(): string | null { return this.raw.run_mode ?? null; }
}

/** Models ranked for a task. `recommended` is the deployable pick; `frontier` the baseline. */
export class Leaderboard extends BaseModel {
  get taskId(): string | null { return this.raw.task_id ?? null; }
  get metric(): string | null { return this.raw.metric ?? null; }
  get costUnit(): string | null { return this.raw.cost_unit ?? null; }
  get recommended(): string | null { return this.raw.recommended ?? null; }
  get models(): LeaderboardEntry[] {
    return (this.raw.models ?? []).map((m: Raw) => new LeaderboardEntry(m));
  }
  get frontier(): LeaderboardEntry | null {
    return this.raw.frontier ? new LeaderboardEntry(this.raw.frontier) : null;
  }
}

/** A vendor frontier model you can evaluate against (from the eval pool). */
export class FrontierModel extends BaseModel {
  get id(): string | null { return this.raw.id ?? null; }
  get vendor(): string | null { return this.raw.vendor ?? null; }
  get vision(): boolean { return Boolean(this.raw.vision); }
  /** Only meaningful when a task was given: it's on that task's leaderboard. */
  get benchmarked(): boolean { return Boolean(this.raw.benchmarked); }
}

export function leaderboardFrom(raw: unknown): Leaderboard {
  return new Leaderboard((raw as Raw) ?? {});
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
