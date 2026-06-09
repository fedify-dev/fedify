import assert from "node:assert/strict";
import test from "node:test";
import { getContextLoader, getDocumentLoader } from "../../docloader.ts";
import { normalizeSuite } from "../scenario/normalize.ts";
import type { Suite } from "../scenario/types.ts";
import { fanoutRunner } from "./fanout.ts";

test("fanoutRunner - triggers benchmark hook and reports drain", async () => {
  const target = new URL("http://target.test/");
  let statsCalls = 0;
  let triggerRecipients = 0;
  const suite: Suite = {
    version: 1,
    target: target.href,
    scenarios: [{
      name: "fanout",
      type: "fanout",
      sender: "alice",
      followers: 5,
      load: { concurrency: 1 },
      duration: "50ms",
      queueDrainTimeout: "1s",
      expect: { deliveryThroughput: ">= 1/s" },
    }],
  };
  const scenario = normalizeSuite(suite).scenarios[0];
  const measurement = await fanoutRunner.run({
    scenario,
    target,
    documentLoader: await getDocumentLoader({ allowPrivateAddress: true }),
    contextLoader: await getContextLoader({ allowPrivateAddress: true }),
    allowPrivateAddress: true,
    fleet: null,
    fetch: (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.pathname === "/.well-known/fedify/bench/stats") {
        statsCalls++;
        const drained = statsCalls > 1;
        return Promise.resolve(json(statsSnapshot({
          enqueued: drained ? 6 : 0,
          completed: drained ? 6 : 0,
          failed: 0,
        })));
      }
      if (url.pathname === "/.well-known/fedify/bench/trigger") {
        const triggerBody = JSON.parse(String(init?.body));
        triggerRecipients = triggerBody.recipients.length;
        return Promise.resolve(json({ version: 1 }, 202));
      }
      return Promise.resolve(new Response("unexpected", { status: 500 }));
    },
  });

  assert.ok(measurement.requests.total > 0);
  assert.strictEqual(measurement.requests.successRate, 1);
  assert.ok(measurement.server?.queue?.drainMs?.p95 != null);
  assert.ok(measurement.throughputPerSec > 0);
  assert.strictEqual(triggerRecipients, 5);
});

test("fanoutRunner.validate - requires enough followers for fanout queue", () => {
  const scenario = normalizeSuite({
    version: 1,
    target: "http://target.test/",
    scenarios: [{
      name: "fanout",
      type: "fanout",
      sender: "alice",
      followers: 4,
    }],
  }).scenarios[0];
  assert.throws(() => fanoutRunner.validate?.(scenario), /at least 5/);
});

test("fanoutRunner - serializes overlapping trigger drains", async () => {
  const target = new URL("http://target.test/");
  let statsCalls = 0;
  let activeTriggers = 0;
  let maxActiveTriggers = 0;
  const suite: Suite = {
    version: 1,
    target: target.href,
    scenarios: [{
      name: "fanout",
      type: "fanout",
      sender: "alice",
      followers: 5,
      load: { concurrency: 3 },
      duration: "40ms",
      queueDrainTimeout: "1s",
    }],
  };
  const scenario = normalizeSuite(suite).scenarios[0];
  await fanoutRunner.run({
    scenario,
    target,
    documentLoader: await getDocumentLoader({ allowPrivateAddress: true }),
    contextLoader: await getContextLoader({ allowPrivateAddress: true }),
    allowPrivateAddress: true,
    fleet: null,
    fetch: async (input) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.pathname === "/.well-known/fedify/bench/stats") {
        statsCalls++;
        const drained = statsCalls % 2 === 0;
        return json(statsSnapshot({
          enqueued: drained ? 6 : 0,
          completed: drained ? 6 : 0,
          failed: 0,
        }));
      }
      if (url.pathname === "/.well-known/fedify/bench/trigger") {
        activeTriggers++;
        maxActiveTriggers = Math.max(maxActiveTriggers, activeTriggers);
        await new Promise((resolve) => setTimeout(resolve, 5));
        activeTriggers--;
        return json({ version: 1 }, 202);
      }
      return new Response("unexpected", { status: 500 });
    },
  });

  assert.strictEqual(maxActiveTriggers, 1);
});

test("fanoutRunner - counts failed queue tasks as delivery failures", async () => {
  const target = new URL("http://target.test/");
  let statsCalls = 0;
  const suite: Suite = {
    version: 1,
    target: target.href,
    scenarios: [{
      name: "fanout",
      type: "fanout",
      sender: "alice",
      followers: 5,
      load: { concurrency: 1 },
      duration: "40ms",
      queueDrainTimeout: "1s",
    }],
  };
  const scenario = normalizeSuite(suite).scenarios[0];
  const measurement = await fanoutRunner.run({
    scenario,
    target,
    documentLoader: await getDocumentLoader({ allowPrivateAddress: true }),
    contextLoader: await getContextLoader({ allowPrivateAddress: true }),
    allowPrivateAddress: true,
    fleet: null,
    fetch: (input) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.pathname === "/.well-known/fedify/bench/stats") {
        statsCalls++;
        const failedTasks = Math.floor(statsCalls / 2) * 6;
        return Promise.resolve(json(statsSnapshot({
          enqueued: failedTasks,
          completed: 0,
          failed: failedTasks,
        })));
      }
      if (url.pathname === "/.well-known/fedify/bench/trigger") {
        return Promise.resolve(json({ version: 1 }, 202));
      }
      return Promise.resolve(new Response("unexpected", { status: 500 }));
    },
  });

  assert.ok(measurement.requests.total > 0);
  assert.strictEqual(measurement.requests.successRate, 0);
  assert.strictEqual(measurement.throughputPerSec, 0);
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function statsSnapshot(counts: {
  readonly enqueued: number;
  readonly completed: number;
  readonly failed: number;
}): Record<string, unknown> {
  return {
    version: 1,
    source: "server",
    scopeMetrics: [{
      metrics: [
        sum("fedify.queue.task.enqueued", counts.enqueued),
        sum("fedify.queue.task.completed", counts.completed),
        sum("fedify.queue.task.failed", counts.failed),
      ],
    }],
  };
}

function sum(name: string, value: number): Record<string, unknown> {
  return {
    name,
    dataPointType: "sum",
    dataPoints: [{ value }],
  };
}
