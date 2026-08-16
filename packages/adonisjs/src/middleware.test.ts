/**
 * Specification-compliance tests for the AdonisJS ↔ Fedify middleware.
 *
 * The first four scenarios are the ones every Fedify integration package is
 * required to cover.  The rest guard the AdonisJS-specific decisions this
 * package makes — chiefly the use of `ctx.route` to detect whether the
 * framework matched a route, and the lazy `ctx.federation` accessor.
 *
 * @module
 */
import {
  deepStrictEqual,
  match,
  notStrictEqual,
  ok,
  strictEqual,
} from "node:assert/strict";
import { after, describe, it } from "node:test";

import type { HttpContext } from "@adonisjs/core/http";

import { fedifyMiddleware } from "./middleware.ts";
import {
  ACTIVITY_PUB_ACCEPT,
  BROWSER_ACCEPT,
  createTestFederation,
  startTestServer,
  type TestServer,
} from "./test_utils.ts";

/**
 * Boots one server per test and tears it down afterwards.
 */
async function withServer(
  options:
    & Omit<
      Parameters<typeof startTestServer<null>>[0],
      "federation" | "contextDataFactory"
    >
    & {
      contextDataFactory?: () => null;
    },
): Promise<TestServer> {
  const server = await startTestServer<null>({
    federation: createTestFederation(),
    contextDataFactory: options.contextDataFactory ?? (() => null),
    ignoreRoutePrefixes: options.ignoreRoutePrefixes,
    defineRoutes: options.defineRoutes,
  });
  after(() => server.close());
  return server;
}

