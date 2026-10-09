import type { Federation } from "@fedify/fedify/federation";
import { test } from "@fedify/fixture";
import {
  appendResponseHeader,
  createApp,
  createError,
  createRouter,
  defineEventHandler,
  type H3Event,
  send,
  setResponseHeader,
  setResponseStatus,
  toNodeListener,
} from "h3";
import { equal, ok } from "node:assert/strict";
import { createServer } from "node:http";
import { createFedifyMiddleware } from "./middleware.ts";
import fedifyPlugin from "./plugin.ts";

type BeforeResponse = (event: H3Event, payload: { body?: unknown }) => void;
type RenderBefore = (context: { event: H3Event }) => void;

async function request(
  kind:
    | "miss"
    | "renderer-error"
    | "renderer-response"
    | "route-error"
    | "route-response"
    | "success"
    | "server-error",
  deferred = true,
): Promise<{ response: Response; errors: number }> {
  let errors = 0;
  let beforeResponse: BeforeResponse | undefined;
  let renderBefore: RenderBefore | undefined;
  const app = createApp({
    // Nitro 2.13.3's onError calls its error handler directly, which sends
    // before H3 can run onBeforeResponse. Reproduce that lifecycle here.
    async onError(error, event) {
      equal(this, app.options);
      errors++;
      setResponseStatus(event, error.statusCode, error.statusMessage);
      await send(event, "application error", "application/json");
    },
    onBeforeResponse: (event, payload) => beforeResponse?.(event, payload),
  });
  fedifyPlugin(
    {
      h3App: app,
      hooks: {
        hook(name: string, callback: unknown) {
          if (name === "beforeResponse") {
            beforeResponse = callback as BeforeResponse;
          }
          if (name === "render:before") renderBefore = callback as RenderBefore;
        },
      },
    } as Parameters<typeof fedifyPlugin>[0],
  );
  const federation = {
    fetch: (_request: Request, options: {
      onNotAcceptable: () => Response;
      onNotFound: () => Response;
    }) =>
      Promise.resolve(
        deferred ? options.onNotAcceptable() : options.onNotFound(),
      ),
  } as unknown as Federation<unknown>;
  app.use(createFedifyMiddleware(federation));
  const router = createRouter({ preemptive: true });
  if (kind !== "miss") {
    router.get(
      kind.startsWith("renderer") ? "/**" : "/users/alice",
      defineEventHandler((event) => {
        if (kind.startsWith("renderer")) renderBefore?.({ event });
        setResponseHeader(event, "Vary", "Origin");
        setResponseHeader(event, "ETag", '"old"');
        setResponseHeader(event, "Content-Digest", "sha-256=:old-event:");
        setResponseHeader(event, "Digest", "SHA-256=old-event");
        if (kind === "success") return "HTML representation";
        if (kind === "server-error") throw createError({ statusCode: 500 });
        if (kind.endsWith("error")) {
          throw createError({
            statusCode: 404,
            statusMessage: "Page not found",
          });
        }
        const headers = new Headers({
          Vary: "Cookie",
          "Content-Type": "text/html",
          "Content-Length": "12",
          "Content-Digest": "sha-256=:old-response:",
          Digest: "SHA-256=old-response",
        });
        headers.append("Set-Cookie", "a=; Max-Age=0; Path=/");
        headers.append(
          "Set-Cookie",
          "b=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/",
        );
        appendResponseHeader(event, "Set-Cookie", "session=active; Path=/");
        return new Response("missing page", { status: 404, headers });
      }),
    );
  }
  app.use(router.handler);
  const server = createServer(toNodeListener(app));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    ok(address && typeof address !== "string");
    const response = await fetch(
      `http://127.0.0.1:${address.port}/users/alice`,
      { headers: { Accept: "image/png", Connection: "close" } },
    );
    // Buffer before closing the server, preserving the actual status line.
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

for (const kind of ["miss", "renderer-error", "renderer-response"] as const) {
  test(`Nuxt restores deferred 406 for ${kind}`, async () => {
    const { response, errors } = await request(kind);
    equal(response.status, 406);
    equal(response.statusText, "Not Acceptable");
    equal(response.headers.get("content-type"), "text/plain");
    ok(response.headers.get("vary")?.split(/,\s*/).includes("Accept"));
    equal(response.headers.get("etag"), null);
    equal(response.headers.get("content-digest"), null);
    equal(response.headers.get("digest"), null);
    if (kind !== "miss") ok(response.headers.get("vary")?.includes("Origin"));
    if (kind === "renderer-response") {
      ok(response.headers.get("vary")?.includes("Cookie"));
      equal(response.headers.getSetCookie().length, 3);
      for (const cookie of ["session=active", "a=", "b="]) {
        ok(
          response.headers.getSetCookie().some((value) =>
            value.startsWith(cookie)
          ),
        );
      }
    }
    equal(await response.text(), "Not acceptable");
    equal(errors, 0);
  });
}
for (
  const kind of [
    "route-error",
    "route-response",
    "success",
    "server-error",
  ] as const
) {
  test(`Nuxt preserves application ${kind}`, async () => {
    const { response, errors } = await request(kind);
    equal(
      response.status,
      kind === "success" ? 200 : kind === "server-error" ? 500 : 404,
    );
    equal(errors, kind.endsWith("error") ? 1 : 0);
    const source = kind === "route-response" ? "old-response" : "old-event";
    equal(response.headers.get("content-digest"), `sha-256=:${source}:`);
    equal(response.headers.get("digest"), `SHA-256=${source}`);
  });
}
test("Nuxt leaves non-deferred route misses to the error handler", async () => {
  const { response, errors } = await request("miss", false);
  equal(response.status, 404);
  equal(errors, 1);
});
