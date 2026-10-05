import { getLogger } from "@logtape/logtape";
import { SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import metadata from "../deno.json" with { type: "json" };
import {
  BodyTooLargeError,
  MAX_BODY_SIZE,
  readBoundedBytes,
  readBoundedText,
} from "./body.ts";
import preloadedContexts from "./contexts.ts";
import { HttpHeaderLink } from "./link.ts";
import {
  createActivityPubRequest,
  FetchError,
  type GetUserAgentOptions,
  logRequest,
} from "./request.ts";
import { UrlError, validatePublicUrl } from "./url.ts";

const logger = getLogger(["fedify", "runtime", "docloader"]);
const DEFAULT_MAX_REDIRECTION = 20;
const MAX_HTML_SIZE = 1024 * 1024; // 1MB
const MAX_ERROR_BODY_SIZE = 1024 * 1024; // 1MB
const DEFAULT_TIMEOUT = 10_000; // 10 seconds
// The maximum delay setTimeout() accepts; larger values fire immediately
// on some runtimes:
const MAX_TIMEOUT = 2_147_483_647;

/**
 * A remote JSON-LD document and its context fetched by
 * a {@link DocumentLoader}.
 */
export interface RemoteDocument {
  /**
   * The URL of the context document.
   */
  contextUrl: string | null;

  /**
   * The fetched JSON-LD document.
   */
  document: unknown;

  /**
   * The URL of the fetched document.
   */
  documentUrl: string;
}

/**
 * Options for {@link DocumentLoader}.
 * @since 1.8.0
 */
export interface DocumentLoaderOptions {
  /**
   * An `AbortSignal` for cancellation.
   * @since 1.8.0
   */
  signal?: AbortSignal;

  /**
   * Whether to lower error-level logs for recoverable document loading
   * failures to warning-level logs.  The loader still throws the error.
   * @default `false`
   * @since 2.4.0
   */
  suppressError?: boolean;
}

/**
 * A JSON-LD document loader that fetches documents from the Web.
 * @param url The URL of the document to load.
 * @param options The options for the document loader.
 * @returns The loaded remote document.
 */
export type DocumentLoader = (
  url: string,
  options?: DocumentLoaderOptions,
) => Promise<RemoteDocument>;

/**
 * A factory function that creates a {@link DocumentLoader} with options.
 * @param options The options for the document loader.
 * @returns The document loader.
 * @since 1.4.0
 */
export type DocumentLoaderFactory = (
  options?: DocumentLoaderFactoryOptions,
) => DocumentLoader;

/**
 * Options for {@link DocumentLoaderFactory}.
 * @see {@link DocumentLoaderFactory}
 * @see {@link AuthenticatedDocumentLoaderFactory}
 * @since 1.4.0
 */
export interface DocumentLoaderFactoryOptions {
  /**
   * Whether to allow fetching private network addresses.
   * Turned off by default.
   * @default `false``
   */
  allowPrivateAddress?: boolean;

  /**
   * Options for making `User-Agent` string.
   * If a string is given, it is used as the `User-Agent` header value.
   * If an object is given, it is passed to {@link getUserAgent} function.
   */
  userAgent?: GetUserAgentOptions | string;

  /**
   * The maximum number of redirections to follow.
   * @default `20`
   * @since 2.2.0
   */
  maxRedirection?: number;

  /**
   * The timeout in milliseconds for each call of the created document
   * loader.  The timeout is shared by all the steps of a call, including
   * URL validation, every HTTP redirect and alternate document link it
   * follows, retries, and reading the response body; it does not restart
   * for each of them.  It does not interrupt synchronous work such as
   * parsing a document that has already been received.
   *
   * When a call times out, the loader throws a {@link FetchError} without
   * a {@link FetchError.response}, whose `cause` is a `DOMException` named
   * `"TimeoutError"`.  An `AbortSignal` passed through
   * {@link DocumentLoaderOptions.signal} still cancels a call; in that case
   * the loader throws the signal's reason as before.
   *
   * Fractional values are rounded up.  Set it to `null` to turn off the
   * timeout.
   * @default `10000` (10 seconds)
   * @throws {RangeError} If the value is not a positive finite number or is
   *                      greater than 2,147,483,647 (about 24.8 days).
   * @since 2.4.0
   */
  timeout?: number | null;
}

/**
 * A factory function that creates an authenticated {@link DocumentLoader} for
 * a given identity.  This is used for fetching documents that require
 * authentication.
 * @param identity The identity to create the document loader for.
 *                 The actor's key pair.
 * @param options The options for the document loader.
 * @returns The authenticated document loader.
 * @since 0.4.0
 */
export type AuthenticatedDocumentLoaderFactory = (
  identity: { keyId: URL; privateKey: CryptoKey },
  options?: DocumentLoaderFactoryOptions,
) => DocumentLoader;

function createResponseMetadata(response: Response): Response {
  return new Response(null, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
}

const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([204, 205, 304]);

/**
 * Reads the body of an error response while the document loader is still
 * running, so that its timeout and `AbortSignal` also bound the read, and
 * nothing reading {@link FetchError.response} later waits on the network.
 * The body is kept byte for byte, unless it is too large or cannot be read;
 * then only the status and headers are kept.  A response whose status
 * the `Response` constructor does not accept (e.g., 999) is kept as a clone
 * whose body has been read in full; if its body is too large or cannot be
 * read, no response is kept at all.
 */
async function bufferErrorResponse(
  response: Response,
  url: string,
  signal?: AbortSignal,
): Promise<Response | undefined> {
  if (response.status < 200 || response.status > 599) {
    // Such a response cannot be rebuilt, so keep a clone instead, and read
    // the original to the end so that the clone's body is buffered too:
    const clone = response.clone();
    try {
      await readBoundedBytes(response, MAX_ERROR_BODY_SIZE, url);
    } catch (error) {
      await clone.body?.cancel().catch(() => {});
      if (signal?.aborted) throw error;
      logger.debug(
        "Failed to read the error response body from {url}: {error}",
        { url, error },
      );
      return undefined;
    }
    return clone;
  }
  if (response.body == null || NULL_BODY_STATUSES.has(response.status)) {
    return createResponseMetadata(response);
  }
  let body: Uint8Array<ArrayBuffer>;
  try {
    body = await readBoundedBytes(response, MAX_ERROR_BODY_SIZE, url);
  } catch (error) {
    if (signal?.aborted) throw error;
    logger.debug(
      "Failed to read the error response body from {url}: {error}",
      { url, error },
    );
    return createResponseMetadata(response);
  }
  return new Response(body, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
}

/**
 * Gets a {@link RemoteDocument} from the given response.
 * @param url The URL of the document to load.
 * @param response The response to get the document from.
 * @param fetch The function to fetch the document.
 * @param options The options for loading the document.
 * @returns The loaded remote document.
 * @throws {FetchError} If the response is not OK.
 * @internal
 */
export async function getRemoteDocument(
  url: string,
  response: Response,
  fetch: (
    url: string,
    options?: DocumentLoaderOptions,
  ) => Promise<RemoteDocument>,
  options?: DocumentLoaderOptions,
): Promise<RemoteDocument> {
  const documentUrl = response.url === "" ? url : response.url;
  const docUrl = new URL(documentUrl);
  if (!response.ok) {
    if (options?.suppressError) {
      logger.warn(
        "Failed to fetch document: {status} {url} {headers}",
        {
          status: response.status,
          url: documentUrl,
          headers: Object.fromEntries(response.headers.entries()),
        },
      );
    } else {
      logger.error(
        "Failed to fetch document: {status} {url} {headers}",
        {
          status: response.status,
          url: documentUrl,
          headers: Object.fromEntries(response.headers.entries()),
        },
      );
    }

    throw new FetchError(
      documentUrl,
      `HTTP ${response.status}: ${documentUrl}`,
      await bufferErrorResponse(response, documentUrl, options?.signal),
    );
  }
  const contentType = response.headers.get("Content-Type");
  const jsonLd = contentType == null ||
    contentType === "application/activity+json" ||
    contentType.startsWith("application/activity+json;") ||
    contentType === "application/ld+json" ||
    contentType.startsWith("application/ld+json;");
  const linkHeader = response.headers.get("Link");
  let contextUrl: string | null = null;
  if (linkHeader != null) {
    let link: HttpHeaderLink;
    try {
      link = new HttpHeaderLink(linkHeader);
    } catch (e) {
      if (e instanceof SyntaxError) {
        link = new HttpHeaderLink();
      } else {
        throw e;
      }
    }
    if (jsonLd) {
      const entries = link.getByRel("http://www.w3.org/ns/json-ld#context");
      for (const [uri, params] of entries) {
        if ("type" in params && params.type === "application/ld+json") {
          contextUrl = uri;
          break;
        }
      }
    } else {
      const entries = link.getByRel("alternate");
      for (const [uri, params] of entries) {
        const altUri = new URL(uri, docUrl);
        if (
          "type" in params &&
          (params.type === "application/activity+json" ||
            params.type === "application/ld+json" ||
            params.type.startsWith("application/ld+json;")) &&
          altUri.href !== docUrl.href
        ) {
          logger.debug(
            "Found alternate document: {alternateUrl} from {url}",
            { alternateUrl: altUri.href, url: documentUrl },
          );
          return await fetch(altUri.href, options);
        }
      }
    }
  }
  let document: unknown;
  if (
    !jsonLd &&
    (contentType === "text/html" || contentType?.startsWith("text/html;") ||
      contentType === "application/xhtml+xml" ||
      contentType?.startsWith("application/xhtml+xml;"))
  ) {
    const errorResponse = createResponseMetadata(response);
    let html: string;
    try {
      html = await readBoundedText(response, MAX_HTML_SIZE, documentUrl);
    } catch (error) {
      if (!(error instanceof BodyTooLargeError)) throw error;
      logger.warn(
        "HTML response too large, skipping alternate link discovery: {url}",
        { url: documentUrl, maxBytes: MAX_HTML_SIZE },
      );
      throw new FetchError(
        documentUrl,
        `HTML document is too large to scan for an ActivityPub alternate link ` +
          `(Content-Type: ${contentType})`,
        errorResponse,
      );
    }
    // Safe regex patterns without nested quantifiers to prevent ReDoS
    // (CVE-2025-68475)
    // Step 1: Extract <a ...> or <link ...> tags
    const tagPattern = /<(a|link)\s+([^>]*?)\s*\/?>/gi;
    // Step 2: Parse attributes
    const attrPattern = /([a-z][a-z:_-]*)=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

    let tagMatch: RegExpExecArray | null;
    while ((tagMatch = tagPattern.exec(html)) !== null) {
      const tagContent = tagMatch[2];
      let attrMatch: RegExpExecArray | null;
      const attribs: Record<string, string> = {};

      // Reset regex state for attribute parsing
      attrPattern.lastIndex = 0;
      while ((attrMatch = attrPattern.exec(tagContent)) !== null) {
        const key = attrMatch[1].toLowerCase();
        const value = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? "";
        attribs[key] = value;
      }

      if (
        attribs.rel === "alternate" && "type" in attribs && (
          attribs.type === "application/activity+json" ||
          attribs.type === "application/ld+json" ||
          attribs.type.startsWith("application/ld+json;")
        ) && "href" in attribs &&
        new URL(attribs.href, docUrl).href !== docUrl.href
      ) {
        logger.debug(
          "Found alternate document: {alternateUrl} from {url}",
          { alternateUrl: attribs.href, url: documentUrl },
        );
        return await fetch(new URL(attribs.href, docUrl).href, options);
      }
    }
    try {
      document = JSON.parse(html);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      throw new FetchError(
        documentUrl,
        `HTML document has no ActivityPub alternate link ` +
          `(Content-Type: ${contentType})`,
        errorResponse,
      );
    }
  } else {
    document = JSON.parse(
      await readBoundedText(response, MAX_BODY_SIZE, documentUrl),
    );
  }
  logger.debug(
    "Fetched document: {status} {url} {headers}",
    {
      status: response.status,
      url: documentUrl,
      headers: Object.fromEntries(response.headers.entries()),
    },
  );
  return { contextUrl, document, documentUrl };
}

/**
 * Resolves {@link DocumentLoaderFactoryOptions.timeout} into milliseconds.
 * @param timeout The timeout option.  `undefined` means the default timeout,
 *                and `null` means no timeout.
 * @returns The timeout in milliseconds, or `null` if it is turned off.
 * @throws {RangeError} If the timeout is invalid.
 * @internal
 */
export function resolveDocumentLoaderTimeout(
  timeout: number | null | undefined,
): number | null {
  if (timeout === undefined) return DEFAULT_TIMEOUT;
  if (timeout === null) return null;
  if (
    typeof timeout !== "number" || !Number.isFinite(timeout) || timeout <= 0
  ) {
    throw new RangeError(
      `The document loader timeout must be a positive finite number of ` +
        `milliseconds, but got ${String(timeout)}.`,
    );
  }
  const ms = Math.ceil(timeout);
  if (ms > MAX_TIMEOUT) {
    throw new RangeError(
      `The document loader timeout must not be greater than ${MAX_TIMEOUT} ` +
        `milliseconds, but got ${timeout}.`,
    );
  }
  return ms;
}

/**
 * Bounds each call of the given document loader by the given timeout.
 * The timeout is combined with the caller's `signal`, and the combined
 * signal is passed to the loader.  The call settles no later than the
 * timeout even if the loader is stuck in a step that cannot be aborted,
 * e.g., a DNS lookup.
 *
 * A timed-out call throws a {@link FetchError} without a response, whose
 * `cause` is a `DOMException` named `"TimeoutError"`.  If the caller's
 * signal is aborted, its reason is thrown instead.
 * @param loader The document loader to bound.
 * @param timeout The timeout in milliseconds, or `null` for no timeout.
 *                It is assumed to have been resolved by
 *                {@link resolveDocumentLoaderTimeout}.
 * @returns The bounded document loader.
 * @internal
 */
export function withDocumentLoaderTimeout(
  loader: DocumentLoader,
  timeout: number | null,
): DocumentLoader {
  if (timeout == null) return loader;
  return async (url, options) => {
    const callerSignal = options?.signal;
    callerSignal?.throwIfAborted();
    const controller = new AbortController();
    const timeoutReason = new DOMException(
      `The document loader timed out after ${timeout} ms.`,
      "TimeoutError",
    );
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(timeoutReason);
    }, timeout);
    const onCallerAbort = () => controller.abort(callerSignal?.reason);
    callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener("abort", onAbort, { once: true });
    });
    const loading = loader(url, { ...options, signal: controller.signal });
    // If the abort wins the race, the loader's late rejection is ignored:
    loading.catch(() => {});
    try {
      return await Promise.race([loading, aborted]);
    } catch (error) {
      if (callerSignal?.aborted) throw callerSignal.reason;
      if (!timedOut) throw error;
      logger[options?.suppressError ? "warn" : "error"](
        "Timed out after {timeout} ms while fetching document: {url}",
        { timeout, url },
      );
      const fetchError = new FetchError(url, `Timed out after ${timeout} ms`);
      fetchError.cause = timeoutReason;
      throw fetchError;
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onCallerAbort);
      if (onAbort != null) {
        controller.signal.removeEventListener("abort", onAbort);
      }
    }
  };
}

