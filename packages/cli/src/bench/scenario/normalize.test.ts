import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSuite, SuiteNormalizeError } from "./normalize.ts";
import type { Suite } from "./types.ts";

function suite(overrides: Partial<Suite> = {}): Suite {
  return {
    version: 1,
    target: "http://localhost:3000",
    scenarios: [
      { name: "inbox-shared", type: "inbox", recipient: "acct:alice@x" },
    ],
    ...overrides,
  };
}

test("normalizeSuite - applies defaults and parses units", () => {
  const resolved = normalizeSuite(suite({
    defaults: { duration: "30s", warmup: "5s", load: { rate: "200/s" } },
  }));
  const s = resolved.scenarios[0];
  assert.strictEqual(s.durationMs, 30_000);
  assert.strictEqual(s.warmupMs, 5000);
  assert.deepEqual(s.load, {
    kind: "open",
    ratePerSec: 200,
    arrival: "constant",
    maxInFlight: undefined,
  });
  assert.strictEqual(s.signing, "pipeline");
  assert.strictEqual(s.runs, 1);
  assert.deepEqual(s.recipients, ["acct:alice@x"]);
});

test("normalizeSuite - falls back to open-loop defaults", () => {
  const s = normalizeSuite(suite()).scenarios[0];
  assert.strictEqual(s.load.kind, "open");
  assert.strictEqual(s.durationMs, 60_000);
  assert.strictEqual(s.warmupMs, 0);
});

test("normalizeSuite - resolves closed-loop load", () => {
  const s = normalizeSuite(suite({
    defaults: { load: { concurrency: 50, maxInFlight: 100 } },
  })).scenarios[0];
  assert.deepEqual(s.load, {
    kind: "closed",
    concurrency: 50,
    maxInFlight: 100,
  });
});

test("normalizeSuite - scenario load overrides defaults", () => {
  const s = normalizeSuite(suite({
    defaults: { load: { rate: "10/s" } },
    scenarios: [{
      name: "x",
      type: "inbox",
      recipient: "acct:a@x",
      load: { concurrency: 5 },
    }],
  })).scenarios[0];
  assert.strictEqual(s.load.kind, "closed");
});

test("normalizeSuite - load inherits arrival/maxInFlight from defaults", () => {
  const s = normalizeSuite(suite({
    defaults: { load: { rate: "10/s", arrival: "poisson", maxInFlight: 200 } },
    scenarios: [{
      name: "x",
      type: "inbox",
      recipient: "acct:a@x",
      load: { rate: "100/s" },
    }],
  })).scenarios[0];
  assert.deepEqual(s.load, {
    kind: "open",
    ratePerSec: 100,
    arrival: "poisson",
    maxInFlight: 200,
  });
});

test("normalizeSuite - parses fanout queueDrainTimeout to ms", () => {
  const s = normalizeSuite(suite({
    scenarios: [{
      name: "fan",
      type: "fanout",
      sender: "alice",
      queueDrainTimeout: "2m",
    }],
  })).scenarios[0];
  assert.strictEqual(s.queueDrainTimeoutMs, 120_000);
});

test("normalizeSuite - coerces scalar recipient to a list", () => {
  const s = normalizeSuite(suite({
    scenarios: [{
      name: "wf",
      type: "webfinger",
      recipient: ["acct:a@x", "acct:b@x"],
    }],
  })).scenarios[0];
  assert.deepEqual(s.recipients, ["acct:a@x", "acct:b@x"]);
});

test("normalizeSuite - --target overrides the suite target", () => {
  const resolved = normalizeSuite(suite(), {
    target: "http://127.0.0.1:8080",
  });
  assert.strictEqual(resolved.target.href, "http://127.0.0.1:8080/");
});

test("normalizeSuite - requires a target", () => {
  assert.throws(
    () => normalizeSuite(suite({ target: undefined })),
    SuiteNormalizeError,
  );
});

test("normalizeSuite - rejects an invalid target URL", () => {
  assert.throws(
    () => normalizeSuite(suite({ target: "not a url" })),
    SuiteNormalizeError,
  );
});

test("normalizeSuite - pipeline signing rejects a time-windowed target", () => {
  assert.throws(
    () =>
      normalizeSuite(suite({
        defaults: { signing: "pipeline", signatureTimeWindow: true },
      })),
    SuiteNormalizeError,
  );
});

test("normalizeSuite - presign rejects a closed-loop load", () => {
  assert.throws(
    () =>
      normalizeSuite(suite({
        defaults: { signing: "presign", load: { concurrency: 10 } },
      })),
    SuiteNormalizeError,
  );
});

test("normalizeSuite - presign allows an open-loop load", () => {
  const s = normalizeSuite(suite({
    defaults: { signing: "presign", load: { rate: "100/s" } },
  })).scenarios[0];
  assert.strictEqual(s.signing, "presign");
  assert.strictEqual(s.load.kind, "open");
});

test("normalizeSuite - jit signing allows a time-windowed target", () => {
  const s = normalizeSuite(suite({
    defaults: { signing: "jit", signatureTimeWindow: true },
  })).scenarios[0];
  assert.strictEqual(s.signing, "jit");
  assert.strictEqual(s.signatureTimeWindow, true);
});

test("normalizeSuite - rejects warmup not shorter than duration", () => {
  assert.throws(
    () =>
      normalizeSuite(suite({
        defaults: { duration: "10s", warmup: "10s" },
      })),
    (error: unknown) =>
      error instanceof SuiteNormalizeError && /warmup/.test(error.message),
  );
  assert.throws(
    () =>
      normalizeSuite(suite({
        defaults: { duration: "10s", warmup: "30s" },
      })),
    SuiteNormalizeError,
  );
});

test("normalizeSuite - allows warmup shorter than duration", () => {
  const s = normalizeSuite(suite({
    defaults: { duration: "10s", warmup: "9s" },
  })).scenarios[0];
  assert.strictEqual(s.durationMs, 10_000);
  assert.strictEqual(s.warmupMs, 9000);
});

test("normalizeSuite - rejects multiple runs (runs > 1)", () => {
  assert.throws(
    () => normalizeSuite(suite({ defaults: { runs: 3 } })),
    (error: unknown) =>
      error instanceof SuiteNormalizeError && /runs/.test(error.message),
  );
});
