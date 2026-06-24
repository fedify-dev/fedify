import assert from "node:assert/strict";
import test from "node:test";
import { runLoad, type SendOutcome } from "./generator.ts";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const ok: SendOutcome = { ok: true, status: 202 };

test("runLoad - open-loop records a sample per scheduled arrival", async () => {
  const result = await runLoad(
    {
      load: { kind: "open", ratePerSec: 100, arrival: "constant" },
      durationMs: 100,
      warmupMs: 0,
    },
    () => Promise.resolve(ok),
  );
  assert.strictEqual(result.samples.length, 10);
  assert.strictEqual(result.saturated, false);
  assert.ok(result.samples.every((s) => s.outcome.ok));
});

test("runLoad - coordinated-omission: a stall inflates later latencies", async () => {
  let firstSend = true;
  const result = await runLoad(
    {
      load: {
        kind: "open",
        ratePerSec: 50, // arrivals at 0, 20, 40, 60, 80 ms
        arrival: "constant",
        maxInFlight: 1,
      },
      durationMs: 100,
      warmupMs: 0,
    },
    async () => {
      if (firstSend) {
        firstSend = false;
        await delay(60); // first request stalls, holding the only slot
      } else {
        await delay(1);
      }
      return ok;
    },
  );
  assert.strictEqual(result.saturated, true);
  // A later request, blocked behind the stall, measures latency from its
  // scheduled time, so it is far larger than its own ~1ms service time.
  const delayed = result.samples.filter((s) => s.scheduledAtMs > 0);
  assert.ok(
    delayed.some((s) => s.latencyMs > 25),
    `expected an inflated latency; got ${
      delayed.map((s) => Math.round(s.latencyMs)).join(", ")
    }`,
  );
});

test("runLoad - open-loop respects the maxInFlight cap", async () => {
  let inFlight = 0;
  let peak = 0;
  await runLoad(
    {
      load: {
        kind: "open",
        ratePerSec: 1000,
        arrival: "constant",
        maxInFlight: 3,
      },
      durationMs: 60,
      warmupMs: 0,
    },
    async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await delay(5);
      inFlight--;
      return ok;
    },
  );
  assert.ok(peak <= 3, `peak in-flight ${peak} must not exceed 3`);
});

test("runLoad - marks warm-up samples", async () => {
  const result = await runLoad(
    {
      load: { kind: "open", ratePerSec: 100, arrival: "constant" },
      durationMs: 100,
      warmupMs: 30,
    },
    () => Promise.resolve(ok),
  );
  assert.ok(result.samples.some((s) => s.warmup));
  assert.ok(result.samples.some((s) => !s.warmup));
  assert.ok(
    result.samples.filter((s) => s.warmup).every((s) => s.scheduledAtMs < 30),
  );
});

test("runLoad - closed-loop runs N workers for the duration", async () => {
  let concurrent = 0;
  let peak = 0;
  const result = await runLoad(
    {
      load: { kind: "closed", concurrency: 2 },
      durationMs: 40,
      warmupMs: 0,
    },
    async () => {
      concurrent++;
      peak = Math.max(peak, concurrent);
      await delay(5);
      concurrent--;
      return ok;
    },
  );
  assert.ok(result.samples.length > 0);
  assert.ok(peak <= 2, `closed-loop concurrency ${peak} must not exceed 2`);
  assert.strictEqual(result.saturated, false);
});

test("runLoad - closed-loop honors maxInFlight below concurrency", async () => {
  let concurrent = 0;
  let peak = 0;
  await runLoad(
    {
      load: { kind: "closed", concurrency: 8, maxInFlight: 2 },
      durationMs: 40,
      warmupMs: 0,
    },
    async () => {
      concurrent++;
      peak = Math.max(peak, concurrent);
      await delay(5);
      concurrent--;
      return ok;
    },
  );
  assert.ok(peak <= 2, `in-flight ${peak} must respect maxInFlight 2`);
});

test("runLoad - records send exceptions as failed samples", async () => {
  const result = await runLoad(
    {
      load: { kind: "open", ratePerSec: 100, arrival: "constant" },
      durationMs: 30,
      warmupMs: 0,
    },
    () => Promise.reject(new Error("boom")),
  );
  assert.ok(result.samples.length > 0);
  assert.ok(result.samples.every((s) => !s.outcome.ok));
  assert.ok(result.samples.every((s) => s.outcome.errorKind === "exception"));
});

test("runLoad - aborts scheduled sleeps", async () => {
  const controller = new AbortController();
  const startedAt = Date.now();
  const load = runLoad(
    {
      load: { kind: "open", ratePerSec: 1, arrival: "constant" },
      durationMs: 10_000,
      warmupMs: 0,
    },
    () => Promise.resolve(ok),
    undefined,
    controller.signal,
  );
  setTimeout(() => controller.abort(new Error("cancelled")), 10);
  await assert.rejects(load, /cancelled/);
  assert.ok(Date.now() - startedAt < 1000);
});
