/**
 * The AdonisJS server middleware that mounts Fedify.
 *
 * The service provider binds {@link FedifyMiddleware} with the `Federation`
 * and `config/fedify.ts`; applications that build their own `Federation` use
 * {@link fedifyMiddleware} instead.  Nothing here depends on the container.
 *
 * @module
 */
import { Readable } from "node:stream";

import type { HttpContext } from "@adonisjs/core/http";
import type { NextFn } from "@adonisjs/core/types/http";
import type { Federation } from "@fedify/fedify";

import {
  E_FEDIFY_CONTEXT_UNAVAILABLE,
  E_MISSING_FEDERATION,
} from "./errors.ts";
import {
  ensureFederationGetter,
  type HttpContextClass,
  setFederationContextFactory,
} from "./http_context.ts";
import type { ContextData, ContextDataFactory } from "./types.ts";
import {
  PLACEHOLDER_HOST,
  warnUnusableAuthority,
} from "./unusable_authority.ts";

/**
 * Options accepted by {@link FedifyMiddleware} and {@link fedifyMiddleware}.
 */
export interface FedifyMiddlewareOptions {
  /**
   * URL path prefixes to bypass entirely.  See
   * {@link import('./types.js').FedifyConfig.ignoreRoutePrefixes}.
   *
   * @default `[]`
   */
  ignoreRoutePrefixes?: string[];
}

/**
 * The instance shape of the middleware.
 */
export interface FedifyMiddlewareHandler {
  handle(ctx: HttpContext, next: NextFn): Promise<void>;
}

/**
 * What {@link fedifyMiddleware} returns: a middleware **class**, since
 * `server.use()` constructs entries through the container.
 */
export type FedifyMiddlewareClass = new () => FedifyMiddlewareHandler;

/**
 * The arguments after `federation`.  The factory defaults to producing
 * `undefined`, so it may only be omitted when `TContextData` admits it;
 * otherwise omitting it is a compile error.  The tuple wrapper keeps the
 * conditional from distributing over a union.
 */
export type FedifyMiddlewareArgs<TContextData> = [undefined] extends
  [TContextData] ? [
    contextDataFactory?: ContextDataFactory<TContextData>,
    options?: FedifyMiddlewareOptions,
  ]
  : [
    contextDataFactory: ContextDataFactory<TContextData>,
    options?: FedifyMiddlewareOptions,
  ];

/**
 * Context classes whose conflicting `federation` member was already reported.
 */
const conflicting = new WeakSet<object>();

/**
 * Methods `new Request()` refuses; in practice only `TRACE` arrives here.
 */
const FORBIDDEN_METHODS = new Set(["CONNECT", "TRACE", "TRACK"]);

/**
 * Wraps the raw `IncomingMessage` in a `ReadableStream` that stays inert until
 * first read.  The `Request` is built before Fedify decides whether it handles
 * the request; an eager `Readable.toWeb()` would start draining the socket and
 * hang the AdonisJS body parser on every declined `POST`.
 */
function lazyRequestBody(
  message: HttpContext["request"]["request"],
): ReadableStream<Uint8Array> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        reader ??= (Readable.toWeb(message) as ReadableStream<Uint8Array>)
          .getReader();

        const { done, value } = await reader.read();
        if (done) controller.close();
        else controller.enqueue(value);
      },
      cancel(reason) {
        return reader?.cancel(reason);
      },
    },
    { highWaterMark: 0 },
  );
}

/**
 * What an authority may not contain: `Host` admits only `uri-host [":" port]`,
 * so anything that could carry a path, query, fragment or userinfo makes the
 * value something other than an authority.
 */
