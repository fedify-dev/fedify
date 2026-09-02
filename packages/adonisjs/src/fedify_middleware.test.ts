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
  throws,
} from "node:assert/strict";
import { Readable } from "node:stream";
import { after, describe, it } from "node:test";

import type { HttpContext } from "@adonisjs/core/http";
import type { NextFn } from "@adonisjs/core/types/http";
import type { Federation } from "@fedify/fedify";

import { E_MISSING_FEDERATION } from "./errors.ts";
import FedifyMiddleware, { fedifyMiddleware } from "./fedify_middleware.ts";
import { installFederationGetter } from "./http_context.ts";
import {
  ACTIVITY_PUB_ACCEPT,
  BROWSER_ACCEPT,
  createTestFederation,
  type FederationServerOptions,
  fetchHttp2,
  fetchRaw,
  startTestServer,
  type TestServer,
  type TestServerMiddleware,
} from "./test_utils.ts";
import {
  WARNED_AUTHORITIES_LIMIT,
  WARNED_AUTHORITIES_WINDOW_MS,
} from "./unusable_authority.ts";

/**
 * Boots one server per test and tears it down afterwards.
 */
async function withServer(
  options:
    & Omit<
      FederationServerOptions<null>,
      "federation" | "contextDataFactory"
    >
    & {
      /** Defaults to {@link createTestFederation}. */
      federation?: Federation<null>;
      contextDataFactory?: () => null;
    },
): Promise<TestServer> {
  const server = await startTestServer<null>({
    federation: options.federation ?? createTestFederation(),
    contextDataFactory: options.contextDataFactory ?? (() => null),
    ignoreRoutePrefixes: options.ignoreRoutePrefixes,
    defineRoutes: options.defineRoutes,
    afterFedify: options.afterFedify,
    beforeFedify: options.beforeFedify,
    allowMethodSpoofing: options.allowMethodSpoofing,
    http2: options.http2,
  });
  after(() => server.close());
  return server;
}

/**
 * A `beforeFedify` middleware that records `ctx.logger.warn` calls, so a test
 * can assert on what the Fedify middleware logs.
 */
