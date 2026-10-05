import type { Logger } from "@logtape/logtape";
import process from "node:process";
import metadata from "../deno.json" with { type: "json" };
import { UrlError } from "./url.ts";

/**
 * Error thrown when fetching a JSON-LD document failed.
 */
export class FetchError extends Error {
  /**
   * The URL that failed to fetch.
   */
  url: URL;

  /**
   * The HTTP response that failed, if available.
   */
  response?: Response;

  /**
   * Constructs a new `FetchError`.
   *
   * @param url The URL that failed to fetch.
   * @param message Error message.
   * @param response The failed HTTP response, if available.
   */
  constructor(url: URL | string, message?: string, response?: Response) {
    super(message == null ? url.toString() : `${url}: ${message}`);
    this.name = "FetchError";
    this.url = typeof url === "string" ? new URL(url) : url;
    this.response = response;
  }
}

const MAX_CAUSE_DEPTH = 8;

/**
 * Guesses whether an error thrown by a document loader is transient,
 * i.e., whether fetching the same document again later could succeed.
 *
 * This is a heuristic classification, not a guarantee.  Callers that retry
 * on transient errors should still bound the number of retries.  The rules
 * are:
 *
 *  -  A {@link UrlError} is transient only if its
 *     {@link UrlError.reason | reason} is `"dns"`; URLs disallowed by SSRF
 *     protection are permanent.
 *  -  A {@link FetchError} with a {@link FetchError.response | response} is
 *     transient if the status is 5xx, 408 (Request Timeout), or 429 (Too Many
 *     Requests); other statuses such as 404 are permanent.
 *  -  A {@link FetchError} without a response is classified by its `cause`,
 *     which is how timeouts are reported.  Without a cause, it is permanent
 *     (e.g., redirect loops, too many redirections, or bodies that exceed the
 *     size limit).
 *  -  A `TimeoutError` or `AbortError` is transient.
 *  -  A `TypeError` from parsing an invalid URL is permanent; any other
 *     `TypeError` is transient, since `fetch()` reports network failures
 *     that way.
 *  -  A `SyntaxError` (a malformed JSON body) is permanent.
 *  -  An `AggregateError`, e.g., from trying several gateways, is transient
 *     if any of its errors is.
 *  -  Any other error is treated as transient.
 *
 * @param error The error thrown by a document loader.
 * @returns `true` if the error is likely transient, `false` if retrying is
 *          unlikely to help.
 * @since 2.5.0
 */
export function isTransientFetchError(error: unknown): boolean {
  return classifyFetchError(error, new Set(), 0);
}

function classifyFetchError(
  error: unknown,
  path: Set<unknown>,
  depth: number,
): boolean {
  // Only an error on the current path is a cycle; the same error can appear
  // in several branches, e.g., twice in an AggregateError:
  if (depth > MAX_CAUSE_DEPTH || path.has(error)) return true;
  path.add(error);
  try {
    return classifyErrorShape(error, path, depth);
  } finally {
    path.delete(error);
  }
}

function classifyErrorShape(
  error: unknown,
  path: Set<unknown>,
  depth: number,
): boolean {
  if (!(error instanceof Error) && !isNamedError(error)) return true;
  const name = (error as { readonly name: string }).name;
  if (error instanceof UrlError || name === "UrlError") {
    return (error as { readonly reason?: unknown }).reason === "dns";
  }
  if (name === "BodyTooLargeError") return false;
  if (error instanceof FetchError || name === "FetchError") {
    const response = (error as { readonly response?: unknown }).response;
    if (isResponseLike(response)) {
      const status = response.status;
      return status >= 500 || status === 408 || status === 429;
    }
    const cause = (error as { readonly cause?: unknown }).cause;
    if (cause == null) return false;
    return classifyFetchError(cause, path, depth + 1);
  }
  if (error instanceof AggregateError || name === "AggregateError") {
    const errors = (error as { readonly errors?: unknown }).errors;
    if (!Array.isArray(errors) || errors.length < 1) return true;
    return errors.some((e) => classifyFetchError(e, path, depth + 1));
  }
  if (name === "TimeoutError" || name === "AbortError") return true;
  if (error instanceof TypeError || name === "TypeError") {
    // Node.js's fetch() wraps the URL parsing error as its cause:
    const cause = (error as { readonly cause?: unknown }).cause;
    return !isInvalidUrlError(error) && !isInvalidUrlError(cause);
  }
  if (error instanceof SyntaxError || name === "SyntaxError") return false;
  return true;
}

