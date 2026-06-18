/**
 * Test helpers — build a `Pareta` backed by an injected mock `fetch` so every
 * test is hermetic (no network, no real keys). The analog of the Python
 * `conftest.py` MockTransport + the `_backoff = 0` zeroing.
 */
import { Pareta } from "../src/index.js";

export const TEST_KEY = "pareta_sk_testid000000000000000000.testverifier000000000000";

export type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

/** A Pareta client whose transport is the given handler; sleeps are zeroed. */
export function makeClient(handler: Handler, opts: { maxRetries?: number } = {}): Pareta {
  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
    handler(String(input), init ?? {});
  const pa = new Pareta({
    apiKey: TEST_KEY,
    baseURL: "https://api.test",
    maxRetries: opts.maxRetries ?? 2,
    fetch: fetchMock as typeof fetch,
  });
  // No real sleeping in tests (mirror conftest `_backoff = lambda: 0`).
  (pa as unknown as { _backoff: () => number })._backoff = () => 0;
  (pa as unknown as { _sleep: () => Promise<void> })._sleep = () => Promise.resolve();
  return pa;
}

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "x-request-id": "req_test", ...headers },
  });
}

/** A data-only SSE response (chat stream): each chunk on its own `data:` line + [DONE]. */
export function sseResponse(chunks: string[]): Response {
  const payload = chunks.map((c) => `data: ${c}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(payload, { status: 200, headers: { "content-type": "text/event-stream" } });
}

/**
 * An SSE response that delivers `preDrop` raw text, then errors mid-stream.
 * Uses pull-based staging so the chunk is delivered BEFORE the error (enqueue +
 * error in the same tick would discard the queued chunk per the Streams spec).
 */
export function sseDropResponse(preDrop: string): Response {
  let stage = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (stage === 0) {
        controller.enqueue(new TextEncoder().encode(preDrop));
        stage = 1;
      } else {
        controller.error(new Error("mid-stream drop"));
      }
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}
