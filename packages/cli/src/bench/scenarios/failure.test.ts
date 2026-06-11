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
            new Response("bad signature", {
              status: 401,
            }),
          );
        }
        return Promise.resolve(new Response("not found", { status: 404 }));
      },
      assertDestinationAllowed: () => {},
      clock,
    });

    assert.strictEqual(measurement.requests.total, 3);
    assert.strictEqual(measurement.requests.successRate, 1);
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