const NON_AUTHORITY = /[/?#\\@\s]/;

/**
 * Keeps the first entry of a comma-separated authority (`X-Forwarded-Host`
 * behind two proxies), which `new URL()` would reject.
 *
 * Under `trustProxy`, `authority()` returns `X-Forwarded-Host` verbatim, so a
 * client could send `example.com/x` and shift the path Fedify sees to
 * `/x/users/alice` while AdonisJS still routes the real path — bypassing
 * `ignoreRoutePrefixes`.  Anything that could carry a path, query, fragment or
 * userinfo (`good.example@evil.com` parses to the host `evil.com`) is
 * therefore refused outright, which leaves the {@link PLACEHOLDER_HOST}
 * fallback to keep the path intact.
 */
function normalizeAuthority(host: string): string {
  const comma = host.indexOf(",");
  const authority = (comma < 0 ? host : host.slice(0, comma)).trim();
  return NON_AUTHORITY.test(authority) ? "" : authority;
}

/**
 * Reduces a request target to origin form, or `undefined` when it carries no
 * path.  An absolute target (`GET http://example.com/users/alice HTTP/1.1`)
 * reaches `req.url` verbatim; only its path and query survive, so the request
 * line cannot pick the host Fedify sees and let an inbox `POST` signed for
 * another server verify here.
 */
function toOriginForm(target: string): string | undefined {
  // Origin form already.  It is interpolated, not resolved, so `//users/alice`
  // keeps its path instead of reading `users` as a host.
  if (target.startsWith("/")) return target;

  // Textually rather than through `new URL()`, which would hand back the
  // *normalised* path or, for a target it refuses, nothing at all --
  // collapsing the request to `/` and hiding the real path from
  // `ignoreRoutePrefixes` and `ctx.federation`.
  const prefix = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#]*/.exec(target);
  // Asterisk form (`OPTIONS *`) or malformed.  Authority form reaches only
  // `CONNECT`, which {@link FORBIDDEN_METHODS} refuses.
  if (prefix === null) return undefined;

  const rest = target.slice(prefix[0].length);
  return rest.startsWith("/") ? rest : `/${rest}`;
}

/**
 * Builds the URL for one authority, or `undefined` if it cannot carry one.
 * The target is interpolated, never resolved, so the authority stays the one
 * {@link normalizeAuthority} passed; an empty one is refused because
 * `new URL("http:///users/alice")` silently takes `users` as the host.
 */
function buildRequestUrl(
  protocol: string,
  authority: string,
  target: string,
): URL | undefined {
  if (authority === "") return undefined;

  try {
    return new URL(`${protocol}://${authority}${target}`);
  } catch {
    return undefined;
  }
}

/**
 * Builds the URL Fedify sees from the raw request target, keeping the
 * percent-encoding Fedify's URI templates expect and the bytes a peer signed.
 * Only the target's path and query are read (see {@link toOriginForm}); the
 * authority comes from {@link normalizeAuthority}, via `authority()` so
 * HTTP/2's `:authority` is covered.  Every input is attacker-controlled, so
 * the result only has to exist: the scheme is reduced to `http`/`https`, and
 * an unusable authority falls back to {@link PLACEHOLDER_HOST} rather than a
 * 500.  Since that breaks signature verification, the discarded value is
 * returned for the caller to log once it knows Fedify will see the request.
 *
 * The accepted authority is returned verbatim as well, for the `Host` header
 * {@link toFetchRequest} synthesises on HTTP/2: `URL` normalises what it
 * parses (case, default port, punycode) while a signature covers the bytes as
 * sent.  It is absent exactly when the placeholder stood in.
 */
function toRequestUrl(
  request: HttpContext["request"],
): { url: URL; authority?: string; unusableAuthority?: string } {
  // `protocol()` hands back the first `X-Forwarded-Proto` token as it
  // arrived; an upper-case `HTTPS` must not be read as plain `http`.
  const protocol = request.protocol().toLowerCase() === "https"
    ? "https"
    : "http";
  const host = request.authority();
  const authority = host == null ? "" : normalizeAuthority(host);
  // A target with no origin form is routed as `/`, which matches no
  // federation route, so AdonisJS answers.
  const target = toOriginForm(request.request.url ?? "/") ?? "/";

  const parsed = buildRequestUrl(protocol, authority, target);
  let url = parsed;
  let unusableAuthority: string | undefined;
  if (url === undefined) {
    // Only the authority can be at fault: the target starts with `/`, and a
    // URL parser in path state takes any bytes after it.
    url = new URL(`${protocol}://${PLACEHOLDER_HOST}${target}`);
    if (host != null) unusableAuthority = host;
  }

  return {
    url,
    authority: parsed === undefined ? undefined : authority,
    unusableAuthority,
  };
}

/**
 * Converts an AdonisJS request into a WHATWG `Request` for Fedify.
 *
 * `intended()`, not `method()`, so `_method` spoofing cannot turn an inbox
 * `POST` into a `GET`.  Headers are forwarded as they arrived; HTTP/2
 * pseudo-headers are skipped, and since that leaves no `Host` (which
 * signatures may cover), one is synthesised only then, from the authority the
 * URL was built from.
 */
function toFetchRequest(
  ctx: HttpContext,
  url: URL,
  authority: string | undefined,
): Request {
  const request = ctx.request;
  const method = request.intended().toUpperCase();

  const headers = new Headers();
  const rawHeaders = request.headers();
  // `Object.keys()`, not `for...in`: a polluted prototype must not be forwarded.
  for (const key of Object.keys(rawHeaders)) {
    if (key.startsWith(":")) continue;
    const value = rawHeaders[key];
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else if (typeof value === "string") {
      headers.append(key, value);
    }
  }

  // Only when absent: an HTTP/1.1 `Host` is what the peer signed and what the
  // verifier reads, so it is never touched (a proxy rewriting `Host` has to
  // preserve it; see the README).  On HTTP/2 the authority travels in
  // `:authority`, which the pseudo-header skip dropped, so it is put back
  // here -- verbatim, not `url.host`, since `URL` case-folds, drops a default
  // port and punycodes while a signature covers the bytes as sent.  An
  // unusable authority gets the placeholder in the URL only, never a header.
  if (authority !== undefined && !headers.has("host")) {
    headers.set("host", authority);
  }

  const hasBody = method !== "GET" && method !== "HEAD";

  return new Request(url, {
    method,
    headers,
    body: hasBody ? lazyRequestBody(request.request) : undefined,
    // Not in the DOM lib's `RequestInit`, but Node requires it for streams.
    ...{ duplex: "half" },
  });
}

/**
 * Copies a WHATWG `Response` produced by Fedify onto the AdonisJS response.
 * `Set-Cookie` goes through `getSetCookie()` because iterating `Headers`
 * folds it; `Vary` is merged rather than copied, so a `Vary: Origin` an
 * upstream middleware set survives Fedify's own `Vary: Accept`; bodyless
 * responses (`204`, `304`, `HEAD`) are not streamed.
 */
function writeFedifyResponse(response: Response, ctx: HttpContext): void {
  ctx.response.status(response.status);

  for (const [key, value] of response.headers) {
    const name = key.toLowerCase();
    if (name === "set-cookie") continue;
    if (name === "vary") {
      mergeIntoVary(ctx, value);
      continue;
    }
    ctx.response.header(key, value);
  }

  for (const cookie of response.headers.getSetCookie()) {
    ctx.response.append("set-cookie", cookie);
  }

  const bodyless = response.body === null ||
    response.status === 204 ||
    response.status === 304 ||
    // `intended()`: a spoofed `_method=HEAD` must not suppress the body.
    ctx.request.intended().toUpperCase() === "HEAD";

  if (bodyless) {
    // Do not leave a body Fedify produced anyway (usually for HEAD) dangling;
    // a failed cleanup must not become an unhandled rejection.
    response.body?.cancel().catch(() => {});
    return;
  }

  ctx.response.stream(response.body!, (error) => {
    ctx.logger.error({ err: error }, "Failed to stream the Fedify response");
    return ["Internal server error", 500];
  });
}

/**
 * Splits a `Vary` value into its entries.
 */
function parseVary(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

/**
 * Merges a raw `Vary` value into the response's `Vary`.
 *
 * `ctx.response.header()` replaces rather than appends, so writing `Vary`
 * directly would drop what an upstream middleware or a route already put
 * there (CORS's `Origin`, say) and let a shared cache mix representations.
 *
 * Both of AdonisJS's header layers are read: `header()` buffers a value that
 * is copied onto the Node response when the reply is written, while
 * `ctx.response.vary()` writes to the Node response directly, and
 * `getHeader()` prefers the buffered value.  Once `Accept` is buffered before
 * `next()`, a `vary("Origin")` a route calls is therefore invisible through
 * `getHeader()` alone and would be overwritten at write time.  The union goes
 * back to the buffered layer, since that is what goes out.  `Vary: *` on any
 * side wins.
 */
function mergeIntoVary(ctx: HttpContext, rawValue: string): void {
  const vary: string[] = [];
  const layers = [
    String(ctx.response.getHeader("Vary") ?? ""),
    String(ctx.response.response.getHeader("vary") ?? ""),
    rawValue,
  ];

  for (const layer of layers) {
    for (const value of parseVary(layer)) {
      if (value === "*") {
        ctx.response.header("Vary", "*");
        return;
      }
      if (!vary.some((v) => v.toLowerCase() === value.toLowerCase())) {
        vary.push(value);
      }
    }
  }

  if (vary.length > 0) ctx.response.header("Vary", vary.join(", "));
}

/**
 * Headers of a discarded response that must not describe the one written over
 * it: cache and validator metadata, which decides how long a shared cache
 * keeps the substitute, and metadata about a body nobody will see.  The
 * targeted cache-control family (`CDN-Cache-Control`, `Surrogate-Control`, …)
 * is included because a CDN honours it over `Cache-Control` and largely
 * ignores `Vary`, so a leftover lifetime would keep the 406 cached for
 * ActivityPub clients too.  Enumerated rather than matched on a `content-`
 * prefix, which would also take `Content-Security-Policy`.
 */
const DISCARDED_ENTITY_HEADERS: ReadonlySet<string> = new Set([
  "age",
  "cache-control",
  "cdn-cache-control",
  "cloudflare-cdn-cache-control",
  "content-digest",
  "content-disposition",
  "content-encoding",
  "content-language",
  "content-length",
  "content-location",
  "content-range",
  "content-type",
  "digest",
  "etag",
  "expires",
  "last-modified",
  "pragma",
  "repr-digest",
  "surrogate-control",
  "surrogate-key",
]);

/**
 * Removes a response header around a quirk of AdonisJS's `removeHeader()`,
 * which drops the buffered entry only when the current value is truthy, so one
 * set to `""` would survive.  It also forwards to Node unconditionally, which
 * throws once the head is flushed, so this is only safe while
 * `ctx.response.headersSent` is false.
 */
function removeResponseHeader(ctx: HttpContext, key: string): void {
  // A non-empty placeholder, so the buffered entry is truthy and deleted.
  ctx.response.header(key, "-");
  ctx.response.removeHeader(key);
}

/**
 * Drops the body a discarded response left buffered, so the one written over
 * it is the one that goes out.
 *
 * `response.send()` assigns `lazyBody.content` alone, and `finish()` reads the
 * other entries after it: a path passed to `download()` would still be
 * streamed in place of the new body, and a readable passed to `stream()`
 * would be forgotten — one leaked file descriptor per request.  Resetting
 * `lazyBody` drops both.
 */
function discardPendingBody(ctx: HttpContext): void {
  const stream = ctx.response.outgoingStream;
  ctx.response.lazyBody = {};
  if (stream == null) return;

  // `ResponseStream` is either a Node `Readable` or a WHATWG `ReadableStream`.
  if ("destroy" in stream) {
    // Nothing else listens, since AdonisJS never attached to the stream, and
    // an unlistened `error` event is an uncaught exception.
    stream.on("error", () => {});
    if (!stream.destroyed) stream.destroy();
  } else if (!stream.locked) {
    // Likewise, a rejected `cancel()` must not become an unhandled rejection.
    stream.cancel().catch(() => {});
  }
}

/**
 * Undoes what a discarded response did to the headers, before another is
 * written over it.
 *
 * `next()` mixes two populations: a header a *later middleware* set
 * (`@adonisjs/cors`'s `Access-Control-Allow-Origin`, say) answers this
 * request and has to survive, while one the *discarded page* set describes a
 * body nobody will see.  They are told apart by name: only
 * {@link DISCARDED_ENTITY_HEADERS} are touched, and each is put back exactly
 * as the snapshot had it — removed when the snapshot had none.  Restoring
 * every snapshot entry instead would undo the request's own answer, since
 * `response.header()` replaces rather than merges.
 *
 * `Vary` is reconciled by {@link mergeIntoVary} around `next()` instead,
 * since only the union of the snapshot and the current value is right.
 */
function rollBackDiscardedResponse(
  ctx: HttpContext,
  headersBefore: ReturnType<HttpContext["response"]["getHeaders"]>,
): void {
  const headersAfter = ctx.response.getHeaders();

  for (const key of DISCARDED_ENTITY_HEADERS) {
    // `hasOwn()`, not `in`: `constructor` is a legal header name.
    const before = Object.hasOwn(headersBefore, key)
      ? headersBefore[key]
      : undefined;

    // Written back whether or not `next()` changed it: `header()` is
    // idempotent, and takes an array, so a repeated header goes back whole.
    if (before !== undefined) ctx.response.header(key, before);
    else if (Object.hasOwn(headersAfter, key)) removeResponseHeader(ctx, key);
  }
}

/**
 * The response handed back to Fedify after AdonisJS answered a delegated
 * request.  Nothing is written from it, but Fedify logs and meters its
 * status, so it reports what AdonisJS answered.  `Response` only accepts
 * 200-599, so anything else (a 1xx) is reported as 200.
 */
function delegatedResponse(status: number): Response {
  return new Response(null, {
    status: status >= 200 && status <= 599 ? status : 200,
  });
}

/**
 * Mounts a `Federation` instance inside an AdonisJS application; the
 * counterpart of `integrateFederation()` in `@fedify/express`.
 *
 * Register it in the **server** stack: Fedify serves paths the router does
 * not know, and the body stream is still intact there for signature
 * verification.  An instance holds configuration only, so one serves every
 * request.
 */
export default class FedifyMiddleware<TContextData = ContextData>
  implements FedifyMiddlewareHandler {
  #federation: Federation<TContextData>;
  #contextDataFactory: ContextDataFactory<TContextData>;
  #ignoreRoutePrefixes: string[];

  /**
   * @param federation The federation instance to mount.
   * @param args The context-data factory and the options; see
   *   {@link FedifyMiddlewareArgs}.  The factory sees a pre-routing
   *   `HttpContext`; see {@link import('./types.js').ContextDataFactory}.
   */
  constructor(
    federation: Federation<TContextData>,
    ...args: FedifyMiddlewareArgs<TContextData>
  ) {
    // The container zero-arg-constructs this class when the object the kernel
    // resolved is not the one the provider bound (a duplicated package copy,
    // or the ESM and CJS builds mixed); fail here rather than on every request.
    if (federation == null) throw new E_MISSING_FEDERATION();

    // The conditional tuple is unresolved here; read it through its common shape.
    const [contextDataFactory, options] = args as [
      ContextDataFactory<TContextData>?,
      FedifyMiddlewareOptions?,
    ];

    this.#federation = federation;
    this.#contextDataFactory = contextDataFactory ??
      (() => undefined as TContextData);
    this.#ignoreRoutePrefixes = options?.ignoreRoutePrefixes ?? [];
  }

  async handle(ctx: HttpContext, next: NextFn): Promise<void> {
    const federation = this.#federation;

    // Install the `ctx.federation` getter on this context's class: it covers a
    // duplicated `@adonisjs/core` and the container-free path, which has no
    // provider.  A conflicting `federation` member is reported once; the
    // federation endpoints do not need the accessor.
    const contextClass = ctx.constructor as unknown as HttpContextClass;
    if (
      !ensureFederationGetter(contextClass) && !conflicting.has(contextClass)
    ) {
      conflicting.add(contextClass);
      ctx.logger.error(
        'Something other than @fedify/adonisjs defines "federation" on this ' +
          'application\'s HttpContext, so "ctx.federation" is not the Fedify ' +
          "request context. Federation endpoints are unaffected; rename the " +
          "conflicting macro or getter to use it from controllers",
      );
    }

    // The ignore check and Fedify must see the same URL, so build it once.
    const { url, authority, unusableAuthority } = toRequestUrl(ctx.request);
    const path = url.pathname;

    if (
      this.#ignoreRoutePrefixes.some((prefix) => path.startsWith(prefix)) ||
      FORBIDDEN_METHODS.has(ctx.request.intended().toUpperCase())
    ) {
      // Opted out, or impossible to represent as a `Request`.
      setFederationContextFactory(ctx, () => {
        throw new E_FEDIFY_CONTEXT_UNAVAILABLE(path);
      });
      return next();
    }

    // Only past the bypass: on an opted-out path Fedify never sees the URL,
    // so the placeholder is harmless.
    if (unusableAuthority !== undefined) {
      warnUnusableAuthority(ctx.logger, unusableAuthority);
    }

    const request = toFetchRequest(ctx, url, authority);

    // `federation.fetch()` takes `contextData` by value, so the factory runs
    // before the router.
    const contextData = await this.#contextDataFactory(ctx);

    // Also for requests Fedify declines: a controller serving the HTML half of
    // a shared URL needs it.  The getter creates the context lazily.
    setFederationContextFactory(
      ctx,
      () => federation.createContext(request, contextData),
    );

    /**
     * What happened while Fedify was deciding: whether a fall-through callback
     * handed the request to AdonisJS, and whether AdonisJS produced nothing of
     * its own so the 406 below is the answer.  "Nothing" means no route
     * matched (`ctx.route` is set only on a match) *and* the framework's own
     * 404: a later server middleware (`@adonisjs/cors` on a preflight) or a
     * downstream failure can answer without the router running, and must not
     * be overwritten.  A downstream middleware *deliberately* answering 404 on
     * a Fedify-owned path is indistinguishable from that default and is also
     * replaced by the 406.
     *
     * `router.match()` could say before `next()` whether a route exists and
     * spare the rollback, but is deliberately not asked:
     *
     * 1. Every integration follows the deferred-406 contract the manual
     *    documents: delegate, and answer 406 only when the framework answered
     *    404 (Hono reads `ctx.res.status` after `next()`, Express `req.route`).
     *    Deciding from the route table would give AdonisJS a narrower one.
     *
     * 2. Server middleware answers without a route by design (`@adonisjs/cors`
     *    on a preflight, `@adonisjs/static`, a maintenance page), and Fedify
     *    calls `onNotAcceptable` for a wildcard `Accept` too -- what curl and
     *    a preflight send -- so skipping `next()` would cut those off on every
     *    path Fedify owns.
     *
     * 3. `ctx.route` is the framework's own verdict.  A lookup here would
     *    duplicate `routeFinder`'s preamble and drift silently as the router
     *    changes.
     *
     * The price is undoing a response AdonisJS was allowed to start: the
     * headers in {@link DISCARDED_ENTITY_HEADERS} are put back by name, a
     * pending body is dropped, and nothing is touched once the head has been
     * flushed.
     *
     * An object rather than two `let`s so TypeScript does not narrow them.
     */
    const outcome: { delegated: boolean; answer406: boolean } = {
      delegated: false,
      answer406: false,
    };

    const response = await federation.fetch(request, {
      contextData,

      /**
       * Fedify has no route for this path: hand the request to AdonisJS.
       * `await next()` resolves even on no match, since `E_ROUTE_NOT_FOUND`
       * goes through the exception handler and renders a 404.
       */
      onNotFound: async () => {
        outcome.delegated = true;
        await next();
        return delegatedResponse(ctx.response.getStatus());
      },

      /**
       * Fedify has a route but cannot satisfy `Accept` (a browser at an actor
       * URL).  AdonisJS gets a chance to serve its own representation first;
       * 406 is only the answer if it has nothing either.  `Accept` is merged
       * into `Vary` rather than written over it, and the snapshot's value is
       * merged back after `next()`, because a route may have replaced the
       * header meanwhile.
       */
      onNotAcceptable: async () => {
        outcome.delegated = true;
        mergeIntoVary(ctx, "Accept");
        // A value snapshot, not a live view: `getHeaders()` builds a fresh
        // object on every call.
        const headersBefore = ctx.response.getHeaders();
        await next();

        // Put back what `Vary` carried before `next()`, `Accept` included.  A
        // superset only costs cache hits; a missing entry lets a cache mix the
        // two representations up.
        mergeIntoVary(ctx, String(headersBefore.vary ?? ""));

        const status = ctx.response.getStatus();
        // Not once the head is flushed: the 406 could not be written over it,
        // and `removeHeader()` would raise `ERR_HTTP_HEADERS_SENT`.
        outcome.answer406 = ctx.route === undefined && status === 404 &&
          !ctx.response.headersSent;

        if (outcome.answer406) rollBackDiscardedResponse(ctx, headersBefore);

        // The 406 itself is produced below; this only feeds Fedify's log.
        return delegatedResponse(outcome.answer406 ? 406 : status);
      },
    });

    // Fedify owns the path, cannot satisfy `Accept`, and AdonisJS had nothing
    // either.  `Vary` already carries `Accept`.
    if (outcome.answer406) {
      // Before `send()`, which only sets the buffered *content*: a 404 page
      // rendered with `download()` or `stream()` would otherwise still go out,
      // or leak its readable.
      discardPendingBody(ctx);
      ctx.response
        .status(406)
        .type("text/plain")
        .send("Not acceptable");
      return;
    }

    if (outcome.delegated) {
      // AdonisJS produced the response (a matched route or its own 404 page).
      return;
    }

    writeFedifyResponse(response, ctx);
  }
}

/**
 * Creates a middleware class around a `Federation` the application built
 * itself, with no container or `config/fedify.ts` involved.  This is the
 * package's default export; most applications use the provider instead.
 *
 * @example
 * ```ts
 * // start/kernel.ts
 * import fedifyMiddleware from '@fedify/adonisjs'
 * // A module of the application's own that default-exports its `Federation`.
 * import federation from '../app/federation.js'
 *
 * server.use([
 *   async () => ({ default: fedifyMiddleware(federation, (ctx) => ctx) }),
 * ])
 * ```
 *
 * With the default `ContextData` of `HttpContext | null`, pass `(ctx) => ctx`
 * to match the provider; see {@link FedifyMiddlewareArgs}.
 *
 * @returns A {@link FedifyMiddleware} subclass whose constructor takes no
 *   arguments, which is what `server.use()` constructs.
 * @param federation The federation instance to mount.
 * @param args The context-data factory and the options.
 */
export function fedifyMiddleware<TContextData>(
  federation: Federation<TContextData>,
  ...args: FedifyMiddlewareArgs<TContextData>
): FedifyMiddlewareClass {
  // Here rather than in the constructor guard, which fires only on the first
  // request and blames the provider or a duplicated package copy; a factory
  // caller's likely mistake is a module that default-exports nothing.
  if (federation == null) {
    throw new E_MISSING_FEDERATION(
      "fedifyMiddleware() was called without a Federation instance. Check " +
        "that the module its first argument comes from actually " +
        "default-exports the Federation it builds",
    );
  }

  // Named so container errors and tracing show something readable.
  return class ConfiguredFedifyMiddleware
    extends FedifyMiddleware<TContextData> {
    constructor() {
      super(federation, ...args);
    }
  };
}
