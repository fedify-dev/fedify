import assert from "node:assert/strict";
import test from "node:test";
import { serve } from "srvx";
import { getContextLoader, getDocumentLoader } from "../../docloader.ts";
import { normalizeSuite } from "../scenario/normalize.ts";
import type { Suite } from "../scenario/types.ts";
import { webfingerRunner } from "./webfinger.ts";

test("webfingerRunner - drives lookups and aggregates results", async () => {
  let lookups = 0;
  const server = serve({
    port: 0,
    hostname: "127.0.0.1",
    silent: true,
    fetch(request: Request): Response {
      const url = new URL(request.url);
      if (url.pathname === "/.well-known/webfinger") {
        lookups++;
        return new Response(
          JSON.stringify({
            subject: url.searchParams.get("resource"),
            links: [],
          }),
          { headers: { "content-type": "application/jrd+json" } },
        );
      }
      return new Response("Not found", { status: 404 });
    },
  });
  await server.ready();
  const target = new URL(server.url!);
  try {
    const suite: Suite = {
      version: 1,
      target: target.href,
      scenarios: [{
        name: "wf",
        type: "webfinger",
        recipient: [`acct:alice@${target.host}`, `acct:bob@${target.host}`],
        load: { concurrency: 4 },
        duration: "50ms",
      }],
    };
    const scenario = normalizeSuite(suite).scenarios[0];
    const measurement = await webfingerRunner.run({
      scenario,
      target,
      documentLoader: await getDocumentLoader({ allowPrivateAddress: true }),
      contextLoader: await getContextLoader({ allowPrivateAddress: true }),
      allowPrivateAddress: true,
      fleet: null,
    });
    assert.ok(measurement.requests.total > 0);
    assert.strictEqual(measurement.requests.successRate, 1);
    assert.ok(lookups > 0);
    assert.ok(measurement.client.latencyMs.p95 >= 0);
    assert.strictEqual(measurement.server, null);
  } finally {
    await server.close(true);
  }
});
