import { test } from "@fedify/fixture";
import { equal, ok, strictEqual } from "node:assert/strict";
import { fetchWithFedify, resolveDeferredNotAcceptable } from "./logic.ts";

test(
  "genuine handler 406 must be classified as handled",
  async () => {
    const handlerBody = JSON.stringify({ error: "custom reason" });
    const handlerResponse = new Response(handlerBody, {
      status: 406,
      headers: { "Content-Type": "application/json" },
    });

    const result = await fetchWithFedify(
      () => Promise.resolve(handlerResponse),
      new Request("https://example.com/inbox"),
      undefined,
    );

    equal(result.kind, "handled");
    if (result.kind === "handled") {
      strictEqual(result.response, handlerResponse);
    }
  },
);

test(
  "framework intentional 404 on shared route must not become 406",
  () => {
    // When a route handler ran (routeHandled=true), preserve the
    // framework's 404 instead of rewriting it to 406.
    const result = resolveDeferredNotAcceptable(true, 404, true);
    equal(
      result,
      undefined,
      "should preserve framework 404 when route was handled",
    );
  },
);

test(
  "deferred 406 fires when no route handler matched",
  () => {
    // When no route handler matched (routeHandled=false), the 404
    // is a genuine route miss and should be converted to 406.
    const result = resolveDeferredNotAcceptable(true, 404, false);
    ok(result, "should return 406 when no route handled the request");
    equal(result!.status, 406);
  },
);
