import assert from "node:assert/strict";
import test from "node:test";
import { serve } from "srvx";
import { buildFleet } from "../actor/fleet.ts";
import { getContextLoader, getDocumentLoader } from "../../docloader.ts";
import type { Clock } from "../load/clock.ts";
import { normalizeSuite } from "../scenario/normalize.ts";
import type { Suite } from "../scenario/types.ts";
import { spawnSyntheticServer } from "../server/synthetic.ts";
import { failureRunner } from "./failure.ts";

for (
  const [fault, outcome] of [
    ["remote-404", "permanent"],
    ["remote-410", "permanent"],
    ["slow-inbox", "completed"],
    ["network-error", "failed"],
  ] as const
) {
  test(`failureRunner - drives ${fault} through the target`, async () => {
    const target = new URL("http://target.test/");
    const suite: Suite = {
      version: 1,
      target: target.href,
      scenarios: [{
        name: "failure",
        type: "failure",
        fault,
        sender: "alice",
        load: { concurrency: 1 },
        duration: "25ms",
        queueDrainTimeout: "1s",
      }],
    };
    const scenario = normalizeSuite(suite).scenarios[0];
    let triggerCalls = 0;
    let triggerRecipientCount = 0;
    const measurement = await failureRunner.run({
      scenario,
      target,
      documentLoader: await getDocumentLoader({ allowPrivateAddress: true }),
      contextLoader: await getContextLoader({ allowPrivateAddress: true }),
      allowPrivateAddress: true,
      fleet: null,
      fetch: (input, init) => {
        const url = new URL(input instanceof Request ? input.url : input);
        if (url.pathname === "/.well-known/fedify/bench/stats") {
          return Promise.resolve(statsJson(statsSnapshot({
            enqueued: triggerCalls,
            completed: outcome === "failed" ? 0 : triggerCalls,
            failed: outcome === "failed" ? triggerCalls : 0,
            permanentFailures: outcome === "permanent" ? triggerCalls : 0,
          })));
        }
        if (url.pathname === "/.well-known/fedify/bench/trigger") {
          triggerCalls++;
          const body = JSON.parse(String(init?.body));
          triggerRecipientCount = body.recipients.length;
          assert.deepStrictEqual(body.sender, { identifier: "alice" });
          return Promise.resolve(statsJson({ version: 1 }, 202));
        }
        return Promise.resolve(new Response("unexpected", { status: 500 }));
      },
      assertDestinationAllowed: () => {},
    });

    assert.ok(measurement.requests.total > 0);
    assert.strictEqual(measurement.requests.failed, 0);
    assert.strictEqual(measurement.requests.successRate, 1);
    assert.ok(triggerCalls > 0);
    assert.strictEqual(triggerRecipientCount, 1);
  });
}

test("failureRunner - uses configured sink base for remote faults", async () => {
  const target = new URL("http://target.test/");
  const sinkBase = `http://127.0.0.1:${await reservePort()}/`;
  const scenario = normalizeSuite({
    version: 1,
    target: target.href,
    scenarios: [{
      name: "failure",
      type: "failure",
      fault: "remote-404",
      sender: "alice",
      sinkBase,
      load: { concurrency: 1 },
      duration: "25ms",
      queueDrainTimeout: "1s",
    }],
  }).scenarios[0];
  let triggerCalls = 0;
  let recipientInbox = "";

  const measurement = await failureRunner.run({
    scenario,
    target,
    documentLoader: await getDocumentLoader({ allowPrivateAddress: true }),
    contextLoader: await getContextLoader({ allowPrivateAddress: true }),
    allowPrivateAddress: true,
    fleet: null,
    fetch: (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.pathname === "/.well-known/fedify/bench/stats") {
        return Promise.resolve(statsJson(statsSnapshot({
          enqueued: triggerCalls,
          completed: triggerCalls,
          failed: 0,
          permanentFailures: triggerCalls,
        })));
      }
      if (url.pathname === "/.well-known/fedify/bench/trigger") {
        triggerCalls++;
        const body = JSON.parse(String(init?.body));
        recipientInbox = body.recipients[0].inbox;
        return Promise.resolve(statsJson({ version: 1 }, 202));
      }
      return Promise.resolve(new Response("unexpected", { status: 500 }));
    },
    assertDestinationAllowed: () => {},
  });

  assert.ok(measurement.requests.total > 0);
  assert.strictEqual(recipientInbox, new URL("/inbox/0", sinkBase).href);
});

