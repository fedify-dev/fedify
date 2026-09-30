// @ts-ignore: The following code is generated
import { testDefinitions } from "./dist/testing/mod.js";
// @ts-ignore: The following code is generated
import "./imports.ts";
import { testDefinitions as fixtureTestDefinitions } from
  "../../../vocab-runtime/src/portable-workers.test.ts";
import "../../../vocab/src/portable-lookup.test.ts";
import { expectedTestNames } from "./expected-tests.ts";
import { createTestWorker } from "./runner.ts";
import { selfTests } from "./selftest.ts";

const expected = new Set(expectedTestNames);
const selected = [...new Set([...testDefinitions, ...fixtureTestDefinitions])]
  .filter(({ name }) => expected.has(name as typeof expectedTestNames[number]));
for (const name of expected) {
  if (selected.filter((test) => test.name === name).length !== 1) {
    throw new Error(`Workers test registration is missing or duplicated: ${name}`);
  }
}

const worker = createTestWorker(selected);
const selfTestWorker = createTestWorker(selfTests);

export default {
  fetch(request: Request, env: unknown): Promise<Response> {
    return (new URL(request.url).searchParams.has("selftest")
      ? selfTestWorker
      : worker).fetch(request, env);
  },
  queue: worker.queue,
};
