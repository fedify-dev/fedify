import assert from "node:assert/strict";
import test from "node:test";
import { serve } from "srvx";
import { getContextLoader, getDocumentLoader } from "../../docloader.ts";
import { normalizeSuite } from "../scenario/normalize.ts";
import type { Suite } from "../scenario/types.ts";
import { fanoutRunner, spawnSinkServer } from "./fanout.ts";

test("fanoutRunner - triggers benchmark hook and reports drain", async () => {
  const target = new URL("http://target.test/");
  let triggerCalls = 0;
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
        return Promise.resolve(json(statsSnapshot({
          enqueued: triggerCalls * 6,
          completed: triggerCalls * 6,
          failed: 0,
        })));
      }
      if (url.pathname === "/.well-known/fedify/bench/trigger") {
        triggerCalls++;
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
  assert.ok(measurement.deliveryThroughputPerSec != null);
  assert.ok(
    Math.abs(
      measurement.deliveryThroughputPerSec -
        measurement.throughputPerSec * triggerRecipients,
    ) < 1e-9,
  );
  assert.strictEqual(triggerRecipients, 5);
});

test("fanoutRunner.validate - accepts schema-minimum follower count", () => {
  const scenario = normalizeSuite({
    version: 1,
    target: "http://target.test/",
    scenarios: [{
      name: "fanout",
      type: "fanout",
      sender: "alice",
      followers: 1,
    }],
  }).scenarios[0];
  assert.doesNotThrow(() => fanoutRunner.validate?.(scenario));
});

test("fanoutRunner.validate - rejects invalid sinkBase URLs", () => {
  for (
    const sinkBase of [
      "http://target.test/",
      "https://target.test:8443/",
      "http://user:pass@target.test:9090/",
      "http://target.test:9090/sinks/",
    ]
  ) {
    const scenario = normalizeSuite({
      version: 1,
      target: "http://target.test/",
      scenarios: [{
        name: "fanout",
        type: "fanout",
        sender: "alice",
        followers: 5,
        sinkBase,
      }],
    }).scenarios[0];

    assert.throws(
      () => fanoutRunner.validate?.(scenario),
      /sinkBase must be an http URL/,
    );
  }
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
  assert.ok(measurement.throughputPerSec > 0);
  assert.strictEqual(measurement.deliveryThroughputPerSec, 0);
});

test("fanoutRunner - waits for observed queue work before drain", async () => {
  const target = new URL("http://target.test/");
  let statsCalls = 0;
  let triggerCalls = 0;
  const scenario = normalizeSuite({
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
  }).scenarios[0];

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
        const observed = statsCalls > 2;
        const queueTasks = observed ? triggerCalls * 6 : 0;
        return Promise.resolve(json(statsSnapshot({
          enqueued: queueTasks,
          completed: queueTasks,
          failed: 0,
        })));
      }
      if (url.pathname === "/.well-known/fedify/bench/trigger") {
        triggerCalls++;
        return Promise.resolve(json({ version: 1 }, 202));
      }
      return Promise.resolve(new Response("unexpected", { status: 500 }));
    },
  });

  assert.ok(measurement.requests.total > 0);
  assert.strictEqual(measurement.requests.successRate, 1);
  assert.ok(statsCalls > 2);
});

test("fanoutRunner - ignores baseline backlog completions while draining", async () => {
  const target = new URL("http://target.test/");
  let triggerCalls = 0;
  const scenario = normalizeSuite({
    version: 1,
    target: target.href,
    scenarios: [{
      name: "fanout",
      type: "fanout",
      sender: "alice",
      followers: 5,
      load: { concurrency: 1 },
      duration: "1ms",
      queueDrainTimeout: "30ms",
    }],
  }).scenarios[0];

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
        return Promise.resolve(json(statsSnapshot({
          enqueued: 6 + triggerCalls * 6,
          completed: triggerCalls > 0 ? 6 : 0,
          failed: 0,
        })));
      }
      if (url.pathname === "/.well-known/fedify/bench/trigger") {
        triggerCalls++;
        return Promise.resolve(json({ version: 1 }, 202));
      }
      return Promise.resolve(new Response("unexpected", { status: 500 }));
    },
  });

  assert.ok(measurement.requests.total > 0);
  assert.strictEqual(measurement.requests.successRate, 0);
  assert.ok(triggerCalls > 0);
});

test("fanoutRunner - tolerates transient drain stats failures", async () => {
  const target = new URL("http://target.test/");
  let statsCalls = 0;
  let triggerCalls = 0;
  const scenario = normalizeSuite({
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
  }).scenarios[0];

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
        if (statsCalls === 2) {
          return Promise.resolve(
            new Response("temporarily unavailable", {
              status: 503,
            }),
          );
        }
        return Promise.resolve(json(statsSnapshot({
          enqueued: triggerCalls * 6,
          completed: triggerCalls * 6,
          failed: 0,
        })));
      }
      if (url.pathname === "/.well-known/fedify/bench/trigger") {
        triggerCalls++;
        return Promise.resolve(json({ version: 1 }, 202));
      }
      return Promise.resolve(new Response("unexpected", { status: 500 }));
    },
  });

  assert.ok(measurement.requests.total > 0);
  assert.strictEqual(measurement.requests.failed, 0);
  assert.strictEqual(measurement.requests.successRate, 1);
  assert.ok(statsCalls >= 3);
});

