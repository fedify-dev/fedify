import { getLogger } from "@logtape/logtape";
import { issuePinGrant, type PinGrant, revokePinGrant } from "./pin-grant.ts";
import {
  type ConnectionPinner,
  detectRuntime,
  getRuntimePinner,
} from "./pinners/mod.ts";
import {
  type LookupAllAddresses,
  lookupAllAddresses,
  lookupPublicAddresses,
  parsePublicUrl,
  type ResolvedAddress,
  UrlError,
} from "./url.ts";

const logger = getLogger(["fedify", "runtime", "fetch"]);

/**
 * Options for {@link openPublicFetch} and {@link withPublicFetch}.
 */
export interface PublicFetchOptions {
  /**
   * An `AbortSignal` for cancelling the DNS lookup.
   */
  readonly signal?: AbortSignal;

  /**
   * A function that resolves all addresses of a hostname, used instead of
   * `node:dns.lookup()`.  The addresses it returns are validated in the same
   * way as the default lookup's.
   */
  readonly lookup?: (hostname: string) => Promise<readonly ResolvedAddress[]>;
}

/**
 * A session for fetching resources from a single origin.  Its `fetch()`
 * connects only to the addresses validated when the session was opened, on
 * runtimes that support it.
 */
export interface PublicFetchSession {
  /**
   * A copy of the URL the session was opened for.
   */
  readonly url: URL;

  /**
   * Fetches a resource from the session's origin.  Redirects are never
   * followed; the redirect mode is always `"manual"`.
   * @throws {TypeError} If the input's origin differs from the session's, or
   *                     if the session is closed.
   */
  fetch(input: Request | URL | string, init?: RequestInit): Promise<Response>;

  /**
   * Closes the session.  The cancellation of response bodies that have been
   * neither consumed nor cancelled is started (without waiting for it), and
   * the session can no longer fetch.  Calling this more than once has no
   * effect.
   */
  close(): Promise<void>;
}

/**
 * The functions created by {@link createPublicFetch}.
 */
export interface PublicFetch {
  /**
   * Validates the URL, resolves its hostname, checks that every resolved
   * address is public, and opens a session that connects only to those
   * addresses.
   * @param url The URL to open a session for.
   * @param options The options.
   * @returns The session.  It must be closed.
   * @throws {UrlError} If the URL is not allowed, or its hostname cannot be
   *                    resolved (with `reason: "dns"`).
   */
  openPublicFetch(
    url: URL | string,
    options?: PublicFetchOptions,
  ): Promise<PublicFetchSession>;

  /**
   * Opens a session with {@link PublicFetch.openPublicFetch}, runs the given
   * function with its `fetch()`, and closes the session afterwards.
   * @param url The URL to open a session for.
   * @param fn The function to run.  It must not return a `Response`, since
   *           the response bodies are cancelled when the session is closed.
   * @param options The options.
   * @returns The value returned by `fn`.
   * @throws {UrlError} If the URL is not allowed.
   * @throws {TypeError} If `fn` returns a `Response`.
   */
  withPublicFetch<T>(
    url: URL | string,
    fn: (fetch: PublicFetchSession["fetch"]) => Promise<T>,
    options?: PublicFetchOptions,
  ): Promise<T>;
}

/**
 * The dependencies of {@link createPublicFetch}.
 */
export interface PublicFetchDependencies {
  /**
   * Gets the pinner to connect with, or `null` to use the global `fetch()`.
   */
  readonly pinner: () => Promise<ConnectionPinner | null>;

  /**
   * The default lookup function.
   */
  readonly lookup: LookupAllAddresses;
}

/**
 * Creates {@link PublicFetch.openPublicFetch} and
 * {@link PublicFetch.withPublicFetch} bound to the given pinner and lookup.
 * This is exported only for tests; it is not exported from any entry point.
 * @param dependencies The pinner and the default lookup function.
 * @returns The functions.
 */
export function createPublicFetch(
  dependencies: PublicFetchDependencies,
): PublicFetch {
  async function openPublicFetch(
    url: URL | string,
    options: PublicFetchOptions = {},
  ): Promise<PublicFetchSession> {
    const { url: parsed, hostname, family } = parsePublicUrl(url);
    if (parsed.username !== "" || parsed.password !== "") {
      throw new UrlError("URLs with credentials are not allowed");
    }
    const lookup = options.lookup ?? dependencies.lookup;
    let addresses: readonly ResolvedAddress[];
    if (family !== 0) {
      addresses = [{ address: hostname, family }];
    } else if (lookup === lookupAllAddresses && !await canResolve()) {
      // Without the `net` permission on Deno, the hostname cannot be resolved,
      // but fetch() cannot connect to it either:
      return createSession(parsed, globalFetch);
    } else {
      options.signal?.throwIfAborted();
      addresses = await lookupPublicAddresses(hostname, lookup);
      options.signal?.throwIfAborted();
    }
    const pinner = await dependencies.pinner();
    if (pinner == null || !pinner.supports(parsed)) {
      logUnpinned(parsed);
      return createSession(parsed, globalFetch);
    }
    const grant = issuePinGrant(parsed, addresses);
    return createSession(
      parsed,
      (input, init) =>
        pinner.fetch(grant, new Request(input, init), init.signal ?? undefined),
      { grant, pinner },
    );
  }

  async function withPublicFetch<T>(
    url: URL | string,
    fn: (fetch: PublicFetchSession["fetch"]) => Promise<T>,
    options?: PublicFetchOptions,
  ): Promise<T> {
    const session = await openPublicFetch(url, options);
    try {
      const result = await fn(session.fetch);
      if (result instanceof Response) {
        throw new TypeError(
          "withPublicFetch() callbacks must not return a Response, since " +
            "its body is cancelled when the session is closed.",
        );
      }
      return result;
    } catch (error) {
      logger.debug(
        "Failed while fetching {url}; closing the session: {error}",
        { url: session.url.href, error },
      );
      throw error;
    } finally {
      await session.close();
    }
  }

  return { openPublicFetch, withPublicFetch };
}

