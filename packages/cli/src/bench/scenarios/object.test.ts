import assert from "node:assert/strict";
import test from "node:test";
import { serve } from "srvx";
import { getContextLoader, getDocumentLoader } from "../../docloader.ts";
import { normalizeSuite } from "../scenario/normalize.ts";
import type { Suite } from "../scenario/types.ts";
import { objectRunner } from "./object.ts";

async function spawnObjectTarget() {
  let objectGets = 0;
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
          id: new URL("/users/alice", url).href,
          outbox: new URL("/users/alice/outbox", url).href,
        });
      }
      if (url.pathname === "/users/alice/outbox") {
        return json({
          "@context": "https://www.w3.org/ns/activitystreams",
          type: "OrderedCollection",
          id: url.href,
          orderedItems: [
            {
              type: "Note",
              id: new URL("/objects/1", url).href,
              content: "one",
            },
            {
              type: "Article",
              id: new URL("/objects/2", url).href,
              content: "two",
            },
          ],
        });
      }
      if (url.pathname.startsWith("/objects/")) {
        objectGets++;
        return json({
          "@context": "https://www.w3.org/ns/activitystreams",
          type: url.pathname.endsWith("/1") ? "Note" : "Article",
          id: url.href,
          content: "object",
        });
      }
      return new Response("Not found", { status: 404 });
    },
  });
  await server.ready();
  return {
    url: new URL(server.url!),
    objectGets: () => objectGets,
    close: () => server.close(true),
  };
}

test("objectRunner - fetches explicit object URLs", async () => {
  const target = await spawnObjectTarget();
  try {
    const suite: Suite = {
      version: 1,
      target: target.url.href,
      scenarios: [{
        name: "object",
        type: "object",
        source: [
          new URL("/objects/1", target.url).href,
          new URL("/objects/2", target.url).href,
        ],
        load: { concurrency: 2 },
        duration: "80ms",
      }],
    };
    const scenario = normalizeSuite(suite).scenarios[0];
    const measurement = await objectRunner.run({
      scenario,
      target: target.url,
      documentLoader: await getDocumentLoader({ allowPrivateAddress: true }),
      contextLoader: await getContextLoader({ allowPrivateAddress: true }),
      allowPrivateAddress: true,
      fleet: null,
    });

    assert.ok(measurement.requests.total > 0);
    assert.strictEqual(measurement.requests.successRate, 1);
    assert.ok(target.objectGets() > 0);
  } finally {
    await target.close();
  }
});

test("objectRunner - crawls actor collections before fetching objects", async () => {
  const target = await spawnObjectTarget();
  try {
    const suite: Suite = {
      version: 1,
      target: target.url.href,
      scenarios: [{
        name: "object-crawl",
        type: "object",
        source: {
          seed: new URL("/users/alice", target.url).href,
          collection: "outbox",
          limit: 1,
          type: "Note",
        },
        load: { concurrency: 1 },
        duration: "80ms",
      }],
    };
    const scenario = normalizeSuite(suite).scenarios[0];
    const measurement = await objectRunner.run({
      scenario,
      target: target.url,
      documentLoader: await getDocumentLoader({ allowPrivateAddress: true }),
      contextLoader: await getContextLoader({ allowPrivateAddress: true }),
      allowPrivateAddress: true,
      fleet: null,
    });

    assert.ok(measurement.requests.total > 0);
    assert.strictEqual(measurement.requests.successRate, 1);
    assert.ok(target.objectGets() > 0);
  } finally {
    await target.close();
  }
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/activity+json" },
  });
}
