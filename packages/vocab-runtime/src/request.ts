import type { Logger } from "@logtape/logtape";
import process from "node:process";
import metadata from "../deno.json" with { type: "json" };

/**
 * Error thrown when fetching a JSON-LD document failed.
 */
export class FetchError extends Error {
  /**
   * The URL that failed to fetch.
   */
  url: URL;

  /**
   * Constructs a new `FetchError`.
   *
   * @param url The URL that failed to fetch.
   * @param message Error message.
   */
  constructor(url: URL | string, message?: string) {
    super(message == null ? url.toString() : `${url}: ${message}`);
    this.name = "FetchError";
    this.url = typeof url === "string" ? new URL(url) : url;
  }
}

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
      Accept: "application/activity+json, application/ld+json",
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
