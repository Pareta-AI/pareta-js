# Changelog

## 1.0.0 — 2026-07-08

- Every POST now carries an `Idempotency-Key` header, generated once per
  logical call and re-sent verbatim on automatic retries — the server
  collapses all attempts of one request onto a single billed debit
  (fixes double-billing when a long-running request outlived a client
  timeout and the SDK retried it).
- Default request timeout raised 60s → 600s (long-document `model:"auto"`
  requests legitimately run 60–180s server-side; matches the OpenAI SDK
  default).

Auto-only major. `model: "auto"` is the single serving surface — the client
drops the dedicated-endpoint control plane (the backend routes stay live; this
is a client-surface removal).

- **BREAKING**: `endpoints.*` namespace removed (`deploy`, `list`, `retrieve`,
  `start`, `stop`, `delete`, `metrics`), along with the `Endpoint` model and
  the `DeployParams` / `EndpointMetrics` exports.
- **BREAKING**: `tasks.leaderboard()` and `tasks.recommended()` removed, along
  with the `Leaderboard` / `LeaderboardEntry` exports.
- `tasks.match()` stays as the discovery surface (plus `tasks.list()` /
  `tasks.retrieve()`); `chat.*`, `models.*`, `evals.*`, and `auto` are
  unchanged.

## 0.2.1 — 2026-07-05

- New README (the npm/GitHub landing page) — auto-first: `model: "auto"` leads,
  evals + auto metrics as the measurement story, dedicated endpoints as the
  pin-one-model path. Package docstring updated to match.

## 0.2.0 — 2026-07-03

- New `client.auto` resource: `metrics()` (org rollup incl. projected savings
  vs frontier, typed `AutoMetrics`) and `compareFrontier()` (metered
  side-by-side against a frontier vendor).
- Docs: `model: "auto"` is the recommended default for chat completions.

