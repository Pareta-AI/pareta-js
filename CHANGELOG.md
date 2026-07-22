# Changelog

## 2.0.0 — 2026-07-21

**Breaking (CB1): an eval set is now DATA + INTENT.** `intent` — one sentence on
what the model should do with each item — is REQUIRED, and `task` is now
OPTIONAL. Parity with Python SDK 2.0.0.

- `pa.evals.proposeContract({ items, intent })` — NEW. Preview which grading
  contract fits your data (stateless). Returns a `ProposalResult`.
- `pa.evals.sets.create({ items, intent, task? })` — with no `task`, auto-binds
  ONLY a clean single high/medium match; a conflict/split/ambiguity throws with
  the proposals so you pin `task`.
- `pa.evals.runs.create({ items, intent, … })` — the inline sugar carries the
  same requirement; `task` optional.
- New exports: `ContractProposal`, `ProposalResult`; `EvalSet.intent`.

Migration: add `intent: "…"` to every `evals.sets.create` / `runs.create`.

## 1.4.0 — 2026-07-19

- **Image editing**: `pa.images.edit(image, prompt, {seed?})` →
  `POST /v1/images/edits` (instruction-only, no mask). `image` is a file
  path (Node), bytes, a Blob, or `{ base64 }`. Billed FLAT per edit.
  Parity with Python SDK 1.3.0.

## 1.3.0 — 2026-07-19

- **Images lane**: `pa.images.generate(prompt, {size?, seed?})` →
  `POST /v1/images/generations`, returning an `ImageGeneration` (`.image`
  decoded PNG bytes, `.save(path)` in Node, `.size`, `.model`). Billed FLAT
  per image; the `X-Pareta-Billed` header carries the receipt. Full parity
  with Python SDK 1.2.0.

## 1.2.0 — 2026-07-10

The Speech lanes — full parity with the Python SDK's `client.audio`:

- **`pa.audio.transcriptions(audio, { language })`** — speech-to-text via
  `POST /v1/audio/transcriptions`. `audio` is a file path (Node), raw bytes
  (`Uint8Array`/`ArrayBuffer`/`Blob`), or `{ base64 }`. Metered per minute
  of input audio.
- **`pa.audio.speech(text, { voice })`** — text-to-speech via
  `POST /v1/audio/speech`. Returns a `Speech` whose `.audio` is decoded
  bytes (`.save(path)` writes a file in Node; browser-safe decode).
  Metered per minute of output audio.
- New response models `Transcription`, `Speech`.
- Browser/edge bundles stay clean: file reads and writes use lazy
  `node:fs` imports, base64 codecs fall back from `Buffer` to
  `btoa`/`atob`.

## 1.1.0 — 2026-07-10

The Retrieval capability lanes — the standard RAG stack on Pareta (parity
with the Python SDK 1.1.0):

- **`pa.rerank(query, documents, { topN })`** — document reranking via
  `POST /v1/rerank`. Ordered `RerankResult` rows (`.index`,
  `.relevanceScore` — calibrated P(relevant), thresholdable);
  `.topDocuments(docs)` maps ranked indices back onto your array. Served by
  `pareta-rerank-1`; metered per document scored.
- **`pa.embeddings(input, { inputType })`** — text embeddings via
  `POST /v1/embeddings`. Unit-normalized 1024-dim vectors, input order
  preserved; `inputType: "query"` embeds retrieval queries asymmetrically.
  Served by `bge-1`; metered per input token ($0.01 / 1M).
- New response models `Rerank`, `RerankResult`, `Embeddings`.

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

