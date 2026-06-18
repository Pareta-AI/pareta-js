import { afterEach, describe, expect, it } from "vitest";
import { Pareta, ParetaError, VERSION } from "../src/index.js";
import { jsonResponse, makeClient, TEST_KEY } from "./_helpers.js";

describe("client construction", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("throws synchronously on missing API key", () => {
    expect(() => new Pareta({})).toThrow(ParetaError);
  });

  it("fromEnv reads key + base URL and strips the trailing slash", () => {
    process.env.PARETA_API_KEY = "pareta_sk_fromenv";
    process.env.PARETA_BASE_URL = "https://api-staging.pareta.ai/";
    const pa = Pareta.fromEnv();
    expect(pa.apiKey).toBe("pareta_sk_fromenv");
    expect(pa.baseURL).toBe("https://api-staging.pareta.ai"); // slash stripped
  });

  it("defaults to the prod base URL", () => {
    delete process.env.PARETA_BASE_URL;
    const pa = new Pareta({ apiKey: "pareta_sk_x" });
    expect(pa.baseURL).toBe("https://api.pareta.ai");
  });

  it("explicit options win over env in fromEnv", () => {
    process.env.PARETA_API_KEY = "pareta_sk_env";
    const pa = Pareta.fromEnv({ apiKey: "pareta_sk_explicit" });
    expect(pa.apiKey).toBe("pareta_sk_explicit");
  });

  it("clamps maxRetries to a non-negative integer", () => {
    expect(new Pareta({ apiKey: "k", maxRetries: -5 }).maxRetries).toBe(0);
    expect(new Pareta({ apiKey: "k", maxRetries: 3.9 }).maxRetries).toBe(3);
  });
});

describe("request headers + path", () => {
  it("sends Bearer auth, the TS user-agent, and the right path", async () => {
    const seen: Record<string, string | undefined> = {};
    const pa = makeClient((url, init) => {
      const h = init.headers as Record<string, string>;
      seen.auth = h["Authorization"];
      seen.ua = h["User-Agent"];
      seen.accept = h["Accept"];
      seen.path = new URL(url).pathname;
      return jsonResponse(200, { object: "list", data: [] });
    });
    await pa.models.list();
    expect(seen.auth).toBe(`Bearer ${TEST_KEY}`);
    expect(seen.ua?.startsWith("pareta-typescript/")).toBe(true);
    expect(seen.ua).toBe(`pareta-typescript/${VERSION}`);
    expect(seen.accept).toBe("application/json");
    expect(seen.path).toBe("/v1/models");
  });

  it("returns {} (not a throw) on an empty 2xx body (204-style)", async () => {
    const pa = makeClient(() => new Response(null, { status: 204 }));
    const out = await pa.request("DELETE", "/v1/endpoints/ep");
    expect(out).toEqual({});
  });
});
