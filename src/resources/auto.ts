/**
 * `client.auto` — the routing brain's surrounding surfaces.
 *
 * Calling the brain itself is plain chat with `model: "auto"`:
 *
 *   client.chat.completions.create({
 *     model: "auto",
 *     messages: [{ role: "user", content: "…" }],
 *   })
 *
 * This resource carries the org-level metrics rollup (requests, success,
 * spend, PROJECTED savings vs frontier) and the metered frontier comparison
 * the Playground uses.
 */

import type { Transport } from "../client.js";

export interface AutoMetrics {
  requests_30d: number;
  requests_today: number;
  success_rate_30d: number | null;
  billed_micro_usd_30d: number;
  billed_micro_usd_today: number;
  cost_to_serve_micro_usd_30d: number;
  /** PROJECTED (frontier list-priced counterfactual) — labeled so until
   * dual-run calibration lands. */
  savings_vs_frontier_micro_usd_30d: number | null;
  savings_multiple_30d: number | null;
  performance_hourly_7d: Array<{
    hour: string; requests: number; error_rate: number;
    p50_ms: number | null; p95_ms: number | null;
  }>;
  days_30d: Array<{ day: string; n: number; ok: number; success_rate: number }>;
  last_request: {
    created_at: string; status_code: number; duration_ms: number;
    billed_micro_usd: number | null; cost_to_serve_micro_usd: number | null;
  } | null;
}

export interface FrontierComparison {
  model: string;
  content: string;
  cost_micro_usd: number;
  latency_ms: number;
}

export class Auto {
  constructor(private readonly client: Transport) {}

  /** Your org's `model: "auto"` traffic, rolled up. Read-only, free. */
  metrics(): Promise<AutoMetrics> {
    return this.client.request<AutoMetrics>("GET", "/v1/auto/metrics");
  }

  /**
   * One prompt against a frontier vendor for a side-by-side with
   * `model: "auto"` — METERED at the vendor's actual token cost (a failed
   * vendor call bills $0). Allowed models: gpt-5.5, gemini-3-5-flash,
   * gemini-3-1-pro, claude-sonnet-4-6.
   */
  compareFrontier(params: {
    model: string;
    messages: Array<{ role: string; content: string }>;
  }): Promise<FrontierComparison> {
    return this.client.request<FrontierComparison>(
      "POST", "/v1/playground/frontier", { body: params },
    );
  }
}
