/**
 * `client.endpoints` — deploy, operate, and measure deployed endpoints.
 *
 * `deploy({ task, model })` is ergonomic: Pareta picks the GPU/serving config
 * (you never pass hardware) and `model` defaults to the task's recommended pick.
 * The backend resolver behind POST /v1/endpoints evolved with the discovery
 * work — verify the deploy body against staging when wiring real deploys.
 */

import type { Transport } from "../client.js";
import type { SSEEvent } from "../streaming.js";
import { ParetaError } from "../errors.js";
import { Endpoint, endpointList } from "../models.js";

const BASE = "/v1/endpoints";

/** Params for `endpoints.deploy`. Extra keys pass through to the deploy body. */
export interface DeployParams {
  /** The task id to deploy a model for. */
  task: string;
  /** Model alias to deploy; defaults to "recommended" (the task's top pick). */
  model?: string;
  /** Optional endpoint name. */
  name?: string;
  /** If true, block through the deploy and resolve the live Endpoint. */
  wait?: boolean;
  [key: string]: unknown;
}

function buildDeployBody(params: DeployParams): Record<string, unknown> {
  const { task, model, name, wait: _wait, ...extra } = params;
  if (!task) throw new ParetaError("task is required");
  const body: Record<string, unknown> = { task, model: model || "recommended", ...extra };
  if (name !== undefined) body.name = name;
  return body;
}

function endpointFromComplete(data: unknown): Endpoint {
  const ep = data && typeof data === "object" ? (data as Record<string, unknown>).endpoint : null;
  return new Endpoint((ep as Record<string, unknown>) ?? {});
}

function deployError(data: unknown): ParetaError {
  const msg = data && typeof data === "object" ? (data as Record<string, unknown>).message : String(data);
  return new ParetaError(`deploy failed: ${msg || "unknown error"}`);
}

/**
 * `endpoints.metrics(id).performance()` etc. Each returns the raw metric JSON
 * (shapes vary by dimension; typed models arrive with the OpenAPI generation).
 */
export class EndpointMetrics {
  constructor(
    private readonly client: Transport,
    private readonly id: string,
  ) {}

  performance(params?: Record<string, unknown>): Promise<unknown> {
    return this.client.request("GET", `${BASE}/${this.id}/performance`, { params });
  }
  uptime(params?: Record<string, unknown>): Promise<unknown> {
    return this.client.request("GET", `${BASE}/${this.id}/uptime`, { params });
  }
  cost(params?: Record<string, unknown>): Promise<unknown> {
    return this.client.request("GET", `${BASE}/${this.id}/cost`, { params });
  }
  quality(params?: Record<string, unknown>): Promise<unknown> {
    return this.client.request("GET", `${BASE}/${this.id}/quality`, { params });
  }
  activity(params?: Record<string, unknown>): Promise<unknown> {
    return this.client.request("GET", `${BASE}/${this.id}/activity`, { params });
  }
}

export class Endpoints {
  constructor(private readonly client: Transport) {}

  /**
   * Deploy a model for a task. `wait: false` (default) → an `AsyncIterable` of
   * progress events (`{event, data}`); the terminal event is `complete`
   * (`data.endpoint`) or `error`. `wait: true` → resolves the live `Endpoint`
   * (throws `ParetaError` on a deploy `error` event).
   */
  deploy(params: DeployParams & { wait: true }): Promise<Endpoint>;
  deploy(params: DeployParams & { wait?: false }): AsyncIterable<SSEEvent>;
  deploy(params: DeployParams): Promise<Endpoint> | AsyncIterable<SSEEvent> {
    const body = buildDeployBody(params);
    const stream = this.client.stream<SSEEvent>("POST", BASE, { body, events: true });
    if (!params.wait) return stream;
    return this.waitForDeploy(stream);
  }

  private async waitForDeploy(stream: AsyncIterable<SSEEvent>): Promise<Endpoint> {
    for await (const ev of stream) {
      if (ev.event === "complete") return endpointFromComplete(ev.data);
      if (ev.event === "error") throw deployError(ev.data);
    }
    throw new ParetaError("deploy stream ended without a 'complete' event");
  }

  list(): Promise<Endpoint[]> {
    return this.client.request<Endpoint[]>("GET", BASE, { cast: endpointList });
  }

  retrieve(endpointId: string): Promise<Endpoint> {
    return this.client.request<Endpoint>("GET", `${BASE}/${endpointId}`, {
      cast: (raw) => new Endpoint(raw as Record<string, unknown>),
    });
  }

  start(endpointId: string): Promise<unknown> {
    return this.client.request("POST", `${BASE}/${endpointId}/start`);
  }

  stop(endpointId: string): Promise<unknown> {
    return this.client.request("POST", `${BASE}/${endpointId}/stop`);
  }

  async delete(endpointId: string): Promise<void> {
    await this.client.request("DELETE", `${BASE}/${endpointId}`);
  }

  metrics(endpointId: string): EndpointMetrics {
    return new EndpointMetrics(this.client, endpointId);
  }
}
