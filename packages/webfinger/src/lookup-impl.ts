import { getUserAgent, UrlError } from "@fedify/vocab-runtime";
import {
  openDirectFetch,
  openPublicFetch,
  type PublicFetchSession,
} from "@fedify/vocab-runtime/internal";
import { getLogger } from "@logtape/logtape";
import { BodyTooLargeError, MAX_BODY_SIZE, readBoundedText } from "./body.ts";
import type { ResourceDescriptor } from "./jrd.ts";
import type {
  LookupWebFingerOptions,
  WebFingerLookupOutcome,
} from "./lookup.ts";

const logger = getLogger(["fedify", "webfinger", "lookup"]);

const DEFAULT_MAX_REDIRECTION = 5;

/**
 * The dependencies of {@link lookupWebFingerInternal}.
 * @internal
 */
export interface LookupWebFingerDependencies {
  /**
   * Opens a fetch session for a single hop.  Defaults to `openDirectFetch()`
   * if `allowPrivateAddress` is turned on, or `openPublicFetch()` otherwise.
   */
  readonly openHop?: (url: string) => Promise<PublicFetchSession>;
}

/**
 * The outcome of a single hop: either a redirect to follow, or the final
 * result of the lookup.
 */
type HopResult =
  | { readonly redirect: string; readonly statusCode: number }
  | { readonly outcome: WebFingerLookupOutcome };

/**
 * Looks up a WebFinger resource, opening a fetch session per hop.  This is
 * the implementation of {@link lookupWebFinger}, which is not exported from
 * the package entry point.
 * @param resource The resource URL to look up.
 * @param options Extra options for looking up the resource.
 * @param deps The dependencies.
 * @returns The resource descriptor and terminal lookup classification.
 * @internal
 */
