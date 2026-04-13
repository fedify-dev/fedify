import { strict as assert } from "node:assert";
import { test } from "@fedify/fixture";
import {
  fetchWithFedify,
  resolveDeferredNotAcceptable,
} from "./runtime/server/logic.ts";

test("Fedify handles federation request successfully", async () => {
  const response = await fetchWithFedify(
    () =>
      Promise.resolve(
        new Response('{"type":"Person"}', {
          status: 200,
          headers: { "Content-Type": "application/activity+json" },
        }),
      ),
    new Request("https://example.com/users/alice"),
    undefined,
  );

  assert.equal(response.kind, "handled");
  if (response.kind === "handled") {
    assert.equal(response.response.status, 200);
    assert.equal(
      response.response.headers.get("Content-Type"),
      "application/activity+json",
    );
  }
});

test("non-federation request is delegated on notFound", async () => {
  const response = await fetchWithFedify(
    async (_request, options) => {
      return await options.onNotFound!(new Request("https://example.com/"));
    },
    new Request("https://example.com/"),
    undefined,
  );

  assert.equal(response.kind, "not-found");
});

test(
  "returns 406 when client does not accept ActivityPub and framework is 404",
  async () => {
    const response = await fetchWithFedify(
      async (_request, options) => {
        return await options.onNotAcceptable!(
          new Request("https://example.com/users/alice", {
            headers: { Accept: "text/html" },
          }),
        );
      },
      new Request("https://example.com/users/alice", {
        headers: { Accept: "text/html" },
      }),
      undefined,
    );

    assert.equal(response.kind, "not-acceptable");

    const negotiated = resolveDeferredNotAcceptable(true, 404);
    assert.ok(negotiated);
    assert.equal(negotiated.status, 406);
    assert.equal(negotiated.headers.get("Vary"), "Accept");
    assert.equal(await negotiated.text(), "Not acceptable");
  },
);

test("framework response is preserved for shared HTML route", async () => {
  const response = await fetchWithFedify(
    async (_request, options) => {
      return await options.onNotAcceptable!(
        new Request("https://example.com/users/alice", {
          headers: { Accept: "text/html" },
        }),
      );
    },
    new Request("https://example.com/users/alice", {
      headers: { Accept: "text/html" },
    }),
    undefined,
  );

  assert.equal(response.kind, "not-acceptable");

  const negotiated = resolveDeferredNotAcceptable(true, 200);
  assert.equal(negotiated, undefined);
});