test("failureRunner - gates remote fault sinks before triggering", async () => {
  const target = new URL("http://target.test/");
  const sinkBase = `http://127.0.0.1:${await reservePort()}/`;
  const scenario = normalizeSuite({
    version: 1,
    target: target.href,
    scenarios: [{
      name: "failure",
      type: "failure",
      fault: "remote-404",
      sender: "alice",
      sinkBase,
      load: { concurrency: 1 },
      duration: "25ms",
      queueDrainTimeout: "1s",
    }],
  }).scenarios[0];
  let gateCalls = 0;
  let triggerCalls = 0;

  await assert.rejects(
    async () =>
      failureRunner.run({
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
        assertDestinationAllowed: () => {},
      }),
    /refused http:\/\/127\.0\.0\.1:/,
  );

  assert.strictEqual(gateCalls, 1);
  assert.strictEqual(triggerCalls, 0);
});

test("failureRunner - shares sink base across remote fault mix", async () => {
  const target = new URL("http://target.test/");
  const sinkBase = `http://127.0.0.1:${await reservePort()}/`;
  const scenario = normalizeSuite({
    version: 1,
    target: target.href,
    scenarios: [{
      name: "failure",
      type: "failure",
      fault: ["remote-404", "remote-410"],
      sender: "alice",
      sinkBase,
      load: { concurrency: 1 },
      duration: "25ms",
      queueDrainTimeout: "1s",
    }],
  }).scenarios[0];
  let triggerCalls = 0;
  const recipientInboxes: string[] = [];

  const measurement = await failureRunner.run({
    scenario,
    target,
    documentLoader: await getDocumentLoader({ allowPrivateAddress: true }),
    contextLoader: await getContextLoader({ allowPrivateAddress: true }),
    allowPrivateAddress: true,
    fleet: null,
    fetch: (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.pathname === "/.well-known/fedify/bench/stats") {
        return Promise.resolve(statsJson(statsSnapshot({
          enqueued: triggerCalls,
          completed: triggerCalls,
          failed: 0,
          permanentFailures: triggerCalls,
        })));
      }
      if (url.pathname === "/.well-known/fedify/bench/trigger") {
        triggerCalls++;
        const body = JSON.parse(String(init?.body));
        recipientInboxes.push(body.recipients[0].inbox);
        return Promise.resolve(statsJson({ version: 1 }, 202));
      }
      return Promise.resolve(new Response("unexpected", { status: 500 }));
    },
    assertDestinationAllowed: () => {},
  });

  assert.ok(measurement.requests.total > 1);
  assert.strictEqual(measurement.requests.failed, 0);
  assert.ok(recipientInboxes.includes(new URL("/inbox/0", sinkBase).href));
  assert.ok(recipientInboxes.includes(new URL("/inbox/1", sinkBase).href));
});

test("failureRunner.validate - rejects sinkBase for mixed network faults", () => {
  const scenario = normalizeSuite({
    version: 1,
    target: "http://target.test/",
    scenarios: [{
      name: "failure",
      type: "failure",
      fault: ["network-error", "remote-404"],
      sender: "alice",
      sinkBase: "http://127.0.0.1:29999/",
    }],
  }).scenarios[0];

  assert.throws(
    () => failureRunner.validate?.(scenario),
    /cannot combine network-error with other remote failure faults/,
  );
});

