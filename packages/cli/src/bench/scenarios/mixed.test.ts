import assert from "node:assert/strict";
import test from "node:test";
import { getContextLoader, getDocumentLoader } from "../../docloader.ts";
import { LogLinearHistogram } from "../metrics/histogram.ts";
import type { ScenarioMeasurement } from "../result/build.ts";
import { normalizeSuite } from "../scenario/normalize.ts";
import type { Suite } from "../scenario/types.ts";
import { mergeMeasurements, mixedRunner } from "./mixed.ts";

test("mixedRunner - runs weighted child scenarios together", async () => {
  const target = new URL("http://target.test/");
  let webfingerCalls = 0;
  const suite: Suite = {
    version: 1,
    target: target.href,
    scenarios: [
      {
        name: "lookup-a",
        type: "webfinger",
        recipient: "acct:alice@target.test",
      },
      {
        name: "lookup-b",
        type: "webfinger",
        recipient: "acct:bob@target.test",
      },
      {
        name: "mixed",
        type: "mixed",
        load: { rate: 20 },
        duration: "50ms",
        mix: [
          { scenario: "lookup-a", weight: 3 },
          { scenario: "lookup-b", weight: 1 },
        ],
      },
    ],
  };
  const scenarios = normalizeSuite(suite).scenarios;
  const scenario = scenarios[2];
  const measurement = await mixedRunner.run({
    scenario,
    scenarios,
    target,
    documentLoader: await getDocumentLoader({ allowPrivateAddress: true }),
    contextLoader: await getContextLoader({ allowPrivateAddress: true }),
    allowPrivateAddress: true,
    fleet: null,
    fetch: (input) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.pathname === "/.well-known/webfinger") {
        webfingerCalls++;
        return Promise.resolve(json({
          subject: url.searchParams.get("resource"),
          links: [],
        }));
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    },
  });

  assert.ok(webfingerCalls > 0);
  assert.strictEqual(measurement.requests.failed, 0);
  assert.strictEqual(measurement.requests.successRate, 1);
});

test("mixedRunner - rejects unknown children", async () => {
  const scenarios = normalizeSuite({
    version: 1,
    target: "http://target.test/",
    scenarios: [{
      name: "mixed",
      type: "mixed",
      mix: [{ scenario: "missing", weight: 1 }],
    }],
  }).scenarios;

  await assert.rejects(
    async () =>
      await mixedRunner.run({
        scenario: scenarios[0],
        scenarios,
        target: new URL("http://target.test/"),
        documentLoader: await getDocumentLoader({ allowPrivateAddress: true }),
        contextLoader: await getContextLoader({ allowPrivateAddress: true }),
        allowPrivateAddress: true,
        fleet: null,
      }),
    /unknown mixed child/,
  );
});

test("mixedRunner.validate - rejects unknown children with suite context", () => {
  const scenarios = normalizeSuite({
    version: 1,
    target: "http://target.test/",
    scenarios: [{
      name: "mixed",
      type: "mixed",
      mix: [{ scenario: "missing", weight: 1 }],
    }],
  }).scenarios;

  assert.throws(
    () => mixedRunner.validate?.(scenarios[0], { scenarios }),
    /unknown mixed child/,
  );
});

test("mixedRunner.validate - rejects nested mixed children with suite context", () => {
  const scenarios = normalizeSuite({
    version: 1,
    target: "http://target.test/",
    scenarios: [
      {
        name: "outer",
        type: "mixed",
        mix: [{ scenario: "inner", weight: 1 }],
      },
      {
        name: "inner",
        type: "mixed",
        mix: [{ scenario: "lookup", weight: 1 }],
      },
      {
        name: "lookup",
        type: "webfinger",
      },
    ],
  }).scenarios;

  assert.throws(
    () => mixedRunner.validate?.(scenarios[0], { scenarios }),
    /nested mixed/,
  );
});

test("mixedRunner.validate - rejects too-small closed load", () => {
  const scenario = normalizeSuite({
    version: 1,
    target: "http://target.test/",
    scenarios: [{
      name: "mixed",
      type: "mixed",
      load: { concurrency: 1 },
      mix: [
        { scenario: "one", weight: 1 },
        { scenario: "two", weight: 1 },
      ],
    }],
  }).scenarios[0];

  assert.throws(() => mixedRunner.validate?.(scenario), /concurrency/);
});

test("mergeMeasurements - merges latency histograms", () => {
  const measurement = mergeMeasurements([
    fakeMeasurement(Array.from({ length: 99 }, () => 1)),
    fakeMeasurement([1000]),
  ]);

  assert.ok(measurement.client.latencyMs.p50 < 10);
  assert.strictEqual(measurement.client.latencyMs.max, 1000);
  assert.strictEqual(measurement.histogram?.count, 100);
});

function fakeMeasurement(samples: readonly number[]): ScenarioMeasurement {
  const histogram = new LogLinearHistogram();
  for (const sample of samples) histogram.record(sample);
  return {
    requests: {
      total: samples.length,
      ok: samples.length,
      failed: 0,
      successRate: 1,
    },
    throughputPerSec: samples.length,
    client: {
      latencyMs: {
        p50: histogram.percentile(50),
        p95: histogram.percentile(95),
        p99: histogram.percentile(99),
        mean: histogram.mean,
        max: histogram.max,
      },
    },
    server: null,
    errors: [],
    histogram: histogram.toJSON(),
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/jrd+json" },
  });
}
