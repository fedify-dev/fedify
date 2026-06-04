import assert from "node:assert/strict";
import test from "node:test";
import { fetchServerMetrics, parseServerMetrics } from "./stats-client.ts";

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
