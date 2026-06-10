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
import { actorRunner } from "./actor.ts";

async function spawnActorTarget() {
  const federation = createFederation<void>({
    kv: new MemoryKvStore(),
    benchmarkMode: true,
  });
  const keyPairs = Promise.all([
    generateCryptoKeyPair("RSASSA-PKCS1-v1_5"),
    generateCryptoKeyPair("Ed25519"),
  ]);
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
    .setKeyPairsDispatcher(async () => await keyPairs);
  federation.setInboxListeners("/users/{identifier}/inbox", "/inbox").on(
    Create,
    () => {},
  );

  let actorGets = 0;
  const server = serve({
    port: 0,
    hostname: "127.0.0.1",
    silent: true,
    fetch(request: Request) {
      if (new URL(request.url).pathname === "/users/alice") actorGets++;
      return federation.fetch(request, { contextData: undefined });
    },
  });
  await server.ready();
  return {
    url: new URL(server.url!),
    actorGets: () => actorGets,
    close: () => server.close(true),
  };
}

test("actorRunner - fetches actor documents", async () => {
  const target = await spawnActorTarget();
  try {
    const suite: Suite = {
      version: 1,
      target: target.url.href,
      scenarios: [{
        name: "actor",
        type: "actor",
        recipient: new URL("/users/alice", target.url).href,
        load: { concurrency: 2 },
        duration: "80ms",
      }],
    };
    const scenario = normalizeSuite(suite).scenarios[0];
    const measurement = await actorRunner.run({
      scenario,
      target: target.url,
      documentLoader: await getDocumentLoader({ allowPrivateAddress: true }),
      contextLoader: await getContextLoader({ allowPrivateAddress: true }),
      allowPrivateAddress: true,
      fleet: null,
    });

    assert.ok(measurement.requests.total > 0);
    assert.strictEqual(measurement.requests.successRate, 1);
    assert.ok(target.actorGets() > 0);
  } finally {
    await target.close();
  }
});

test("actorRunner - signs authenticated actor fetches", async () => {
  const target = await spawnActorTarget();
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
        name: "actor-auth",
        type: "actor",
        recipient: new URL("/users/alice", target.url).href,
        authenticated: true,
        load: { concurrency: 1 },
        duration: "80ms",
      }],
    };
    const scenario = normalizeSuite(suite).scenarios[0];
    const measurement = await actorRunner.run({
      scenario,
      target: target.url,
      documentLoader: await getDocumentLoader({ allowPrivateAddress: true }),
      contextLoader: await getContextLoader({ allowPrivateAddress: true }),
      allowPrivateAddress: true,
      fleet,
    });

    assert.ok(measurement.requests.total > 0);
    assert.strictEqual(measurement.requests.successRate, 1);
  } finally {
    try {
      await fleet?.close();
    } finally {
      await target.close();
    }
  }
});

test("actorRunner.validate - rejects non-http actor recipient URLs", () => {
  for (const recipient of ["ftp://target.test/users/alice", "mailto:alice"]) {
    const scenario = normalizeSuite({
      version: 1,
      target: "http://target.test/",
      scenarios: [{
        name: "actor",
        type: "actor",
        recipient,
      }],
    }).scenarios[0];

    assert.throws(
      () => actorRunner.validate?.(scenario),
      /actor recipient must be an acct: handle or a bare http\(s\) URL/,
    );
  }
});