/**
 * Options for {@link getDocumentLoader}.
 * @since 1.3.0
 */
export interface GetDocumentLoaderOptions extends DocumentLoaderFactoryOptions {
  /**
   * Whether to preload the frequently used contexts.
   */
  skipPreloadedContexts?: boolean;
}

/**
 * Creates a JSON-LD document loader that utilizes the browser's `fetch` API.
 * At most 20 HTTP redirects and alternate document links are followed in total
 * per call.  Revisiting a URL within that chain throws a {@link FetchError}.
 * Each call times out after 10 seconds by default; see
 * {@link DocumentLoaderFactoryOptions.timeout}.
 *
 * The created loader preloads the below frequently used contexts by default
 * (unless `options.skipPreloadedContexts` is set to `true`):
 *
 * - <https://www.w3.org/ns/activitystreams>
 * - <https://w3id.org/security/v1>
 * - <https://w3id.org/security/data-integrity/v1>
 * - <https://w3id.org/security/data-integrity/v2>
 * - <https://www.w3.org/ns/did/v1>
 * - <https://www.w3.org/ns/cid/v1>
 * - <https://w3id.org/security/multikey/v1>
 * - <https://w3id.org/fep/ef61>
 * - <https://w3id.org/fep/7aa9>
 * - <https://w3id.org/fep/6757>
 * - <https://w3id.org/fep/22cd>
 * - <https://purl.archive.org/socialweb/webfinger>
 * - <http://schema.org/>
 * @param options Options for the document loader.
 * @returns The document loader.
 * @since 1.3.0
 */
