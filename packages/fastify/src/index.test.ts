import { fedifyPlugin } from "@fedify/fastify";
import {
  createFederation,
  MemoryKvStore,
  type RequestContext,
} from "@fedify/fedify";
import { Person } from "@fedify/vocab";
import Fastify from "fastify";
import { strict as assert } from "node:assert";
import { test } from "node:test";

test("Fedify should handle requests successfully", async () => {
  const fastify = Fastify({ logger: false });
  const federation = createFederation<void>({ kv: new MemoryKvStore() });

  fastify.get("/", () => {
    return { message: "Hello World" };
  });

  federation.setActorDispatcher(
    "/users/{identifier}",
    (_ctx: RequestContext<void>, identifier: string) => {
      if (identifier === "alice") {
        return new Person({
          id: new URL(`https://example.com/users/${identifier}`),
          preferredUsername: identifier,
          name: `User ${identifier}`,
        });
      }
      return null;
    },
  );

  await fastify.register(fedifyPlugin, { federation });
  await fastify.ready();

  const fedifyResponse = await fastify.inject({
    method: "GET",
    url: "/users/alice",
    headers: { "Accept": "application/activity+json" },
  });
  const fedifyData = JSON.parse(fedifyResponse.body);

  assert.equal(fedifyResponse.statusCode, 200);
  assert.equal(
    fedifyResponse.headers["content-type"],
    "application/activity+json",
  );
  assert.equal(fedifyData.type, "Person");
  assert.equal(fedifyData.preferredUsername, "alice");

  const fastifyResponse = await fastify.inject({
    method: "GET",
    url: "/",
  });
  const fastifyData = JSON.parse(fastifyResponse.body);
  assert.equal(fastifyResponse.statusCode, 200);
  assert.equal(fastifyData.message, "Hello World");

  await fastify.close();
});

test("Fedify should delegate to Fastify on notFound", async () => {
  const fastify = Fastify({ logger: false });
  const federation = createFederation<void>({ kv: new MemoryKvStore() });
  federation.setActorDispatcher(
    "/users/{identifier}",
    (_ctx: RequestContext<void>, identifier: string) => {
      if (identifier === "alice") {
        return new Person({
          id: new URL(`https://example.com/users/${identifier}`),
          preferredUsername: identifier,
          name: `User ${identifier}`,
        });
      }
      return null;
    },
  );

  await fastify.register(fedifyPlugin, { federation });

  fastify.get("/api/users/:id", (request) => {
    const params = request.params as { id: string };
    return { message: "Fastify handled this", userId: params.id };
  });

  await fastify.ready();

  const response = await fastify.inject({
    method: "GET",
    url: "/api/users/bob",
    headers: { "Accept": "application/activity+json" },
  });
  const data = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(data.message, "Fastify handled this");
  assert.equal(data.userId, "bob");

  await fastify.close();
});

test("Fedify should handle notAcceptable and return 406", async () => {
  const fastify = Fastify({ logger: false });
  const federation = createFederation<void>({ kv: new MemoryKvStore() });

  federation.setActorDispatcher(
    "/users/{identifier}",
    (_ctx: RequestContext<void>, identifier: string) => {
      return new Person({
        id: new URL(`https://example.com/users/${identifier}`),
        preferredUsername: identifier,
        name: `User ${identifier}`,
      });
    },
  );

  await fastify.register(fedifyPlugin, { federation });
  await fastify.ready();
  const response = await fastify.inject({
    method: "GET",
    url: "/users/alice",
    headers: { "Accept": "text/html" },
  });

  assert.equal(response.statusCode, 406);
  assert.equal(response.body, "Not Acceptable");

  await fastify.close();
});

test("Fedify should create a fresh 406 response for each request", async () => {
  const fastify = Fastify({ logger: false });
  const federation = createFederation<void>({ kv: new MemoryKvStore() });

  federation.setActorDispatcher(
    "/users/{identifier}",
    (_ctx: RequestContext<void>, identifier: string) => {
      return new Person({
        id: new URL(`https://example.com/users/${identifier}`),
        preferredUsername: identifier,
        name: `User ${identifier}`,
      });
    },
  );

  await fastify.register(fedifyPlugin, { federation });
  await fastify.ready();

  const firstResponse = await fastify.inject({
    method: "GET",
    url: "/users/alice",
    headers: { "Accept": "text/html" },
  });
  const secondResponse = await fastify.inject({
    method: "GET",
    url: "/users/alice",
    headers: { "Accept": "text/html" },
  });

  assert.equal(firstResponse.statusCode, 406);
  assert.equal(firstResponse.body, "Not Acceptable");
  assert.equal(secondResponse.statusCode, 406);
  assert.equal(secondResponse.body, "Not Acceptable");

  await fastify.close();
});

