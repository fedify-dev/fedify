import {
  createFederation,
  InProcessMessageQueue,
  MemoryKvStore,
} from "@fedify/fedify";
import { test } from "@fedify/fixture";
import { strict as assert } from "node:assert";
import {
  fedifyWith,
  integrateFederation,
  isFederationRequest,
  isNodeInfoRequest,
} from "./index.ts";

test("Accept header detection", () => {
  const request = new Request("https://example.com/", {
    headers: {
      Accept: "application/activity+json",
    },
  });

  assert.strictEqual(isFederationRequest(request), true);
});

test("Content-Type header detection", () => {
  const request = new Request("https://example.com/", {
    method: "POST",
    headers: {
      "Content-Type": "application/activity+json",
    },
  });

  assert.strictEqual(isFederationRequest(request), true);
});

test("NodeInfo route detection", () => {
  const request1 = new Request("https://example.com/.well-known/nodeinfo", {});

  const request2 = new Request(
    "https://example.com/.well-known/x-nodeinfo2",
    {},
  );

  assert.strictEqual(isNodeInfoRequest(request1), true);
  assert.strictEqual(isNodeInfoRequest(request2), true);
});

test("Non-federation request delegation", async () => {
  const federation = createFederation({
    kv: new MemoryKvStore(),
    queue: new InProcessMessageQueue(),
  });
  const customMiddleware = (request: Request) => {
    if (request.url === "https://example.com/test") {
      return new Response("Custom middleware response");
    }
    return new Response("Default response");
  };
  const middleware = fedifyWith(federation)(customMiddleware);

  const request = new Request("https://example.com/", {
    headers: {
      Accept: "text/html",
    },
  });

  const request2 = new Request("https://example.com/test", {
    headers: {
      Accept: "text/html",
    },
  });

  assert.strictEqual(isFederationRequest(request), false);
  assert.strictEqual(isFederationRequest(request2), false);

  const response1 = await middleware(request);
  const response2 = await middleware(request2);

  assert.strictEqual(await response1.text(), "Default response");
  assert.strictEqual(await response2.text(), "Custom middleware response");
});

test("Custom not-found/not acceptable handler", async () => {
  const federation = createFederation({
    kv: new MemoryKvStore(),
    queue: new InProcessMessageQueue(),
  });

  // Set up a dispatcher that always returns null to simulate a not acceptable scenario
  federation.setActorDispatcher("/users/{identifier}", () => null);

  const handler = integrateFederation(federation, undefined, {
    onNotFound: () => new Response("Custom not found", { status: 418 }),
    onNotAcceptable: () =>
      new Response("Custom not acceptable", { status: 418 }),
  });

  const response1 = await handler(
    new Request("https://example.com/missing", {
      headers: { Accept: "application/activity+json" },
    }),
  );

  assert.strictEqual(response1.status, 418);
  assert.strictEqual(await response1.text(), "Custom not found");

  const response2 = await handler(
    new Request("https://example.com/users/123", {
      headers: { Accept: "text/html" },
    }),
  );

  assert.strictEqual(response2.status, 418);
  assert.strictEqual(await response2.text(), "Custom not acceptable");
});
