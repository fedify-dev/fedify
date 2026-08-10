import { createFederation, MemoryKvStore } from "@fedify/fedify";
import { Elysia } from "elysia";
import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { fedify } from "./index.ts";

interface MockFederation {
  fetch(request: Request, options: unknown): Promise<Response>;
}

describe("[elysia] fedify() plugin", () => {
  test("fedify() calls the context data factory when handling a request", async () => {
    const elysia = new Elysia();
    const mockFederation: MockFederation = {
      fetch: () => Promise.resolve(new Response("OK")),
    };
    let count = 0;
    const mockContextDataFactory = () => {
      // increases count if this method called
      count++;
    };

    elysia.use(fedify(mockFederation as never, mockContextDataFactory));
    await elysia.handle(new Request("http://localhost/"));

    assert.strictEqual(count, 1, "the context data factory must be called");
  });

  test("fedify() calls federation.fetch() with the context data", async () => {
    const elysia = new Elysia();
    const mockFederation: MockFederation = {
      fetch: (_req, opts) => {
        // return context data
        const contextData = (opts as { contextData: string }).contextData;
        return Promise.resolve(new Response(contextData));
      },
    };
    const mockContextDataFactory = () => "Hello World";

    elysia.use(fedify(mockFederation as never, mockContextDataFactory));
    const actual = await elysia.handle(new Request("http://localhost/"))
      .then((res) => res.text());

    assert.strictEqual(
      actual,
      "Hello World",
      "federation.fetch() must receive the context data returned by the factory",
    );
  });

  test("fedify() falls through to Elysia routes when federation reports not-found via onNotFound", async () => {
    const elysia = new Elysia().get(
      "/hello-world",
      ({ set, status }) => {
        set.headers["X-Custom-Header"] = "custom-value";
        return status(201, "Hello World");
      },
    );
    const federationWithoutDispatcher = createFederation<void>({
      kv: new MemoryKvStore(),
    });

    elysia.use(fedify(federationWithoutDispatcher, () => undefined));
    const response = await elysia.handle(
      new Request("http://localhost/hello-world"),
    );

    assert.strictEqual(response.status, 201, "status must come from Elysia");
    assert.strictEqual(
      response.headers.get("X-Custom-Header"),
      "custom-value",
      "header must come from Elysia",
    );
    assert.strictEqual(
      await response.text(),
      "Hello World",
      "body must come from Elysia",
    );
  });

  test("fedify() falls through to Elysia routes when federation declines the request via onNotAcceptable", async () => {
    const elysia = new Elysia().get(
      "/users/alice",
      ({ set, status }) => {
        set.headers["X-Custom-Header"] = "custom-value";
        return status(200, "Hello Alice");
      },
    );
    // Register the actor route so the request matches, but ask for text/html
    // so federation declines via onNotAcceptable instead of handling it.
    const federation = createFederation<void>({ kv: new MemoryKvStore() });
    federation.setActorDispatcher("/users/{identifier}", () => null);

    elysia.use(fedify(federation, () => undefined));
    const response = await elysia.handle(
      new Request("http://localhost/users/alice", {
        headers: { Accept: "text/html" },
      }),
    );

    assert.strictEqual(response.status, 200, "status must come from Elysia");
    assert.strictEqual(
      response.headers.get("X-Custom-Header"),
      "custom-value",
      "header must come from Elysia",
    );
    assert.strictEqual(
      await response.text(),
      "Hello Alice",
      "body must come from Elysia",
    );
  });
});
