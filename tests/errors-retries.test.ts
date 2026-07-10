import { describe, expect, it } from "vitest";
import {
  APIConnectionError,
  AuthenticationError,
  BadRequestError,
  EndpointNotReadyError,
  InsufficientCreditsError,
  NotFoundError,
} from "../src/index.js";
import { jsonResponse, makeClient } from "./_helpers.js";

const userMsg = [{ role: "user", content: "x" }];

describe("status → error mapping", () => {
  it("402 → InsufficientCreditsError (with status + request id)", async () => {
    const pa = makeClient(
      () => jsonResponse(402, { detail: "organization is out of credit. Top up…" }),
      { maxRetries: 0 },
    );
    const err = await pa.chat.completions
      .create({ model: "ep", messages: userMsg })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InsufficientCreditsError);
    expect((err as InsufficientCreditsError).status).toBe(402);
    expect((err as InsufficientCreditsError).requestId).toBe("req_test");
    expect((err as Error).message).toMatch(/out of credit/);
  });

  it("401 → AuthenticationError", async () => {
    const pa = makeClient(() => jsonResponse(401, { detail: "invalid API key" }), { maxRetries: 0 });
    await expect(pa.models.list()).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("404 → NotFoundError", async () => {
    const pa = makeClient(() => jsonResponse(404, { detail: "endpoint 'ep' not found" }), { maxRetries: 0 });
    await expect(pa.chat.completions.create({ model: "ep", messages: userMsg })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("503 → EndpointNotReadyError", async () => {
    const pa = makeClient(() => jsonResponse(503, { detail: "endpoint 'ep' is stopped." }), { maxRetries: 0 });
    await expect(pa.chat.completions.create({ model: "ep", messages: userMsg })).rejects.toBeInstanceOf(
      EndpointNotReadyError,
    );
  });

  it("422 message falls back to 'HTTP 422' (detail is an array)", async () => {
    const pa = makeClient(
      () => jsonResponse(422, { detail: [{ loc: ["body", "model"], msg: "field required", type: "value_error" }] }),
      { maxRetries: 0 },
    );
    await expect(pa.models.list()).rejects.toThrow("HTTP 422");
    await expect(pa.models.list()).rejects.toBeInstanceOf(BadRequestError);
  });
});

describe("retry policy", () => {
  it("retries 5xx then succeeds (2 failures + 1 success)", async () => {
    let n = 0;
    const pa = makeClient(() => {
      n += 1;
      return n < 3 ? jsonResponse(500, { detail: "boom" }) : jsonResponse(200, { object: "list", data: [] });
    }, { maxRetries: 2 });
    await pa.models.list();
    expect(n).toBe(3);
  });

  it("does NOT retry a 400 (terminal 4xx)", async () => {
    let n = 0;
    const pa = makeClient(() => {
      n += 1;
      return jsonResponse(400, { detail: "bad" });
    }, { maxRetries: 3 });
    await expect(pa.models.list()).rejects.toBeInstanceOf(BadRequestError);
    expect(n).toBe(1);
  });

  it("retries a 429 honoring retry-after:0", async () => {
    let n = 0;
    const pa = makeClient(() => {
      n += 1;
      return n === 1
        ? jsonResponse(429, { detail: "slow down" }, { "retry-after": "0" })
        : jsonResponse(200, { data: [] });
    }, { maxRetries: 2 });
    await pa.models.list();
    expect(n).toBe(2);
  });

  it("wraps a connection failure in APIConnectionError", async () => {
    const pa = makeClient(() => {
      throw new Error("no route");
    }, { maxRetries: 1 });
    await expect(pa.models.list()).rejects.toBeInstanceOf(APIConnectionError);
  });
});

describe("streaming retry semantics", () => {
  it("mid-stream drop raises and is NOT retried (pre-drop event delivered)", async () => {
    let n = 0;
    const pa = makeClient(() => {
      n += 1;
      // Deliver the pre-drop event on the first pull, then error on the next —
      // enqueue+error in the same tick would DISCARD the queued chunk.
      let stage = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (stage === 0) {
            controller.enqueue(
              new TextEncoder().encode('data: {"choices":[{"index":0,"delta":{"content":"hi"}}]}\n\n'),
            );
            stage = 1;
          } else {
            controller.error(new Error("mid-stream drop"));
          }
        },
      });
      return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
    }, { maxRetries: 2 });

    const seen: string[] = [];
    await expect(
      (async () => {
        for await (const chunk of pa.chat.completions.create({
          model: "ep",
          messages: [{ role: "user", content: "hi" }],
          stream: true,
        })) {
          seen.push(chunk.choices[0]!.delta.content ?? "");
        }
      })(),
    ).rejects.toBeInstanceOf(APIConnectionError);
    expect(seen).toEqual(["hi"]); // the pre-drop event was delivered
    expect(n).toBe(1); // NOT retried mid-stream
  });

  it("connect failure before any body is retried (initial + 2)", async () => {
    let n = 0;
    const pa = makeClient(() => {
      n += 1;
      throw new Error("no route");
    }, { maxRetries: 2 });
    await expect(
      (async () => {
        for await (const _ of pa.chat.completions.create({
          model: "ep",
          messages: [{ role: "user", content: "hi" }],
          stream: true,
        })) {
          // drain
        }
      })(),
    ).rejects.toBeInstanceOf(APIConnectionError);
    expect(n).toBe(3); // initial + 2 retries
  });
});

// ─── #174: Idempotency-Key — one logical request, one server-side debit ─

const okCompletion = () =>
  jsonResponse(200, {
    id: "c",
    object: "chat.completion",
    choices: [{ index: 0, message: { role: "assistant", content: "x" }, finish_reason: "stop" }],
  });

function headerOf(init: RequestInit, name: string): string | undefined {
  const h = (init.headers ?? {}) as Record<string, string>;
  return h[name];
}

describe("#174 idempotency key", () => {
  it("POST carries a stable Idempotency-Key across auto-retries", async () => {
    const seen: Array<string | undefined> = [];
    const pa = makeClient((_url, init) => {
      seen.push(headerOf(init, "Idempotency-Key"));
      return seen.length < 3 ? jsonResponse(500, { detail: "boom" }) : okCompletion();
    }, { maxRetries: 3 });
    await pa.chat.completions.create({ model: "auto", messages: userMsg });
    expect(seen).toHaveLength(3);
    for (const k of seen) expect(k).toMatch(/^pareta-js-/);
    expect(new Set(seen).size).toBe(1); // SAME key on every attempt
  });

  it("separate logical calls get separate keys", async () => {
    const seen: Array<string | undefined> = [];
    const pa = makeClient((_url, init) => {
      seen.push(headerOf(init, "Idempotency-Key"));
      return okCompletion();
    }, { maxRetries: 0 });
    await pa.chat.completions.create({ model: "auto", messages: userMsg });
    await pa.chat.completions.create({ model: "auto", messages: userMsg });
    expect(new Set(seen).size).toBe(2);
  });

  it("GET requests carry no Idempotency-Key", async () => {
    const pa = makeClient((_url, init) => {
      expect(headerOf(init, "Idempotency-Key")).toBeUndefined();
      return jsonResponse(200, { object: "list", data: [] });
    }, { maxRetries: 0 });
    await pa.models.list();
  });

  it("default timeout is 600s (#174 long-doc)", async () => {
    const { DEFAULT_TIMEOUT_MS } = await import("../src/client.js");
    expect(DEFAULT_TIMEOUT_MS).toBe(600_000);
  });
});