test("failureRunner - detects network-error retries", async () => {
  const target = new URL("http://target.test/");
  const scenario = normalizeSuite({
    version: 1,
    target: target.href,
    scenarios: [{
      name: "failure",
      type: "failure",
      fault: "network-error",
      sender: "alice",
      load: { concurrency: 1 },
      duration: "25ms",
      queueDrainTimeout: "50ms",
    }],
  }).scenarios[0];
  let triggerCalls = 0;
  const measurement = await failureRunner.run({
    scenario,
    target,
    documentLoader: await getDocumentLoader({ allowPrivateAddress: true }),
    contextLoader: await getContextLoader({ allowPrivateAddress: true }),
    allowPrivateAddress: true,
    fleet: null,
    fetch: (input) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.pathname === "/.well-known/fedify/bench/stats") {
        return Promise.resolve(statsJson(statsSnapshot({
          enqueued: triggerCalls * 2,
          completed: triggerCalls,
          failed: 0,
          permanentFailures: 0,
        })));
      }
      if (url.pathname === "/.well-known/fedify/bench/trigger") {
        triggerCalls++;
        return Promise.resolve(statsJson({ version: 1 }, 202));
      }
      return Promise.resolve(new Response("unexpected", { status: 500 }));
    },
    assertDestinationAllowed: () => {},
  });

  assert.ok(measurement.requests.total > 0);
  assert.strictEqual(measurement.requests.failed, 0);
  assert.strictEqual(measurement.requests.successRate, 1);
  assert.ok(triggerCalls > 0);
});

test("failureRunner - tolerates transient remote fault stats failures", async () => {
  const target = new URL("http://target.test/");
  const scenario = normalizeSuite({
    version: 1,
    target: target.href,
    scenarios: [{
      name: "failure",
      type: "failure",
      fault: "remote-404",
      sender: "alice",
      load: { concurrency: 1 },
      duration: "25ms",
      queueDrainTimeout: "1s",
    }],
  }).scenarios[0];
  let statsCalls = 0;
  let triggerCalls = 0;
  const measurement = await failureRunner.run({
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
        return Promise.resolve(statsJson(statsSnapshot({
          enqueued: triggerCalls,
          completed: triggerCalls,
          failed: 0,
          permanentFailures: statsCalls > 1 ? triggerCalls : 0,
        })));
      }
      if (url.pathname === "/.well-known/fedify/bench/trigger") {
        triggerCalls++;
        return Promise.resolve(statsJson({ version: 1 }, 202));
      }
      return Promise.resolve(new Response("unexpected", { status: 500 }));
    },
    assertDestinationAllowed: () => {},
  });

  assert.ok(measurement.requests.total > 0);
  assert.strictEqual(measurement.requests.failed, 0);
  assert.strictEqual(measurement.requests.successRate, 1);
  assert.ok(statsCalls >= 3);
});

test("failureRunner - uses abortable remote fault poll sleeps", async () => {
  const target = new URL("http://target.test/");
  const signal = new AbortController().signal;
  const sleepSignals: (AbortSignal | undefined)[] = [];
  let now = 0;
  const clock: Clock = {
    now: () => now,
    sleepUntil: (timeMs, signal) => {
      now = Math.max(now, timeMs);
      sleepSignals.push(signal);
      return Promise.resolve();
    },
  };
  const scenario = normalizeSuite({
    version: 1,
    target: target.href,
    scenarios: [{
      name: "failure",
      type: "failure",
      fault: "remote-404",
      sender: "alice",
      load: { rate: "1000/s" },
      duration: "1ms",
      queueDrainTimeout: "1ms",
    }],
  }).scenarios[0];
  let triggerCalls = 0;

  await failureRunner.run({
    scenario,
    target,
    documentLoader: await getDocumentLoader({ allowPrivateAddress: true }),
    contextLoader: await getContextLoader({ allowPrivateAddress: true }),
    allowPrivateAddress: true,
    fleet: null,
    fetch: (input) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.pathname === "/.well-known/fedify/bench/stats") {
        return Promise.resolve(statsJson(statsSnapshot({
          enqueued: triggerCalls,
          completed: triggerCalls,
          failed: 0,
          permanentFailures: 0,
        })));
      }
      if (url.pathname === "/.well-known/fedify/bench/trigger") {
        triggerCalls++;
        return Promise.resolve(statsJson({ version: 1 }, 202));
      }
      return Promise.resolve(new Response("unexpected", { status: 500 }));
    },
    assertDestinationAllowed: () => {},
    clock,
    signal,
  });

  assert.deepStrictEqual(sleepSignals, [signal, signal]);
});

test("failureRunner.validate - requires sender for remote faults", () => {
  const scenario = normalizeSuite({
    version: 1,
    target: "http://target.test/",
    scenarios: [{
      name: "failure",
      type: "failure",
      fault: "remote-404",
    }],
  }).scenarios[0];

  assert.throws(() => failureRunner.validate?.(scenario), /sender/);
});

