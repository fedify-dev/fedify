// @ts-ignore: The following code is generated
import { testDefinitions } from "./dist/testing/mod.js";
// @ts-ignore: The following code is generated
import "./imports.ts";
import { createTestWorker } from "./runner.ts";
import { selfTests } from "./selftest.ts";

const worker = createTestWorker(testDefinitions);
const selfTestWorker = createTestWorker(selfTests);

export default {
  fetch(request: Request, env: unknown): Promise<Response> {
    return (new URL(request.url).searchParams.has("selftest")
      ? selfTestWorker
      : worker).fetch(request, env);
  },
  queue: worker.queue,
};
