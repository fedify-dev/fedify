import type { Federation } from "@fedify/fedify";
import { integrateFetchOptions, integrateHandler } from "@fedify/fresh";
import { assertEquals, assertExists, assertStrictEquals } from "@std/assert";
import type { Context } from "fresh";

function createMockContext<TState>(
  overrides: Partial<Context<TState>> = {},
): Context<TState> {
  return {
    req: new Request("https://example.com/"),
    next: () => Promise.resolve(new Response(null, { status: 404 })),
    ...overrides,
  } as Context<TState>;
}

Deno.test("integrateFetchOptions() wires onNotFound to ctx.next()", async () => {
  let nextCalled = false;
  const ctx = createMockContext({
    next: () => {
      nextCalled = true;
      return Promise.resolve(new Response("fresh page"));
    },
  });

  const options = integrateFetchOptions(ctx);
  assertExists(options.onNotFound);
  const response = await options.onNotFound(ctx.req);

  assertEquals(nextCalled, true);
  assertEquals(await response.text(), "fresh page");
});

Deno.test("onNotAcceptable() returns Fresh response when not 404", async () => {
  const ctx = createMockContext({
    next: () => Promise.resolve(new Response("ok", { status: 200 })),
  });

  const options = integrateFetchOptions(ctx);
  assertExists(options.onNotAcceptable);
  const response = await options.onNotAcceptable(ctx.req);

  assertEquals(response.status, 200);
  assertEquals(await response.text(), "ok");
});

Deno.test("onNotAcceptable() returns 406 when Fresh returns 404", async () => {
  const ctx = createMockContext({
    next: () => Promise.resolve(new Response(null, { status: 404 })),
  });

  const options = integrateFetchOptions(ctx);
  assertExists(options.onNotAcceptable);
  const response = await options.onNotAcceptable(ctx.req);

  assertEquals(response.status, 406);
  assertEquals(response.headers.get("Vary"), "Accept");
  assertEquals(response.headers.get("Content-Type"), "text/plain");
});

Deno.test("integrateHandler() calls createContextData and passes result to federation.fetch()", async () => {
  const expectedContextData = { userId: "test-user" };
  let receivedContextData: unknown;
  let receivedRequest: Request | undefined;

  const mockFederation = {
    fetch: (req: Request, opts: { contextData: unknown }) => {
      receivedRequest = req;
      receivedContextData = opts.contextData;
      return Promise.resolve(new Response("ok"));
    },
  } as unknown as Federation<unknown>;

  const ctx = createMockContext();
  const createContextData = (c: Context<unknown>) => {
    assertStrictEquals(c, ctx);
    return expectedContextData;
  };

  const handler = integrateHandler(mockFederation, createContextData);
  const response = await handler(ctx);

  assertEquals(receivedContextData, expectedContextData);
  assertStrictEquals(receivedRequest, ctx.req);
  assertEquals(await response.text(), "ok");
});

Deno.test("integrateHandler() supports an async createContextData factory", async () => {
  const expectedContextData = { userId: "async-user" };
  let receivedContextData: unknown;

  const mockFederation = {
    fetch: (_req: Request, opts: { contextData: unknown }) => {
      receivedContextData = opts.contextData;
      return Promise.resolve(new Response("ok"));
    },
  } as unknown as Federation<unknown>;

  const createContextData = () => Promise.resolve(expectedContextData);

  const ctx = createMockContext();
  const handler = integrateHandler(mockFederation, createContextData);
  await handler(ctx);

  assertEquals(receivedContextData, expectedContextData);
});
