import {
  createFederation,
  generateCryptoKeyPair,
  MemoryKvStore,
} from "@fedify/fedify";
import { Create, Endpoints, Person } from "@fedify/vocab";
import assert from "node:assert/strict";
import test from "node:test";
import { serve } from "srvx";
import { getContextLoader, getDocumentLoader } from "../../docloader.ts";
import { buildFleet } from "../actor/fleet.ts";
import { normalizeSuite } from "../scenario/normalize.ts";
import type { Suite } from "../scenario/types.ts";
import { spawnSyntheticServer } from "../server/synthetic.ts";
import { inboxRunner } from "./inbox.ts";

// Stands up a real Fedify federation in benchmark mode that serves WebFinger,
// the recipient actor, and an inbox that verifies incoming signatures.
async function spawnBenchmarkTarget() {
  // No message queue, so incoming activities are processed inline (which also
  // keeps the test process from being held open by a queue worker timer).
  const federation = createFederation<void>({
    kv: new MemoryKvStore(),
    benchmarkMode: true,
  });
  let keyPairs: CryptoKeyPair[] | undefined;
  federation
    .setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
      if (identifier !== "alice") return null;
      const pairs = await ctx.getActorKeyPairs(identifier);
      return new Person({
        id: ctx.getActorUri(identifier),
        preferredUsername: identifier,
        inbox: ctx.getInboxUri(identifier),
        endpoints: new Endpoints({ sharedInbox: ctx.getInboxUri() }),
        publicKey: pairs[0]?.cryptographicKey,
        assertionMethods: pairs.map((p) => p.multikey),
      });
    })
    .mapHandle((_ctx, username) => (username === "alice" ? "alice" : null))
    .setKeyPairsDispatcher(async (_ctx, identifier) => {
      if (identifier !== "alice") return [];
      keyPairs ??= [
        await generateCryptoKeyPair("RSASSA-PKCS1-v1_5"),
        await generateCryptoKeyPair("Ed25519"),
      ];
      return keyPairs;
    });

  let received = 0;
  federation
    .setInboxListeners("/users/{identifier}/inbox", "/inbox")
    .on(Create, () => {
      received++;
    });

  const server = serve({
    port: 0,
    hostname: "127.0.0.1",
    silent: true,
    fetch: (request: Request) =>
      federation.fetch(request, { contextData: undefined }),
  });
  await server.ready();
  return {
    url: new URL(server.url!),
    receivedCount: () => received,
    close: () => server.close(true),
  };
}

test("inboxRunner - signed deliveries verify against a benchmarkMode target", async () => {
  const target = await spawnBenchmarkTarget();
  let fleet: Awaited<ReturnType<typeof spawnSyntheticServer>> | undefined;
  try {
    fleet = await spawnSyntheticServer(
      await buildFleet([{
        count: 1,
        signatureStandards: ["draft-cavage-http-signatures-12"],
      }]),
    );
    const suite: Suite = {
      version: 1,
      target: target.url.href,
      scenarios: [{
        name: "inbox-shared",
        type: "inbox",
        // An actor URI is used (not an acct: handle) because WebFinger is
        // https-only and this loopback target is served over http.
        recipient: new URL("/users/alice", target.url).href,
        inbox: "shared",
        load: { concurrency: 2 },
        duration: "300ms",
      }],
    };
    const scenario = normalizeSuite(suite).scenarios[0];
    const measurement = await inboxRunner.run({
      scenario,
      target: target.url,
      documentLoader: await getDocumentLoader({ allowPrivateAddress: true }),
      contextLoader: await getContextLoader({ allowPrivateAddress: true }),
      allowPrivateAddress: true,
      fleet,
    });

    // Deliveries were accepted, i.e. the target verified the HTTP signatures.
    assert.ok(measurement.requests.total > 0, "expected some deliveries");
    assert.strictEqual(
      measurement.requests.successRate,
      1,
      `expected all deliveries to succeed; errors: ${
        JSON.stringify(measurement.errors)
      }`,
    );
    // Server-side metrics are read from the cooperative stats endpoint.
    assert.ok(
      measurement.server?.signatureVerificationMs != null,
      "expected server-side signature verification metrics",
    );
    // The inbox listener actually ran (activities were processed inline).
    assert.ok(target.receivedCount() > 0, "expected the inbox listener to run");
  } finally {
    try {
      await fleet?.close();
    } finally {
      await target.close();
    }
  }
});
