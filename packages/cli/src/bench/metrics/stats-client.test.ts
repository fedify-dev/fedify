import assert from "node:assert/strict";
import test from "node:test";
import {
  diffSnapshots,
  fetchServerMetrics,
  fetchServerSnapshot,
  parseServerMetrics,
  parseServerSnapshot,
  type ServerSnapshot,
  snapshotToMetrics,
} from "./stats-client.ts";

function snapshot() {
  return {
    version: 1,
    source: "server",
    scopeMetrics: [
      {
        scope: { name: "@fedify/fedify", version: "2.3.0" },
        metrics: [
          {
            name: "activitypub.signature.verification.duration",
            unit: "ms",
            dataPointType: "histogram",
            dataPoints: [
              {
                attributes: { "activitypub.signature.kind": "http" },
                value: {
                  buckets: {
                    boundaries: [5, 10, 25, 50, 100],
                    counts: [10, 20, 30, 20, 15, 5],
                  },
                  count: 100,
                  sum: 2000,
                },
              },
            ],
          },
          {
            name: "fedify.queue.depth",
            unit: "{task}",
            dataPointType: "gauge",
            dataPoints: [
              {
                attributes: { "fedify.queue.depth.state": "queued" },
                value: 7,
              },
              { attributes: { "fedify.queue.depth.state": "ready" }, value: 3 },
            ],
          },
        ],
      },
    ],
    errors: [],
  };
}

test("parseServerMetrics - extracts signature verification percentiles", () => {
  const metrics = parseServerMetrics(snapshot());
  assert.ok(metrics != null);
  const overall = metrics.signatureVerificationMs?.overall;
  assert.strictEqual(overall?.p50, 25);
  assert.strictEqual(overall?.p95, 100);
  assert.strictEqual(overall?.p99, 100);
});

test("parseServerMetrics - extracts max queue depth", () => {
  const metrics = parseServerMetrics(snapshot());
  assert.strictEqual(metrics?.queue?.depthMax, 7);
});

test("parseServerMetrics - null when no relevant instruments", () => {
  assert.strictEqual(
    parseServerMetrics({ version: 1, source: "server", scopeMetrics: [] }),
    null,
  );
});

test("parseServerMetrics - tolerates malformed snapshots without throwing", () => {
  for (
    const bad of [
      null,
      undefined,
      42,
      "nope",
      {},
      { scopeMetrics: "x" },
      { scopeMetrics: [{ metrics: "x" }] },
      {
        scopeMetrics: [{
          metrics: [{
            name: "activitypub.signature.verification.duration",
            dataPointType: "histogram",
            dataPoints: [{
              value: { buckets: { boundaries: null, counts: 5 } },
            }],
          }],
        }],
      },
      {
        scopeMetrics: [{
          metrics: [{
            name: "activitypub.signature.verification.duration",
            dataPointType: "histogram",
            dataPoints: [{
              value: { buckets: { boundaries: [1, "x"], counts: [1, 2, 3] } },
            }],
          }],
        }],
      },
    ]
  ) {
    assert.strictEqual(parseServerMetrics(bad), null);
  }
});

test("fetchServerMetrics - parses a fetched snapshot", async () => {
  const metrics = await fetchServerMetrics(
    new URL("http://localhost:3000"),
    () =>
      Promise.resolve(
        new Response(JSON.stringify(snapshot()), {
          headers: { "content-type": "application/json" },
        }),
      ),
  );
  assert.ok(metrics?.signatureVerificationMs != null);
});

test("fetchServerMetrics - null on a failed request", async () => {
  const metrics = await fetchServerMetrics(
    new URL("http://localhost:3000"),
    () => Promise.resolve(new Response("nope", { status: 404 })),
  );
  assert.strictEqual(metrics, null);
});

test("parseServerSnapshot - extracts raw histogram and queue depth", () => {
  const snap = parseServerSnapshot(snapshot());
  assert.deepEqual(snap?.signature?.boundaries, [5, 10, 25, 50, 100]);
  assert.deepEqual(snap?.signature?.counts, [10, 20, 30, 20, 15, 5]);
  assert.strictEqual(snap?.queueDepthMax, 7);
});

test("parseServerSnapshot - extracts permanent delivery failures", () => {
  const snap = parseServerSnapshot({
    scopeMetrics: [{
      metrics: [{
        name: "activitypub.delivery.permanent_failure",
        dataPointType: "sum",
        dataPoints: [{ value: 3 }, { value: 2 }],
      }],
    }],
  });
  assert.strictEqual(snap?.deliveryPermanentFailures, 5);
});

test("parseServerSnapshot - skips malformed sum data points", () => {
  const snap = parseServerSnapshot({
    scopeMetrics: [{
      metrics: [
        {
          name: "fedify.queue.task.enqueued",
          dataPointType: "sum",
          dataPoints: [null, { value: 5 }],
        },
        {
          name: "fedify.queue.task.completed",
          dataPointType: "sum",
          dataPoints: [{ value: 3 }],
        },
      ],
    }],
  });
  assert.deepEqual(snap?.queueTasks, {
    enqueued: 5,
    completed: 3,
    failed: 0,
  });
});

test("parseServerSnapshot - empty (non-null) when no relevant instruments", () => {
  // A parseable-but-empty snapshot yields an empty snapshot, not null, so a
  // successful baseline fetch is distinguishable from an unavailable one.
  assert.deepEqual(
    parseServerSnapshot({ version: 1, source: "server", scopeMetrics: [] }),
    { signature: null, queueDepthMax: null },
  );
});

