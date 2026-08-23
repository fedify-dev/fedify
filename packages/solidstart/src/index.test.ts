import { createFederation, MemoryKvStore } from "@fedify/fedify";
import type { FetchEvent } from "@solidjs/start/server";
import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { createOnRequestHandler } from "./handlers.ts";

// The handlers are the SUT instead of fedifyMiddleware(): importing it
// would load @solidjs/start's *.jsx* runtime modules, which need a bundler.
describe("[solidstart] fedifyMiddleware()", () => {
  test("returns no response when federation reports not-found via onNotFound", async () => {
    // No dispatcher is registered, so federation.fetch() takes the
    // onNotFound path for every request:
    const federationWithoutDispatcher = createFederation<void>({
      kv: new MemoryKvStore(),
    });
    let contextDataFactoryCalls = 0;
    const onRequest = createOnRequestHandler(
      federationWithoutDispatcher,
      () => {
        contextDataFactoryCalls++;
      },
    );

    const event = {
      request: new Request("http://localhost/hello-world"),
      locals: {},
    } as unknown as FetchEvent;
    const response = await onRequest(event);

    assert.strictEqual(
      contextDataFactoryCalls,
      1,
      "the context data factory must be consulted for the request",
    );
    assert.strictEqual(
      response,
      undefined,
      "onRequest must not return a response when Fedify reports not-found " +
        "so that SolidStart can handle the request",
    );
  });
});
