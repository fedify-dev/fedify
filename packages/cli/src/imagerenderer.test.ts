import assert from "node:assert/strict";
import { rm, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { downloadImage } from "./imagerenderer.ts";

const TEST_PUBLIC_IMAGE_URL = "https://198.51.100.10/image.png";
const TEST_PUBLIC_REDIRECT_URL = "https://198.51.100.11/final.png";

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
    result = await downloadImage(TEST_PUBLIC_IMAGE_URL);
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
    if (target === TEST_PUBLIC_IMAGE_URL) {
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
    const result = await downloadImage(TEST_PUBLIC_IMAGE_URL);
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
    if (target === TEST_PUBLIC_IMAGE_URL) {
      return Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: TEST_PUBLIC_REDIRECT_URL },
        }),
      );
    }
    return Promise.resolve(new Response(new Uint8Array([1, 2, 3])));
  }) as typeof fetch;

  let result: string | null = null;
  try {
    result = await downloadImage(TEST_PUBLIC_IMAGE_URL);
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

test("downloadImage - cancels redirect response body before following", async () => {
  let cancelled = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: URL | RequestInfo) => {
    const target = typeof input === "string" ? input : input.toString();
    if (target === TEST_PUBLIC_IMAGE_URL) {
      const body = new ReadableStream<Uint8Array>({
        cancel() {
          cancelled++;
        },
      });
      return Promise.resolve(
        new Response(body, {
          status: 302,
          headers: { location: TEST_PUBLIC_REDIRECT_URL },
        }),
      );
    }
    return Promise.resolve(new Response(new Uint8Array([1, 2, 3])));
  }) as typeof fetch;

  let result: string | null = null;
  try {
    result = await downloadImage(TEST_PUBLIC_IMAGE_URL);
    assert.notEqual(result, null);
    assert.equal(cancelled, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (result != null) {
      await rm(path.dirname(result), { recursive: true, force: true });
    }
  }
});

test("downloadImage - cancels redirect body when location is missing", async () => {
  let cancelled = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_input: URL | RequestInfo) => {
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled++;
      },
    });
    return Promise.resolve(new Response(body, { status: 302 }));
  }) as typeof fetch;

  try {
    const result = await downloadImage(TEST_PUBLIC_IMAGE_URL);
    assert.equal(result, null);
    assert.equal(cancelled, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("downloadImage - cancels body for non-ok terminal response", async () => {
  let cancelled = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_input: URL | RequestInfo) => {
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled++;
      },
    });
    return Promise.resolve(new Response(body, { status: 500 }));
  }) as typeof fetch;

  try {
    const result = await downloadImage(TEST_PUBLIC_IMAGE_URL);
    assert.equal(result, null);
    assert.equal(cancelled, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("downloadImage - rejects unsafe extension containing path traversal", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch =
    ((_input: URL | RequestInfo) =>
      Promise.resolve(new Response(new Uint8Array([1, 2, 3])))) as typeof fetch;

  try {
    const result = await downloadImage(
      "https://198.51.100.10/image.png/..%2f..%2f..%2fetc%2fpasswd",
    );
    assert.equal(result, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("downloadImage - falls back to jpg when URL has no extension", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch =
    ((_input: URL | RequestInfo) =>
      Promise.resolve(new Response(new Uint8Array([1, 2, 3])))) as typeof fetch;

  let result: string | null = null;
  try {
    result = await downloadImage("https://198.51.100.10/image");
    assert.notEqual(result, null);
    assert.equal(path.extname(result!), ".jpg");
  } finally {
    globalThis.fetch = originalFetch;
    if (result != null) {
      await rm(path.dirname(result), { recursive: true, force: true });
    }
  }
});

test("downloadImage - falls back to content type for extensionless nested path", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_input: URL | RequestInfo) =>
    Promise.resolve(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/png" },
      }),
    )) as typeof fetch;

  let result: string | null = null;
  try {
    result = await downloadImage("https://198.51.100.10/media/12345");
    assert.notEqual(result, null);
    assert.equal(path.extname(result!), ".png");
  } finally {
    globalThis.fetch = originalFetch;
    if (result != null) {
      await rm(path.dirname(result), { recursive: true, force: true });
    }
  }
});
