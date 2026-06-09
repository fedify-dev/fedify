import assert from "node:assert/strict";
import test from "node:test";
import { getContextLoader, getDocumentLoader } from "../../docloader.ts";
import { normalizeSuite } from "../scenario/normalize.ts";
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
