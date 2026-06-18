import { describe, expect, it } from "vitest";
import { APIConnectionError, Endpoint, ParetaError } from "../src/index.js";
import type { SSEEvent } from "../src/index.js";
import { jsonResponse, makeClient, sseDropResponse } from "./_helpers.js";

/** A named-event SSE response (deploy stream). CRLF by default — the real
 *  sse-starlette stream emits CRLF, and the parser MUST normalize it. */
function deploySSE(events: Array<{ event: string; data: unknown }>, opts: { crlf?: boolean } = {}): Response {
  const nl = opts.crlf === false ? "\n" : "\r\n";
  const payload = events
    .map((e) => `event: ${e.event}${nl}data: ${JSON.stringify(e.data)}${nl}${nl}`)
    .join("");
  return new Response(payload, { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("endpoints.deploy", () => {
  it("sends {task, model:'recommended'} and validates task", async () => {
    let sent: Record<string, unknown> = {};
    const pa = makeClient((_url, init) => {
      sent = JSON.parse(init.body as string);
      return deploySSE([{ event: "complete", data: { endpoint: { id: "ep_x", status: "live" } } }]);
    });
    await pa.endpoints.deploy({ task: "invoice-extraction", wait: true });
    expect(sent.task).toBe("invoice-extraction");
    expect(sent.model).toBe("recommended");
    expect(() => pa.endpoints.deploy({ task: "", wait: false })).toThrow(ParetaError);
  });

  it("wait:false yields the progress events", async () => {
    const pa = makeClient(() =>
      deploySSE([
        { event: "progress", data: { stage: "provisioning-gpu" } },
        { event: "complete", data: { endpoint: { id: "ep_new", status: "live" } } },
      ]),
    );
    const seen: SSEEvent[] = [];
    for await (const ev of pa.endpoints.deploy({ task: "t" })) seen.push(ev);
    expect(seen.map((e) => e.event)).toEqual(["progress", "complete"]);
  });

  it("wait:true resolves the live Endpoint on 'complete' (CRLF stream)", async () => {
    const pa = makeClient(() =>
      deploySSE(
        [
          { event: "progress", data: { stage: "booting" } },
          { event: "complete", data: { endpoint: { id: "ep_new", status: "live", taskName: "t" } } },
        ],
        { crlf: true }, // regression guard for 862fab6 — CRLF must be normalized
      ),
    );
    const ep = await pa.endpoints.deploy({ task: "t", wait: true });
    expect(ep).toBeInstanceOf(Endpoint);
    expect(ep.id).toBe("ep_new");
    expect(ep.isLive).toBe(true);
    expect(ep.task).toBe("t");
  });

  it("wait:true throws ParetaError on an 'error' event", async () => {
    const pa = makeClient(() => deploySSE([{ event: "error", data: { message: "GPU OOM" } }]));
    await expect(pa.endpoints.deploy({ task: "t", wait: true })).rejects.toThrow(/deploy failed: GPU OOM/);
  });

  it("throws if the stream ends without 'complete'", async () => {
    const pa = makeClient(() => deploySSE([{ event: "progress", data: { stage: "x" } }]));
    await expect(pa.endpoints.deploy({ task: "t", wait: true })).rejects.toThrow(/without a 'complete'/);
  });

  it("mid-stream drop raises and is NOT retried (deploy)", async () => {
    let n = 0;
    const pa = makeClient(() => {
      n += 1;
      return sseDropResponse('event: progress\r\ndata: {"stage":"provisioning-gpu"}\r\n\r\n');
    });
    const seen: string[] = [];
    await expect(
      (async () => {
        for await (const ev of pa.endpoints.deploy({ task: "t" })) seen.push(ev.event);
      })(),
    ).rejects.toBeInstanceOf(APIConnectionError);
    expect(seen).toEqual(["progress"]);
    expect(n).toBe(1);
  });
});

describe("endpoints lifecycle", () => {
  it("list unwraps the bare array + applies field fallbacks", async () => {
    const pa = makeClient(() =>
      jsonResponse(200, [
        { id: "ep1", status: "live", taskName: "invoice-extraction" },
        { name: "ep2", status: "stopped" },
      ]),
    );
    const eps = await pa.endpoints.list();
    expect(eps.length).toBe(2);
    expect(eps[0]!.id).toBe("ep1");
    expect(eps[0]!.isLive).toBe(true);
    expect(eps[0]!.task).toBe("invoice-extraction");
    expect(eps[1]!.id).toBe("ep2"); // id falls back to name
  });

  it("retrieve returns a typed Endpoint", async () => {
    const pa = makeClient((url) => {
      expect(new URL(url).pathname).toBe("/v1/endpoints/ep1");
      return jsonResponse(200, { id: "ep1", model: "kie-1", status: "live" });
    });
    const ep = await pa.endpoints.retrieve("ep1");
    expect(ep.model).toBe("kie-1");
  });

  it("delete returns void on a 204", async () => {
    const pa = makeClient((url, init) => {
      expect(init.method).toBe("DELETE");
      expect(new URL(url).pathname).toBe("/v1/endpoints/ep1");
      return new Response(null, { status: 204 });
    });
    await expect(pa.endpoints.delete("ep1")).resolves.toBeUndefined();
  });

  it("metrics builds the dimension path + query", async () => {
    let path = "";
    let search = "";
    const pa = makeClient((url) => {
      const u = new URL(url);
      path = u.pathname;
      search = u.search;
      return jsonResponse(200, { points: [] });
    });
    await pa.endpoints.metrics("ep1").performance({ since_hours: 24 });
    expect(path).toBe("/v1/endpoints/ep1/performance");
    expect(search).toBe("?since_hours=24");
  });
});
