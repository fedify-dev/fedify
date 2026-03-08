import assert from "node:assert/strict";
import { rm, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { downloadImage } from "./imagerenderer.ts";

test("downloadImage - skips private URL without fetching", async () => {
  let called = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_input: URL | RequestInfo) => {
    called = true;
    return Promise.resolve(new Response(new Uint8Array([1, 2, 3])));
  }) as typeof fetch;
  try {
    const result = await downloadImage("http://localhost/image.png");
    assert.equal(result, null);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("downloadImage - writes file for public URL", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch =
    ((_input: URL | RequestInfo) =>
      Promise.resolve(new Response(new Uint8Array([1, 2, 3])))) as typeof fetch;

  let result: string | null = null;
  try {
    result = await downloadImage("https://example.com/image.png");
    assert.notEqual(result, null);
    const fileStat = await stat(result!);
    assert.equal(fileStat.isFile(), true);
  } finally {
    globalThis.fetch = originalFetch;
    if (result != null) {
      await rm(path.dirname(result), { recursive: true, force: true });
    }
  }
});

test("downloadImage - rejects redirect to private URL", async () => {
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: URL | RequestInfo) => {
    calls++;
    const target = typeof input === "string" ? input : input.toString();
    if (target === "https://example.com/image.png") {
      return Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: "http://localhost/secret.png" },
        }),
      );
    }
    return Promise.resolve(new Response(new Uint8Array([1, 2, 3])));
  }) as typeof fetch;

  try {
    const result = await downloadImage("https://example.com/image.png");
    assert.equal(result, null);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("downloadImage - follows validated redirects", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: URL | RequestInfo) => {
    const target = typeof input === "string" ? input : input.toString();
    if (target === "https://example.com/image.png") {
      return Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: "https://cdn.example.com/final.png" },
        }),
      );
    }
    return Promise.resolve(new Response(new Uint8Array([1, 2, 3])));
  }) as typeof fetch;

  let result: string | null = null;
  try {
    result = await downloadImage("https://example.com/image.png");
    assert.notEqual(result, null);
    const fileStat = await stat(result!);
    assert.equal(fileStat.isFile(), true);
  } finally {
    globalThis.fetch = originalFetch;
    if (result != null) {
      await rm(path.dirname(result), { recursive: true, force: true });
    }
  }
});