test("fanoutRunner - uses configured sink base for recipients", async () => {
  const target = new URL("http://target.test/");
  const sinkBase = `http://127.0.0.1:${await reservePort()}/`;
  let triggerCalls = 0;
  let recipientInboxes: string[] = [];
  const scenario = normalizeSuite({
    version: 1,
    target: target.href,
    scenarios: [{
      name: "fanout",
      type: "fanout",
      sender: "alice",
      followers: 5,
      sinkBase,
      load: { concurrency: 1 },
      duration: "40ms",
      queueDrainTimeout: "1s",
    }],
  }).scenarios[0];

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
        return Promise.resolve(json(statsSnapshot({
          enqueued: triggerCalls * 6,
          completed: triggerCalls * 6,
          failed: 0,
        })));
      }
      if (url.pathname === "/.well-known/fedify/bench/trigger") {
        triggerCalls++;
        const body = JSON.parse(String(init?.body));
        recipientInboxes = body.recipients.map((
          recipient: Record<string, unknown>,
        ) => recipient.inbox);
        return Promise.resolve(json({ version: 1 }, 202));
      }
      return Promise.resolve(new Response("unexpected", { status: 500 }));
    },
  });

  assert.ok(measurement.requests.total > 0);
  assert.deepStrictEqual(
    recipientInboxes,
    Array.from({ length: 5 }, (_, i) => new URL(`/inbox/${i}`, sinkBase).href),
  );
});

test("fanoutRunner - gates sink recipients before triggering", async () => {
  const target = new URL("http://target.test/");
  const scenario = normalizeSuite({
    version: 1,
    target: target.href,
    scenarios: [{
      name: "fanout",
      type: "fanout",
      sender: "alice",
      followers: 5,
      sinkBase: `http://127.0.0.1:${await reservePort()}/`,
      load: { concurrency: 1 },
      duration: "30ms",
      queueDrainTimeout: "1s",
    }],
  }).scenarios[0];
  let gateCalls = 0;
  let triggerCalls = 0;

  await assert.rejects(
    async () =>
      fanoutRunner.run({
        scenario,
        target,
        documentLoader: await getDocumentLoader({ allowPrivateAddress: true }),
        contextLoader: await getContextLoader({ allowPrivateAddress: true }),
        allowPrivateAddress: true,
        fleet: null,
        fetch: (input) => {
          const url = new URL(input instanceof Request ? input.url : input);
          if (url.pathname === "/.well-known/fedify/bench/trigger") {
            triggerCalls++;
          }
          return Promise.resolve(new Response("unexpected", { status: 500 }));
        },
        assertActorlessDestinationAllowed: (url) => {
          gateCalls++;
          throw new Error(`refused ${url.href}`);
        },
      }),
    /refused http:\/\/127\.0\.0\.1:/,
  );

  assert.strictEqual(gateCalls, 1);
  assert.strictEqual(triggerCalls, 0);
});

test("spawnSinkServer - ignores invalid sink latency", async () => {
  const sink = await spawnSinkServer({
    followers: 1,
    rawBehavior: { latency: "not-a-duration", status: 202 },
  });
  try {
    const response = await fetch(String(sink.recipients[0].inbox), {
      method: "POST",
      body: "{}",
    });
    assert.strictEqual(response.status, 202);
  } finally {
    await sink.close();
  }
});

test("spawnSinkServer - ignores out-of-range sink status", async () => {
  const sink = await spawnSinkServer({
    followers: 1,
    rawBehavior: { status: 999 },
  });
  try {
    const response = await fetch(String(sink.recipients[0].inbox), {
      method: "POST",
      body: "{}",
    });
    assert.strictEqual(response.status, 202);
  } finally {
    await sink.close();
  }
});

test("fanoutRunner - omits queue drain metrics without drain samples", async () => {
  const target = new URL("http://target.test/");
  const scenario = normalizeSuite({
    version: 1,
    target: target.href,
    scenarios: [{
      name: "fanout",
      type: "fanout",
      sender: "alice",
      followers: 5,
      load: { concurrency: 1 },
      duration: "30ms",
      queueDrainTimeout: "1s",
    }],
  }).scenarios[0];

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
        return Promise.resolve(json(statsSnapshot({
          enqueued: 0,
          completed: 0,
          failed: 0,
        })));
      }
      if (url.pathname === "/.well-known/fedify/bench/trigger") {
        return Promise.resolve(json({ error: "unavailable" }, 503));
      }
      return Promise.resolve(new Response("unexpected", { status: 500 }));
    },
  });

  assert.ok(measurement.requests.total > 0);
  assert.strictEqual(measurement.requests.successRate, 0);
  assert.strictEqual(measurement.server?.queue?.drainMs, undefined);
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function reservePort(): Promise<number> {
  const server = serve({
    port: 0,
    hostname: "127.0.0.1",
    silent: true,
    fetch: () => new Response("reserved"),
  });
  await server.ready();
  const port = Number(new URL(server.url!).port);
  await server.close(true);
  return port;
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
