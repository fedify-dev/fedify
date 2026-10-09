import type { Federation } from "@fedify/fedify/federation";
import { test } from "@fedify/fixture";
import {
  createApp,
  createError,
  createRouter,
  defineEventHandler,
  type H3Event,
  send,
  sendRedirect,
  setResponseStatus,
  toNodeListener,
  toWebHandler,
} from "h3";
import { equal, ok } from "node:assert/strict";
import { createServer } from "node:http";

async function pipeline(
  handler: (event: H3Event) => unknown,
  deferred = true,
  web = false,
): Promise<{ response: Response; errors: number }> {
  // SolidStart ships JSX with extensionless imports; only Bun can load the
  // real wrapper. Keep the import lazy so other runtimes can discover tests.
  const { fedifyMiddleware } = await import("./index.ts");
  const federation = {
    fetch: (_request: Request, options: {
      onNotAcceptable: () => Response;
      onNotFound: () => Response;
    }) =>
      Promise.resolve(
        deferred ? options.onNotAcceptable() : options.onNotFound(),
      ),
  } as unknown as Federation<unknown>;
  const middleware = fedifyMiddleware(federation);
  let errors = 0;
  const app = createApp({
    // Nitro sends errors directly, bypassing middleware response hooks.
    onError: async (error, event) => {
      errors++;
      setResponseStatus(event, error.statusCode, error.statusMessage);
      await send(event, "application error", "application/json");
    },
  });
  // This is vinxi's middleware composition, followed by Nitro's router.
  const onRequest = middleware.onRequest;
  const onBeforeResponse = middleware.onBeforeResponse;
  ok(typeof onRequest === "function");
  ok(typeof onBeforeResponse === "function");
  app.use(defineEventHandler({
    // Vinxi pins H3 1.15.3, while this test uses the workspace's H3 1.15.x.
    // Bridge their callback types without replacing SolidStart's wrappers.
    onRequest: (event) =>
      onRequest(event as unknown as Parameters<typeof onRequest>[0]),
    onBeforeResponse: (event, payload) =>
      onBeforeResponse(
        event as unknown as Parameters<typeof onBeforeResponse>[0],
        payload,
      ),
    handler,
  }));
  app.use(createRouter({ preemptive: true }).handler);
  if (web) {
    return {
      response: await toWebHandler(app)(
        new Request("http://localhost/users/alice"),
      ),
      errors,
    };
  }
  const server = createServer(toNodeListener(app));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    ok(address && typeof address !== "string");
    const response = await fetch(
      `http://127.0.0.1:${address.port}/users/alice`,
      {
        headers: { Accept: "image/png", Connection: "close" },
        redirect: "manual",
      },
    );
    const body = await response.text();
    return {
      response: new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      }),
      errors,
    };
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve())
    );
  }
}
const missingHandlers: Record<string, (event: H3Event) => unknown> = {
  "returned Response": () => new Response("no HTML", { status: 404 }),
  "event status": (event) => {
    setResponseStatus(event, 404);
    return "no HTML";
  },
  "undefined": () => undefined,
  "null": (event) => {
    setResponseStatus(event, 404);
    return null;
  },
  "thrown error": () => {
    throw createError({ statusCode: 404, statusMessage: "Page not found" });
  },
  "returned error": () => createError({ statusCode: 404 }),
};
for (const [name, handler] of Object.entries(missingHandlers)) {
  test(`SolidStart restores deferred 406 for ${name}`, {
    ignore: !("Bun" in globalThis),
  }, async () => {
    const { response, errors } = await pipeline(handler);
    equal(response.status, 406);
    equal(response.statusText, "Not Acceptable");
    equal(response.headers.get("content-type"), "text/plain");
    equal(response.headers.get("vary"), "Accept");
    equal(await response.text(), "Not Acceptable");
    equal(errors, name === "thrown error" ? 1 : 0);
  });
}
test("SolidStart restores thrown 404 through H3's Web handler", {
  ignore: !("Bun" in globalThis),
}, async () => {
  const { response } = await pipeline(
    missingHandlers["thrown error"],
    true,
    true,
  );
  equal(response.status, 406);
  equal(await response.text(), "Not Acceptable");
});
for (
  const [name, handler, status] of [
    ["success", () => new Response("HTML"), 200],
    ["Response overrides event status", (event: H3Event) => {
      setResponseStatus(event, 404);
      return new Response("HTML");
    }, 200],
    ["server error", () => {
      throw createError({ statusCode: 500 });
    }, 500],
  ] as const
) {
  test(
    `SolidStart preserves ${name}`,
    { ignore: !("Bun" in globalThis) },
    async () => {
      equal((await pipeline(handler)).response.status, status);
    },
  );
}
test("SolidStart preserves non-deferred 404", {
  ignore: !("Bun" in globalThis),
}, async () => {
  equal(
    (await pipeline(missingHandlers["thrown error"], false)).response.status,
    404,
  );
});

test("SolidStart preserves already-handled redirects", {
  ignore: !("Bun" in globalThis),
}, async () => {
  const { response, errors } = await pipeline((event) =>
    sendRedirect(event, "/login")
  );
  // The harness request must not follow the redirect back into the middleware.
  equal(response.status, 302);
  equal(response.headers.get("location"), "/login");
  equal(errors, 0);
});

test("SolidStart keeps concurrent requests isolated", {
  ignore: !("Bun" in globalThis),
}, async () => {
  const [deferred, ordinary] = await Promise.all([
    pipeline(missingHandlers["thrown error"]),
    pipeline(missingHandlers["thrown error"], false),
  ]);
  equal(deferred.response.status, 406);
  equal(ordinary.response.status, 404);
});
