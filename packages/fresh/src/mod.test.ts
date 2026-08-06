import { integrateFetchOptions } from "@fedify/fresh";
import { assertEquals, assertExists } from "@std/assert";
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
