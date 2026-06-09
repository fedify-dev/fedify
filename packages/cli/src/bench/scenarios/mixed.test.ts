import assert from "node:assert/strict";
import test from "node:test";
import { getContextLoader, getDocumentLoader } from "../../docloader.ts";
import { normalizeSuite } from "../scenario/normalize.ts";
import type { Suite } from "../scenario/types.ts";
import { mixedRunner } from "./mixed.ts";

test("mixedRunner - runs weighted child scenarios together", async () => {
  const target = new URL("http://target.test/");
  let webfingerCalls = 0;
  const suite: Suite = {
    version: 1,
    target: target.href,
    scenarios: [
      {
        name: "lookup-a",
        type: "webfinger",
        recipient: "acct:alice@target.test",
      },
      {
        name: "lookup-b",
        type: "webfinger",
        recipient: "acct:bob@target.test",
      },
      {
        name: "mixed",
        type: "mixed",
        load: { rate: 20 },
        duration: "50ms",
        mix: [
          { scenario: "lookup-a", weight: 3 },
          { scenario: "lookup-b", weight: 1 },
        ],
      },
    ],
  };
  const scenarios = normalizeSuite(suite).scenarios;
  const scenario = scenarios[2];
  const measurement = await mixedRunner.run({
    scenario,
    scenarios,
    target,
    documentLoader: await getDocumentLoader({ allowPrivateAddress: true }),
    contextLoader: await getContextLoader({ allowPrivateAddress: true }),
    allowPrivateAddress: true,
    fleet: null,
    fetch: (input) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.pathname === "/.well-known/webfinger") {
        webfingerCalls++;
        return Promise.resolve(json({
          subject: url.searchParams.get("resource"),
          links: [],
        }));
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    },
  });

  assert.ok(webfingerCalls > 0);
  assert.strictEqual(measurement.requests.failed, 0);
  assert.strictEqual(measurement.requests.successRate, 1);
});

test("mixedRunner - rejects unknown children", async () => {
  const scenarios = normalizeSuite({
    version: 1,
    target: "http://target.test/",
    scenarios: [{
      name: "mixed",
      type: "mixed",
      mix: [{ scenario: "missing", weight: 1 }],
    }],
  }).scenarios;

  await assert.rejects(
    async () =>
      await mixedRunner.run({
        scenario: scenarios[0],
        scenarios,
        target: new URL("http://target.test/"),
        documentLoader: await getDocumentLoader({ allowPrivateAddress: true }),
        contextLoader: await getContextLoader({ allowPrivateAddress: true }),
        allowPrivateAddress: true,
        fleet: null,
      }),
    /unknown mixed child/,
  );
});

test("mixedRunner.validate - rejects too-small closed load", () => {
  const scenario = normalizeSuite({
    version: 1,
    target: "http://target.test/",
    scenarios: [{
      name: "mixed",
      type: "mixed",
      load: { concurrency: 1 },
      mix: [
        { scenario: "one", weight: 1 },
        { scenario: "two", weight: 1 },
      ],
    }],
  }).scenarios[0];

  assert.throws(() => mixedRunner.validate?.(scenario), /concurrency/);
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/jrd+json" },
  });
}
