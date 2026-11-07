import { test } from "@fedify/fixture";
import {
  deepStrictEqual,
  ok,
  rejects,
  strictEqual,
  throws,
} from "node:assert/strict";
import {
  captureResponseBody,
  snapshotBodyCapture,
  takeCapturedDiagnostic,
} from "./outbound-capture.ts";
import { createFederationBuilder, FederationBuilderImpl } from "./builder.ts";

const limits = { maxBytes: 32, timeoutMs: 1000 };
async function drain(body: ReadableStream<Uint8Array>): Promise<number[]> {
  const reader = body.getReader();
  const bytes: number[] = [];
  try {
    while (true) {
      const value = await reader.read();
      if (value.done) return bytes;
      bytes.push(...value.value);
    }
  } catch {
    return bytes;
  } finally {
    reader.releaseLock();
  }
}

test("response body capture validates explicit limits before replacing registration", () => {
  const config = { maxBytes: 32, timeoutMs: 0.5, onBody() {} };
  const builder = createFederationBuilder<void>();
  ok(builder instanceof FederationBuilderImpl);
  builder.setOutboundObservers({ responseBodyCapture: config });
  const original = builder.outboundObservers;
  deepStrictEqual(original.responseBodyCapture, {
    ...config,
    timeoutMs: 1,
    responses: "all",
  });
  ok(Object.isFrozen(original.responseBodyCapture));
  config.maxBytes = 1;
  strictEqual(original.responseBodyCapture?.maxBytes, 32);
  for (const [value, error] of [
    [null, TypeError],
    [{ ...limits }, TypeError],
    [{ onBody() {}, timeoutMs: 1 }, TypeError],
    [{ onBody() {}, maxBytes: 1 }, TypeError],
    [{ ...limits, onBody() {}, maxBytes: "1" }, TypeError],
    [{ ...limits, onBody() {}, maxBytes: 0 }, RangeError],
    [{ ...limits, onBody() {}, maxBytes: 1.5 }, RangeError],
    [
      { ...limits, onBody() {}, maxBytes: Number.MAX_SAFE_INTEGER + 1 },
      RangeError,
    ],
    [{ ...limits, onBody() {}, timeoutMs: Infinity }, RangeError],
    [{ ...limits, onBody() {}, timeoutMs: NaN }, RangeError],
    [{ ...limits, onBody() {}, timeoutMs: 0 }, RangeError],
    [{ ...limits, onBody() {}, timeoutMs: 2147483647.1 }, RangeError],
    [{ ...limits, onBody() {}, responses: "failures" }, TypeError],
  ] as const) {
    throws(
      () =>
        builder.setOutboundObservers({ responseBodyCapture: value as never }),
      error,
    );
    strictEqual(builder.outboundObservers, original);
  }
  strictEqual(snapshotBodyCapture(undefined), undefined);
});

test("response body capture distinguishes selection EOF and exact byte limits", async (t) => {
  for (const mode of [
    "filtered",
    "no-body",
    "empty",
    "short",
    "exact",
    "over",
  ] as const) {
    await t.step(mode, async () => {
      const response = new Response(
        mode === "no-body"
          ? null
          : mode === "empty"
            ? ""
            : mode === "over"
              ? "abcd"
              : "abc",
      );
      let calls = 0;
      let exposed: number[] = [];
      let signal: AbortSignal | undefined;
      const result = await captureResponseBody(
        response,
        {
          maxBytes: mode === "exact" || mode === "over" ? 3 : 32,
          timeoutMs: 1000,
          ...(mode === "filtered"
            ? { responses: "non-success-http-responses" as const }
            : {}),
        },
        async (body, current) => {
          calls++;
          signal = current;
          exposed = await drain(body);
        },
      );
      strictEqual(
        result.type,
        mode === "filtered" || mode === "no-body"
          ? mode
          : mode === "exact" || mode === "over"
            ? "limit-reached"
            : "complete",
      );
      strictEqual(
        result.bytesExposed,
        mode === "filtered" || mode === "no-body" || mode === "empty" ? 0 : 3,
      );
      strictEqual(calls, mode === "filtered" || mode === "no-body" ? 0 : 1);
      if (calls) {
        ok(signal?.aborted);
        strictEqual(response.body?.locked, false);
      }
      if (result.bytesExposed) deepStrictEqual(exposed, [97, 98, 99]);
      ok(Object.isFrozen(result));
    });
  }
});

