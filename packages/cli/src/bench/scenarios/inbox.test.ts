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
// the recipient actor(s), and an inbox that verifies incoming signatures.
async function spawnBenchmarkTarget(usernames: string[] = ["alice"]) {
  // No message queue, so incoming activities are processed inline (which also
  // keeps the test process from being held open by a queue worker timer).
  const federation = createFederation<void>({
    kv: new MemoryKvStore(),
    benchmarkMode: true,
  });
  const keyPairsByUser = new Map<string, CryptoKeyPair[]>();
  federation
    .setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
      if (!usernames.includes(identifier)) return null;
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
    .mapHandle((_ctx, username) =>
      usernames.includes(username) ? username : null
    )
    .setKeyPairsDispatcher(async (_ctx, identifier) => {
      if (!usernames.includes(identifier)) return [];
      let pairs = keyPairsByUser.get(identifier);
      if (pairs == null) {
        pairs = [
          await generateCryptoKeyPair("RSASSA-PKCS1-v1_5"),
          await generateCryptoKeyPair("Ed25519"),
        ];
        keyPairsByUser.set(identifier, pairs);
      }
      return pairs;
    });

  let received = 0;
  federation
    .setInboxListeners("/users/{identifier}/inbox", "/inbox")
    .on(Create, () => {
      received++;
    });

  // Record every inbox path that was POSTed to, so a test can confirm that
  // deliveries were spread across multiple recipients' personal inboxes.
  const inboxHits = new Set<string>();
  const server = serve({
    port: 0,
    hostname: "127.0.0.1",
    silent: true,
    fetch: (request: Request) => {
      if (request.method === "POST") {
        inboxHits.add(new URL(request.url).pathname);
      }
      return federation.fetch(request, { contextData: undefined });
    },
  });
  await server.ready();
  return {
    url: new URL(server.url!),
    receivedCount: () => received,
    inboxHits: () => inboxHits,
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

test("inboxRunner - reports server metrics scoped past the warm-up", async () => {
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
        name: "inbox-warmup",
        type: "inbox",
        recipient: new URL("/users/alice", target.url).href,
        inbox: "shared",
        load: { concurrency: 2 },
        // A non-zero warm-up exercises the measured-window baseline snapshot.
        warmup: "120ms",
        duration: "400ms",
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

    assert.strictEqual(measurement.requests.successRate, 1);
    // The measured window verified signatures, so server metrics survive the
    // baseline diff rather than being cancelled out by warm-up traffic.
    assert.ok(
      measurement.server?.signatureVerificationMs != null,
      "expected windowed server signature-verification metrics",
    );
  } finally {
    try {
      await fleet?.close();
    } finally {
      await target.close();
    }
  }
});

test("inboxRunner - rotates deliveries across multiple recipients", async () => {
  const target = await spawnBenchmarkTarget(["alice", "bob"]);
  let fleet: Awaited<ReturnType<typeof spawnSyntheticServer>> | undefined;
  try {
    fleet = await spawnSyntheticServer(
      await buildFleet([{
        count: 2,
        signatureStandards: ["draft-cavage-http-signatures-12"],
      }]),
    );
    const suite: Suite = {
      version: 1,
      target: target.url.href,
      scenarios: [{
        name: "inbox-multi",
        type: "inbox",
        recipient: [
          new URL("/users/alice", target.url).href,
          new URL("/users/bob", target.url).href,
        ],
        // Personal inboxes so each recipient's deliveries hit a distinct path.
        inbox: "personal",
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

    assert.strictEqual(
      measurement.requests.successRate,
      1,
      `expected all deliveries to succeed; errors: ${
        JSON.stringify(measurement.errors)
      }`,
    );
    // Both recipients' personal inboxes received deliveries.
    const hits = target.inboxHits();
    assert.ok(
      hits.has("/users/alice/inbox"),
      `expected alice's inbox to be hit; hits: ${JSON.stringify([...hits])}`,
    );
    assert.ok(
      hits.has("/users/bob/inbox"),
      `expected bob's inbox to be hit; hits: ${JSON.stringify([...hits])}`,
    );
  } finally {
    try {
      await fleet?.close();
    } finally {
      await target.close();
    }
  }
});

test("inboxRunner.validate - rejects activity options it cannot honor", () => {
  function resolve(activity: Record<string, unknown>) {
    return normalizeSuite({
      version: 1,
      target: "http://localhost:3000",
      scenarios: [{
        name: "inbox",
        type: "inbox",
        recipient: "http://localhost:3000/users/alice",
        // deno-lint-ignore no-explicit-any
        activity: activity as any,
      }],
    }).scenarios[0];
  }
  assert.throws(
    () => inboxRunner.validate!(resolve({ type: "Announce" })),
    /Create activities/,
  );
  assert.throws(
    () =>
      inboxRunner.validate!(
        resolve({ type: "Create", embedObject: false }),
      ),
    /embedObject/,
  );
  assert.throws(
    () =>
      inboxRunner.validate!(
        resolve({ type: "Create", object: { type: "Image" } }),
      ),
    /Note objects/,
  );
  // A list whose first item is supported but a later one is not is rejected.
  assert.throws(
    () => inboxRunner.validate!(resolve({ type: ["Create", "Announce"] })),
    /Create activities/,
  );
  assert.throws(
    () =>
      inboxRunner.validate!(
        resolve({ type: "Create", object: { type: ["Note", "Image"] } }),
      ),
    /Note objects/,
  );
  // The default Create/Note activity is accepted.
  assert.doesNotThrow(() =>
    inboxRunner.validate!(resolve({ type: "Create", object: { type: "Note" } }))
  );
});