test("Fedify should handle notAcceptable with custom error handler", async () => {
  const fastify = Fastify({ logger: false });
  const federation = createFederation<void>({ kv: new MemoryKvStore() });
  let notAcceptableCalled = false;

  const onNotAcceptable = (_request: Request) => {
    notAcceptableCalled = true;
    return new Response("Custom Handler", { status: 400 });
  };

  federation.setActorDispatcher(
    "/users/{identifier}",
    (_ctx: RequestContext<void>, identifier: string) => {
      return new Person({
        id: new URL(`https://example.com/users/${identifier}`),
        preferredUsername: identifier,
        name: `User ${identifier}`,
      });
    },
  );

  await fastify.register(fedifyPlugin, {
    federation,
    errorHandlers: {
      onNotAcceptable,
    },
  });

  await fastify.ready();
  const response = await fastify.inject({
    method: "GET",
    url: "/users/alice",
    headers: { "Accept": "text/html" },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body, "Custom Handler");
  assert.equal(notAcceptableCalled, true);

  await fastify.close();
});

test("Fedify should handle notFound with custom error handler", async () => {
  const fastify = Fastify({ logger: false });
  const federation = createFederation<void>({ kv: new MemoryKvStore() });
  let notFoundCalled = false;

  const onNotFound = (_request: Request) => {
    notFoundCalled = true;
    return new Response("Custom Handler", { status: 400 });
  };

  federation.setActorDispatcher(
    "/users/{identifier}",
    (_ctx: RequestContext<void>, identifier: string) => {
      if (identifier === "alice") {
        return new Person({
          id: new URL(`https://example.com/users/${identifier}`),
          preferredUsername: identifier,
          name: `User ${identifier}`,
        });
      }
      return null;
    },
  );

  await fastify.register(fedifyPlugin, {
    federation,
    errorHandlers: {
      onNotFound,
    },
  });

  await fastify.ready();
  const response = await fastify.inject({
    method: "GET",
    url: "/users/bob",
    headers: { "Accept": "application/activity+json" },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body, "Custom Handler");
  assert.equal(notFoundCalled, true);

  await fastify.close();
});

// Large enough to fill the stream buffers that used to stall; see
// <https://github.com/fedify-dev/fedify/issues/1059>.
const LARGE_BODY_SIZE = 512 * 1024;

test("Fedify should leave request bodies it declines intact", async () => {
  const fastify = Fastify({ logger: false });
  const federation = createFederation<void>({ kv: new MemoryKvStore() });
  federation.setActorDispatcher("/users/{identifier}", () => null);
  await fastify.register(fedifyPlugin, { federation });
  fastify.post("/api/articles", (request) => {
    return String((request.body as string).length);
  });
  const origin = await fastify.listen({ port: 0, host: "127.0.0.1" });

  try {
    for (const size of [1024, LARGE_BODY_SIZE]) {
      const response = await fetch(`${origin}/api/articles`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "x".repeat(size),
        signal: AbortSignal.timeout(5000),
      });
      assert.equal(response.status, 200);
      assert.equal(await response.text(), String(size));
    }
  } finally {
    await fastify.close();
  }
});

test("Fedify should receive request bodies it handles", async () => {
  const fastify = Fastify({ logger: false });
  const federation = createFederation<void>({
    kv: new MemoryKvStore(),
    skipSignatureVerification: true,
  });
  federation.setActorDispatcher("/users/{identifier}", () => null);
  federation.setInboxListeners("/users/{identifier}/inbox", "/inbox");
  await fastify.register(fedifyPlugin, { federation });
  const origin = await fastify.listen({ port: 0, host: "127.0.0.1" });

  try {
    // Fedify rejects a truncated body as invalid JSON, so an accepted
    // activity means the whole body reached it:
    const response = await fetch(`${origin}/inbox`, {
      method: "POST",
      headers: { "Content-Type": "application/activity+json" },
      body: JSON.stringify({
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Create",
        id: "https://remote.example/activities/1",
        actor: "https://remote.example/users/alice",
        object: {
          type: "Note",
          id: "https://remote.example/notes/1",
          attributedTo: "https://remote.example/users/alice",
          content: "x".repeat(LARGE_BODY_SIZE),
        },
      }),
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 202);
  } finally {
    await fastify.close();
  }
});
