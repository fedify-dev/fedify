import { fedifyPlugin } from "@fedify/fastify";
import {
  createFederation,
  MemoryKvStore,
  Person,
  type RequestContext,
} from "@fedify/fedify";
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
