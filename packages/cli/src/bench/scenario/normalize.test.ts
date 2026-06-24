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
  assert.strictEqual(s.runs, 3);
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

test("normalizeSuite - partial load override keeps the default model", () => {
  // `maxInFlight` only, with no rate/concurrency anywhere: falls back to the
  // built-in open-loop default rate while applying the override.
  const s = normalizeSuite(suite({
    defaults: { load: { maxInFlight: 100 } },
  })).scenarios[0];
  assert.deepEqual(s.load, {
    kind: "open",
    ratePerSec: 50,
    arrival: "constant",
    maxInFlight: 100,
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

test("normalizeSuite - rejects a non-http(s) or host-less target", () => {
  // `localhost:3000` (a missing-scheme typo) parses as the `localhost:` scheme
  // with no host; reject it rather than misbehave later.
  for (
    const bad of [
      "localhost:3000",
      "ftp://localhost:3000",
      "file:///tmp/x",
      "ws://localhost:3000",
      // `fetch` rejects URLs carrying credentials, so reject them up front.
      "http://user@localhost:3000",
      "http://user:pass@localhost:3000",
    ]
  ) {
    assert.throws(
      () => normalizeSuite(suite({ target: bad })),
      SuiteNormalizeError,
      `expected ${JSON.stringify(bad)} to be rejected`,
    );
  }
  // The same rejection applies to a --target override.
  assert.throws(
    () => normalizeSuite(suite(), { target: "localhost:3000" }),
    SuiteNormalizeError,
  );
});

test("normalizeSuite - accepts http and https targets", () => {
  assert.strictEqual(
    normalizeSuite(suite({ target: "http://localhost:3000" })).target.protocol,
    "http:",
  );
  assert.strictEqual(
    normalizeSuite(suite({ target: "https://staging.example" })).target
      .protocol,
    "https:",
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

test("normalizeSuite - allows multiple runs", () => {
  const s = normalizeSuite(suite({ defaults: { runs: 5 } })).scenarios[0];
  assert.strictEqual(s.runs, 5);
});

test("normalizeSuite - scenario runs override defaults", () => {
  const s = normalizeSuite(suite({
    defaults: { runs: 5 },
    scenarios: [{
      name: "wf",
      type: "webfinger",
      recipient: "acct:a@x",
      runs: 2,
    }],
  })).scenarios[0];
  assert.strictEqual(s.runs, 2);
});
