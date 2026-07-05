/**
 * The `Pareta` client — one class (no sync/async split; JS is Promise-only).
 * A faithful port of the Python `_client.py` transport: header construction,
 * the retry policy, error mapping, and the `started`-flag streaming rule.
 */

import {
  APIConnectionError,
  APITimeoutError,
  APIStatusError,
  ParetaError,
  errorFromResponse,
  type ErrorDetail,
} from "./errors.js";
import { parseSSE, type SSEEvent } from "./streaming.js";
import { VERSION } from "./version.js";
import { Chat } from "./resources/chat.js";
import { Models } from "./resources/models.js";
import { Endpoints } from "./resources/endpoints.js";
import { Tasks } from "./resources/tasks.js";
import { Evals } from "./resources/evals.js";
import { Auto } from "./resources/auto.js";

export const DEFAULT_BASE_URL = "https://api.pareta.ai";
export const DEFAULT_TIMEOUT_MS = 60_000;
export const DEFAULT_MAX_RETRIES = 2;

// 409 here is the transient lock/contention class; Pareta's own 409 (seed/legacy
// endpoint) is a stable 4xx that just exhausts retries and still raises
// ConflictError, so callers see the right error either way.
const RETRY_STATUSES = new Set([408, 409, 429, 500, 502, 503, 504]);

type FetchFn = typeof globalThis.fetch;

/** A multipart file part (used by eval-set + blob uploads). */
export interface FilePart {
  filename: string;
  content: Blob | ArrayBuffer | ArrayBufferView | string;
  contentType?: string;
}

export interface RequestOptions {
  body?: unknown;
  params?: Record<string, unknown> | undefined;
  files?: Record<string, FilePart>;
  data?: Record<string, string>;
  cast?: (raw: unknown) => unknown;
}

export interface StreamOptions {
  body?: unknown;
  params?: Record<string, unknown> | undefined;
  cast?: (raw: unknown) => unknown;
  events?: boolean;
}

/** What resource namespaces depend on (lets them avoid importing the class). */
export interface Transport {
  request<T = unknown>(method: string, path: string, opts?: RequestOptions): Promise<T>;
  stream<T = unknown>(method: string, path: string, opts?: StreamOptions): AsyncGenerator<T>;
}

export interface ParetaOptions {
  /** `pareta_sk_` secret key. Falls back to PARETA_API_KEY via `fromEnv`. */
  apiKey?: string;
  /** API base URL. Default https://api.pareta.ai (trailing slashes stripped). */
  baseURL?: string;
  /** Overall per-request timeout in ms. Default 60000. */
  timeout?: number;
  /** Max retries for transient failures. Default 2. */
  maxRetries?: number;
  /** Injected fetch implementation (for tests / Node-without-global-fetch). */
  fetch?: FetchFn;
}

function normalizeBaseURL(url: string): string {
  return url.replace(/\/+$/, "");
}

export class Pareta implements Transport {
  readonly apiKey: string;
  readonly baseURL: string;
  readonly timeout: number;
  readonly maxRetries: number;
  private readonly fetchImpl: FetchFn;

  // Resource namespaces (assigned in the constructor; filled in slice by slice).
  readonly chat: Chat;
  readonly models: Models;
  readonly endpoints: Endpoints;
  readonly tasks: Tasks;
  readonly evals: Evals;
  readonly auto: Auto;

  constructor(options: ParetaOptions = {}) {
    if (!options.apiKey) {
      throw new ParetaError(
        "missing API key. Pass apiKey: … or use Pareta.fromEnv() with PARETA_API_KEY " +
          "(mint a pareta_sk_ key in the dashboard).",
      );
    }
    this.apiKey = options.apiKey;
    this.baseURL = normalizeBaseURL(options.baseURL || DEFAULT_BASE_URL);
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = Math.max(0, Math.trunc(options.maxRetries ?? DEFAULT_MAX_RETRIES));
    const f = options.fetch ?? globalThis.fetch;
    if (typeof f !== "function") {
      throw new ParetaError("no fetch implementation found — pass fetch: … (Node < 18 needs a polyfill).");
    }
    this.fetchImpl = options.fetch ? f : f.bind(globalThis);

    // Resources import only the Transport *type* from this module (erased at
    // runtime), so these static imports create no runtime circular dependency.
    this.chat = new Chat(this);
    this.models = new Models(this);
    this.endpoints = new Endpoints(this);
    this.tasks = new Tasks(this);
    this.evals = new Evals(this);
    this.auto = new Auto(this);
  }

  /** Build from PARETA_API_KEY (+ optional PARETA_BASE_URL); explicit opts win. */
  static fromEnv(options: ParetaOptions = {}): Pareta {
    const env: Record<string, string | undefined> =
      typeof process !== "undefined" && process.env ? process.env : {};
    return new Pareta({
      ...options,
      apiKey: options.apiKey || env.PARETA_API_KEY,
      baseURL: options.baseURL || env.PARETA_BASE_URL,
    });
  }

