/**
 * `client.tasks` — browse the benchmark catalog + match free-text intent, and
 * the per-task discovery surface (leaderboard / recommended).
 *
 * Unlike the Python SDK (where `leaderboard`/`recommended` exist only on the
 * sync client), these are present uniformly here — JS has one client.
 */

import type { Transport } from "../client.js";
import { ParetaError } from "../errors.js";
import { Task, TaskMatch, Leaderboard, taskList, leaderboardFrom } from "../models.js";

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

  /** Models ranked by quality/cost for a task (+ recommended + frontier baseline). */
  leaderboard(taskId: string): Promise<Leaderboard> {
    return this.client.request<Leaderboard>("GET", `${BASE}/${taskId}/leaderboard`, {
      cast: leaderboardFrom,
    });
  }

  /** The task's recommended deployable model — what deploy(model:"recommended") resolves to. */
  async recommended(taskId: string): Promise<string | null> {
    return (await this.leaderboard(taskId)).recommended;
  }
}
