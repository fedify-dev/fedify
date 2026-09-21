import { deepStrictEqual, ok, rejects } from "node:assert/strict";
import { test } from "node:test";
import { gunzipSync, gzipSync } from "node:zlib";
import { BodyTooLargeError, readBoundedText } from "./body.ts";

const url = "https://example.com/document";

test("readBoundedText handles empty bodies and flushes incomplete UTF-8", async () => {
  deepStrictEqual(await readBoundedText(new Response(null), 1, url), "");
  deepStrictEqual(await readBoundedText(new Response(""), 1, url), "");
  deepStrictEqual(
    await readBoundedText(new Response(new Uint8Array([0xe2, 0x82])), 2, url),
    "\ufffd",
  );
});

test("readBoundedText counts bytes and preserves split UTF-8", async () => {
  const bytes = new TextEncoder().encode('"안녕"');
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    },
  });
  deepStrictEqual(
    await readBoundedText(new Response(stream), bytes.length, url),
    '"안녕"',
  );
  await rejects(
    readBoundedText(new Response(bytes), bytes.length - 1, url),
    BodyTooLargeError,
  );
});

test("readBoundedText rejects a declared oversized body without pulling", async () => {
  let pulled = false;
  let canceled = false;
  const response = new Response(
    new ReadableStream({
      pull() {
        pulled = true;
      },
      cancel() {
        canceled = true;
      },
    }, { highWaterMark: 0 }),
    { headers: { "Content-Length": "100" } },
  );
  await rejects(readBoundedText(response, 10, url), BodyTooLargeError);
  deepStrictEqual(pulled, false);
  deepStrictEqual(canceled, true);
  deepStrictEqual(response.body?.locked, false);
});

test("readBoundedText cancels chunked bodies despite absent or false lengths", async () => {
  for (const length of [undefined, "1", "invalid"]) {
    let pulls = 0;
    let canceled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array(4));
      },
      cancel() {
        canceled = true;
      },
    }, { highWaterMark: 0 });
    const response = new Response(stream, {
      headers: length == null ? {} : { "Content-Length": length },
    });
    await rejects(readBoundedText(response, 8, url), BodyTooLargeError);
    deepStrictEqual(pulls, 3);
    deepStrictEqual(canceled, true);
    deepStrictEqual(response.body?.locked, false);
  }
});

test("readBoundedText limits decoded gzip bytes, not the compressed length", async () => {
  const compressed = gzipSync('"' + "a".repeat(4096) + '"');
  ok(compressed.length < 128);
  const decoded = gunzipSync(compressed);
  await rejects(
    readBoundedText(
      new Response(decoded, {
        headers: {
          "Content-Encoding": "gzip",
          "Content-Length": String(compressed.length),
        },
      }),
      128,
      url,
    ),
    BodyTooLargeError,
  );
  // The encoded representation can also be larger than a valid decoded body.
  deepStrictEqual(
    await readBoundedText(
      new Response("{}", {
        headers: { "Content-Encoding": "gzip", "Content-Length": "22" },
      }),
      2,
      url,
    ),
    "{}",
  );
});

test("readBoundedText rejects invalid limits and releases failed streams", async () => {
  for (const limit of [0, -1, NaN, Infinity, 1.5]) {
    await rejects(readBoundedText(new Response("{}"), limit, url), RangeError);
  }
  const failure = new Error("broken stream");
  const response = new Response(
    new ReadableStream({
      pull(controller) {
        controller.error(failure);
      },
    }),
  );
  await rejects(
    readBoundedText(response, 10, url),
    (error) => error === failure,
  );
  deepStrictEqual(response.body?.locked, false);
});