  // ── header / url / retry helpers ─────────────────────────────────────
  private headers(opts: { stream?: boolean; jsonBody?: boolean }): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: opts.stream ? "text/event-stream" : "application/json",
      "User-Agent": `pareta-typescript/${VERSION}`,
    };
    // Multipart sets its own Content-Type (with boundary) — never set JSON there.
    if (opts.jsonBody) h["Content-Type"] = "application/json";
    return h;
  }

  private shouldRetry(status: number): boolean {
    return RETRY_STATUSES.has(status);
  }

  /** Seconds to wait before retry `attempt` (0-indexed). Overridable in tests. */
  protected _backoff(attempt: number, retryAfter: number | null): number {
    if (retryAfter !== null && retryAfter >= 0) return Math.min(retryAfter, 30);
    return Math.min(0.5 * 2 ** attempt, 8) + Math.random() * 0.25;
  }

  /** Sleep `seconds`. Overridable in tests to skip real waits. */
  protected _sleep(seconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  }

  private retryAfterSeconds(res: Response): number | null {
    const val = res.headers.get("retry-after");
    if (!val) return null;
    const n = Number.parseFloat(val);
    return Number.isNaN(n) ? null : n;
  }

  private buildURL(path: string, params?: Record<string, unknown>): string {
    let url = `${this.baseURL}${path}`;
    if (params) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) qs.append(k, String(v));
      }
      const s = qs.toString();
      if (s) url += `?${s}`;
    }
    return url;
  }

  private buildFormData(files?: Record<string, FilePart>, data?: Record<string, string>): FormData {
    const fd = new FormData();
    if (data) for (const [k, v] of Object.entries(data)) fd.append(k, v);
    if (files) {
      for (const [k, f] of Object.entries(files)) {
        const blob =
          f.content instanceof Blob
            ? f.content
            : new Blob([f.content as BlobPart], f.contentType ? { type: f.contentType } : undefined);
        fd.append(k, blob, f.filename);
      }
    }
    return fd;
  }

  private wrapFetchError(e: unknown): APIConnectionError {
    const name = (e as { name?: string })?.name;
    if (name === "TimeoutError" || name === "AbortError") {
      return new APITimeoutError(undefined, { cause: e });
    }
    const msg = (e as { message?: string })?.message || "connection error";
    return new APIConnectionError(msg, { cause: e });
  }

  private async parseError(res: Response): Promise<APIStatusError> {
    const requestId = res.headers.get("x-request-id");
    let detail: ErrorDetail;
    try {
      const body = (await res.json()) as unknown;
      detail =
        body && typeof body === "object" && !Array.isArray(body)
          ? ((body as Record<string, unknown>).detail as ErrorDetail)
          : (body as ErrorDetail);
    } catch {
      detail = undefined;
    }
    return errorFromResponse(res.status, { detail, requestId, response: res });
  }

  // ── transport ────────────────────────────────────────────────────────
  async request<T = unknown>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const { body, params, files, data, cast } = opts;
    const url = this.buildURL(path, params);
    const isMultipart = files != null || data != null;
    const headers = this.headers({ jsonBody: body != null && !isMultipart });
    let payload: BodyInit | undefined;
    if (isMultipart) {
      payload = this.buildFormData(files, data);
    } else if (body != null) {
      payload = JSON.stringify(body);
    }

    let lastExc: ParetaError | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method,
          headers,
          body: payload,
          signal: AbortSignal.timeout(this.timeout),
        });
      } catch (e) {
        lastExc = this.wrapFetchError(e);
        if (attempt < this.maxRetries) {
          await this._sleep(this._backoff(attempt, null));
          continue;
        }
        break;
      }
      if (res.ok) {
        const text = await res.text();
        const raw = text ? JSON.parse(text) : {};
        return (cast ? cast(raw) : raw) as T;
      }
      if (attempt < this.maxRetries && this.shouldRetry(res.status)) {
        await res.text().catch(() => undefined); // drain before retry
        await this._sleep(this._backoff(attempt, this.retryAfterSeconds(res)));
        continue;
      }
      throw await this.parseError(res);
    }
    throw lastExc as ParetaError;
  }

  /**
   * Yield parsed SSE objects. Retries ONLY the initial connect/handshake — once
   * bytes are flowing a mid-stream drop raises (re-issuing would re-run a
   * metered generation / re-trigger a deploy). `events:true` → `{event,data}`.
   */
  async *stream<T = unknown>(method: string, path: string, opts: StreamOptions = {}): AsyncGenerator<T> {
    const { body, params, cast, events } = opts;
    const url = this.buildURL(path, params);
    const headers = this.headers({ stream: true, jsonBody: body != null });
    const payload = body != null ? JSON.stringify(body) : undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      let started = false; // flips true once a 2xx body is flowing — no safe retry past here
      try {
        const res = await this.fetchImpl(url, {
          method,
          headers,
          body: payload,
          signal: AbortSignal.timeout(this.timeout),
        });
        if (!res.ok) {
          if (attempt < this.maxRetries && this.shouldRetry(res.status)) {
            await res.text().catch(() => undefined);
            await this._sleep(this._backoff(attempt, this.retryAfterSeconds(res)));
            continue;
          }
          throw await this.parseError(res);
        }
        if (!res.body) throw new APIConnectionError("response had no body to stream");
        started = true;
        const reader = res.body.getReader();
        if (events) {
          for await (const ev of parseSSE(reader, { events: true })) {
            yield ev as unknown as T;
          }
        } else {
          for await (const obj of parseSSE(reader)) {
            yield (cast ? cast(obj) : obj) as T;
          }
        }
        return;
      } catch (e) {
        // A deliberate non-2xx (parseError) must propagate, not be wrapped/retried.
        if (e instanceof ParetaError && (e as APIStatusError).status !== undefined) throw e;
        const wrapped = this.wrapFetchError(e);
        // Mid-stream drop ALWAYS throws; only connect/handshake errors retry.
        if (started || attempt >= this.maxRetries) throw wrapped;
        await this._sleep(this._backoff(attempt, null));
      }
    }
  }
}

export type { SSEEvent };
