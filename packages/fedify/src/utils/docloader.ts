import {
  createActivityPubRequest,
  type DocumentLoader,
  type DocumentLoaderFactoryOptions,
  type DocumentLoaderOptions,
  FetchError,
  getRemoteDocument,
  logRequest,
  type RemoteDocument,
  resolveDocumentLoaderTimeout,
  UrlError,
  validatePublicUrl,
  withDocumentLoaderTimeout,
} from "@fedify/vocab-runtime";
import { getLogger } from "@logtape/logtape";
import type { TracerProvider } from "@opentelemetry/api";
import { curry } from "es-toolkit";
import {
  doubleKnock,
  type HttpMessageSignaturesSpecDeterminer,
} from "../sig/http.ts";
import { validateCryptoKey } from "../sig/key.ts";

const logger = getLogger(["fedify", "utils", "docloader"]);
const DEFAULT_MAX_REDIRECTION = 20;

/**
 * Options for {@link getAuthenticatedDocumentLoader}.
 * @see {@link getAuthenticatedDocumentLoader}
 * @since 1.3.0
 */
export interface GetAuthenticatedDocumentLoaderOptions
  extends DocumentLoaderFactoryOptions {
  /**
   * An optional spec determiner for HTTP Message Signatures.
   * It determines the spec to use for signing requests.
   * It is used for double-knocking
   * (see <https://swicg.github.io/activitypub-http-signature/#how-to-upgrade-supported-versions>).
   * @since 1.6.0
   */
  specDeterminer?: HttpMessageSignaturesSpecDeterminer;

  /**
   * The OpenTelemetry tracer provider.  If omitted, the global tracer provider
   * is used.
   * @since 1.6.0
   */
  tracerProvider?: TracerProvider;
}

/**
 * Gets an authenticated {@link DocumentLoader} for the given identity.
 * Note that an authenticated document loader intentionally does not cache
 * the fetched documents.
 * At most 20 HTTP redirects and alternate document links are followed in total
 * per call.  Revisiting a URL within that chain throws a {@link FetchError}.
 * Each call, including its double-knocking retries, times out after
 * 10 seconds by default; see {@link DocumentLoaderFactoryOptions.timeout}.
 * @param identity The identity to get the document loader for.
 *                 The actor's key pair.
 * @param options The options for the document loader.
 * @returns The authenticated document loader.
 * @throws {TypeError} If the key is invalid or unsupported.
 * @throws {RangeError} If the `timeout` option is invalid.
 * @since 0.4.0
 */
export function getAuthenticatedDocumentLoader(
  identity: { keyId: URL; privateKey: CryptoKey },
  {
    allowPrivateAddress,
    maxRedirection,
    userAgent,
    specDeterminer,
    timeout,
    tracerProvider,
  }: GetAuthenticatedDocumentLoaderOptions = {},
): DocumentLoader {
  validateCryptoKey(identity.privateKey);
  const resolvedTimeout = resolveDocumentLoaderTimeout(timeout);
  async function load(
    url: string,
    options?: DocumentLoaderOptions,
    redirected = 0,
    visited = new Set<string>(),
  ): Promise<RemoteDocument> {
    options?.signal?.throwIfAborted();
    let currentUrl = new URL(url).href;
    await validateUrl(currentUrl, options);
    visited.add(currentUrl);
    const originalRequest = createActivityPubRequest(currentUrl, { userAgent });
    function follow(nextUrl: string): void {
      options?.signal?.throwIfAborted();
      if (redirected >= DEFAULT_MAX_REDIRECTION) {
        throw new FetchError(
          currentUrl,
          `Too many redirections (${redirected + 1})`,
        );
      }
      if (visited.has(nextUrl)) {
        throw new FetchError(
          currentUrl,
          `Redirect loop detected: ${nextUrl}`,
        );
      }
      redirected++;
    }
    const response = await doubleKnock(
      originalRequest,
      identity,
      {
        maxRedirection,
        specDeterminer,
        log: curry(logRequest)(logger),
        tracerProvider,
        signal: options?.signal,
        validateRedirect: async (nextUrl) => {
          follow(nextUrl);
          await validateUrl(nextUrl, options);
          visited.add(nextUrl);
          currentUrl = nextUrl;
        },
      },
    );
    options?.signal?.throwIfAborted();
    return getRemoteDocument(currentUrl, response, (alternateUrl) => {
      follow(alternateUrl);
      return load(alternateUrl, options, redirected, visited);
    }, options);
  }

  async function validateUrl(
    url: string,
    options?: DocumentLoaderOptions,
  ): Promise<void> {
    const protocol = new URL(url).protocol;
    if (protocol !== "http:" && protocol !== "https:") {
      throw new UrlError(`Unsupported protocol: ${protocol}`);
    }
    if (!allowPrivateAddress) {
      try {
        await validatePublicUrl(url);
      } catch (error) {
        if (error instanceof UrlError) {
          if (error.reason === "dns") {
            logger.debug("DNS lookup failed for {url}", { url, error });
          } else {
            logger[options?.suppressError ? "warn" : "error"](
              "Disallowed private URL: {url}",
              { url, error },
            );
          }
        }
        throw error;
      }
      // The DNS lookup cannot be aborted, so do not go on if the call was
      // aborted or timed out in the meantime:
      options?.signal?.throwIfAborted();
    }
  }
  return withDocumentLoaderTimeout(
    (url, options) => load(url, options),
    resolvedTimeout,
  );
}
