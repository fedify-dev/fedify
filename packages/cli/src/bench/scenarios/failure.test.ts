import assert from "node:assert/strict";
import test from "node:test";
import { serve } from "srvx";
import { buildFleet } from "../actor/fleet.ts";
import { getContextLoader, getDocumentLoader } from "../../docloader.ts";
import { normalizeSuite } from "../scenario/normalize.ts";
import type { Suite } from "../scenario/types.ts";
import { spawnSyntheticServer } from "../server/synthetic.ts";
import { failureRunner } from "./failure.ts";

test("failureRunner - counts expected remote failure as success", async () => {
  const suite: Suite = {
    version: 1,
    target: "http://target.test/",
    scenarios: [{
      name: "failure",
      type: "failure",
      fault: "remote-404",
      load: { concurrency: 1 },
      duration: "25ms",
    }],
  };
  const scenario = normalizeSuite(suite).scenarios[0];
  const measurement = await failureRunner.run({
    scenario,
    target: new URL("http://target.test/"),
    documentLoader: await getDocumentLoader({ allowPrivateAddress: true }),
    contextLoader: await getContextLoader({ allowPrivateAddress: true }),
    allowPrivateAddress: true,
    fleet: null,
  });

  assert.ok(measurement.requests.total > 0);
  assert.strictEqual(measurement.requests.failed, 0);
  assert.strictEqual(measurement.requests.successRate, 1);
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
        load: { concurrency: 1 },
        duration: "80ms",
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
            new Response("bad signature", {
              status: 401,
            }),
          );
        }
        return Promise.resolve(new Response("not found", { status: 404 }));
      },
      assertDestinationAllowed: () => {},
    });

    assert.ok(measurement.requests.total > 1);
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
