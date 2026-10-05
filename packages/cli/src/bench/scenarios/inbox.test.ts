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
import type { Clock } from "../load/clock.ts";
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

  // Count POSTs per inbox path, so a test can confirm how deliveries were
  // allocated across multiple recipients' personal inboxes.
  const inboxHits = new Map<string, number>();
  const server = serve({
    port: 0,
    hostname: "127.0.0.1",
    silent: true,
    fetch: (request: Request) => {
      if (request.method === "POST") {
        const path = new URL(request.url).pathname;
        inboxHits.set(path, (inboxHits.get(path) ?? 0) + 1);
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

// A clock that jumps straight to each scheduled arrival, so open-loop runs
// make a fixed number of attempts no matter how slow the deliveries are.
function createFakeClock(): Clock {
  let now = 0;
  return {
    now: () => now,
    sleepUntil: (timeMs) => {
      now = Math.max(now, timeMs);
      return Promise.resolve();
    },
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

test(
  "inboxRunner - reports server metrics scoped past the warm-up",
  { timeout: 60_000 },
  async () => {
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
          // 10/s over 400ms schedules exactly four arrivals: two inside the
          // warm-up (0 and 100ms) and two measured (200 and 300ms), so the
          // measured-window baseline snapshot is always taken.
          load: { rate: 10, arrival: "constant", maxInFlight: 2 },
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
        clock: createFakeClock(),
      });

      // Only the two measured deliveries are counted client-side, although all
      // four, warm-up included, reached the inbox listener.
      assert.strictEqual(measurement.requests.total, 2);
      assert.strictEqual(
        measurement.requests.successRate,
        1,
        `expected all deliveries to succeed; errors: ${
          JSON.stringify(measurement.errors)
        }`,
      );
      assert.strictEqual(target.receivedCount(), 4);
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
  },
);

// Recipients are allocated round-robin by signing index, so the run makes a
// fixed number of attempts rather than however many fit in a real-time window:
// four constant arrivals under a fake clock, each consuming one allocation
// index, split exactly two per recipient whatever order they complete in.
async function assertAllocatesAcrossRecipients(
  signing: "jit" | "presign",
): Promise<void> {
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
        // 10/s over 400ms schedules exactly four arrivals (0, 100, 200, and
        // 300ms), which is also the batch size presign signs up front.
        load: { rate: 10, maxInFlight: 2 },
        duration: "400ms",
        signing,
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
      clock: createFakeClock(),
    });

    assert.strictEqual(measurement.requests.total, 4);
    assert.strictEqual(
      measurement.requests.successRate,
      1,
      `expected all deliveries to succeed; errors: ${
        JSON.stringify(measurement.errors)
      }`,
    );
    // Each recipient's personal inbox received exactly half of the deliveries.
    assert.deepStrictEqual(
      Object.fromEntries(target.inboxHits()),
      { "/users/alice/inbox": 2, "/users/bob/inbox": 2 },
    );
  } finally {
    try {
      await fleet?.close();
    } finally {
      await target.close();
    }
  }
}

test(
  "inboxRunner - allocates jit deliveries across multiple recipients",
  { timeout: 60_000 },
  () => assertAllocatesAcrossRecipients("jit"),
);

test(
  "inboxRunner - allocates presigned deliveries across multiple recipients",
  { timeout: 60_000 },
  () => assertAllocatesAcrossRecipients("presign"),
);

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

test("inboxRunner.validate - rejects a malformed or non-http inbox value", () => {
  function resolve(inbox: string) {
    return normalizeSuite({
      version: 1,
      target: "http://localhost:3000",
      scenarios: [{
        name: "inbox",
        type: "inbox",
        recipient: "http://localhost:3000/users/alice",
        inbox,
      }],
    }).scenarios[0];
  }
  // A typo that is not a URL would otherwise crash selectInbox mid-run.
  assert.throws(() => inboxRunner.validate!(resolve("shraed")), /inbox/);
  // A non-http(s) URL would slip to the send path as a failure.
  assert.throws(
    () => inboxRunner.validate!(resolve("ftp://host/inbox")),
    /http\(s\)/,
  );
  // shared, personal, and a bare http(s) URL are accepted.
  for (const ok of ["shared", "personal", "https://host.example/inbox"]) {
    assert.doesNotThrow(() => inboxRunner.validate!(resolve(ok)));
  }
});
