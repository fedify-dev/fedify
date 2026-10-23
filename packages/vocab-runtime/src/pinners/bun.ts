import { getLogger } from "@logtape/logtape";
import { isIP } from "node:net";
import { type PinGrant, redeemPinGrant } from "../pin-grant.ts";
import type { ResolvedAddress } from "../url.ts";
import type { ConnectionPinner, ConnectionPinnerOptions } from "./types.ts";

const logger = getLogger(["fedify", "runtime", "fetch"]);

/**
 * The first Bun version that honors `proxy: false` when proxy environment
 * variables are set at startup.  Earlier versions send pinned requests
 * through the proxy, with the validated IP address as the target.
 */
const PROXY_FALSE_MIN_VERSION = "1.4.3";

const PROXY_VARIABLES = [
  "HTTP_PROXY",
  "http_proxy",
  "HTTPS_PROXY",
  "https_proxy",
  "ALL_PROXY",
  "all_proxy",
] as const;

// Transport errors that Bun's fetch() raises before a response arrives.
// Only GET and HEAD requests fall back to the next address on these.
const FALLBACK_ERROR_CODES: ReadonlySet<string> = new Set([
  "ConnectionRefused",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ETIMEDOUT",
]);

/**
 * Bun versions before 1.3.11 verify the server certificate against the `Host`
 * header, including a non-default port, instead of `tls.serverName`, so
 * pinned requests to HTTPS servers on non-default ports always fail the check
 * there.  A custom `checkServerIdentity` cannot stand in for it: these
 * versions send the whole request before a failing custom check aborts it
 * (and 1.3.10 even reuses the connection for the next request), so such
 * requests are refused instead.
 */
const HOST_HEADER_IDENTITY_RANGE = "<1.3.11";

interface BunGlobal {
  readonly version: string;
  readonly semver: { satisfies(version: string, range: string): boolean };
}

interface BunFetchInit extends RequestInit {
  tls?: { serverName?: string };
  proxy?: string | false;
}

/**
 * Creates a pinner for Bun.  Every request is sent to an IP literal URL with
 * the original `Host` header, `tls.serverName` set to the original hostname
 * (so that the certificate is still verified against it), and `proxy: false`.
 *
 * GET and HEAD requests fall back to the next address on transport errors
 * raised before a response arrives.  Other methods use only the first
 * address, since a transport error does not guarantee that the request did
 * not reach the server, and retrying it could deliver an activity twice.
 * Together with the transport retries of `doubleKnock()`, a GET request is
 * attempted at most twice per address.  Note that Bun 1.4 also reports
 * a connection reset after the request was sent as a `TypeError`, so GET and
 * HEAD requests may be repeated against the next address in that case, which
 * is acceptable for these idempotent methods.
 *
 * Bun versions before 1.3.11 verify certificates against the `Host` header,
 * which includes a non-default port, and cannot safely check them against
 * the original hostname in any other way, so requests to HTTPS servers on
 * non-default ports fail there with a `TypeError` before connecting.
 *
 * Bun versions before 1.4.3 ignore `proxy: false` when proxy environment
 * variables are set, so requests go through the proxy with the validated IP
 * address as the target.  In that case a warning is logged once.
 * @param options The pinner options.
 * @returns The pinner.
 */