const runtimePublicFetch: PublicFetch = createPublicFetch({
  pinner: getRuntimePinner,
  lookup: lookupAllAddresses,
});

/**
 * Validates the URL, resolves its hostname, checks that every resolved
 * address is public, and opens a session that connects only to those
 * addresses.  Connections are pinned on Node.js and Bun.  On other runtimes,
 * the session uses the global `fetch()` after the check.
 * @param url The URL to open a session for.
 * @param options The options.
 * @returns The session.  It must be closed.
 * @throws {UrlError} If the URL is not allowed, or its hostname cannot be
 *                    resolved (with `reason: "dns"`).
 */
export const openPublicFetch: PublicFetch["openPublicFetch"] =
  runtimePublicFetch.openPublicFetch;

/**
 * Opens a session with {@link openPublicFetch}, runs the given function with
 * its `fetch()`, and closes the session afterwards.
 * @param url The URL to open a session for.
 * @param fn The function to run.  It must not return a `Response`, since
 *           the response bodies are cancelled when the session is closed.
 * @param options The options.
 * @returns The value returned by `fn`.
 * @throws {UrlError} If the URL is not allowed.
 * @throws {TypeError} If `fn` returns a `Response`.
 */
export const withPublicFetch: PublicFetch["withPublicFetch"] =
  runtimePublicFetch.withPublicFetch;

/**
 * Opens a session that neither validates nor pins addresses, for callers that
 * allow private addresses.  It has the same rules as {@link openPublicFetch}
 * sessions otherwise: requests are limited to the URL's origin, redirects are
 * never followed, and unconsumed response bodies are cancelled on close.
 * It grants nothing beyond calling the global `fetch()` directly.
 * @param url The URL to open a session for.
 * @returns The session.  It must be closed.
 */
export function openDirectFetch(
  url: URL | string,
): Promise<PublicFetchSession> {
  return Promise.resolve(createSession(new URL(url), globalFetch));
}

/**
 * Starts cancelling the body of a response without waiting for it to settle.
 * The cancellation of a branch of a tee (e.g., a body cloned by a fetch mock)
 * settles only after the other branch is cancelled too, per the Streams
 * standard, so awaiting it could block forever.  Failures are only logged.
 */
function cancelResponseBody(response: Response, url: URL): void {
  response.body?.cancel().catch((error) => {
    logger.debug(
      "Failed to cancel a response body from {url}: {error}",
      { url: url.href, error },
    );
  });
}

function globalFetch(
  input: Request | URL | string,
  init: RequestInit,
): Promise<Response> {
  return fetch(input, init);
}

function createSession(
  url: URL,
  send: (input: Request | URL | string, init: RequestInit) => Promise<Response>,
  pin?: { readonly grant: PinGrant; readonly pinner: ConnectionPinner },
): PublicFetchSession {
  const origin = url.origin;
  const tracked: Response[] = [];
  let closed = false;

  async function sessionFetch(
    input: Request | URL | string,
    init?: RequestInit,
  ): Promise<Response> {
    if (closed) throw new TypeError("The fetch session is closed.");
    const target = new URL(input instanceof Request ? input.url : input);
    if (target.origin !== origin) {
      throw new TypeError(
        `A fetch session for ${origin} cannot fetch ${target.origin}.`,
      );
    }
    // Override the default redirect mode ("follow") of Request objects too;
    // Bun also needs the option on fetch() itself:
    // https://github.com/oven-sh/bun/issues/10754
    const response = await send(input, { ...init, redirect: "manual" });
    if (closed) {
      cancelResponseBody(response, url);
      throw new TypeError("The fetch session is closed.");
    }
    tracked.push(response);
    return response;
  }

  async function close(): Promise<void> {
    if (closed) return;
    closed = true;
    for (const response of tracked) {
      if (response.body == null || response.bodyUsed) continue;
      if (response.body.locked) {
        logger.debug(
          "Cannot cancel a locked response body from {url}.",
          { url: url.href },
        );
        continue;
      }
      cancelResponseBody(response, url);
    }
    if (pin == null) return;
    revokePinGrant(pin.grant);
    await pin.pinner.release(pin.grant);
  }

  return {
    get url() {
      return new URL(url);
    },
    fetch: sessionFetch,
    close,
  };
}

async function canResolve(): Promise<boolean> {
  if (!("Deno" in globalThis)) return true;
  const permission = await Deno.permissions.query({ name: "net" });
  return permission.state === "granted";
}

const loggedUnpinned = new Set<string>();

function logUnpinned(url: URL): void {
  const runtime = detectRuntime();
  const key = `${runtime} ${url.protocol}`;
  if (loggedUnpinned.has(key)) return;
  loggedUnpinned.add(key);
  logger.debug(
    "Outbound {protocol} connections are not pinned to validated addresses " +
      "on {runtime}; the hostname is resolved again when connecting.",
    { runtime, protocol: url.protocol },
  );
}
