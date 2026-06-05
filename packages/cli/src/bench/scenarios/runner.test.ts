import assert from "node:assert/strict";
import test from "node:test";
import type { SendOutcome } from "../load/generator.ts";
import { withMeasuredWindowStart } from "./runner.ts";

const ok: SendOutcome = { ok: true, status: 200 };

test("withMeasuredWindowStart - fires once at the warm-up boundary", async () => {
  const seenAt: number[] = [];
  let fires = 0;
  const send = withMeasuredWindowStart(
    100,
    () => {
      fires++;
    },
    (scheduledAtMs) => {
      seenAt.push(scheduledAtMs);
      return Promise.resolve(ok);
    },
  );
  for (const offset of [0, 40, 99, 100, 140, 200]) await send(offset);
  // Fires exactly once, at the first send whose scheduled time reaches 100.
  assert.strictEqual(fires, 1);
  // The underlying send still ran for every request, in order.
  assert.deepEqual(seenAt, [0, 40, 99, 100, 140, 200]);
});

test("withMeasuredWindowStart - fires before the first send when no warm-up", async () => {
  const order: string[] = [];
  const send = withMeasuredWindowStart(
    0,
    () => {
      order.push("boundary");
    },
    (_scheduledAtMs) => {
      order.push("send");
      return Promise.resolve(ok);
    },
  );
  await send(0);
  await send(10);
  // The callback runs before the very first send, then never again.
  assert.deepEqual(order, ["boundary", "send", "send"]);
});

test("withMeasuredWindowStart - never fires if no request reaches the window", async () => {
  let fires = 0;
  const send = withMeasuredWindowStart(
    1000,
    () => {
      fires++;
    },
    () => Promise.resolve(ok),
  );
  for (const offset of [0, 100, 999]) await send(offset);
  assert.strictEqual(fires, 0);
});