export async function lookupWebFingerInternal(
  resource: URL | string,
  options: LookupWebFingerOptions = {},
  deps: LookupWebFingerDependencies = {},
): Promise<WebFingerLookupOutcome> {
  if (typeof resource === "string") resource = new URL(resource);
  let protocol = "https:";
  let server: string;
  if (resource.protocol === "acct:" || resource.protocol === "mailto:") {
    // `acct:` (RFC 7565) and `mailto:` (RFC 6068, used as a WebFinger
    // resource per RFC 7033 §4.5) are opaque-path schemes: their
    // `user@host` authority lives in `pathname`, not in `host`.  The
    // WebFinger host is extracted from the substring after the last
    // `@`, and the lookup always goes to https on that host.
    const atPos = resource.pathname.lastIndexOf("@");
    if (atPos < 0) return { resource: null, result: "invalid" };
    server = resource.pathname.substring(atPos + 1);
    // The authority part of both schemes must be a bare host: no
    // path, query, or fragment characters embedded in it.  The
    // WHATWG URL parser routes anything after the first `?` or `#`
    // into `search` / `hash`, so by the time we read `pathname` the
    // only stray characters that can land in `server` are slashes.
    // Reject those (along with an empty authority) for both schemes.
    if (server === "" || /[/?#]/.test(server)) {
      return { resource: null, result: "invalid" };
    }
    // `acct:` (RFC 7565 §3) is bare authority only: no `search` or
    // `hash` allowed.  `mailto:` (RFC 6068 §2) explicitly permits
    // `?hfields=…` header fields and fragment identifiers, so we
    // forward those to the remote WebFinger lookup unchanged and
    // only enforce the stricter shape for `acct:`.
    if (
      resource.protocol === "acct:" &&
      (resource.search !== "" || resource.hash !== "")
    ) {
      return { resource: null, result: "invalid" };
    }
  } else {
    protocol = resource.protocol;
    server = resource.host;
  }
  let url = new URL(`${protocol}//${server}/.well-known/webfinger`);
  url.searchParams.set("resource", resource.href);
  const openHop = deps.openHop ??
    ((hopUrl: string) =>
      options.allowPrivateAddress === true
        ? openDirectFetch(hopUrl)
        : openPublicFetch(hopUrl, { signal: options.signal }));
  let redirected = 0;
  while (true) {
    logger.debug(
      "Fetching WebFinger resource descriptor from {url}...",
      { url: url.href },
    );
    const remoteHost = url.host;
    const session = await openSession(url, openHop, options.signal);
    if (session == null) {
      return { resource: null, result: "network_error", remoteHost };
    }
    let hop: HopResult;
    try {
      hop = await fetchHop(session, url, options);
    } finally {
      await session.close();
    }
    if ("outcome" in hop) return hop.outcome;
    redirected++;
    const maxRedirection = options.maxRedirection ?? DEFAULT_MAX_REDIRECTION;
    if (redirected > maxRedirection) {
      logger.error(
        "Too many redirections ({redirections}) while fetching WebFinger " +
          "resource descriptor.",
        { redirections: redirected },
      );
      return {
        resource: null,
        result: "invalid",
        statusCode: hop.statusCode,
        remoteHost,
      };
    }
    // The request URL is the base, since a pinned response's url can be an
    // IP address URL:
    let redirectedUrl: URL;
    try {
      redirectedUrl = new URL(hop.redirect, url);
    } catch (error) {
      logger.error(
        "Invalid Location header while following WebFinger redirect: {error}",
        { url: url.href, error },
      );
      return {
        resource: null,
        result: "invalid",
        statusCode: hop.statusCode,
        remoteHost,
      };
    }
    if (redirectedUrl.protocol !== url.protocol) {
      logger.error(
        "Redirected to a different protocol ({protocol} to " +
          "{redirectedProtocol}) while fetching WebFinger resource " +
          "descriptor.",
        {
          protocol: url.protocol,
          redirectedProtocol: redirectedUrl.protocol,
        },
      );
      return {
        resource: null,
        result: "invalid",
        statusCode: hop.statusCode,
        remoteHost,
      };
    }
    url = redirectedUrl;
  }
}

/**
 * Opens a fetch session for a hop.  A disallowed URL, a failed DNS lookup,
 * or an aborted lookup yields `null` instead of an error.
 */
async function openSession(
  url: URL,
  openHop: (url: string) => Promise<PublicFetchSession>,
  signal: AbortSignal | undefined,
): Promise<PublicFetchSession | null> {
  try {
    return await openHop(url.href);
  } catch (e) {
    if (e instanceof UrlError) {
      if (e.reason === "dns") {
        logger.debug("DNS lookup failed for {url}", {
          url: url.href,
          error: e,
        });
      } else {
        logger.error(
          "Invalid URL for WebFinger resource descriptor: {error}",
          { error: e },
        );
      }
      return null;
    }
    if (signal?.aborted) {
      logger.debug(
        "Failed to fetch WebFinger resource descriptor: {error}",
        { url: url.href, error: e },
      );
      return null;
    }
    throw e;
  }
}

/**
 * Fetches a hop with the given session, and consumes the response body or
 * starts cancelling it before returning.  The caller closes the session.
 */
async function fetchHop(
  session: PublicFetchSession,
  url: URL,
  options: LookupWebFingerOptions,
): Promise<HopResult> {
  let response: Response;
  try {
    response = await session.fetch(url, {
      headers: {
        Accept: "application/jrd+json",
        "User-Agent": typeof options.userAgent === "string"
          ? options.userAgent
          : getUserAgent(options.userAgent),
      },
      redirect: "manual",
      signal: options.signal,
    });
  } catch (error) {
    logger.debug(
      "Failed to fetch WebFinger resource descriptor: {error}",
      { url: url.href, error },
    );
    return {
      outcome: {
        resource: null,
        result: "network_error",
        remoteHost: url.host,
      },
    };
  }
  if (
    response.status >= 300 && response.status < 400 &&
    response.headers.has("Location")
  ) {
    cancelBody(response, url);
    return {
      redirect: response.headers.get("Location")!,
      statusCode: response.status,
    };
  }
  if (!response.ok) {
    logger.debug(
      "Failed to fetch WebFinger resource descriptor: {status} {statusText}.",
      {
        url: url.href,
        status: response.status,
        statusText: response.statusText,
      },
    );
    cancelBody(response, url);
    return {
      outcome: {
        resource: null,
        result: response.status === 404 || response.status === 410
          ? "not_found"
          : "error",
        statusCode: response.status,
        remoteHost: url.host,
      },
    };
  }
  try {
    const parsed: unknown = JSON.parse(
      await readBoundedText(response, MAX_BODY_SIZE, url),
    );
    // A JSON primitive, null, or array is not a resource descriptor.
    if (
      typeof parsed !== "object" || parsed === null || Array.isArray(parsed)
    ) {
      return {
        outcome: {
          resource: null,
          result: "invalid",
          statusCode: response.status,
          remoteHost: url.host,
        },
      };
    }
    return {
      outcome: {
        resource: parsed as ResourceDescriptor,
        result: "found",
        statusCode: response.status,
        remoteHost: url.host,
      },
    };
  } catch (e) {
    if (e instanceof BodyTooLargeError) {
      return {
        outcome: {
          resource: null,
          result: "invalid",
          statusCode: response.status,
          remoteHost: url.host,
        },
      };
    }
    if (e instanceof SyntaxError) {
      logger.debug(
        "Failed to parse WebFinger resource descriptor as JSON: {error}",
        { error: e },
      );
      return {
        outcome: {
          resource: null,
          result: "invalid",
          statusCode: response.status,
          remoteHost: url.host,
        },
      };
    }
    throw e;
  }
}

/**
 * Starts cancelling a response body that is not read, without waiting for it
 * to settle.  The cancellation of a branch of a tee (e.g., a body cloned by
 * a fetch mock) settles only after the other branch is cancelled too, per
 * the Streams standard, so awaiting it could block forever.  A failure is
 * only logged.
 */
function cancelBody(response: Response, url: URL): void {
  response.body?.cancel().catch((error) => {
    logger.debug(
      "Failed to cancel the response body from {url}: {error}",
      { url: url.href, error },
    );
  });
}
