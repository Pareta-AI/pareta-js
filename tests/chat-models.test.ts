import { describe, expect, it } from "vitest";
import { ChatCompletion, Model, ParetaError } from "../src/index.js";
import { jsonResponse, makeClient, sseResponse } from "./_helpers.js";

describe("models.list", () => {
  it("returns typed Model objects", async () => {
    const pa = makeClient((url) => {
      expect(new URL(url).pathname).toBe("/v1/models");
      return jsonResponse(200, {
        object: "list",
        data: [{ id: "ep_abc", object: "model", owned_by: "pareto", created: 1 }],
      });
    });
    const models = await pa.models.list();
    expect(models.length).toBe(1);
    const first = [...models][0]!;
    expect(first).toBeInstanceOf(Model);
    expect(first.id).toBe("ep_abc");
    expect(first.ownedBy).toBe("pareto");
  });
});

describe("chat.completions.create", () => {
  it("non-stream returns a typed ChatCompletion", async () => {
    const pa = makeClient((url) => {
      expect(new URL(url).pathname).toBe("/v1/chat/completions");
      return jsonResponse(200, {
        id: "cmpl_1",
        model: "ep_abc",
        choices: [
          { index: 0, finish_reason: "stop", message: { role: "assistant", content: "hello there" } },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      });
    });
    const resp = await pa.chat.completions.create({
      model: "ep_abc",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(resp).toBeInstanceOf(ChatCompletion);
    expect(resp.choices[0]!.message.content).toBe("hello there");
    expect(resp.choices[0]!.finishReason).toBe("stop");
    expect(resp.usage.totalTokens).toBe(5);
  });

  it("surfaces the per-call cost receipt from response headers (#164)", async () => {
    const pa = makeClient(() =>
      jsonResponse(
        200,
        { id: "c1", model: "auto", choices: [{ message: { content: "hi" } }], usage: { total_tokens: 6 } },
        { "X-Pareta-Billed": "700", "X-Pareta-Frontier-Would-Have-Cost": "12000" },
      ),
    );
    const resp = await pa.chat.completions.create({ model: "auto", messages: [{ role: "user", content: "hi" }] });
    expect(resp.billedMicroUsd).toBe(700);
    expect(resp.frontierWouldHaveCostMicroUsd).toBe(12000);
    expect(resp.savingsFactor).toBe(Math.round((12000 / 700) * 10) / 10);
  });

  it("cost fields are null when the receipt headers are absent", async () => {
    const pa = makeClient(() =>
      jsonResponse(200, { choices: [{ message: { content: "hi" } }] }),
    );
    const resp = await pa.chat.completions.create({ model: "auto", messages: [{ role: "user", content: "x" }] });
    expect(resp.billedMicroUsd).toBeNull();
    expect(resp.savingsFactor).toBeNull();
  });

  it("stream sets stream:true and yields deltas", async () => {
    let sentStream: unknown;
    const pa = makeClient((_url, init) => {
      sentStream = JSON.parse(init.body as string).stream;
      return sseResponse([
        '{"id":"c","choices":[{"index":0,"delta":{"role":"assistant","content":"Hel"}}]}',
        '{"id":"c","choices":[{"index":0,"delta":{"content":"lo"}}]}',
      ]);
    });
    let text = "";
    for await (const chunk of pa.chat.completions.create({
      model: "ep_abc",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    })) {
      text += chunk.choices[0]!.delta.content ?? "";
    }
    expect(sentStream).toBe(true);
    expect(text).toBe("Hello");
  });

  it("requires a non-empty model and messages", async () => {
    const pa = makeClient(() => jsonResponse(200, {}));
    expect(() => pa.chat.completions.create({ model: "", messages: [{ role: "user", content: "x" }] })).toThrow(
      ParetaError,
    );
    expect(() => pa.chat.completions.create({ model: "ep", messages: [] })).toThrow(ParetaError);
  });
});
