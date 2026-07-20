import { describe, expect, it } from "vitest";
import { ImageGeneration, ParetaError } from "../src/index.js";
import { jsonResponse, makeClient } from "./_helpers.js";

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x20, 0x21]);
const PNG_B64 = Buffer.from(PNG_BYTES).toString("base64");

function payload() {
  return {
    created: 1789000000,
    model: "hidream-1",
    data: [{ b64_json: PNG_B64 }],
    size: "1024x1024",
  };
}

describe("images.generate", () => {
  it("posts the body and returns a typed ImageGeneration", async () => {
    let body: Record<string, unknown> = {};
    const pa = makeClient((url, init) => {
      expect(new URL(url).pathname).toBe("/v1/images/generations");
      body = JSON.parse(init.body as string);
      return jsonResponse(200, payload());
    });
    const out = await pa.images.generate("a red fox in the snow");
    expect(body).toEqual({ prompt: "a red fox in the snow" });
    expect(out).toBeInstanceOf(ImageGeneration);
    expect(out.model).toBe("hidream-1");
    expect(out.size).toBe("1024x1024");
    expect(out.created).toBe(1789000000);
    expect(out.b64Json).toBe(PNG_B64);
    expect(Array.from(out.image)).toEqual(Array.from(PNG_BYTES));
  });

  it("forwards size and seed", async () => {
    let body: Record<string, unknown> = {};
    const pa = makeClient((url, init) => {
      body = JSON.parse(init.body as string);
      return jsonResponse(200, payload());
    });
    await pa.images.generate("x", { size: "2560x1440", seed: 7 });
    expect(body).toEqual({ prompt: "x", size: "2560x1440", seed: 7 });
  });

  it("rejects an empty prompt without a request", async () => {
    const pa = makeClient(() => {
      throw new Error("no request expected");
    });
    expect(() => pa.images.generate("")).toThrow(ParetaError);
    expect(() => pa.images.generate("   ")).toThrow(ParetaError);
  });

  it("decodes to empty bytes when data is missing", () => {
    const out = new ImageGeneration({ created: 1, model: "hidream-1" });
    expect(out.b64Json).toBeNull();
    expect(out.image.length).toBe(0);
  });
});

describe("images.edit", () => {
  it("posts prompt + normalized image and returns a typed ImageGeneration", async () => {
    let body: Record<string, unknown> = {};
    const pa = makeClient((url, init) => {
      expect(new URL(url).pathname).toBe("/v1/images/edits");
      body = JSON.parse(init.body as string);
      return jsonResponse(200, payload());
    });
    const out = await pa.images.edit(PNG_BYTES, "make the fox blue", { seed: 3 });
    expect(body).toEqual({ prompt: "make the fox blue", image: PNG_B64, seed: 3 });
    expect(out).toBeInstanceOf(ImageGeneration);
    expect(Array.from(out.image)).toEqual(Array.from(PNG_BYTES));
  });

  it("passes { base64 } through untouched", async () => {
    let body: Record<string, unknown> = {};
    const pa = makeClient((url, init) => {
      body = JSON.parse(init.body as string);
      return jsonResponse(200, payload());
    });
    await pa.images.edit({ base64: PNG_B64 }, "x");
    expect(body.image).toBe(PNG_B64);
  });

  it("rejects empty prompt and empty image", async () => {
    const pa = makeClient(() => {
      throw new Error("no request expected");
    });
    await expect(pa.images.edit(PNG_BYTES, "")).rejects.toThrow(ParetaError);
    await expect(pa.images.edit(new Uint8Array(0), "x")).rejects.toThrow(ParetaError);
    await expect(pa.images.edit({ base64: "  " }, "x")).rejects.toThrow(ParetaError);
  });
});