test("response body capture revokes locked readers and bounds callback cleanup", async (t) => {
  for (const mode of [
    "returned",
    "cancelled",
    "throws",
    "hangs",
    "pending-read",
    "body-error",
  ] as const) {
    await t.step(mode, async () => {
      const failure = new Error(mode);
      let signal!: AbortSignal;
      let retained!: ReadableStreamDefaultReader<Uint8Array>;
      let pending: Promise<unknown> | undefined;
      let rejectLate!: (error: unknown) => void;
      const late = new Promise<void>((_resolve, reject) => {
        rejectLate = reject;
      });
      const body = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            if (mode === "body-error") controller.error(failure);
          },
          cancel() {
            return new Promise<void>(() => {});
          },
        },
        { highWaterMark: 0 },
      );
      const result = await captureResponseBody(
        new Response(body),
        {
          ...limits,
          timeoutMs: 25,
        },
        async (stream, current) => {
          signal = current;
          retained = stream.getReader();
          if (mode === "throws") throw failure;
          if (mode === "cancelled") await retained.cancel(failure);
          if (mode === "hangs") await late;
          if (mode === "pending-read") {
            pending = retained.read().catch((error) => error);
          }
          if (mode === "body-error") await retained.read();
        },
      );
      const expected =
        mode === "returned" || mode === "pending-read"
          ? "callback-returned"
          : mode === "cancelled"
            ? "consumer-stopped"
            : mode === "hangs"
              ? "deadline"
              : "failed";
      strictEqual(result.type, expected);
      strictEqual(result.bytesExposed, 0);
      ok(signal.aborted);
      strictEqual(body.locked, false);
      if (result.type === "failed") {
        strictEqual(result.phase, mode === "throws" ? "observer" : "body");
        strictEqual(result.error, failure);
      }
      if (result.type === "consumer-stopped") {
        strictEqual(result.reason, failure);
      }
      if (mode !== "cancelled") await rejects(retained.read());
      if (pending) ok((await pending) instanceof Error);
      retained.releaseLock();
      if (mode === "hangs") {
        rejectLate(failure);
        await Promise.resolve();
        await Promise.resolve();
      }
    });
  }
});

test("response body capture shares one reader with bounded diagnostics", async () => {
  const response = new Response("diagnostic failure", { status: 503 });
  ok(response.body);
  const getReader = response.body.getReader.bind(response.body);
  let acquisitions = 0;
  Object.defineProperty(response.body, "getReader", {
    value: () => {
      acquisitions++;
      return getReader();
    },
  });
  const summary = await captureResponseBody(
    response,
    {
      ...limits,
      maxBytes: 4,
    },
    async (body) => {
      await drain(body);
    },
  );
  strictEqual(summary.type, "limit-reached");
  strictEqual(summary.bytesExposed, 4);
  strictEqual(acquisitions, 1);
  strictEqual(takeCapturedDiagnostic(response), "diagnostic failure");
  strictEqual(takeCapturedDiagnostic(response), undefined);
});

test("response body capture isolates unavailable readers and diagnostic deadlines", async (t) => {
  await t.step("already locked source", async () => {
    const response = new Response("locked");
    const reader = response.body!.getReader();
    try {
      const result = await captureResponseBody(response, limits, () => {
        throw new Error("must not invoke callback");
      });
      ok(result.type === "failed");
      strictEqual(result.phase, "body");
      strictEqual(result.bytesExposed, 0);
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
  });
  await t.step("diagnostics retain their own deadline", async () => {
    let cancels = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull() {},
        cancel() {
          cancels++;
          return new Promise<void>(() => {});
        },
      },
      { highWaterMark: 0 },
    );
    const response = new Response(body, { status: 503 });
    const result = await captureResponseBody(
      response,
      {
        ...limits,
        timeoutMs: 10000,
      },
      () => {},
    );
    deepStrictEqual(result, { type: "callback-returned", bytesExposed: 0 });
    strictEqual(takeCapturedDiagnostic(response), "… (timed out)");
    strictEqual(cancels, 1);
    strictEqual(body.locked, false);
  });
});