function captureWarnings(warnings: string[]): TestServerMiddleware {
  return {
    async handle(ctx: HttpContext, next: NextFn) {
      ctx.logger.warn = ((...args: unknown[]) => {
        warnings.push(String(args[0]));
      }) as typeof ctx.logger.warn;
      await next();
    },
  };
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

  it("keeps an upstream Vary on a Fedify-answered response", async () => {
    // Fedify's own responses carry `Vary: Accept`.  Copying that header onto
    // the AdonisJS response with `header()` would overwrite the `Vary: Origin`
    // an upstream cors middleware set, on the path every federated request
    // takes; it has to be merged there too.
    const server = await withServer({
      beforeFedify: {
        async handle(ctx: HttpContext, next: NextFn) {
          ctx.response.header("Vary", "Origin");
          await next();
        },
      },
    });

    const response = await server.fetch("/users/alice", {
      headers: { Accept: ACTIVITY_PUB_ACCEPT },
    });

    strictEqual(response.status, 200);
    strictEqual(response.headers.get("vary"), "Origin, Accept");
  });

  it("drops the discarded 404's headers from the 406", async () => {
    // A downstream 404 on a Fedify-owned path is replaced by the 406, and the
    // headers it set must not ride along: a `Cache-Control` from the discarded
    // page would decide how long a shared cache keeps the substituted
    // response.
    const server = await withServer({
      afterFedify: {
        handle(ctx: HttpContext) {
          ctx.response
            .status(404)
            .header("Cache-Control", "public, max-age=3600")
            .send("not here");
        },
      },
    });

    const response = await server.fetch("/users/alice", {
      headers: { Accept: BROWSER_ACCEPT },
    });

    strictEqual(response.status, 406);
    strictEqual(response.headers.get("cache-control"), null);
    strictEqual(response.headers.get("vary"), "Accept");
  });

  it("drops the discarded 404's CDN cache headers from the 406", async () => {
    // The targeted cache-control family is honoured by a CDN over
    // `Cache-Control`, and largely without regard to `Vary`, so one left over
    // from the discarded page would keep the 406 cached for ActivityPub
    // clients as well.
    const server = await withServer({
      afterFedify: {
        handle(ctx: HttpContext) {
          ctx.response
            .status(404)
            .header("Cache-Control", "no-store")
            .header("CDN-Cache-Control", "max-age=3600")
            .header("Cloudflare-CDN-Cache-Control", "max-age=3600")
            .header("Surrogate-Control", "max-age=3600")
            .send("not here");
        },
      },
    });

    const response = await server.fetch("/users/alice", {
      headers: { Accept: BROWSER_ACCEPT },
    });

    strictEqual(response.status, 406);
    strictEqual(response.headers.get("cache-control"), null);
    strictEqual(response.headers.get("cdn-cache-control"), null);
    strictEqual(response.headers.get("cloudflare-cdn-cache-control"), null);
    strictEqual(response.headers.get("surrogate-control"), null);
  });

  it("restores headers the discarded 404 overwrote on the 406", async () => {
    // The rollback must catch an overwrite, not only an addition: an upstream
    // `Cache-Control: no-store` replaced by the discarded page's cacheable
    // value would otherwise ride along on the 406, and a shared cache would
    // keep the substituted response.
    const server = await withServer({
      beforeFedify: {
        async handle(ctx: HttpContext, next: NextFn) {
          ctx.response.header("Cache-Control", "no-store");
          await next();
        },
      },
      afterFedify: {
        handle(ctx: HttpContext) {
          ctx.response
            .status(404)
            .header("Cache-Control", "public, max-age=3600")
            .send("not here");
        },
      },
    });

    const response = await server.fetch("/users/alice", {
      headers: { Accept: BROWSER_ACCEPT },
    });

    strictEqual(response.status, 406);
    strictEqual(response.headers.get("cache-control"), "no-store");
    strictEqual(response.headers.get("vary"), "Accept");
  });

  it("keeps an upstream Vary when the discarded 404 replaces it", async () => {
    // The rollback exempts `Vary` and merges the snapshot back in instead of
    // restoring it.  A downstream that *replaces* the header rather than
    // appending to it would otherwise drop the upstream `Origin`, and a
    // shared cache would serve one origin's response to another.
    const server = await withServer({
      beforeFedify: {
        async handle(ctx: HttpContext, next: NextFn) {
          ctx.response.header("Vary", "Origin");
          await next();
        },
      },
      afterFedify: {
        handle(ctx: HttpContext) {
          ctx.response
            .status(404)
            .header("Vary", "Accept-Encoding")
            .send("not here");
        },
      },
    });

    const response = await server.fetch("/users/alice", {
      headers: { Accept: BROWSER_ACCEPT },
    });

    strictEqual(response.status, 406);
    const vary = (response.headers.get("vary") ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase());
    ok(vary.includes("origin"), `Upstream Vary was dropped: ${vary}`);
    ok(vary.includes("accept"), `Accept was dropped: ${vary}`);
  });

  it("keeps CORS headers set during next() on the 406", async () => {
    // `configure.ts` registers this middleware first, so `@adonisjs/cors`
    // runs inside `next()`.  Wiping its headers would answer a cross-origin
    // request with a 406 carrying `Vary: Origin` and no matching
    // `Access-Control-Allow-Origin`, which the browser cannot read.
    const server = await withServer({
      afterFedify: {
        handle(ctx: HttpContext) {
          ctx.response
            .status(404)
            .header("Access-Control-Allow-Origin", "https://app.example")
            .header("Vary", "Origin")
            .send("not here");
        },
      },
    });

    const response = await server.fetch("/users/alice", {
      headers: { Accept: BROWSER_ACCEPT },
    });

    strictEqual(response.status, 406);
    strictEqual(
      response.headers.get("access-control-allow-origin"),
      "https://app.example",
    );
  });

  it("drops an empty-string header the discarded 404 set", async () => {
    // AdonisJS's `removeHeader()` only deletes the buffered entry when the
    // current value is truthy, so a header set to `""` would otherwise ride
    // along on the 406 and still be written out by `writeHead()`.
    const server = await withServer({
      afterFedify: {
        handle(ctx: HttpContext) {
          ctx.response
            .status(404)
            .header("Cache-Control", "")
            .send("not here");
        },
      },
    });

    const response = await server.fetch("/users/alice", {
      headers: { Accept: BROWSER_ACCEPT },
    });

    strictEqual(response.status, 406);
    strictEqual(response.headers.get("cache-control"), null);
  });

  it("keeps a header a later middleware appended on the 406", async () => {
    // `response.header()` replaces rather than merges, so restoring every
    // snapshot entry would cut a header a later middleware *appended to* back
    // to the value it had before `next()` -- dropping the session cookie the
    // request itself established.
    const server = await withServer({
      beforeFedify: {
        async handle(ctx: HttpContext, next: NextFn) {
          ctx.response.append("Set-Cookie", "first=1");
          await next();
        },
      },
      afterFedify: {
        handle(ctx: HttpContext) {
          ctx.response.append("Set-Cookie", "second=2");
          ctx.response.status(404).send("not here");
        },
      },
    });

    const response = await server.fetch("/users/alice", {
      headers: { Accept: BROWSER_ACCEPT },
    });

    strictEqual(response.status, 406);
    deepStrictEqual(response.headers.getSetCookie(), ["first=1", "second=2"]);
  });

  it("keeps a header a later middleware narrowed on the 406", async () => {
    // The other half of the same rule: `@adonisjs/cors` runs inside `next()`
    // and replaces a wildcard `Access-Control-Allow-Origin` with the request's
    // own origin.  Putting the snapshot's `*` back would answer a credentialed
    // cross-origin request with a value the browser refuses.
    const server = await withServer({
      beforeFedify: {
        async handle(ctx: HttpContext, next: NextFn) {
          ctx.response.header("Access-Control-Allow-Origin", "*");
          await next();
        },
      },
      afterFedify: {
        handle(ctx: HttpContext) {
          ctx.response
            .status(404)
            .header("Access-Control-Allow-Origin", "https://app.example")
            .send("not here");
        },
      },
    });

    const response = await server.fetch("/users/alice", {
      headers: { Accept: BROWSER_ACCEPT },
    });

    strictEqual(response.status, 406);
    strictEqual(
      response.headers.get("access-control-allow-origin"),
      "https://app.example",
    );
  });

  it("destroys a stream the discarded 404 left behind", async () => {
    // `send()` only sets the buffered content, and AdonisJS prefers content
    // over a stream, so a 404 page rendered with `stream()` would be silently
    // forgotten -- one leaked file descriptor per request on a Fedify-owned
    // path.
    const discarded = Readable.from(["not here"]);
    const server = await withServer({
      afterFedify: {
        handle(ctx: HttpContext) {
          ctx.response.status(404).stream(discarded);
        },
      },
    });

    const response = await server.fetch("/users/alice", {
      headers: { Accept: BROWSER_ACCEPT },
    });

    strictEqual(response.status, 406);
    strictEqual(await response.text(), "Not acceptable");
    strictEqual(discarded.destroyed, true);
  });

  it("throws E_MISSING_FEDERATION when constructed without a federation", () => {
    // The container zero-arg-constructs the class when the object the kernel
    // resolved is not the one the provider bound; the curated error beats a
    // `TypeError` on every request.
    throws(
      () => new (FedifyMiddleware as unknown as new () => unknown)(),
      (error: unknown) => error instanceof E_MISSING_FEDERATION,
    );
  });

  it("throws E_MISSING_FEDERATION when the factory gets no federation", () => {
    // The constructor guard would only fire on the first request, with a
    // message blaming the provider or a duplicated package copy; the factory
    // validates at call time and names the actual mistake, typically an
    // import from a module that default-exports nothing.
    throws(
      () =>
        fedifyMiddleware(
          undefined as unknown as Federation<null>,
          () => null,
        ),
      (error: unknown) =>
        error instanceof E_MISSING_FEDERATION &&
        error.message.includes("fedifyMiddleware()"),
    );
  });

  it("keeps a Vary set by upstream middleware in the 406", async () => {
    // An app can register `@adonisjs/cors` ahead of the Fedify middleware in
    // the server stack, and cors answers `Vary: Origin`.  The old overwrite
    // dropped it, letting a shared cache mix origins; merging keeps it.
    const server = await withServer({
      beforeFedify: {
        async handle(ctx: HttpContext, next: NextFn) {
          ctx.response.header("Vary", "Origin");
          await next();
        },
      },
    });

    const response = await server.fetch("/users/alice", {
      headers: { Accept: BROWSER_ACCEPT },
    });

    strictEqual(response.status, 406);
    strictEqual(response.headers.get("vary"), "Origin, Accept");
  });

  it("keeps Accept in the 406's Vary when downstream middleware replaces it", async () => {
    // A later middleware can replace `Vary` rather than append to it; a 406
    // cached without `Accept` could then reach an ActivityPub client.
    const server = await withServer({
      afterFedify: {
        async handle(ctx: HttpContext, next: NextFn) {
          ctx.response.header("Vary", "Origin");
          await next();
        },
      },
    });

    const response = await server.fetch("/users/alice", {
      headers: { Accept: BROWSER_ACCEPT },
    });

    strictEqual(response.status, 406);
    strictEqual(response.headers.get("vary"), "Origin, Accept");
  });

  it("keeps Accept in Vary when a matched route replaces it", async () => {
    // The delegated response wins on this path, so it never reaches the 406
    // branch.  Without the merge after `next()` the `Vary: Accept` set before
    // delegating is simply gone, and a cache keyed on `Origin` alone could hand
    // this HTML page to an ActivityPub client asking for the same URL.
    const server = await withServer({
      defineRoutes(router) {
        router.get(
          "/users/:identifier",
          ({ params, response }) =>
            response
              .header("Vary", "Origin")
              .header("content-type", "text/html")
              .send(`<h1>${params.identifier}</h1>`),
        );
      },
    });

    const response = await server.fetch("/users/alice", {
      headers: { Accept: BROWSER_ACCEPT },
    });

    strictEqual(response.status, 200);
    strictEqual(await response.text(), "<h1>alice</h1>");
    strictEqual(response.headers.get("vary"), "Origin, Accept");
  });

  it("keeps a Vary written through response.vary() during next() in the 406", async () => {
    // `ctx.response.vary()` writes to the Node response directly, while the
    // `Accept` buffered before `next()` lives in AdonisJS's own header map,
    // which `getHeader()` prefers and which overwrites the raw value when the
    // reply is written.  Reading the buffered layer alone lost `Origin` here.
    const server = await withServer({
      afterFedify: {
        handle(ctx: HttpContext) {
          ctx.response.vary("Origin");
          ctx.response.status(404).send("not here");
        },
      },
    });

    const response = await server.fetch("/users/alice", {
      headers: { Accept: BROWSER_ACCEPT },
    });

    strictEqual(response.status, 406);
    strictEqual(response.headers.get("vary"), "Accept, Origin");
  });

  it("keeps a Vary a matched route writes through response.vary()", async () => {
    // The delegated response wins here, and the same two-layer split applied:
    // the route's raw `Origin` was overwritten by the buffered `Accept`.
    const server = await withServer({
      defineRoutes(router) {
        router.get("/users/:identifier", (ctx: HttpContext) => {
          ctx.response.vary("Origin");
          return ctx.response.send("route");
        });
      },
    });

    const response = await server.fetch("/users/alice", {
      headers: { Accept: BROWSER_ACCEPT },
    });

    strictEqual(response.status, 200);
    strictEqual(response.headers.get("vary"), "Accept, Origin");
  });

  it("lets a Vary of * written through response.vary() win", async () => {
    // `*` on the raw layer has to beat the buffered list, or the buffered
    // value would overwrite it when the reply is written.
    const server = await withServer({
      afterFedify: {
        handle(ctx: HttpContext) {
          ctx.response.vary("*");
          ctx.response.status(404).send("not here");
        },
      },
    });

    const response = await server.fetch("/users/alice", {
      headers: { Accept: BROWSER_ACCEPT },
    });

    strictEqual(response.status, 406);
    strictEqual(response.headers.get("vary"), "*");
  });

  it("leaves a Vary of * alone", async () => {
    // `*` already defeats every cache hit; appending `Accept` to it would only
    // make the header less honest.
    const server = await withServer({
      defineRoutes(router) {
        router.get(
          "/users/:identifier",
          ({ response }) =>
            response
              .header("Vary", "*")
              .header("content-type", "text/html")
              .send("<h1>alice</h1>"),
        );
      },
    });

    const response = await server.fetch("/users/alice", {
      headers: { Accept: BROWSER_ACCEPT },
    });

    strictEqual(response.status, 200);
    strictEqual(response.headers.get("vary"), "*");
  });

  describe("forwarded host handling", () => {
    // The harness listens on loopback, which the default `trustProxy` accepts,
    // so `request.host()` returns `X-Forwarded-Host` verbatim.  Handing the
    // joined value to `new URL()` used to throw, answering 500.

    it("serves a federation request when X-Forwarded-Host carries a list", async () => {
      const server = await withServer({});

      const response = await server.fetch("/users/alice", {
        headers: {
          Accept: ACTIVITY_PUB_ACCEPT,
          "X-Forwarded-Host": "first.example.com, second.example.com",
        },
      });

      strictEqual(response.status, 200);
      const document = (await response.json()) as Record<string, unknown>;
      strictEqual(document.preferredUsername, "alice");
      // The first entry is the host the client used, as Express reads it; the
      // actor id proves it was kept rather than the fallback engaging.
      strictEqual(document.id, "http://first.example.com/users/alice");

      // Whitespace around the separator is trimmed too.
      const spaced = await server.fetch("/users/alice", {
        headers: {
          Accept: ACTIVITY_PUB_ACCEPT,
          "X-Forwarded-Host": "first.example.com ,second.example.com",
        },
      });
      strictEqual(spaced.status, 200);
      const spacedDocument = (await spaced.json()) as Record<string, unknown>;
      strictEqual(spacedDocument.id, "http://first.example.com/users/alice");
    });

    it("delegates to AdonisJS when X-Forwarded-Host carries a list", async () => {
      const server = await withServer({
        defineRoutes(router) {
          router.get(
            "/hello",
            ({ response }) => response.send("hello from adonis"),
          );
        },
      });

      const response = await server.fetch("/hello", {
        headers: {
          "X-Forwarded-Host": "first.example.com, second.example.com",
        },
      });

      strictEqual(response.status, 200);
      strictEqual(await response.text(), "hello from adonis");
    });

    it("leaves the Host header alone when a proxy rewrote it", async () => {
      // The URL follows the trusted forwarded authority; the header stays
      // the peer's.  Fedify's draft-cavage verifier reads `host` off the
      // headers, so a proxy that rewrites `Host` (nginx's `proxy_pass` default
      // sends the upstream's own name) has to preserve it instead, as the
      // README says: no string comparison can tell such a rewrite from a
      // proxy that merely normalised the peer's spelling, and replacing the
      // bytes the peer signed is the worse mistake.
      let seenHost: string | null | undefined;
      let seenUrl: URL | undefined;
      const server = await withServer({
        defineRoutes(router) {
          router.get("/users/:identifier", (ctx: HttpContext) => {
            seenHost = ctx.federation.request.headers.get("host");
            seenUrl = ctx.federation.url;
            return ctx.response.send("route");
          });
        },
      });

      const response = await fetchRaw(server, "/users/alice", {
        host: "internal.invalid:3333",
        headers: {
          Accept: BROWSER_ACCEPT,
          "X-Forwarded-Host": "public.example",
        },
      });

      strictEqual(response.status, 200);
      strictEqual(seenHost, "internal.invalid:3333");
      strictEqual(seenUrl?.host, "public.example");
    });

    it("hands Fedify the Host header verbatim", async () => {
      // A draft-cavage signature covers the bytes the peer sent, so the header
      // has to carry them.  `URL` normalises what it parses -- case-folded, a
      // default port dropped -- and building the header from `url.host` would
      // hand the verifier a value the signature was never computed over.
      let seenHost: string | null | undefined;
      let seenUrl: URL | undefined;
      const server = await withServer({
        defineRoutes(router) {
          router.get("/users/:identifier", (ctx: HttpContext) => {
            seenHost = ctx.federation.request.headers.get("host");
            seenUrl = ctx.federation.url;
            return ctx.response.send("route");
          });
        },
      });

      const response = await fetchRaw(server, "/users/alice", {
        host: "Example.COM:80",
        headers: { Accept: BROWSER_ACCEPT },
      });

      strictEqual(response.status, 200);
      strictEqual(seenHost, "Example.COM:80");
      // The URL is the normalised one, which is what it is for.
      strictEqual(seenUrl?.host, "example.com");
    });

    it("leaves the peer's Host alone when the forwarded authority is unusable", async () => {
      // The placeholder stands in for the authority in the URL only.  The
      // `Host` the peer actually sent is still the value it signed over, so a
      // draft-cavage signature can verify even while `@authority` cannot.
      let seenHost: string | null | undefined;
      let seenUrl: URL | undefined;
      const server = await withServer({
        defineRoutes(router) {
          router.get("/users/:identifier", (ctx: HttpContext) => {
            seenHost = ctx.federation.request.headers.get("host");
            seenUrl = ctx.federation.url;
            return ctx.response.send("route");
          });
        },
      });

      const response = await fetchRaw(server, "/users/alice", {
        host: "peer.example",
        headers: {
          Accept: BROWSER_ACCEPT,
          "X-Forwarded-Host": "not a valid host",
        },
      });

      strictEqual(response.status, 200);
      strictEqual(seenHost, "peer.example");
      strictEqual(seenUrl?.host, "localhost");
    });

    it("honours an uppercase X-Forwarded-Proto", async () => {
      // `protocol()` hands the token back exactly as it arrived, so comparing
      // it against "https" without folding the case reads `HTTPS` as plain
      // http -- and RFC 9421's `@scheme` and `@target-uri` are then verified
      // against a URL the peer never signed.
      const server = await withServer({});

      const response = await server.fetch("/users/alice", {
        headers: {
          Accept: ACTIVITY_PUB_ACCEPT,
          "X-Forwarded-Proto": "HTTPS",
        },
      });

      strictEqual(response.status, 200);
      const document = (await response.json()) as Record<string, unknown>;
      strictEqual(
        document.id,
        `https://${new URL(server.url).host}/users/alice`,
      );
    });

    it("refuses an X-Forwarded-Host that would shift the path", async () => {
      // `authority()` hands `X-Forwarded-Host` back verbatim, so `example.com/x`
      // would make Fedify see `/x/users/alice` while AdonisJS still routes the
      // real path — enough to walk past `ignoreRoutePrefixes`.  Such a value is
      // refused outright, so the fallback host keeps the path Fedify matches on
      // intact.
      const server = await withServer({});

      const response = await server.fetch("/users/alice", {
        headers: {
          Accept: ACTIVITY_PUB_ACCEPT,
          "X-Forwarded-Host": "example.com/x",
        },
      });

      strictEqual(response.status, 200);
      const document = (await response.json()) as Record<string, unknown>;
      strictEqual(document.preferredUsername, "alice");
      strictEqual(document.id, "http://localhost/users/alice");
    });

    it("falls back rather than failing on an unparseable X-Forwarded-Host", async () => {
      // No comma to split on, so only the fallback can rescue this one.
      const server = await withServer({});

      const response = await server.fetch("/users/alice", {
        headers: {
          Accept: ACTIVITY_PUB_ACCEPT,
          "X-Forwarded-Host": "not a valid host",
        },
      });

      strictEqual(response.status, 200);
      const document = (await response.json()) as Record<string, unknown>;
      strictEqual(document.preferredUsername, "alice");
    });

    it("warns once per distinct unusable authority", async () => {
      // Any client can trigger the fallback by putting an unusable value in
      // `Host`, no proxy involved, so the warning must not scale with request
      // volume: one line per distinct value, not one per request.
      const warnings: string[] = [];
      const server = await withServer({
        beforeFedify: captureWarnings(warnings),
      });

      for (let i = 0; i < 3; i++) {
        const response = await server.fetch("/users/alice", {
          headers: {
            Accept: ACTIVITY_PUB_ACCEPT,
            "X-Forwarded-Host": "spam value one",
          },
        });
        strictEqual(response.status, 200);
      }

      strictEqual(warnings.length, 1);
      match(warnings[0] ?? "", /Unusable request authority/);
    });

    it("starts the warning budget over once the window has elapsed", async (t) => {
      // The cap keeps a client from flooding the log, but the values that
      // spend it are the client's to choose: were it spent for the life of the
      // process, sixteen junk values would silence the warning for good, and a
      // proxy misconfigured afterwards -- every request falling back to the
      // placeholder, every signature over `@authority` failing -- would never
      // be reported.
      const warnings: string[] = [];
      const server = await withServer({
        beforeFedify: captureWarnings(warnings),
      });

      const spam = async (value: string) => {
        const response = await server.fetch("/users/alice", {
          headers: {
            Accept: ACTIVITY_PUB_ACCEPT,
            "X-Forwarded-Host": value,
          },
        });
        strictEqual(response.status, 200);
      };

      // Only `Date`, so the server's own timers still run on real time; the
      // runner restores the clock when the test ends.
      t.mock.timers.enable({ apis: ["Date"], now: Date.now() });

      // Whatever earlier tests spent, the elapsed window starts a fresh one.
      t.mock.timers.tick(WARNED_AUTHORITIES_WINDOW_MS);

      for (let i = 0; i < WARNED_AUTHORITIES_LIMIT; i++) {
        await spam(`spam budget ${i}`);
      }
      strictEqual(warnings.length, WARNED_AUTHORITIES_LIMIT);

      // Past the cap: the first extra value says the warning has stopped, and
      // later ones say nothing at all.
      await spam("spam budget over");
      await spam("spam budget over again");
      strictEqual(warnings.length, WARNED_AUTHORITIES_LIMIT + 1);
      match(
        warnings[WARNED_AUTHORITIES_LIMIT] ?? "",
        /Reached %d distinct unusable/,
      );

      // A new window, and the misconfiguration behind it is reported again.
      t.mock.timers.tick(WARNED_AUTHORITIES_WINDOW_MS);
      await spam("spam after the window");
      strictEqual(warnings.length, WARNED_AUTHORITIES_LIMIT + 2);
      match(
        warnings[WARNED_AUTHORITIES_LIMIT + 1] ?? "",
        /Unusable request authority/,
      );
    });

    it("does not warn on a path opted out via ignoreRoutePrefixes", async () => {
      // Fedify never sees the URL on an ignored path, so the placeholder is
      // harmless there; warning would hand any client a log line on paths the
      // operator excluded on purpose.
      const warnings: string[] = [];
      const server = await withServer({
        ignoreRoutePrefixes: ["/assets/"],
        beforeFedify: captureWarnings(warnings),
        defineRoutes(router) {
          router.get(
            "/assets/app.css",
            ({ response }) => response.send("body {}"),
          );
        },
      });

      const response = await server.fetch("/assets/app.css", {
        headers: { "X-Forwarded-Host": "spam value two" },
      });

      strictEqual(response.status, 200);
      deepStrictEqual(warnings, []);
    });
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

    it("matches ignoreRoutePrefixes against the raw request target", async () => {
      // `ctx.request.url()` decodes the parsed path, so `/%61ssets/app.css`
      // would read as `/assets/app.css` and bypass Fedify -- while
      // `toFetchRequest` hands Fedify the encoded form, which is what its
      // router matches.  Both decisions have to read the same value, so the
      // prefix is compared against the raw target and this request is *not*
      // excluded.
      const server = await withServer({
        ignoreRoutePrefixes: ["/assets/"],
        defineRoutes(router) {
          router.get("/assets/app.css", (ctx: HttpContext) => {
            try {
              void ctx.federation;
              return ctx.response.send("context available");
            } catch (error) {
              return ctx.response.send(
                (error as { code?: string }).code ?? "unknown",
              );
            }
          });
        },
      });

      const response = await server.fetch("/%61ssets/app.css");

      strictEqual(await response.text(), "context available");
    });

    it("matches ignoreRoutePrefixes against an absolute-form target", async () => {
      // RFC 9112 lets a client write the whole URL as the request target
      // (`GET http://example.com/users/alice HTTP/1.1`), and Node reports it in
      // `req.url` exactly as it arrived.  Fedify is handed a parsed URL either
      // way, so comparing the prefix against the unparsed target would leave the
      // opt-out silently inapplicable to such a request -- and Fedify would
      // answer for a path the application excluded.
      const server = await withServer({ ignoreRoutePrefixes: ["/users/"] });

      const { status } = await fetchRaw(
        server,
        `${server.url}/users/alice`,
        { headers: { Accept: ACTIVITY_PUB_ACCEPT } },
      );

      // AdonisJS does not normalise the absolute form for its own router
      // either, so nothing matches and the request ends as a 404 -- which is
      // the point: Fedify did not serve the excluded path.
      strictEqual(status, 404);
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

    it("is created once per request", async () => {
      // The getter is a Macroable singleton getter: the first access creates
      // the `RequestContext`, later ones return it.  Losing the `singleton`
      // flag would have every access build a fresh context.
      const federation = createTestFederation();
      const createContext = federation.createContext as (
        ...args: unknown[]
      ) => unknown;
      let created = 0;
      federation.createContext = function (
        this: Federation<null>,
        ...args: unknown[]
      ) {
        created++;
        return createContext.apply(this, args);
      } as unknown as typeof federation.createContext;

      const server = await withServer({
        federation,
        defineRoutes(router) {
          router.get("/same", (ctx: HttpContext) => {
            const first = ctx.federation;
            const second = ctx.federation;
            ctx.response.send(String(first === second));
          });
        },
      });

      const response = await server.fetch("/same");

      strictEqual(await response.text(), "true");
      strictEqual(created, 1);
    });

    it("throws when the middleware did not run for the request", async () => {
      // The getter exists process-wide once anything installed it, but a
      // request the Fedify middleware never saw has no context to hand out.
      // That is distinct from the ignore-prefix case above, where the
      // middleware itself records that the request was skipped.
      installFederationGetter();
      const server = await startTestServer({
        middleware: {
          handle(ctx: HttpContext) {
            try {
              void ctx.federation;
              ctx.response.send("available");
            } catch (error) {
              ctx.response.send((error as { code?: string }).code ?? "unknown");
            }
          },
        },
      });
      after(() => server.close());

      const response = await server.fetch("/anything");

      strictEqual(await response.text(), "E_FEDIFY_CONTEXT_UNAVAILABLE");
    });

    it("rejects assignment, before and after the first access", async () => {
      // A getter without a setter on the prototype, then a read-only own
      // property once memoised: either way, code that tries to replace
      // `ctx.federation` finds out immediately.
      const server = await withServer({
        defineRoutes(router) {
          router.get("/assign", (ctx: HttpContext) => {
            const attempt = () => {
              try {
                (ctx as { federation: unknown }).federation = null;
                return "assigned";
              } catch (error) {
                return (error as Error).constructor.name;
              }
            };
            const before = attempt();
            void ctx.federation;
            const afterwards = attempt();
            ctx.response.send(`${before},${afterwards}`);
          });
        },
      });

      const response = await server.fetch("/assign");

      strictEqual(await response.text(), "TypeError,TypeError");
    });
  });

  it("works with no context data factory at all", async () => {
    // Fedify's integration guide asks for the second argument to be optional,
    // defaulting to a factory that produces `undefined`. This is the whole
    // API surface an application gets if it never touches the container --
    // available exactly when the federation's context data admits
    // `undefined`, which is what the type parameter here says.
    const server = await startTestServer<undefined>({
      federation: createTestFederation<undefined>(),
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
    const Middleware = fedifyMiddleware(createTestFederation(), () => null);

    strictEqual(typeof Middleware, "function");
    strictEqual(typeof new Middleware().handle, "function");
    // Named, so that container and tracing diagnostics can say what failed.
    strictEqual(Middleware.name, "ConfiguredFedifyMiddleware");

    // The factory is only optional when omitting it is sound: the default
    // produces `undefined`, which a `Federation<null>` does not admit.
    // @ts-expect-error -- the context-data factory is required here.
    void fedifyMiddleware(createTestFederation());
    // The factory only closes over the arguments; the class is the same one
    // the service provider constructs.
    ok(new Middleware() instanceof FedifyMiddleware);
  });

  it("serves a federation request through the class form", async () => {
    // The service provider constructs `FedifyMiddleware` itself, so the
    // constructor has to accept exactly what the factory closes over.
    const server = await startTestServer({
      middleware: new FedifyMiddleware<null>(
        createTestFederation(),
        () => null,
      ),
    });
    after(() => server.close());

    const response = await server.fetch("/users/alice", {
      headers: { Accept: ACTIVITY_PUB_ACCEPT },
    });

    strictEqual(response.status, 200);
    const document = (await response.json()) as Record<string, unknown>;
    strictEqual(document.preferredUsername, "alice");
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
      const server = await withServer({
        afterFedify: {
          handle(ctx: HttpContext) {
            ctx.response.status(204).header("x-answered-by", "downstream").send(
              "",
            );
          },
        },
      });

      const response = await server.fetch("/users/alice", {
        headers: { Accept: BROWSER_ACCEPT },
      });

      strictEqual(response.status, 204);
      strictEqual(response.headers.get("x-answered-by"), "downstream");
    });

    it("ignores method spoofing when deciding what Fedify sees", async () => {
      // `_method` is an AdonisJS form-submission convenience. Letting it reach
      // the bridge would turn POST /inbox?_method=GET into a bodyless GET and
      // route the activity away from the inbox.  Spoofing is off by default in
      // AdonisJS, so it has to be switched on for this to test anything.
      const server = await withServer({ allowMethodSpoofing: true });

      const response = await server.fetch("/users/alice/inbox?_method=GET", {
        method: "POST",
        headers: { "Content-Type": "application/activity+json" },
        body: JSON.stringify({ type: "Follow" }),
      });

      // Fedify handled it as the POST it really is and rejected the body as
      // an invalid, unsigned activity.  Had the spoofed GET reached it, the
      // inbox path would have been answered 406 instead: a GET without an
      // ActivityPub `Accept` header.
      strictEqual(response.status, 400);
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

  describe("hostile or unusual request lines", () => {
    it("survives a Host header carrying credentials", async () => {
      // `new Request()` refuses URLs with userinfo, so the authority a peer
      // sends must not reach it verbatim; nothing about the request is
      // otherwise wrong, and the ordinary route still answers.
      const server = await withServer({
        defineRoutes(router) {
          router.get("/hello", ({ response }) => response.send("hi"));
        },
      });

      const response = await fetchRaw(server, "/hello", {
        host: "a:b@evil.example",
      });

      strictEqual(response.status, 200);
      ok(response.raw.endsWith("hi"));
    });

    it("refuses an authority carrying userinfo", async () => {
      // `Host` admits only `uri-host [":" port]`, and `good.example@evil.com`
      // parses to the host `evil.com` — an operator reading the raw header
      // would not see which host Fedify actually used.  The value is refused
      // like any other unusable authority, so the placeholder stands in and
      // the path survives.
      const server = await withServer({});

      const response = await fetchRaw(server, "/users/alice", {
        host: "good.example@evil.example",
        headers: { Accept: ACTIVITY_PUB_ACCEPT },
      });

      strictEqual(response.status, 200);
      ok(
        !response.raw.includes("evil.example"),
        `Fedify trusted the userinfo authority: ${response.raw.slice(-300)}`,
      );
      ok(
        response.raw.includes('"http://localhost/users/alice"'),
        `Expected the placeholder host: ${response.raw.slice(-300)}`,
      );
    });

    it("survives a malformed X-Forwarded-Proto", async () => {
      // The harness trusts loopback, so the header is honoured; `foo bar` is
      // no URL scheme, and the fallback must not throw either.
      const server = await withServer({
        defineRoutes(router) {
          router.get("/hello", ({ response }) => response.send("hi"));
        },
      });

      const response = await server.fetch("/hello", {
        headers: { "X-Forwarded-Proto": "foo bar" },
      });

      strictEqual(response.status, 200);
      strictEqual(await response.text(), "hi");
    });

    it("refuses an absolute-form target's authority", async () => {
      // RFC 9112 lets a request line carry an absolute target, and Node keeps
      // it in `req.url` verbatim.  Resolving it against the request's own
      // authority would discard that authority, letting the client pick the
      // host and scheme Fedify mints and verifies against -- so an inbox POST
      // signed for another server would verify here.  Only the path survives.
      const server = await withServer({});

      const response = await fetchRaw(
        server,
        "https://evil.example/users/alice",
        { headers: { Accept: ACTIVITY_PUB_ACCEPT } },
      );

      strictEqual(response.status, 200);
      ok(
        !response.raw.includes("evil.example"),
        `Fedify trusted the request line's authority: ${
          response.raw.slice(-300)
        }`,
      );
      ok(
        response.raw.includes(`"${server.url}/users/alice"`),
        `Expected the Host authority: ${response.raw.slice(-300)}`,
      );
    });

    it("keeps an absolute-form target's path and query", async () => {
      // Dropping the authority must not take the path with it: the request is
      // still the one it addresses, and `ignoreRoutePrefixes` is matched
      // against exactly this path.
      let seen: URL | undefined;
      const server = await withServer({
        afterFedify: {
          handle(ctx: HttpContext) {
            seen = ctx.federation.url;
            ctx.response.send("downstream");
          },
        },
      });

      const response = await fetchRaw(
        server,
        "http://evil.example/hello?who=alice",
      );

      strictEqual(response.status, 200);
      ok(seen);
      strictEqual(seen.host, new URL(server.url).host);
      strictEqual(seen.pathname, "/hello");
      strictEqual(seen.search, "?who=alice");
    });

    it("keeps the path of an absolute-form target URL cannot parse", async () => {
      // The authority is cut off textually rather than parsed away: a target
      // `new URL()` refuses -- a port out of range here, but a scheme a naive
      // proxy passed through as well -- would otherwise collapse to `/`,
      // taking the real path away from `ignoreRoutePrefixes` and from
      // `ctx.federation.url` while the AdonisJS router still sees it.
      let seen: URL | undefined;
      const server = await withServer({
        afterFedify: {
          handle(ctx: HttpContext) {
            seen = ctx.federation.url;
            ctx.response.send("downstream");
          },
        },
      });

      const response = await fetchRaw(
        server,
        "http://evil.example:99999/hello?who=alice",
      );

      strictEqual(response.status, 200);
      ok(seen);
      strictEqual(seen.host, new URL(server.url).host);
      strictEqual(seen.pathname, "/hello");
      strictEqual(seen.search, "?who=alice");
    });

    it("keeps a double-slash target's authority and path intact", async () => {
      // Resolving `//users/alice` against a base URL would read it as a
      // network-path reference -- host `users`, path `/alice` -- while the
      // AdonisJS router sees the target as sent.  Fedify has to see it the
      // same way.
      let seen: URL | undefined;
      const server = await withServer({
        afterFedify: {
          handle(ctx: HttpContext) {
            seen = ctx.federation.url;
            ctx.response.send("downstream");
          },
        },
      });

      const response = await fetchRaw(server, "//users/alice", {
        headers: { Accept: ACTIVITY_PUB_ACCEPT },
      });

      strictEqual(response.status, 200);
      ok(seen);
      strictEqual(seen.host, new URL(server.url).host);
      strictEqual(seen.pathname, "//users/alice");
    });

    it("keeps the path intact when the request carries no Host header", async () => {
      // With no authority to interpolate, `new URL("http:///users/alice")`
      // reads `users` as the host and hands on `/alice` rather than throwing,
      // so every path would silently shift by one segment and Fedify would
      // stop recognising its own routes.
      const server = await withServer({
        defineRoutes(router) {
          router.get(
            "/users/:identifier",
            ({ response }) => response.send("route"),
          );
        },
      });

      const response = await fetchRaw(server, "/users/alice", {
        host: "",
        headers: { Accept: ACTIVITY_PUB_ACCEPT },
      });

      strictEqual(response.status, 200);
      ok(
        response.raw.includes('"preferredUsername"'),
        `Fedify did not serve the actor: ${response.raw.slice(-200)}`,
      );
    });

    it("does not forward inherited object properties as headers", async () => {
      // `request.headers()` inherits from `Object.prototype`, so walking it
      // with `for...in` would hand Fedify whatever anything else has put
      // there -- and a key that is not a valid HTTP token would make
      // `Headers.append()` throw, failing every request.
      const federation = createTestFederation();
      const fetch = federation.fetch.bind(federation);
      let seen: string[] = [];
      federation.fetch = ((request: Request, options: never) => {
        seen = [...request.headers.keys()];
        return fetch(request, options);
      }) as typeof federation.fetch;

      const server = await withServer({
        federation,
        defineRoutes(router) {
          router.get("/hello", ({ response }) => response.send("hi"));
        },
      });

      // A plain route rather than the actor document: serialising JSON-LD
      // walks objects with `for...in` of its own and fails on a polluted
      // prototype, which is not what this test is about.
      Object.defineProperty(Object.prototype, "x-polluted", {
        value: "yes",
        enumerable: true,
        configurable: true,
        writable: true,
      });
      try {
        const response = await server.fetch("/hello");

        strictEqual(response.status, 200);
        strictEqual(await response.text(), "hi");
        ok(!seen.includes("x-polluted"), `leaked headers: ${seen.join(", ")}`);
      } finally {
        Reflect.deleteProperty(Object.prototype, "x-polluted");
      }
    });

    it("survives a downstream status Response cannot represent", async () => {
      // `new Response(null, { status })` refuses anything outside 200-599,
      // and AdonisJS hands out both 1xx interim statuses and non-standard
      // ones.  Reporting the status to Fedify must not turn a response
      // AdonisJS already produced into a 500.
      const server = await withServer({
        defineRoutes(router) {
          router.get(
            "/odd",
            ({ response }) => response.status(700).send("odd"),
          );
        },
      });

      const response = await fetchRaw(server, "/odd");

      strictEqual(response.status, 700);
      ok(response.raw.endsWith("odd"), response.raw.slice(-120));
    });

    it("reports AdonisJS's real status to Fedify for delegated requests", async () => {
      // Fedify logs each request and records metrics from the `Response` the
      // fall-through callbacks return.  A placeholder 404 or 406 there would
      // have every page AdonisJS served show up as a failed request.
      const federation = createTestFederation();
      const fetch = federation.fetch.bind(federation);
      const reported: number[] = [];
      federation.fetch = ((request, options) =>
        fetch(request, {
          ...options,
          onNotFound: async (r) => {
            const response = await options.onNotFound!(r);
            reported.push(response.status);
            return response;
          },
          onNotAcceptable: async (r) => {
            const response = await options.onNotAcceptable!(r);
            reported.push(response.status);
            return response;
          },
        })) as typeof federation.fetch;

      const server = await withServer({
        federation,
        defineRoutes(router) {
          router.get("/hello", ({ response }) => response.send("hi"));
          // Only alice has a page, so /users/bob reaches the 406 branch.
          router.get(
            "/users/alice",
            ({ response }) => response.send("<p>profile</p>"),
          );
        },
      });

      // Delegated because Fedify has no route: AdonisJS answered 200.
      await server.fetch("/hello");
      // Delegated because the client wants HTML: AdonisJS answered 200.
      await server.fetch("/users/alice", {
        headers: { Accept: BROWSER_ACCEPT },
      });
      // Fedify owns the path, AdonisJS had no page: the client gets the
      // generated 406, so that is what the log has to say -- not the empty
      // 404 AdonisJS produced along the way.
      const notAcceptable = await server.fetch("/users/bob", {
        headers: { Accept: BROWSER_ACCEPT },
      });
      strictEqual(notAcceptable.status, 406);
      // Delegated, and AdonisJS had nothing either: a real 404.
      await server.fetch("/nowhere");

      deepStrictEqual(reported, [200, 200, 406, 404]);
    });
  });

  describe("HTTP/2", () => {
    it("reads the authority from the :authority pseudo-header", async () => {
      // An HTTP/2 request carries no `Host` header at all -- the authority
      // travels in a pseudo-header -- so a URL built only from `host()` would
      // have an empty authority on every request, and every federation path
      // would shift by a segment.
      const server = await withServer({
        http2: true,
        defineRoutes(router) {
          router.get(
            "/users/:identifier",
            ({ response }) => response.send("route"),
          );
        },
      });

      const actor = await fetchHttp2(server, "/users/alice", {
        accept: ACTIVITY_PUB_ACCEPT,
      });

      strictEqual(actor.status, 200);
      const document = JSON.parse(actor.body) as Record<string, unknown>;
      strictEqual(document.preferredUsername, "alice");

      // ...and the HTML half of the same URL still reaches AdonisJS.
      const page = await fetchHttp2(server, "/users/alice", {
        accept: BROWSER_ACCEPT,
      });

      strictEqual(page.status, 200);
      strictEqual(page.body, "route");
    });

    it("gives Fedify a Host header built from the authority", async () => {
      // HTTP/2 replaced `Host` with `:authority`, and the pseudo-headers are
      // skipped when the headers are copied across, so without synthesising
      // one the `Request` Fedify sees carries no `host` at all.  RFC 9421
      // signature verification reads that header straight off the request, so
      // an inbox delivery through an HTTP/2 reverse proxy whose
      // `Signature-Input` covers `host` -- the usual case -- would fail with
      // `Missing header: host`.
      let seen: string | null | undefined;
      const server = await withServer({
        http2: true,
        defineRoutes(router) {
          router.get("/users/:identifier", (ctx) => {
            seen = ctx.federation.request.headers.get("host");
            return ctx.response.send("route");
          });
        },
      });

      const page = await fetchHttp2(server, "/users/alice", {
        accept: BROWSER_ACCEPT,
      });

      strictEqual(page.status, 200);
      strictEqual(seen, new URL(server.url).host);
    });
  });

  describe("request and response bridging", () => {
    it("survives a discarded stream whose cancel() throws", async () => {
      // `cancel()` on a WHATWG stream rejects when the source's cleanup
      // throws; left unhandled, that rejection ends the process under Node's
      // default `--unhandled-rejections=throw`.
      const rejections: unknown[] = [];
      const record = (reason: unknown) => void rejections.push(reason);
      process.on("unhandledRejection", record);
      after(() => process.off("unhandledRejection", record));

      const server = await withServer({
        afterFedify: {
          handle(ctx: HttpContext) {
            ctx.response.status(404).stream(
              new ReadableStream({
                cancel() {
                  throw new Error("cleanup failed");
                },
              }),
            );
          },
        },
      });

      const response = await server.fetch("/users/alice", {
        headers: { Accept: BROWSER_ACCEPT },
      });

      strictEqual(response.status, 406);
      // Let a rejection that escaped reach the process before asserting.
      await new Promise((resolve) => setImmediate(resolve));
      deepStrictEqual(rejections, []);
    });

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

    it("delegates TRACE, which no Request can be built from", async () => {
      // Building a `Request` from a forbidden method throws before `next()`
      // runs, turning a request AdonisJS can answer into a 500.
      const server = await withServer({
        defineRoutes(router) {
          router.route(
            "/ping",
            ["TRACE"],
            (ctx: HttpContext) => ctx.response.send("route ran"),
          );
        },
      });

      const { status, raw } = await fetchRaw(server, "/ping", {
        method: "TRACE",
      });

      strictEqual(status, 200);
      ok(raw.endsWith("route ran"));
    });

    it("preserves multiple Set-Cookie headers from a Fedify response", async () => {
      // Guards the response writer's use of getSetCookie(): iterating Headers
      // would fold these into one comma-joined value.  Fedify has to be the one
      // answering, because a delegated response never reaches the writer -- so
      // this stands in for a federation whose handler sets cookies.
      const headers = new Headers({ "content-type": "text/plain" });
      headers.append("set-cookie", "a=1; Path=/");
      headers.append("set-cookie", "b=2; Path=/");

      const server = await withServer({
        federation: {
          fetch: () => Promise.resolve(new Response("ok", { headers })),
        } as unknown as Federation<null>,
      });

      const response = await server.fetch("/anywhere");

      deepStrictEqual(response.headers.getSetCookie(), [
        "a=1; Path=/",
        "b=2; Path=/",
      ]);
      strictEqual(await response.text(), "ok");
    });

    it("leaves Set-Cookie headers from a delegated AdonisJS route alone", async () => {
      // The counterpart of the test above: Fedify declines, AdonisJS answers,
      // and the middleware must not touch the response it produced.
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
