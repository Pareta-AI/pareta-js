# pareta

[![npm](https://img.shields.io/npm/v/pareta)](https://www.npmjs.com/package/pareta)
[![License](https://img.shields.io/npm/l/pareta)](https://github.com/Pareta-AI/pareta-js/blob/main/LICENSE)

TypeScript/JavaScript client for [Pareta](https://pareta.ai). One model id —
`"auto"` — and Pareta plans each request, routes it to benchmark-proven open
specialists, verifies the result, and falls back to a frontier model when
that's the right call. One request, one bill; you never pay for Pareta's
orchestration or cold starts.

```bash
npm install pareta        # or: pnpm add pareta / yarn add pareta / bun add pareta
```

```ts
import { Pareta } from "pareta";

const pa = Pareta.fromEnv();                 // reads PARETA_API_KEY
// or: new Pareta({ apiKey: "pareta_sk_…", baseURL: "https://api.pareta.ai" })

const res = await pa.chat.completions.create({
  model: "auto",                             // the routing brain — the product
  messages: [{ role: "user", content: "Extract the total from this invoice: …" }],
});
console.log(res.choices[0].message.content);

// Streaming (progress while Pareta plans + executes, then tokens)
for await (const chunk of await pa.chat.completions.create({
  model: "auto", messages: [...], stream: true,
})) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
}
```

## Is it actually good? Measure it on YOUR data

Don't take the routing brain on faith — benchmark it. `pa.evals` runs `"auto"`
head-to-head against frontier models on your own ground truth and prices every
contender honestly:

```ts
const set = await pa.evals.sets.create({ task: "invoice-extraction", items: [...] });
const run = await pa.evals.runs.create({
  evalSet: set.id, models: ["auto"], frontier: ["claude-opus-4-7"], wait: true,
});
```

And watch what your live traffic is doing — spend, success rate, and the
projected savings vs calling a frontier directly:

```ts
await pa.auto.metrics();                     // requests, success, spend, savings
await pa.auto.compareFrontier({              // one prompt, metered, side-by-side
  model: "gpt-5.5",
  messages: [{ role: "user", content: "…" }],
});
```

## Inference is OpenAI-compatible

You don't even need this SDK to call Pareta — point the `openai` package at
`baseURL` + your key and set `model: "auto"`:

```ts
import OpenAI from "openai";
const client = new OpenAI({ apiKey: "pareta_sk_…", baseURL: "https://api.pareta.ai/v1" });
const res = await client.chat.completions.create({ model: "auto", messages: [...] });
```

This SDK's unique value is everything AROUND that call — evals on your data,
auto metrics, the benchmark catalog, and the dedicated-endpoint control plane.

## Dedicated endpoints (when you want to pin one model)

`"auto"` routes per request. When a workload wants one specific open model on
dedicated capacity, deploy it and call it by endpoint id:

```ts
const ep = await pa.endpoints.deploy({ task: "invoice-extraction", model: "recommended", wait: true });
const res = await pa.chat.completions.create({ model: ep.id, messages: [...] });

for (const m of await pa.models.list()) console.log(m.id);
```

Discovery (`pa.tasks.match`, `pa.tasks.leaderboard`) tells you which open
models are benchmark-proven for your task and what the frontier baseline costs.

## Auth

Mint a `pareta_sk_` key in the dashboard (key management is browser-only) and
pass it as `apiKey` or via `PARETA_API_KEY`. The SDK only ever *consumes* a
key; it never creates, lists, or revokes them.

## Errors

All errors subclass `ParetaError` — `AuthenticationError` (401),
`InsufficientCreditsError` (402), `NotFoundError` (404),
`EndpointNotReadyError` (503), `RateLimitError` (429, auto-retried),
`BadRequestError` (400/422), and `APIConnectionError` / `APITimeoutError`
(transport, auto-retried). Idempotent GETs and 429/5xx/timeouts are retried
with exponential backoff (`maxRetries`, default 2).

## Python

The same surface ships as a Python package: [`pip install pareta`](https://pypi.org/project/pareta/),
plus a CLI (`pareta[cli]`) and an MCP server (`pareta[mcp]`). Docs for both:
[docs.pareta.ai](https://docs.pareta.ai).
