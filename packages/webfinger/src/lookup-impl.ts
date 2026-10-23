import { getUserAgent, UrlError } from "@fedify/vocab-runtime";
import {
  openDirectFetch,
  openPublicFetch,
  type PublicFetchSession,
} from "@fedify/vocab-runtime/internal";
import { getLogger } from "@logtape/logtape";
import { BodyTooLargeError, MAX_BODY_SIZE, readBoundedText } from "./body.ts";
import type { ResourceDescriptor } from "./jrd.ts";
import type { LookupWebFingerOptions } from "./lookup.ts";

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
  | { readonly redirect: string }
  | { readonly result: ResourceDescriptor | null };

/**
 * Looks up a WebFinger resource, opening a fetch session per hop.  This is
 * the implementation of {@link lookupWebFinger}, which is not exported from
 * the package entry point.
 * @param resource The resource URL to look up.
 * @param options Extra options for looking up the resource.
 * @param deps The dependencies.
 * @returns The resource descriptor, or `null` if not found.
 * @internal
 */
export async function lookupWebFingerInternal(
  resource: URL | string,
  options: LookupWebFingerOptions = {},
  deps: LookupWebFingerDependencies = {},
): Promise<ResourceDescriptor | null> {
  if (typeof resource === "string") resource = new URL(resource);
  let protocol = "https:";
  let server: string;
  if (resource.protocol === "acct:") {
    const atPos = resource.pathname.lastIndexOf("@");
    if (atPos < 0) return null;
    server = resource.pathname.substring(atPos + 1);
    if (server === "") return null;
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
    const session = await openSession(url, openHop, options.signal);
    if (session == null) return null;
    let hop: HopResult;
    try {
      hop = await fetchHop(session, url, options);
    } finally {
      await session.close();
    }
    if ("result" in hop) return hop.result;
    redirected++;
    const maxRedirection = options.maxRedirection ?? DEFAULT_MAX_REDIRECTION;
    if (redirected >= maxRedirection) {
      logger.error(
        "Too many redirections ({redirections}) while fetching WebFinger " +
          "resource descriptor.",
        { redirections: redirected },
      );
      return null;
    }
    // The request URL is the base, since a pinned response's url can be an
    // IP address URL:
    const redirectedUrl = new URL(hop.redirect, url);
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
      return null;
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
      // TODO: When merging forward into 2.3-maintenance and later, where
      // this returns { resource: null, result: "network_error", remoteHost }
      // instead of null, keep that return value for both reasons.
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
    return { result: null };
  }
  if (
    response.status >= 300 && response.status < 400 &&
    response.headers.has("Location")
  ) {
    cancelBody(response, url);
    return { redirect: response.headers.get("Location")! };
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
    return { result: null };
  }
  try {
    return {
      result: JSON.parse(
        await readBoundedText(response, MAX_BODY_SIZE, url),
      ) as ResourceDescriptor,
    };
  } catch (e) {
    if (e instanceof BodyTooLargeError) return { result: null };
    if (e instanceof SyntaxError) {
      logger.debug(
        "Failed to parse WebFinger resource descriptor as JSON: {error}",
        { error: e },
      );
      return { result: null };
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
