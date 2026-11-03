import { test } from "@fedify/fixture";
import { deepStrictEqual, ok, rejects, strictEqual } from "node:assert/strict";
import { captureResponseBody } from "./outbound-capture.ts";
import { projectSenderPayload } from "./outbound-document.ts";

test("outbound sender payload privacy on Workers", () => {
  const secret = "https://private.example/recipient";
  const input = {
    "@context": "https://www.w3.org/ns/activitystreams",
    type: "Create",
    bcc: [secret],
    object: { "as:bto": [secret], content: "visible" },
  };
  const result = projectSenderPayload(input);
  ok(result.type === "available");
  strictEqual(result.redacted, true);
  strictEqual(JSON.stringify(result.value).includes(secret), false);
  ok(Object.isFrozen(result.value));
  strictEqual(input.bcc[0], secret);
  deepStrictEqual(
    projectSenderPayload({
      ...input,
      "@context": [input["@context"], { private: "as:bcc" }],
    }),
    {
      stage: "sender-payload",
      type: "unavailable",
      reason: "privacy-filter-unavailable",
    },
  );
});

test("outbound body capture revocation on Workers", async () => {
  let cancelled = 0;
  let reader!: ReadableStreamDefaultReader<Uint8Array>;
  let signal!: AbortSignal;
  const source = new ReadableStream<Uint8Array>({
    pull() {},
    cancel() {
      cancelled++;
      return new Promise<void>(() => {});
    },
  }, { highWaterMark: 0 });
  const result = await captureResponseBody(new Response(source), {
    maxBytes: 16,
    timeoutMs: 10,
  }, async (body, current) => {
    signal = current;
    reader = body.getReader();
    await rejects(reader.read());
  });
  deepStrictEqual(result, { type: "deadline", bytesExposed: 0 });
  ok(signal.aborted);
  strictEqual(cancelled, 1);
  strictEqual(source.locked, false);
  await rejects(reader.read());
  reader.releaseLock();
});