test("diffSnapshots - subtracts the baseline bucket counts", () => {
  const baseline: ServerSnapshot = {
    signature: { boundaries: [5, 10, 25], counts: [4, 6, 10, 0] },
    queueDepthMax: 2,
    deliveryPermanentFailures: 2,
  };
  const end: ServerSnapshot = {
    signature: { boundaries: [5, 10, 25], counts: [10, 16, 30, 4] },
    queueDepthMax: 9,
    deliveryPermanentFailures: 5,
  };
  const diff = diffSnapshots(baseline, end);
  assert.deepEqual(diff?.signature?.counts, [6, 10, 20, 4]);
  // The queue depth is a gauge, so the end value is kept (not subtracted).
  assert.strictEqual(diff?.queueDepthMax, 9);
  assert.strictEqual(diff?.deliveryPermanentFailures, 3);
});

test("diffSnapshots - an empty baseline keeps the full end histogram", () => {
  // Nothing was recorded before the window opened, so the whole end histogram
  // belongs to the window.
  const baseline: ServerSnapshot = { signature: null, queueDepthMax: null };
  const end: ServerSnapshot = {
    signature: { boundaries: [5], counts: [3, 1] },
    queueDepthMax: 4,
  };
  const diff = diffSnapshots(baseline, end);
  assert.deepEqual(diff.signature?.counts, [3, 1]);
  assert.strictEqual(diff.queueDepthMax, 4);
});

test("diffSnapshots - incompatible bucketing drops the signature histogram", () => {
  // Same length but different boundary values is not comparable; refuse to
  // subtract rather than misattribute counts.
  const baseline: ServerSnapshot = {
    signature: { boundaries: [5, 10, 20], counts: [1, 1, 1, 1] },
    queueDepthMax: null,
  };
  const end: ServerSnapshot = {
    signature: { boundaries: [5, 10, 25], counts: [2, 2, 2, 2] },
    queueDepthMax: null,
  };
  assert.strictEqual(diffSnapshots(baseline, end).signature, null);
});

test("diffSnapshots - mismatched bucket lengths drop the signature histogram", () => {
  const baseline: ServerSnapshot = {
    signature: { boundaries: [5, 10], counts: [1, 1, 1] },
    queueDepthMax: null,
  };
  const end: ServerSnapshot = {
    signature: { boundaries: [5, 10, 25], counts: [2, 2, 2, 2] },
    queueDepthMax: null,
  };
  assert.strictEqual(diffSnapshots(baseline, end).signature, null);
});

test("diffSnapshots + snapshotToMetrics - percentiles reflect only the window", () => {
  // The window's requests landed entirely in the fastest bucket, even though
  // the cumulative end snapshot is dominated by slow earlier requests.
  const baseline: ServerSnapshot = {
    signature: {
      boundaries: [5, 10, 25, 50, 100],
      counts: [0, 0, 0, 0, 0, 100],
    },
    queueDepthMax: null,
  };
  const end: ServerSnapshot = {
    signature: {
      boundaries: [5, 10, 25, 50, 100],
      counts: [50, 0, 0, 0, 0, 100],
    },
    queueDepthMax: null,
  };
  const metrics = snapshotToMetrics(diffSnapshots(baseline, end));
  assert.strictEqual(metrics?.signatureVerificationMs?.overall.p50, 5);
  assert.strictEqual(metrics?.signatureVerificationMs?.overall.p95, 5);
});

test("snapshotToMetrics - omits a signature histogram with no measurements", () => {
  const empty: ServerSnapshot = {
    signature: { boundaries: [5, 10], counts: [0, 0, 0] },
    queueDepthMax: null,
  };
  assert.strictEqual(snapshotToMetrics(empty), null);
});

test("fetchServerSnapshot - null on a failed request, empty on success", async () => {
  // A failed fetch is unavailable (null); a successful but empty snapshot is a
  // real, diffable baseline (non-null), so the two are not conflated.
  const unavailable = await fetchServerSnapshot(
    new URL("http://localhost:3000"),
    () => Promise.resolve(new Response("nope", { status: 503 })),
  );
  assert.strictEqual(unavailable, null);

  const empty = await fetchServerSnapshot(
    new URL("http://localhost:3000"),
    () =>
      Promise.resolve(
        new Response(
          JSON.stringify({ version: 1, source: "server", scopeMetrics: [] }),
          { headers: { "content-type": "application/json" } },
        ),
      ),
  );
  assert.deepEqual(empty, { signature: null, queueDepthMax: null });
});

test("parseServerSnapshot - skips null metric entries and parses the rest", () => {
  const snap = parseServerSnapshot({
    scopeMetrics: [{
      metrics: [
        null,
        {
          name: "activitypub.signature.verification.duration",
          dataPointType: "histogram",
          dataPoints: [
            { value: { buckets: { boundaries: [5, 10], counts: [1, 2, 3] } } },
          ],
        },
      ],
    }],
  });
  assert.deepEqual(snap?.signature?.counts, [1, 2, 3]);
});

test("parseServerSnapshot - does not sum histogram points with different boundaries", () => {
  const snap = parseServerSnapshot({
    scopeMetrics: [{
      metrics: [{
        name: "activitypub.signature.verification.duration",
        dataPointType: "histogram",
        dataPoints: [
          { value: { buckets: { boundaries: [5, 10], counts: [1, 1, 1] } } },
          { value: { buckets: { boundaries: [5, 20], counts: [2, 2, 2] } } },
        ],
      }],
    }],
  });
  // The second point's boundaries differ, so it is skipped, not misaligned.
  assert.deepEqual(snap?.signature?.boundaries, [5, 10]);
  assert.deepEqual(snap?.signature?.counts, [1, 1, 1]);
});