test("response body capture bounds oversized and nonterminating sources", async (t) => {
  for (const mode of ["oversized", "infinite", "empty-infinite"] as const) {
    await t.step(mode, async () => {
      let pulls = 0;
      let cancels = 0;
      const source = new Uint8Array(
        mode === "oversized" ? 1024 * 1024 : mode === "infinite" ? 1 : 0,
      ).fill(255);
      const original = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            pulls++;
            controller.enqueue(source);
          },
          cancel() {
            cancels++;
          },
        },
        { highWaterMark: 0 },
      );
      let exposed = 0;
      const result = await captureResponseBody(
        new Response(original),
        {
          maxBytes: 17,
          timeoutMs: 50,
        },
        async (body) => {
          const reader = body.getReader();
          try {
            while (true) {
              const chunk = await reader.read();
              if (chunk.done) break;
              exposed += chunk.value.length;
              ok(chunk.value.buffer.byteLength <= 17);
              strictEqual(chunk.value[0], 255);
              chunk.value.fill(0);
            }
          } catch {
            /* Cap/deadline revokes the reader. */
          } finally {
            reader.releaseLock();
          }
        },
      );
      strictEqual(
        result.type,
        mode === "empty-infinite" ? "deadline" : "limit-reached",
      );
      strictEqual(result.bytesExposed, mode === "empty-infinite" ? 0 : 17);
      strictEqual(exposed, result.bytesExposed);
      strictEqual(cancels, 1);
      strictEqual(original.locked, false);
      if (mode !== "empty-infinite") {
        strictEqual(pulls, mode === "oversized" ? 1 : 17);
        strictEqual(source[0], 255);
      }
    });
  }
});

test("response body capture applies backpressure and revokes a paused consumer", async () => {
  let pulls = 0;
  let cancels = 0;
  let retained!: ReadableStreamDefaultReader<Uint8Array>;
  let exposed = 0;
  const source = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array([1]));
      },
      cancel() {
        cancels++;
        return new Promise<void>(() => {});
      },
    },
    { highWaterMark: 0 },
  );
  const result = await captureResponseBody(
    new Response(source),
    {
      maxBytes: 32,
      timeoutMs: 50,
    },
    async (body, signal) => {
      retained = body.getReader();
      const first = await retained.read();
      ok(!first.done);
      exposed += first.value.length;
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", () => resolve(), { once: true });
      });
      strictEqual(pulls, 1);
      await rejects(retained.read());
    },
  );
  deepStrictEqual(result, { type: "deadline", bytesExposed: 1 });
  strictEqual(exposed, 1);
  strictEqual(pulls, 1);
  strictEqual(cancels, 1);
  strictEqual(source.locked, false);
  await rejects(retained.read());
  retained.releaseLock();
});

test("response body capture rejects late source data and observes late pull failure", async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let rejectPull!: (error: unknown) => void;
  const pulling = new Promise<void>((_resolve, reject) => {
    rejectPull = reject;
  });
  let cancels = 0;
  const source = new ReadableStream<Uint8Array>(
    {
      start(value) {
        controller = value;
      },
      pull() {
        return pulling;
      },
      cancel() {
        cancels++;
        return new Promise<void>(() => {});
      },
    },
    { highWaterMark: 0 },
  );
  let retained!: ReadableStreamDefaultReader<Uint8Array>;
  let exposed = 0;
  const result = await captureResponseBody(
    new Response(source),
    {
      maxBytes: 32,
      timeoutMs: 25,
    },
    async (body) => {
      retained = body.getReader();
      try {
        const chunk = await retained.read();
        if (!chunk.done) exposed += chunk.value.length;
      } catch {
        /* Revoked at deadline. */
      }
    },
  );
  deepStrictEqual(result, { type: "deadline", bytesExposed: 0 });
  strictEqual(exposed, 0);
  strictEqual(cancels, 1);
  throws(() => controller.enqueue(new Uint8Array([1])), TypeError);
  rejectPull(new Error("late upstream failure"));
  await Promise.resolve();
  await Promise.resolve();
  await rejects(retained.read());
  retained.releaseLock();
  strictEqual(source.locked, false);
});