function isNamedError(error: unknown): boolean {
  return typeof error === "object" && error != null &&
    typeof (error as { readonly name?: unknown }).name === "string";
}

function isResponseLike(
  value: unknown,
): value is { readonly status: number } {
  return typeof value === "object" && value != null &&
    typeof (value as { readonly status?: unknown }).status === "number";
}

function isInvalidUrlError(error: unknown): boolean {
  if (typeof error !== "object" || error == null) return false;
  const { code, message } = error as {
    readonly code?: unknown;
    readonly message?: unknown;
  };
  return code === "ERR_INVALID_URL" ||
    typeof message === "string" && message.startsWith("Invalid URL");
}

/**
 * The `Accept` header value for fetching ActivityPub objects.  ActivityPub
 * and FEP-ef61 gateways require the ActivityStreams profile on the JSON-LD
 * media type.
 */
const ACTIVITYPUB_ACCEPT =
  'application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams"';

/**
 * Options for creating a request.
 * @internal
 */
export interface CreateRequestOptions {
  userAgent?: GetUserAgentOptions | string;
}

/**
 * Creates a request for the given URL.
 * @param url The URL to create the request for.
 * @param options The options for the request.
 * @returns The created request.
 * @internal
 */
export function createActivityPubRequest(
  url: string,
  options: CreateRequestOptions = {},
): Request {
  return new Request(url, {
    headers: {
      Accept: ACTIVITYPUB_ACCEPT,
      "User-Agent": typeof options.userAgent === "string"
        ? options.userAgent
        : getUserAgent(options.userAgent),
    },
    redirect: "manual",
  });
}

/**
 * Options for making `User-Agent` string.
 * @see {@link getUserAgent}
 * @since 1.3.0
 */
export interface GetUserAgentOptions {
  /**
   * An optional software name and version, e.g., `"Hollo/1.0.0"`.
   */
  software?: string | null;
  /**
   * An optional URL to append to the user agent string.
   * Usually the URL of the ActivityPub instance.
   */
  url?: string | URL | null;
}

/**
 * Gets the user agent string for the given application and URL.
 * @param options The options for making the user agent string.
 * @returns The user agent string.
 * @since 1.3.0
 */
export function getUserAgent(
  { software, url }: GetUserAgentOptions = {},
): string {
  const fedify = `Fedify/${metadata.version}`;
  const runtime = globalThis.Deno?.version?.deno != null
    ? `Deno/${Deno.version.deno}`
    : globalThis.process?.versions?.bun != null
    ? `Bun/${process.versions.bun}`
    : "navigator" in globalThis &&
        navigator.userAgent === "Cloudflare-Workers"
    ? navigator.userAgent
    : globalThis.process?.versions?.node != null
    ? `Node.js/${process.versions.node}`
    : null;
  const userAgent = software == null ? [fedify] : [software, fedify];
  if (runtime != null) userAgent.push(runtime);
  if (url != null) userAgent.push(`+${url.toString()}`);
  const first = userAgent.shift();
  return `${first} (${userAgent.join("; ")})`;
}

/**
 * Logs the request.
 * @param request The request to log.
 * @internal
 */
export function logRequest(logger: Logger, request: Request): void {
  logger.debug(
    "Fetching document: {method} {url} {headers}",
    {
      method: request.method,
      url: request.url,
      headers: Object.fromEntries(request.headers.entries()),
    },
  );
}