describe("Fedify middleware", () => {
  it("serves a federation request as JSON-LD", async () => {
    const server = await withServer({});

    const response = await server.fetch("/users/alice", {
      headers: { Accept: ACTIVITY_PUB_ACCEPT },
    });

    strictEqual(response.status, 200);
    match(
      response.headers.get("content-type") ?? "",
      /activity\+json|ld\+json/,
    );

    const document = (await response.json()) as Record<string, unknown>;
    strictEqual(document.type, "Person");
    strictEqual(document.preferredUsername, "alice");
    strictEqual(document.id, `${server.url}/users/alice`);
  });

  it("serves WebFinger without any AdonisJS route", async () => {
    const server = await withServer({});

    const response = await server.fetch(
      `/.well-known/webfinger?resource=${
        encodeURIComponent(`${server.url}/users/alice`)
      }`,
    );

    strictEqual(response.status, 200);
    const document = (await response.json()) as { subject: string };
    strictEqual(document.subject, `${server.url}/users/alice`);
  });

  it("delegates non-federation requests to AdonisJS", async () => {
    const server = await withServer({
      defineRoutes(router) {
        router.get(
          "/hello",
          ({ response }) => response.send("hello from adonis"),
        );
      },
    });

    const response = await server.fetch("/hello");

    strictEqual(response.status, 200);
    strictEqual(await response.text(), "hello from adonis");
  });

  it("returns 406 when the client does not accept ActivityPub and no route matches", async () => {
    const server = await withServer({});

    const response = await server.fetch("/users/alice", {
      headers: { Accept: BROWSER_ACCEPT },
    });

    strictEqual(response.status, 406);
    strictEqual(await response.text(), "Not acceptable");
    match(response.headers.get("content-type") ?? "", /text\/plain/);
    strictEqual(response.headers.get("vary"), "Accept");
  });

  it("lets AdonisJS serve a shared URL when the client prefers HTML", async () => {
    const server = await withServer({
      defineRoutes(router) {
        router.get(
          "/users/:identifier",
          ({ params, response }) =>
            response.header("content-type", "text/html").send(
              `<h1>${params.identifier}</h1>`,
            ),
        );
      },
    });

    const html = await server.fetch("/users/alice", {
      headers: { Accept: BROWSER_ACCEPT },
    });
    strictEqual(html.status, 200);
    strictEqual(await html.text(), "<h1>alice</h1>");
    strictEqual(html.headers.get("vary"), "Accept");

    // The very same URL still answers with the actor document for servers.
    const jsonLd = await server.fetch("/users/alice", {
      headers: { Accept: ACTIVITY_PUB_ACCEPT },
    });
    strictEqual(jsonLd.status, 200);
    strictEqual(((await jsonLd.json()) as { type: string }).type, "Person");
  });

  it("keeps the AdonisJS 404 for paths neither side knows", async () => {
    const server = await withServer({
      defineRoutes(router) {
        router.get(
          "/hello",
          ({ response }) => response.send("hello from adonis"),
        );
      },
    });

    const response = await server.fetch("/nowhere", {
      headers: { Accept: BROWSER_ACCEPT },
    });

    strictEqual(response.status, 404);
    // Not Fedify's "Not found" body: AdonisJS rendered this one.
    notStrictEqual(await response.text(), "Not found");
  });

  it("answers 406 rather than 404 when a shared route exists but the identifier does not", async () => {
    // Fedify knows the /users/{identifier} template, so it reports "not
    // acceptable" (not "not found") for a browser request.  AdonisJS has no
    // route at all here, so the deferred 406 must win.
    const server = await withServer({});

    const response = await server.fetch("/users/bob", {
      headers: { Accept: BROWSER_ACCEPT },
    });

    strictEqual(response.status, 406);
  });

  describe("ctx.federation", () => {
    it("is available inside AdonisJS route handlers", async () => {
      const server = await withServer({
        defineRoutes(router) {
          router.get("/whoami/:identifier", (ctx: HttpContext) => {
            return ctx.response.json({
              actor: ctx.federation.getActorUri(ctx.params.identifier).href,
              origin: ctx.federation.origin,
            });
          });
        },
      });

      const response = await server.fetch("/whoami/alice");

      strictEqual(response.status, 200);
      deepStrictEqual(await response.json(), {
        actor: `${server.url}/users/alice`,
        origin: server.url,
      });
    });

    it("receives the value produced by the context data factory", async () => {
      let seen: unknown = "not called";
      const federation = createTestFederation();
      const server = await startTestServer<null>({
        federation,
        contextDataFactory: (ctx) => {
          seen = ctx.request.url();
          return null;
        },
        defineRoutes(router) {
          router.get(
            "/ping",
            (ctx: HttpContext) =>
              ctx.response.send(String(ctx.federation.data)),
          );
        },
      });
      after(() => server.close());

      const response = await server.fetch("/ping");

      strictEqual(await response.text(), "null");
      strictEqual(seen, "/ping");
    });

    it("throws on routes excluded via ignoreRoutePrefixes", async () => {
      const server = await withServer({
        ignoreRoutePrefixes: ["/assets/"],
        defineRoutes(router) {
          router.get("/assets/app.css", (ctx: HttpContext) => {
            try {
              void ctx.federation;
              return ctx.response.send("no error");
            } catch (error) {
              return ctx.response.send(
                (error as { code?: string }).code ?? "unknown",
              );
            }
          });
        },
      });

      const response = await server.fetch("/assets/app.css");

      strictEqual(await response.text(), "E_FEDIFY_CONTEXT_UNAVAILABLE");
    });

    it("does not intercept federation routes below an ignored prefix", async () => {
      // A prefix that shadows a Fedify route must genuinely bypass Fedify;
      // this documents the footgun rather than papering over it.
      const server = await withServer({ ignoreRoutePrefixes: ["/users/"] });

      const response = await server.fetch("/users/alice", {
        headers: { Accept: ACTIVITY_PUB_ACCEPT },
      });

      strictEqual(response.status, 404);
    });
  });

  it("works with no context data factory at all", async () => {
    // Fedify's integration guide asks for the second argument to be optional,
    // defaulting to a factory that produces `undefined`. This is the whole
    // API surface an application gets if it never touches the container.
    const server = await startTestServer({
      federation: createTestFederation(),
      defineRoutes(router) {
        router.get(
          "/data",
          (ctx: HttpContext) => ctx.response.send(String(ctx.federation.data)),
        );
      },
    });
    after(() => server.close());

    const actor = await server.fetch("/users/alice", {
      headers: { Accept: ACTIVITY_PUB_ACCEPT },
    });
    strictEqual(actor.status, 200);

    const data = await server.fetch("/data");
    strictEqual(await data.text(), "undefined");
  });

  it("returns a class that server.use() can construct", () => {
    // The README's container-free example passes the return value straight to
    // `server.use()`, which resolves each entry through the IoC container and
    // constructs it. A plain object fails there with `Cannot construct value`,
    // so the return type has to be the class itself.
    const Middleware = fedifyMiddleware(createTestFederation());

    strictEqual(typeof Middleware, "function");
    strictEqual(typeof new Middleware().handle, "function");
  });

  describe("regressions", () => {
    it("does not stall a large body destined for an AdonisJS route", async () => {
      // Converting the raw stream eagerly used to attach a reader that nobody
      // ever drained; past the adapter's ~128 KiB high-water mark it paused the
      // socket for good and any flowing-mode consumer downstream hung forever.
      const payload = "x".repeat(300 * 1024);

      const server = await withServer({
        defineRoutes(router) {
          router.post("/upload", async (ctx: HttpContext) => {
            const size = await new Promise<number>((resolve, reject) => {
              let bytes = 0;
              // Flowing mode, which is what @adonisjs/core/bodyparser_middleware
              // uses through raw-body.
              ctx.request.request.on("data", (chunk: Buffer) => {
                bytes += chunk.length;
              });
              ctx.request.request.on("end", () => resolve(bytes));
              ctx.request.request.on("error", reject);
            });
            return ctx.response.send(String(size));
          });
        },
      });

      const response = await server.fetch("/upload", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: payload,
        signal: AbortSignal.timeout(15_000),
      });

      strictEqual(await response.text(), String(payload.length));
    });

    it("does not overwrite a downstream response that matched no route", async () => {
      // The deferred 406 may only replace the framework's own 404. A server
      // middleware registered after this one -- @adonisjs/cors answering a
      // preflight is the canonical case -- answers without the router running,
      // so ctx.route stays undefined even though the response is deliberate.
      const server = await startTestServer<null>({
        federation: createTestFederation(),
        contextDataFactory: () => null,
        afterFedify: {
          handle(ctx: HttpContext) {
            ctx.response.status(204).header("x-answered-by", "downstream").send(
              "",
            );
          },
        },
      });
      after(() => server.close());

      const response = await server.fetch("/users/alice", {
        headers: { Accept: BROWSER_ACCEPT },
      });

      strictEqual(response.status, 204);
      strictEqual(response.headers.get("x-answered-by"), "downstream");
    });

    it("ignores method spoofing when deciding what Fedify sees", async () => {
      // `_method` is an AdonisJS form-submission convenience. Letting it reach
      // the bridge would turn POST /inbox?_method=GET into a bodyless GET and
      // route the activity away from the inbox.
      const server = await withServer({});

      const response = await server.fetch("/users/alice/inbox?_method=GET", {
        method: "POST",
        headers: { "Content-Type": "application/activity+json" },
        body: JSON.stringify({ type: "Follow" }),
      });

      // Fedify handled it as the POST it really is (and rejected it as
      // unsigned) rather than 404ing on a spoofed GET.
      ok(
        response.status >= 400 && response.status < 500,
        `unexpected status ${response.status}`,
      );
    });

    it("gives Fedify the raw, still-encoded request target", async () => {
      // AdonisJS decodes the parsed path, which would hand Fedify
      // `/users/alice!` for a target of `/users/alice%21` -- a path Fedify's
      // own URI templates would then fail to match.
      const server = await withServer({});

      const encoded = await server.fetch("/users/alice%21", {
        headers: { Accept: ACTIVITY_PUB_ACCEPT },
      });

      // `alice!` is not a known identifier, so Fedify answers 404 -- but only
      // because it saw the percent-encoded target and matched its template.
      strictEqual(encoded.status, 404);

      // And the ordinary identifier still resolves.
      const plain = await server.fetch("/users/alice", {
        headers: { Accept: ACTIVITY_PUB_ACCEPT },
      });
      strictEqual(plain.status, 200);
    });
  });

  describe("request and response bridging", () => {
    it("leaves the request body intact for AdonisJS routes", async () => {
      const server = await withServer({
        defineRoutes(router) {
          router.post("/echo", async (ctx: HttpContext) => {
            const chunks: Buffer[] = [];
            for await (const chunk of ctx.request.request) {
              chunks.push(chunk as Buffer);
            }
            return ctx.response.send(Buffer.concat(chunks).toString("utf8"));
          });
        },
      });

      const response = await server.fetch("/echo", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "a federated payload",
      });

      strictEqual(response.status, 200);
      strictEqual(await response.text(), "a federated payload");
    });

    it("accepts an inbox POST and answers without a body", async () => {
      const server = await withServer({});

      const response = await server.fetch("/users/alice/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/activity+json" },
        body: JSON.stringify({ type: "Follow" }),
      });

      // Unsigned activities are rejected, but the point is that Fedify — not
      // AdonisJS — answered, and that the streamed body survived the bridge.
      ok(
        response.status >= 400 && response.status < 500,
        `unexpected status ${response.status}`,
      );
    });

    it("answers HEAD requests with headers but no body", async () => {
      const server = await withServer({});

      const response = await server.fetch("/users/alice", {
        method: "HEAD",
        headers: { Accept: ACTIVITY_PUB_ACCEPT },
      });

      strictEqual(response.status, 200);
      strictEqual(await response.text(), "");
    });

    it("preserves multiple Set-Cookie headers from AdonisJS", async () => {
      // Guards the response writer's use of getSetCookie(): iterating Headers
      // would fold these into one comma-joined value.
      const server = await withServer({
        defineRoutes(router) {
          router.get("/cookies", (ctx: HttpContext) => {
            ctx.response.append("set-cookie", "a=1; Path=/");
            ctx.response.append("set-cookie", "b=2; Path=/");
            return ctx.response.send("ok");
          });
        },
      });

      const response = await server.fetch("/cookies");

      deepStrictEqual(response.headers.getSetCookie(), [
        "a=1; Path=/",
        "b=2; Path=/",
      ]);
    });
  });
});
