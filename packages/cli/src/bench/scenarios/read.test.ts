import assert from "node:assert/strict";
import test from "node:test";
import { buildFleet } from "../actor/fleet.ts";
import { getContextLoader, getDocumentLoader } from "../../docloader.ts";
import { normalizeSuite } from "../scenario/normalize.ts";
import { spawnSyntheticServer } from "../server/synthetic.ts";
import { runReadLoad } from "./read.ts";

test("runReadLoad - unauthenticated reads use the read destination gate", async () => {
  const scenario = normalizeSuite({
    version: 1,
    target: "http://target.test/",
    scenarios: [{
      name: "read",
      type: "actor",
      load: { concurrency: 1 },
      duration: "25ms",
    }],
  }).scenarios[0];
  let readGateCalls = 0;

  const measurement = await runReadLoad({
    scenario,
    target: new URL("http://target.test/"),
    documentLoader: await getDocumentLoader({ allowPrivateAddress: true }),
    contextLoader: await getContextLoader({ allowPrivateAddress: true }),
    allowPrivateAddress: true,
    fleet: null,
    fetch: (input) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.pathname === "/.well-known/fedify/bench/stats") {
        return Promise.resolve(new Response("not found", { status: 404 }));
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    },
    assertDestinationAllowed: () => {
      throw new Error("signed destination gate should not run");
    },
    assertReadDestinationAllowed: () => {
      readGateCalls++;
    },
  }, {
    urls: [new URL("http://remote.test/users/alice")],
    authenticated: false,
  });

  assert.strictEqual(readGateCalls, 1);
  assert.ok(measurement.requests.total > 0);
  assert.strictEqual(measurement.requests.successRate, 1);
});

test("runReadLoad - gates resolved read URLs concurrently", async () => {
  const scenario = normalizeSuite({
    version: 1,
    target: "http://target.test/",
    scenarios: [{
      name: "read",
      type: "actor",
      load: { concurrency: 1 },
      duration: "25ms",
    }],
  }).scenarios[0];
  let activeGates = 0;
  let maxActiveGates = 0;

  await runReadLoad({
    scenario,
    target: new URL("http://target.test/"),
    documentLoader: await getDocumentLoader({ allowPrivateAddress: true }),
    contextLoader: await getContextLoader({ allowPrivateAddress: true }),
    allowPrivateAddress: true,
    fleet: null,
    fetch: (input) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.pathname === "/.well-known/fedify/bench/stats") {
        return Promise.resolve(new Response("not found", { status: 404 }));
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    },
    assertReadDestinationAllowed: async () => {
      activeGates++;
      maxActiveGates = Math.max(maxActiveGates, activeGates);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeGates--;
    },
  }, {
    urls: [
      new URL("http://remote.test/users/alice"),
      new URL("http://remote.test/users/bob"),
    ],
    authenticated: false,
  });

  assert.strictEqual(maxActiveGates, 2);
});

test("runReadLoad - rejects invalid read URL schemes before load", async () => {
  const scenario = normalizeSuite({
    version: 1,
    target: "http://target.test/",
    scenarios: [{
      name: "read",
      type: "object",
      load: { concurrency: 1 },
      duration: "25ms",
    }],
  }).scenarios[0];
  let fetchCalls = 0;
  let gateCalls = 0;

  for (
    const url of [
      new URL("ftp://remote.test/object"),
      new URL("http://user:pass@remote.test/object"),
    ]
  ) {
    await assert.rejects(
      async () =>
        await runReadLoad({
          scenario,
          target: new URL("http://target.test/"),
          documentLoader: await getDocumentLoader({
            allowPrivateAddress: true,
          }),
          contextLoader: await getContextLoader({ allowPrivateAddress: true }),
          allowPrivateAddress: true,
          fleet: null,
          fetch: () => {
            fetchCalls++;
            return Promise.resolve(new Response("{}", { status: 200 }));
          },
          assertReadDestinationAllowed: () => {
            gateCalls++;
          },
        }, {
          urls: [url],
          authenticated: false,
        }),
      /read URL must be a bare http\(s\) URL/,
    );
  }

  assert.strictEqual(fetchCalls, 0);
  assert.strictEqual(gateCalls, 0);
});

test("runReadLoad - authenticated reads support presign mode", async () => {
  let fleet: Awaited<ReturnType<typeof spawnSyntheticServer>> | undefined;
  try {
    fleet = await spawnSyntheticServer(
      await buildFleet([{
        count: 1,
        signatureStandards: ["draft-cavage-http-signatures-12"],
      }]),
    );
    const scenario = normalizeSuite({
      version: 1,
      target: "http://target.test/",
      scenarios: [{
        name: "read",
        type: "actor",
        authenticated: true,
        signing: "presign",
        load: { rate: "20/s" },
        duration: "50ms",
      }],
    }).scenarios[0];
    let signedGets = 0;

    const measurement = await runReadLoad({
      scenario,
      target: new URL("http://target.test/"),
      documentLoader: await getDocumentLoader({ allowPrivateAddress: true }),
      contextLoader: await getContextLoader({ allowPrivateAddress: true }),
      allowPrivateAddress: true,
      fleet,
      fetch: (input) => {
        const request = input instanceof Request ? input : new Request(input);
        const url = new URL(request.url);
        if (url.pathname === "/.well-known/fedify/bench/stats") {
          return Promise.resolve(new Response("not found", { status: 404 }));
        }
        if (
          request.headers.has("authorization") ||
          request.headers.has("signature")
        ) {
          signedGets++;
        }
        return Promise.resolve(new Response("{}", { status: 200 }));
      },
      assertDestinationAllowed: () => {},
      assertReadDestinationAllowed: () => {
        throw new Error("authenticated reads should use the signed gate");
      },
    }, {
      urls: [new URL("http://remote.test/users/alice")],
      authenticated: true,
    });

    assert.ok(measurement.requests.total > 0);
    assert.strictEqual(measurement.requests.successRate, 1);
    assert.ok(signedGets > 0);
  } finally {
    await fleet?.close();
  }
});