test("failureRunner.validate - rejects unsupported faults", () => {
  const scenario = normalizeSuite({
    version: 1,
    target: "http://target.test/",
    scenarios: [{
      name: "failure",
      type: "failure",
      fault: "unknown-fault",
    }],
  }).scenarios[0];

  assert.throws(() => failureRunner.validate?.(scenario), /unsupported/);
});

test("failureRunner.validate - rejects invalid explicit inbound inboxes", () => {
  const scenario = normalizeSuite({
    version: 1,
    target: "http://target.test/",
    scenarios: [{
      name: "failure",
      type: "failure",
      fault: "invalid-signature",
      recipient: "http://target.test/users/alice",
      inbox: "shraed",
    }],
  }).scenarios[0];

  assert.throws(
    () => failureRunner.validate?.(scenario),
    /inbox must be "shared", "personal", or an http\(s\) URL/,
  );
});

test("failureRunner - discovers inbound failure inboxes once", async () => {
  let actorGets = 0;
  const server = serve({
    port: 0,
    hostname: "127.0.0.1",
    silent: true,
    fetch(request: Request): Response {
      const url = new URL(request.url);
      if (url.pathname === "/users/alice") {
        actorGets++;
        return json({
          "@context": "https://www.w3.org/ns/activitystreams",
          type: "Person",
          id: url.href,
          inbox: new URL("/users/alice/inbox", url).href,
          endpoints: {
            sharedInbox: new URL("/inbox", url).href,
          },
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  await server.ready();
  let fleet: Awaited<ReturnType<typeof spawnSyntheticServer>> | undefined;
  try {
    const target = new URL(server.url!);
    fleet = await spawnSyntheticServer(
      await buildFleet([{
        count: 1,
        signatureStandards: ["draft-cavage-http-signatures-12"],
      }]),
    );
    const scenario = normalizeSuite({
      version: 1,
      target: target.href,
      scenarios: [{
        name: "bad-signature",
        type: "failure",
        fault: "invalid-signature",
        recipient: new URL("/users/alice", target).href,
        load: { rate: 100 },
        duration: "30ms",
      }],
    }).scenarios[0];
    let now = 0;
    const clock: Clock = {
      now: () => now,
      sleepUntil: (timeMs) => {
        now = Math.max(now, timeMs);
        return Promise.resolve();
      },
    };
    let malformedSignatureRequests = 0;
    let signedDateRequests = 0;
    const measurement = await failureRunner.run({
      scenario,
      target,
      documentLoader: await getDocumentLoader({ allowPrivateAddress: true }),
      contextLoader: await getContextLoader({ allowPrivateAddress: true }),
      allowPrivateAddress: true,
      fleet,
      fetch: async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        const url = new URL(request.url);
        if (url.pathname === "/inbox") {
          await request.clone().json();
          const signature = request.headers.get("signature");
          const authorization = request.headers.get("authorization");
          if (
            signature?.endsWith("0") === true ||
            authorization?.endsWith("0") === true
          ) {
            malformedSignatureRequests++;
          }
          if (!Number.isNaN(Date.parse(request.headers.get("date") ?? ""))) {
            signedDateRequests++;
          }
          return new Response("bad signature", {
            status: 401,
          });
        }
        return new Response("not found", { status: 404 });
      },
      assertDestinationAllowed: () => {},
      clock,
    });

    assert.strictEqual(measurement.requests.total, 3);
    assert.strictEqual(measurement.requests.successRate, 1);
    assert.strictEqual(malformedSignatureRequests, 0);
    assert.strictEqual(signedDateRequests, 3);
    assert.strictEqual(actorGets, 1);
  } finally {
    try {
      await fleet?.close();
    } finally {
      await server.close(true);
    }
  }
});

test("failureRunner - treats inbound 5xx as target failures", async () => {
  const server = serve({
    port: 0,
    hostname: "127.0.0.1",
    silent: true,
    fetch(request: Request): Response {
      const url = new URL(request.url);
      if (url.pathname === "/users/alice") {
        return json({
          "@context": "https://www.w3.org/ns/activitystreams",
          type: "Person",
          id: url.href,
          inbox: new URL("/inbox", url).href,
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  await server.ready();
  let fleet: Awaited<ReturnType<typeof spawnSyntheticServer>> | undefined;
  try {
    const target = new URL(server.url!);
    fleet = await spawnSyntheticServer(
      await buildFleet([{
        count: 1,
        signatureStandards: ["draft-cavage-http-signatures-12"],
      }]),
    );
    const scenario = normalizeSuite({
      version: 1,
      target: target.href,
      scenarios: [{
        name: "bad-signature",
        type: "failure",
        fault: "invalid-signature",
        recipient: new URL("/users/alice", target).href,
        load: { concurrency: 1 },
        duration: "50ms",
      }],
    }).scenarios[0];
    const measurement = await failureRunner.run({
      scenario,
      target,
      documentLoader: await getDocumentLoader({ allowPrivateAddress: true }),
      contextLoader: await getContextLoader({ allowPrivateAddress: true }),
      allowPrivateAddress: true,
      fleet,
      fetch: (input) => {
        const url = new URL(input instanceof Request ? input.url : input);
        if (url.pathname === "/inbox") {
          return Promise.resolve(
            new Response("internal error", { status: 500 }),
          );
        }
        return Promise.resolve(new Response("not found", { status: 404 }));
      },
      assertDestinationAllowed: () => {},
    });

    assert.ok(measurement.requests.total > 0);
    assert.strictEqual(measurement.requests.successRate, 0);
    assert.ok(measurement.errors.some((e) => e.status === 500));
  } finally {
    try {
      await fleet?.close();
    } finally {
      await server.close(true);
    }
  }
});

test("failureRunner - treats unexpected inbound 4xx as target failures", async () => {
  const server = serve({
    port: 0,
    hostname: "127.0.0.1",
    silent: true,
    fetch(request: Request): Response {
      const url = new URL(request.url);
      if (url.pathname === "/users/alice") {
        return json({
          "@context": "https://www.w3.org/ns/activitystreams",
          type: "Person",
          id: url.href,
          inbox: new URL("/missing-inbox", url).href,
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  await server.ready();
  let fleet: Awaited<ReturnType<typeof spawnSyntheticServer>> | undefined;
  try {
    const target = new URL(server.url!);
    fleet = await spawnSyntheticServer(
      await buildFleet([{
        count: 1,
        signatureStandards: ["draft-cavage-http-signatures-12"],
      }]),
    );
    const scenario = normalizeSuite({
      version: 1,
      target: target.href,
      scenarios: [{
        name: "bad-signature",
        type: "failure",
        fault: "invalid-signature",
        recipient: new URL("/users/alice", target).href,
        load: { concurrency: 1 },
        duration: "50ms",
      }],
    }).scenarios[0];
    const measurement = await failureRunner.run({
      scenario,
      target,
      documentLoader: await getDocumentLoader({ allowPrivateAddress: true }),
      contextLoader: await getContextLoader({ allowPrivateAddress: true }),
      allowPrivateAddress: true,
      fleet,
      fetch: (input) => {
        const url = new URL(input instanceof Request ? input.url : input);
        if (url.pathname === "/missing-inbox") {
          return Promise.resolve(
            new Response("not found", { status: 404 }),
          );
        }
        return Promise.resolve(new Response("not found", { status: 404 }));
      },
      assertDestinationAllowed: () => {},
    });

    assert.ok(measurement.requests.total > 0);
    assert.strictEqual(measurement.requests.successRate, 0);
    assert.ok(measurement.errors.some((e) => e.status === 404));
  } finally {
    try {
      await fleet?.close();
    } finally {
      await server.close(true);
    }
  }
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/activity+json" },
  });
}

function statsJson(body: unknown, status = 200): Response {
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
  readonly permanentFailures: number;
}): Record<string, unknown> {
  return {
    version: 1,
    source: "server",
    scopeMetrics: [{
      metrics: [
        sum("fedify.queue.task.enqueued", counts.enqueued),
        sum("fedify.queue.task.completed", counts.completed),
        sum("fedify.queue.task.failed", counts.failed),
        sum(
          "activitypub.delivery.permanent_failure",
          counts.permanentFailures,
        ),
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