export function createBunPinner(
  { verifyAddress }: ConnectionPinnerOptions,
): ConnectionPinner {
  // Older Bun versions read proxy variables only at startup, so they are
  // checked once when the pinner is created:
  let proxyWarningPending = ignoresProxyFalse() && hasProxyVariables();
  return {
    supports(url: URL): boolean {
      return url.protocol === "http:" || url.protocol === "https:";
    },

    async fetch(
      grant: PinGrant,
      request: Request,
      signal?: AbortSignal,
    ): Promise<Response> {
      const url = new URL(request.url);
      const { hostname, addresses } = redeemPinGrant(grant, url);
      if (proxyWarningPending) {
        proxyWarningPending = false;
        logger.warn(
          "Bun {version} ignores proxy: false while proxy environment " +
            "variables are set, so outbound requests go through the proxy " +
            "instead of connecting directly to the validated addresses.  " +
            "Upgrade to Bun {minVersion} or later, or unset the proxy " +
            "environment variables; see {url}.",
          {
            version: getBun()?.version,
            minVersion: PROXY_FALSE_MIN_VERSION,
            url: "https://fedify.dev/manual/deploy#bun-behind-an-http-proxy",
          },
        );
      }
      const fallback = request.method === "GET" || request.method === "HEAD";
      const candidates = fallback ? addresses : addresses.slice(0, 1);
      const body = request.body == null ? null : await request.arrayBuffer();
      let lastError: unknown = new TypeError(
        `No address to connect to for ${url.host}.`,
      );
      for (const address of candidates) {
        throwIfAborted(signal, request.signal);
        // Never fall back past an address that fails the check:
        verifyAddress(address);
        const headers = new Headers(request.headers);
        headers.set("Host", url.host);
        const init: BunFetchInit = {
          method: request.method,
          headers,
          body,
          redirect: "manual",
          signal: signal == null || signal === request.signal
            ? request.signal
            : anySignal(signal, request.signal),
          proxy: false,
        };
        if (url.protocol === "https:") {
          init.tls = getTlsOptions(url, hostname);
        }
        try {
          return await fetch(toAddressUrl(url, address), init);
        } catch (error) {
          throwIfAborted(signal, request.signal);
          if (!fallback || !isFallbackError(error)) throw error;
          lastError = error;
        }
      }
      throw lastError;
    },

    release(): void {
    },
  };
}

function getTlsOptions(url: URL, hostname: string): BunFetchInit["tls"] {
  const bun = getBun();
  if (
    url.port !== "" && bun != null &&
    bun.semver.satisfies(bun.version, HOST_HEADER_IDENTITY_RANGE)
  ) {
    throw new TypeError(
      `Bun ${bun.version} cannot verify the certificate of ${url.host} ` +
        "when connecting to a validated address; upgrade to Bun 1.3.11 or " +
        "later to fetch from HTTPS servers on non-default ports.",
    );
  }
  return isIP(hostname) === 0 ? { serverName: hostname } : {};
}

/**
 * Combines two signals without `AbortSignal.any()`, which Bun 1.1.0 lacks.
 */
function anySignal(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (a.aborted) return a;
  if (b.aborted) return b;
  const controller = new AbortController();
  const abort = (event: Event) => {
    controller.abort((event.target as AbortSignal).reason);
    a.removeEventListener("abort", abort);
    b.removeEventListener("abort", abort);
  };
  a.addEventListener("abort", abort);
  b.addEventListener("abort", abort);
  return controller.signal;
}

function toAddressUrl(url: URL, address: ResolvedAddress): URL {
  const result = new URL(url);
  result.hostname = address.family === 6
    ? `[${address.address}]`
    : address.address;
  return result;
}

function isFallbackError(error: unknown): boolean {
  if (error instanceof Error && error.name === "AbortError") return false;
  if (error instanceof TypeError) return true;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && FALLBACK_ERROR_CODES.has(code);
}

function throwIfAborted(...signals: (AbortSignal | undefined)[]): void {
  for (const signal of signals) signal?.throwIfAborted();
}

function getBun(): BunGlobal | undefined {
  return (globalThis as { Bun?: BunGlobal }).Bun;
}

function ignoresProxyFalse(): boolean {
  const bun = getBun();
  if (bun == null) return false;
  return !bun.semver.satisfies(bun.version, `>=${PROXY_FALSE_MIN_VERSION}`);
}

function hasProxyVariables(): boolean {
  const env = (globalThis as {
    process?: { env?: Record<string, string | undefined> };
  }).process?.env;
  if (env == null) return false;
  return PROXY_VARIABLES.some((name) => (env[name] ?? "") !== "");
}
