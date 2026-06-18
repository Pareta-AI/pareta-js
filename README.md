# pareta

[![npm](https://img.shields.io/npm/v/pareta)](https://www.npmjs.com/package/pareta)
[![types](https://img.shields.io/npm/types/pareta)](https://www.npmjs.com/package/pareta)
[![license](https://img.shields.io/npm/l/pareta)](https://github.com/Pareta-AI/pareta-js/blob/main/LICENSE)

TypeScript/JavaScript client for [Pareta](https://pareta.ai) — deploy
open-weights endpoints, run metered inference, browse the benchmark catalog, and
evaluate models on your own data. The mirror of the Python [`pareta`](https://pypi.org/project/pareta/)
package, re-expressed as one Promise-only client.

```bash
npm install pareta        # or: pnpm add pareta / yarn add pareta / bun add pareta
```

```ts
import { Pareta } from "pareta";

const pa = Pareta.fromEnv(); // reads PARETA_API_KEY (+ optional PARETA_BASE_URL)

const res = await pa.chat.completions.create({
  model: "ep_…", // an endpoint id from endpoints.deploy(...)
  messages: [{ role: "user", content: "Extract the totals from this invoice." }],
});
console.log(res.choices[0].message.content);
```

Inference is OpenAI-compatible, so you can equally point the `openai` SDK at
`baseURL` + your `pareta_sk_` key. The SDK's unique value is the control plane —
**deploy**, **eval**, and **discovery**.

## Authenticate

Every request uses a `pareta_sk_` secret key (mint one in the
[dashboard](https://pareta.ai) — key management is browser-only). Put it in the
environment and use `fromEnv()`, or pass it explicitly:

```ts
const pa = new Pareta({ apiKey: "pareta_sk_…" });
```

## Deploy → infer

```ts
// Pareta picks the GPU/serving class; model defaults to the task's best pick.
const ep = await pa.endpoints.deploy({ task: "invoice-extraction", wait: true });

const res = await pa.chat.completions.create({
  model: ep.id!,
  messages: [{ role: "user", content: "…" }],
});
```

Stream tokens:

```ts
for await (const chunk of pa.chat.completions.create({ model: ep.id!, messages, stream: true })) {
  process.stdout.write(chunk.choices[0]?.delta.content ?? "");
}
```

## Discover the best model for a task

```ts
const lb = await pa.tasks.leaderboard("invoice-extraction");
console.log(lb.recommended, lb.frontier?.name); // open pick + frontier baseline
```

## Evaluate on your own data

```ts
const run = await pa.evals.runs.create({
  task: "intent-classification",
  items: [{ input: { text: "cancel my plan" }, expected: "cancellation" }],
  models: ["qwen-1"],
  frontier: "benchmarked", // also race the benchmarked frontier models
  wait: true,
});
console.log(run.cost, run.results.map((r) => [r.modelId, r.qualityMean]));
```

Eval runs are metered against your org balance; `run.cost` is the billed total
in dollars (floored to cents).

## Errors

Status codes map to typed errors you can branch on:

```ts
import { InsufficientCreditsError, EndpointNotReadyError } from "pareta";

try {
  await pa.chat.completions.create({ model, messages });
} catch (e) {
  if (e instanceof InsufficientCreditsError) { /* top up in the dashboard */ }
  if (e instanceof EndpointNotReadyError) { /* endpoint is cold/stopped */ }
}
```

## Runtime

Node 18+, modern browsers, and edge runtimes (Workers / Vercel Edge) — built on
native `fetch` / `ReadableStream` / `FormData`, **zero runtime dependencies**.
Ships ESM + CommonJS + `.d.ts`.

## Docs

Full guide, reference, and examples: **[docs.pareta.ai](https://docs.pareta.ai)**.
