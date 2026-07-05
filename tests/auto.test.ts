import { describe, expect, it } from "vitest";
import { Pareta } from "../src/index.js";

const KEY = "pareta_sk_testid000000000000000000.testverifier000000000000";

const mockFetch = (handler: (url: string, init: RequestInit) => Response) =>
  (async (url: any, init: any) => handler(String(url), init)) as typeof fetch;

describe("client.auto", () => {
  it("metrics() GETs /v1/auto/metrics", async () => {
    const pa = new Pareta({
      apiKey: KEY, baseURL: "https://api.test",
      fetch: mockFetch((url, init) => {
        expect(url).toContain("/v1/auto/metrics");
        expect(init.method).toBe("GET");
        return new Response(JSON.stringify({ requests_30d: 7, savings_multiple_30d: 4.2 }),
          { status: 200, headers: { "content-type": "application/json" } });
      }),
    });
    const m = await pa.auto.metrics();
    expect(m.requests_30d).toBe(7);
    expect(m.savings_multiple_30d).toBe(4.2);
  });

  it("compareFrontier() POSTs model + messages", async () => {
    const pa = new Pareta({
      apiKey: KEY, baseURL: "https://api.test",
      fetch: mockFetch((url, init) => {
        expect(url).toContain("/v1/playground/frontier");
        const body = JSON.parse(String(init.body));
        expect(body.model).toBe("gpt-5.5");
        return new Response(JSON.stringify({
          model: "gpt-5.5", content: "hi", cost_micro_usd: 450, latency_ms: 900,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }),
    });
    const out = await pa.auto.compareFrontier({
      model: "gpt-5.5", messages: [{ role: "user", content: "hello" }],
    });
    expect(out.cost_micro_usd).toBe(450);
  });
});
