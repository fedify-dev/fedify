import {
  createActivityPubRequest,
  type DocumentLoader,
  type DocumentLoaderFactoryOptions,
  type DocumentLoaderOptions,
  FetchError,
  getRemoteDocument,
  logRequest,
  type RemoteDocument,
  UrlError,
} from "@fedify/vocab-runtime";
import {
  openDirectFetch,
  openPublicFetch,
  type PublicFetchSession,
} from "@fedify/vocab-runtime/internal";
import { getLogger } from "@logtape/logtape";
import type { TracerProvider } from "@opentelemetry/api";
import { curry } from "es-toolkit";
import {
  type DoubleKnockOpenHop,
  doubleKnockScoped,
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
 * @param identity The identity to get the document loader for.
 *                 The actor's key pair.
 * @param options The options for the document loader.
 * @returns The authenticated document loader.
 * @throws {TypeError} If the key is invalid or unsupported.
 * @since 0.4.0
 */
export function getAuthenticatedDocumentLoader(
  identity: { keyId: URL; privateKey: CryptoKey },
  options: GetAuthenticatedDocumentLoaderOptions = {},
): DocumentLoader {
  return createAuthenticatedDocumentLoader(identity, options);
}

/**
 * The dependencies of {@link createAuthenticatedDocumentLoader}, for tests.
 */
export interface AuthenticatedDocumentLoaderDependencies {
  /**
   * Opens a fetch session for each hop, instead of `openPublicFetch()` (or
   * `openDirectFetch()` if private addresses are allowed).
   */
  readonly openHop?: DoubleKnockOpenHop;
}

/**
 * The placeholder that the alternate document callback of
 * `getRemoteDocument()` returns, so that the alternate document is loaded
 * after the current hop is closed.
 */
const ALTERNATE_PLACEHOLDER: RemoteDocument = Object.freeze({
  contextUrl: null,
  document: null,
  documentUrl: "about:blank",
});

type LoadResult =
  | { readonly document: RemoteDocument }
  | { readonly alternateUrl: string };

/**
 * The implementation of {@link getAuthenticatedDocumentLoader}.  This is not
 * exported from any entry point.
 * @param identity The identity to get the document loader for.
 * @param options The options for the document loader.
 * @param deps The dependencies, for tests.
 * @returns The authenticated document loader.
 * @throws {TypeError} If the key is invalid or unsupported.
 */
export function createAuthenticatedDocumentLoader(
  identity: { keyId: URL; privateKey: CryptoKey },
  { allowPrivateAddress, userAgent, specDeterminer, tracerProvider }:
    GetAuthenticatedDocumentLoaderOptions = {},
  deps: AuthenticatedDocumentLoaderDependencies = {},
): DocumentLoader {
  validateCryptoKey(identity.privateKey);
  async function load(
    url: string,
    options?: DocumentLoaderOptions,
    redirected = 0,
    visited = new Set<string>(),
  ): Promise<RemoteDocument> {
    options?.signal?.throwIfAborted();
    let currentUrl = new URL(url).href;
    validateUrl(currentUrl);
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
    const result = await doubleKnockScoped<LoadResult>(
      originalRequest,
      identity,
      {
        specDeterminer,
        log: curry(logRequest)(logger),
        tracerProvider,
        signal: options?.signal,
        validateRedirect: (nextUrl) => {
          follow(nextUrl);
          // Addresses are validated when the next hop is opened:
          validateUrl(nextUrl);
          visited.add(nextUrl);
          currentUrl = nextUrl;
        },
      },
      (hopUrl) => openHop(hopUrl, options?.signal),
      async (response) => {
        let alternateUrl: string | undefined;
        const document = await getRemoteDocument(
          currentUrl,
          response,
          (url) => {
            alternateUrl = url;
            return Promise.resolve(ALTERNATE_PLACEHOLDER);
          },
        );
        if (alternateUrl == null) return { document };
        // A Link header alternate leaves the body unread.  getRemoteDocument()
        // has already started cancelling it then; otherwise, start it here
        // without awaiting, since the cancellation of a tee branch (e.g., a
        // body cloned by a fetch mock) may never settle:
        if (!response.bodyUsed && response.body?.locked !== true) {
          response.body?.cancel().catch((error) => {
            logger.debug(
              "Failed to cancel the response body from {url}: {error}",
              { url: currentUrl, error },
            );
          });
        }
        return { alternateUrl };
      },
    );
    if ("document" in result) return result.document;
    // The alternate document is loaded after the current hop is closed:
    follow(result.alternateUrl);
    return load(result.alternateUrl, options, redirected, visited);
  }

  function openUnvalidatedHop(
    url: string,
    signal?: AbortSignal,
  ): Promise<PublicFetchSession> {
    if (deps.openHop != null) return deps.openHop(url);
    return allowPrivateAddress
      ? openDirectFetch(url)
      : openPublicFetch(url, { signal });
  }

  async function openHop(
    url: string,
    signal?: AbortSignal,
  ): Promise<PublicFetchSession> {
    try {
      return await openUnvalidatedHop(url, signal);
    } catch (error) {
      if (error instanceof UrlError) {
        if (error.reason === "dns") {
          logger.debug("DNS lookup failed for {url}", { url, error });
        } else {
          logger.error("Disallowed private URL: {url}", { url, error });
        }
      }
      throw error;
    }
  }

  function validateUrl(url: string): void {
    const parsedUrl = new URL(url);
    const protocol = parsedUrl.protocol;
    if (protocol !== "http:" && protocol !== "https:") {
      throw new UrlError(`Unsupported protocol: ${protocol}`);
    }
    // When merging forward, keep this guard independent of allowPrivateAddress:
    // private-address opt-in must not permit credentials on any followed URL.
    if (parsedUrl.username !== "" || parsedUrl.password !== "") {
      throw new UrlError("URLs with credentials are not allowed");
    }
  }
  return (url, options) => load(url, options);
}
