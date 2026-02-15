import {
  createActivityPubRequest,
  type DocumentLoader,
  type DocumentLoaderFactoryOptions,
  type DocumentLoaderOptions,
  getRemoteDocument,
  logRequest,
  type RemoteDocument,
  UrlError,
  validatePublicUrl,
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
 * @param identity The identity to get the document loader for.
 *                 The actor's key pair.
 * @param options The options for the document loader.
 * @returns The authenticated document loader.
 * @throws {TypeError} If the key is invalid or unsupported.
 * @since 0.4.0
 */
export function getAuthenticatedDocumentLoader(
  identity: { keyId: URL; privateKey: CryptoKey },
  { allowPrivateAddress, userAgent, specDeterminer, tracerProvider }:
    GetAuthenticatedDocumentLoaderOptions = {},
): DocumentLoader {
  validateCryptoKey(identity.privateKey);
  async function load(
    url: string,
    options?: DocumentLoaderOptions,
  ): Promise<RemoteDocument> {
    if (!allowPrivateAddress) {
      try {
        await validatePublicUrl(url);
      } catch (error) {
        if (error instanceof UrlError) {
          logger.error("Disallowed private URL: {url}", { url, error });
        }
        throw error;
      }
    }
    const originalRequest = createActivityPubRequest(url, { userAgent });
    const response = await doubleKnock(
      originalRequest,
      identity,
      {
        specDeterminer,
        log: curry(logRequest)(logger),
        tracerProvider,
        signal: options?.signal,
      },
    );
    return getRemoteDocument(url, response, load);
  }
  return load;
}
