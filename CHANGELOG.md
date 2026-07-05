# Changelog

## 0.2.1 — 2026-07-05

- New README (the npm/GitHub landing page) — auto-first: `model: "auto"` leads,
  evals + auto metrics as the measurement story, dedicated endpoints as the
  pin-one-model path. Package docstring updated to match.

## 0.2.0 — 2026-07-03

- New `client.auto` resource: `metrics()` (org rollup incl. projected savings
  vs frontier, typed `AutoMetrics`) and `compareFrontier()` (metered
  side-by-side against a frontier vendor).
- Docs: `model: "auto"` is the recommended default for chat completions.