export function getDocumentLoader(
  {
    allowPrivateAddress,
    maxRedirection,
    skipPreloadedContexts,
    timeout,
    userAgent,
  }: GetDocumentLoaderOptions = {},
): DocumentLoader {
  const resolvedTimeout = resolveDocumentLoaderTimeout(timeout);
  const tracerProvider = trace.getTracerProvider();
  const tracer = tracerProvider.getTracer(metadata.name, metadata.version);
  const maximumRedirection = maxRedirection ?? DEFAULT_MAX_REDIRECTION;

  async function load(
    url: string,
    options?: DocumentLoaderOptions,
    redirected = 0,
    visited = new Set<string>(),
  ): Promise<RemoteDocument> {
    options?.signal?.throwIfAborted();
    const currentUrl = new URL(url).href;
    if (!skipPreloadedContexts && currentUrl in preloadedContexts) {
      logger.debug("Using preloaded context: {url}.", { url: currentUrl });
      return {
        contextUrl: null,
        document: preloadedContexts[currentUrl],
        documentUrl: currentUrl,
      };
    }
    if (!allowPrivateAddress) {
      try {
        await validatePublicUrl(currentUrl);
      } catch (error) {
        if (error instanceof UrlError) {
          if (error.reason === "dns") {
            logger.debug("DNS lookup failed for {url}", {
              url: currentUrl,
              error,
            });
          } else {
            logger[options?.suppressError ? "warn" : "error"](
              "Disallowed private URL: {url}",
              {
                url: currentUrl,
                error,
              },
            );
          }
        }
        throw error;
      }
      // The DNS lookup cannot be aborted, so do not go on if the call was
      // aborted or timed out in the meantime:
      options?.signal?.throwIfAborted();
    }
    visited.add(currentUrl);

    return await tracer.startActiveSpan(
      "activitypub.fetch_document",
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "url.full": currentUrl,
        },
      },
      async (span) => {
        try {
          const request = createActivityPubRequest(currentUrl, { userAgent });
          logRequest(logger, request);
          const response = await fetch(request, {
            // Since Bun has a bug that ignores the `Request.redirect` option,
            // to work around it we specify `redirect: "manual"` here too:
            // https://github.com/oven-sh/bun/issues/10754
            redirect: "manual",
            signal: options?.signal,
          });
          span.setAttribute("http.response.status_code", response.status);

          // Follow redirects manually to get the final URL:
          if (
            response.status >= 300 && response.status < 400 &&
            response.headers.has("Location")
          ) {
            if (redirected >= maximumRedirection) {
              logger[options?.suppressError ? "warn" : "error"](
                "Too many redirections ({redirections}) while fetching document.",
                { redirections: redirected + 1, url: currentUrl },
              );
              throw new FetchError(
                currentUrl,
                `Too many redirections (${redirected + 1})`,
              );
            }
            const redirectUrl = new URL(
              response.headers.get("Location")!,
              response.url === "" ? currentUrl : response.url,
            ).href;
            span.setAttribute("http.redirect.url", redirectUrl);
            if (visited.has(redirectUrl)) {
              logger[options?.suppressError ? "warn" : "error"](
                "Detected a redirect loop while fetching document: {url} -> " +
                  "{redirectUrl}",
                { url: currentUrl, redirectUrl },
              );
              throw new FetchError(
                currentUrl,
                `Redirect loop detected: ${redirectUrl}`,
              );
            }
            return await load(redirectUrl, options, redirected + 1, visited);
          }

          const result = await getRemoteDocument(
            currentUrl,
            response,
            async (alternateUrl) => {
              options?.signal?.throwIfAborted();
              if (redirected >= DEFAULT_MAX_REDIRECTION) {
                throw new FetchError(
                  currentUrl,
                  `Too many redirections (${redirected + 1})`,
                );
              }
              if (visited.has(alternateUrl)) {
                throw new FetchError(
                  currentUrl,
                  `Redirect loop detected: ${alternateUrl}`,
                );
              }
              return await load(alternateUrl, options, redirected + 1, visited);
            },
            options,
          );
          span.setAttribute("docloader.document_url", result.documentUrl);
          if (result.contextUrl != null) {
            span.setAttribute("docloader.context_url", result.contextUrl);
          }
          return result;
        } catch (error) {
          span.recordException(error as Error);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: String(error),
          });
          throw error;
        } finally {
          span.end();
        }
      },
    );
  }
  return withDocumentLoaderTimeout(
    (url, options) => load(url, options),
    resolvedTimeout,
  );
}
