/**
 * `client.tasks` — the grading-contract directory for evals. A task names how
 * a dataset is scored (row shape + scorer); inference never takes one. `match`
 * maps a plain-English description of your dataset to the contract that
 * grades it — feed the matched task id into `evals.runs.create(task=...)`.
 */

import type { Transport } from "../client.js";
import { ParetaError } from "../errors.js";
import { Task, TaskMatch, taskList } from "../models.js";

const BASE = "/v1/tasks";

export class Tasks {
  constructor(private readonly client: Transport) {}

  list(): Promise<Task[]> {
    return this.client.request<Task[]>("GET", BASE, { cast: taskList });
  }

  retrieve(taskId: string, opts: { examplesN?: number } = {}): Promise<Task> {
    const params = opts.examplesN !== undefined ? { examples_n: opts.examplesN } : undefined;
    return this.client.request<Task>("GET", `${BASE}/${taskId}`, {
      params,
      cast: (raw) => new Task(raw as Record<string, unknown>),
    });
  }

  /** Free-text intent → ranked candidate tasks (the Step-0 backend matcher). */
  match(query: string, opts: { topK?: number } = {}): Promise<TaskMatch> {
    if (!query || !query.trim()) throw new ParetaError("query is required");
    return this.client.request<TaskMatch>("POST", `${BASE}/match`, {
      body: { query, top_k: opts.topK ?? 5 },
      cast: (raw) => new TaskMatch(raw as Record<string, unknown>),
    });
  }
}
