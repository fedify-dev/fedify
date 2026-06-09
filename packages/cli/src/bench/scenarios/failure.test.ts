import assert from "node:assert/strict";
import test from "node:test";
import { getContextLoader, getDocumentLoader } from "../../docloader.ts";
import { normalizeSuite } from "../scenario/normalize.ts";
import type { Suite } from "../scenario/types.ts";
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
