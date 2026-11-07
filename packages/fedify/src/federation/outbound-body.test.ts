import { test } from "@fedify/fixture";
import { deepStrictEqual, ok, rejects, strictEqual } from "node:assert/strict";
import { ResponseBodyPump } from "./outbound-body.ts";

test("response body pump pulls once on demand and releases at EOF", async () => {
  let pulls = 0;
  let cancels = 0;
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let pulled!: () => void;
  const pulling = new Promise<void>((resolve) => {
    pulled = resolve;
  });
  const body = new ReadableStream<Uint8Array>(
    {
      start(value) {
        controller = value;
      },
      pull() {
        pulls++;
        pulled();
      },
      cancel() {
        cancels++;
      },
    },
    { highWaterMark: 0 },
  );
  const pump = new ResponseBodyPump(body, 1000);
  try {
    strictEqual(pulls, 0);
    ok(body.locked);
    const first = pump.read();
    const concurrent = pump.read();
    strictEqual(first, concurrent);
    await pulling;
    strictEqual(pulls, 1);
    controller.enqueue(new Uint8Array([1, 2]));
    const result = await first;
    deepStrictEqual(result, { done: false, value: new Uint8Array([1, 2]) });
    strictEqual(await concurrent, result);
    strictEqual(pulls, 1);
    controller.close();
    deepStrictEqual(await pump.read(), { done: true, value: undefined });
    strictEqual(body.locked, false);
    strictEqual(cancels, 0);
    deepStrictEqual(await pump.read(), { done: true, value: undefined });
  } finally {
    pump.close();
  }
});

test("response body pump deadline bounds stalled reads and cancellation cleanup", async (t) => {
  for (const mode of ["no-pull", "stalled", "late-rejection"] as const) {
    await t.step(mode, async () => {
      let pulls = 0;
      let cancels = 0;
      let cancelled!: () => void;
      const cancelling = new Promise<void>((resolve) => {
        cancelled = resolve;
      });
      let rejectCancel!: (error: unknown) => void;
      const cleanup = new Promise<void>((_resolve, reject) => {
        rejectCancel = reject;
      });
      const body = new ReadableStream<Uint8Array>(
        {
          pull() {
            pulls++;
          },
          cancel() {
            cancels++;
            cancelled();
            return cleanup;
          },
        },
        { highWaterMark: 0 },
      );
      const pump = new ResponseBodyPump(body, 25);
      try {
        if (mode === "no-pull") await cancelling;
        else strictEqual(await pump.read(), undefined);
        strictEqual(cancels, 1);
        strictEqual(body.locked, false);
        strictEqual(pulls, mode === "no-pull" ? 0 : 1);
        strictEqual(await pump.read(), undefined);
        pump.close();
        strictEqual(cancels, 1);
        if (mode === "late-rejection") {
          rejectCancel(new Error("late cleanup failure"));
          // Flush rejection handlers; the late failure must remain observed.
          await Promise.resolve();
          await Promise.resolve();
        }
      } finally {
        pump.close();
      }
    });
  }
});

test("response body pump deadline also stops continuously ready empty chunks", async () => {
  let pulls = 0;
  let cancels = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array());
      },
      cancel() {
        cancels++;
      },
    },
    { highWaterMark: 0 },
  );
  const pump = new ResponseBodyPump(body, 25);
  try {
    while ((await pump.read()) != null) {
      /* Keep pulling a non-terminating source. */
    }
    ok(pulls > 0);
    strictEqual(cancels, 1);
    strictEqual(body.locked, false);
    const stoppedAt = pulls;
    strictEqual(await pump.read(), undefined);
    strictEqual(pulls, stoppedAt);
  } finally {
    pump.close();
  }
});

test("response body pump preserves read failure and releases ownership", async () => {
  const failure = new Error("broken body");
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        controller.error(failure);
      },
    },
    { highWaterMark: 0 },
  );
  const pump = new ResponseBodyPump(body, 1000);
  try {
    await rejects(pump.read(), (error: unknown) => error === failure);
    strictEqual(body.locked, false);
    deepStrictEqual(await pump.read(), { done: true, value: undefined });
  } finally {
    pump.close();
  }
});
