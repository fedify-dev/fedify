import {
  CryptographicKey,
  isActor,
  type Multikey,
  Object,
} from "@fedify/vocab";
import {
  type DocumentLoader,
  FetchError,
  getDocumentLoader,
} from "@fedify/vocab-runtime";
import { getLogger } from "@logtape/logtape";
import {
  SpanKind,
  SpanStatusCode,
  trace,
  type TracerProvider,
} from "@opentelemetry/api";
import metadata from "../../deno.json" with { type: "json" };

/**
 * Checks if the given key is valid and supported.  No-op if the key is valid,
 * otherwise throws an error.
 * @param key The key to check.
 * @param type Which type of key to check.  If not specified, the key can be
 *             either public or private.
 * @throws {TypeError} If the key is invalid or unsupported.
 */
export function validateCryptoKey(
  key: CryptoKey,
  type?: "public" | "private",
): void {
  if (type != null && key.type !== type) {
    throw new TypeError(`The key is not a ${type} key.`);
  }
  if (!key.extractable) {
    throw new TypeError("The key is not extractable.");
  }
  if (
    key.algorithm.name !== "RSASSA-PKCS1-v1_5" &&
    key.algorithm.name !== "Ed25519"
  ) {
    throw new TypeError(
      "Currently only RSASSA-PKCS1-v1_5 and Ed25519 keys are supported.  " +
        "More algorithms will be added in the future!",
    );
  }
  if (key.algorithm.name === "RSASSA-PKCS1-v1_5") {
    // @ts-ignore TS2304
    const algorithm = key.algorithm as unknown as RsaHashedKeyAlgorithm;
    if (algorithm.hash.name !== "SHA-256") {
      throw new TypeError(
        "For compatibility with the existing Fediverse software " +
          "(e.g., Mastodon), hash algorithm for RSASSA-PKCS1-v1_5 keys " +
          "must be SHA-256.",
      );
    }
  }
}

/**
 * Generates a key pair which is appropriate for Fedify.
 * @param algorithm The algorithm to use.  Currently only RSASSA-PKCS1-v1_5 and
 *                  Ed25519 are supported.
 * @returns The generated key pair.
 * @throws {TypeError} If the algorithm is unsupported.
 */
export function generateCryptoKeyPair(
  algorithm?: "RSASSA-PKCS1-v1_5" | "Ed25519",
): Promise<CryptoKeyPair> {
  if (algorithm == null) {
    getLogger(["fedify", "sig", "key"]).warn(
      "No algorithm specified.  Using RSASSA-PKCS1-v1_5 by default, but " +
        "it is recommended to specify the algorithm explicitly as " +
        "the parameter will be required in the future.",
    );
  }
  if (algorithm == null || algorithm === "RSASSA-PKCS1-v1_5") {
    return crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 4096,
        publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    );
  } else if (algorithm === "Ed25519") {
    return crypto.subtle.generateKey(
      "Ed25519",
      true,
      ["sign", "verify"],
    ) as Promise<CryptoKeyPair>;
  }
  throw new TypeError("Unsupported algorithm: " + algorithm);
}

/**
 * Exports a key in JWK format.
 * @param key The key to export.  Either public or private key.
 * @returns The exported key in JWK format.  The key is suitable for
 *          serialization and storage.
 * @throws {TypeError} If the key is invalid or unsupported.
 */
export async function exportJwk(key: CryptoKey): Promise<JsonWebKey> {
  validateCryptoKey(key);
  const jwk = await crypto.subtle.exportKey("jwk", key);
  if (jwk.crv === "Ed25519") jwk.alg = "Ed25519";
  return jwk;
}

/**
 * Imports a key from JWK format.
 * @param jwk The key in JWK format.
 * @param type Which type of key to import, either `"public"` or `"private"`.
 * @returns The imported key.
 * @throws {TypeError} If the key is invalid or unsupported.
 */
export async function importJwk(
  jwk: JsonWebKey,
  type: "public" | "private",
): Promise<CryptoKey> {
  let key: CryptoKey;
  if (jwk.kty === "RSA" && jwk.alg === "RS256") {
    key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      true,
      type === "public" ? ["verify"] : ["sign"],
    );
  } else if (jwk.kty === "OKP" && jwk.crv === "Ed25519") {
    if (navigator?.userAgent === "Cloudflare-Workers") {
      jwk = { ...jwk };
      delete jwk.alg;
    }
    key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      "Ed25519",
      true,
      type === "public" ? ["verify"] : ["sign"],
    );
  } else {
    throw new TypeError("Unsupported JWK format.");
  }
  validateCryptoKey(key, type);
  return key;
}

/**
 * Options for {@link fetchKey}.
 * @since 1.3.0
 */
export interface FetchKeyOptions {
  /**
   * The document loader for loading remote JSON-LD documents.
   */
  documentLoader?: DocumentLoader;

  /**
   * The context loader for loading remote JSON-LD contexts.
   */
  contextLoader?: DocumentLoader;

  /**
   * The key cache to use for caching public keys.
   * @since 0.12.0
   */
  keyCache?: KeyCache;

  /**
   * The OpenTelemetry tracer provider to use for tracing.  If omitted,
   * the global tracer provider is used.
   * @since 1.3.0
   */
  tracerProvider?: TracerProvider;
}

/**
 * The result of {@link fetchKey}.
 * @since 1.3.0
 */
export interface FetchKeyResult<T extends CryptographicKey | Multikey> {
  /**
   * The fetched (or cached) key.
   */
  readonly key: T & { publicKey: CryptoKey } | null;

  /**
   * Whether the key is fetched from the cache.
   */
  readonly cached: boolean;
}

/**
 * Detailed fetch failure information from {@link fetchKeyDetailed}.
 * @since 2.1.0
 */
export type FetchKeyErrorResult =
  | {
    readonly status: number;
    readonly response: Response;
  }
  | {
    readonly error: Error;
  };

/**
 * The result of {@link fetchKeyDetailed}.
 * @since 2.1.0
 */
export interface FetchKeyDetailedResult<T extends CryptographicKey | Multikey>
  extends FetchKeyResult<T> {
  /**
   * The error that occurred while fetching the key, if fetching failed before
   * a document could be parsed.
   */
  readonly fetchError?: FetchKeyErrorResult;
}

interface FetchErrorMetadataCache extends KeyCache {
  getFetchError?(keyId: URL): Promise<FetchKeyErrorResult | undefined>;
  setFetchError?(
    keyId: URL,
    error: FetchKeyErrorResult | null,
  ): Promise<void>;
}

type FetchableKeyClass<T extends CryptographicKey | Multikey> =
  // deno-lint-ignore no-explicit-any
  (new (...args: any[]) => T) & {
    fromJsonLd(
      jsonLd: unknown,
      options: {
        documentLoader?: DocumentLoader;
        contextLoader?: DocumentLoader;
        tracerProvider?: TracerProvider;
      },
    ): Promise<T>;
  };

async function withFetchKeySpan<T extends { cached: boolean }>(
  keyId: URL,
  tracerProvider: TracerProvider | undefined,
  fetcher: () => Promise<T>,
): Promise<T> {
  tracerProvider ??= trace.getTracerProvider();
  const tracer = tracerProvider.getTracer(metadata.name, metadata.version);
  return await tracer.startActiveSpan(
    "activitypub.fetch_key",
    {
      kind: SpanKind.CLIENT,
      attributes: {
        "http.method": "GET",
        "url.full": keyId.href,
        "url.scheme": keyId.protocol.replace(/:$/, ""),
        "url.domain": keyId.hostname,
        "url.path": keyId.pathname,
        "url.query": keyId.search.replace(/^\?/, ""),
        "url.fragment": keyId.hash.replace(/^#/, ""),
      },
    },
    async (span) => {
      try {
        const result = await fetcher();
        span.setAttribute("activitypub.actor.key.cached", result.cached);
        return result;
      } catch (e) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(e) });
        throw e;
      } finally {
        span.end();
      }
    },
  );
}

/**
 * Fetches a {@link CryptographicKey} or {@link Multikey} from the given URL.
 * If the given URL contains an {@link Actor} object, it tries to find
 * the corresponding key in the `publicKey` or `assertionMethod` property.
 * @template T The type of the key to fetch.  Either {@link CryptographicKey}
 *              or {@link Multikey}.
 * @param keyId The URL of the key.
 * @param cls The class of the key to fetch.  Either {@link CryptographicKey}
 *            or {@link Multikey}.
 * @param options Options for fetching the key.  See {@link FetchKeyOptions}.
 * @returns The fetched key or `null` if the key is not found.
 * @since 1.3.0
 */
export function fetchKey<T extends CryptographicKey | Multikey>(
  keyId: URL | string,
  cls: FetchableKeyClass<T>,
  options: FetchKeyOptions = {},
): Promise<FetchKeyResult<T>> {
  keyId = typeof keyId === "string" ? new URL(keyId) : keyId;
  return withFetchKeySpan(
    keyId,
    options.tracerProvider,
    () => fetchKeyInternal(keyId, cls, options),
  );
}

/**
 * Fetches a {@link CryptographicKey} or {@link Multikey} from the given URL,
 * preserving transport-level fetch failures for callers that need to inspect
 * why the key could not be loaded.
 *
 * @template T The type of the key to fetch.  Either {@link CryptographicKey}
 *              or {@link Multikey}.
 * @param keyId The URL of the key.
 * @param cls The class of the key to fetch.  Either {@link CryptographicKey}
 *            or {@link Multikey}.
 * @param options Options for fetching the key.
 * @returns The fetched key, or detailed fetch failure information.
 * @since 2.1.0
 */
export async function fetchKeyDetailed<T extends CryptographicKey | Multikey>(
  keyId: URL | string,
  cls: FetchableKeyClass<T>,
  options: FetchKeyOptions = {},
): Promise<FetchKeyDetailedResult<T>> {
  const cacheKey = typeof keyId === "string" ? new URL(keyId) : keyId;
  return await withFetchKeySpan(
    cacheKey,
    options.tracerProvider,
    async () => {
      return await fetchKeyWithResult<T, FetchKeyDetailedResult<T>>(
        cacheKey,
        cls,
        options,
        async (cacheKey, keyId, keyCache, logger) => {
          const fetchError = await keyCache?.getFetchError?.(cacheKey);
          if (fetchError != null) {
            logger.debug(
              "Entry {keyId} found in cache with preserved fetch failure " +
                "details.",
              { keyId },
            );
            return {
              key: null,
              cached: true,
              fetchError,
            };
          }
          logger.debug(
            "Entry {keyId} found in cache, but no fetch failure details " +
              "are available.",
            { keyId },
          );
          return { key: null, cached: true };
        },
        async (error, cacheKey, keyId, keyCache, logger) => {
          logger.debug("Failed to fetch key {keyId}.", { keyId, error });
          await keyCache?.set(cacheKey, null);
          if (error instanceof FetchError && error.response != null) {
            const fetchError = {
              status: error.response.status,
              response: error.response.clone(),
            } satisfies FetchKeyErrorResult;
            await keyCache?.setFetchError?.(cacheKey, fetchError);
            return {
              key: null,
              cached: false,
              fetchError,
            };
          }
          const fetchError = {
            error: error instanceof Error ? error : new Error(String(error)),
          } satisfies FetchKeyErrorResult;
          await keyCache?.setFetchError?.(cacheKey, fetchError);
          return {
            key: null,
            cached: false,
            fetchError,
          };
        },
      );
    },
  );
}

async function getCachedFetchKey<T extends CryptographicKey | Multikey>(
  cacheKey: URL,
  keyId: string,
  cls: FetchableKeyClass<T>,
  keyCache: KeyCache | undefined,
  logger: ReturnType<typeof getLogger>,
): Promise<FetchKeyResult<T> | null> {
  if (keyCache == null) return null;
  const cachedKey = await keyCache.get(cacheKey);
  if (cachedKey instanceof cls && cachedKey.publicKey != null) {
    logger.debug("Key {keyId} found in cache.", { keyId });
    return {
      key: cachedKey as T & { publicKey: CryptoKey },
      cached: true,
    };
  } else if (cachedKey === null) {
    logger.debug(
      "Entry {keyId} found in cache, but it is unavailable.",
      { keyId },
    );
    return { key: null, cached: true };
  }
  return null;
}

async function clearFetchErrorMetadata(
  keyId: URL,
  keyCache: KeyCache | undefined,
): Promise<void> {
  await (keyCache as FetchErrorMetadataCache | undefined)?.setFetchError?.(
    keyId,
    null,
  );
}

async function resolveFetchedKey<T extends CryptographicKey | Multikey>(
  document: unknown,
  cacheKey: URL,
  keyId: string,
  cls: FetchableKeyClass<T>,
  { documentLoader, contextLoader, keyCache, tracerProvider }: FetchKeyOptions,
  logger: ReturnType<typeof getLogger>,
): Promise<FetchKeyResult<T>> {
  let object: Object | T;
  try {
    object = await Object.fromJsonLd(document, {
      documentLoader,
      contextLoader,
      tracerProvider,
    });
  } catch (e) {
    if (!(e instanceof TypeError)) throw e;
    try {
      object = await cls.fromJsonLd(document, {
        documentLoader,
        contextLoader,
        tracerProvider,
      });
    } catch (e) {
      if (e instanceof TypeError) {
        logger.debug(
          "Failed to verify; key {keyId} returned an invalid object.",
          { keyId },
        );
        await keyCache?.set(cacheKey, null);
        await clearFetchErrorMetadata(cacheKey, keyCache);
        return { key: null, cached: false };
      }
      throw e;
    }
  }
  let key: T | null = null;
  if (object instanceof cls) key = object;
  else if (isActor(object)) {
    // @ts-ignore: cls is either CryptographicKey or Multikey
    const keys = cls === CryptographicKey
      ? object.getPublicKeys({ documentLoader, contextLoader, tracerProvider })
      : object.getAssertionMethods({
        documentLoader,
        contextLoader,
        tracerProvider,
      });
    let length = 0;
    let lastKey: T | null = null;
    for await (const k of keys) {
      length++;
      lastKey = k as T;
      if (k.id?.href === keyId) {
        key = k as T;
        break;
      }
    }
    const keyIdUrl = new URL(keyId);
    if (key == null && keyIdUrl.hash === "" && length === 1) {
      key = lastKey;
    }
    if (key == null) {
      logger.debug(
        "Failed to verify; object {keyId} returned an {actorType}, " +
          "but has no key matching {keyId}.",
        { keyId, actorType: object.constructor.name },
      );
      await keyCache?.set(cacheKey, null);
      await clearFetchErrorMetadata(cacheKey, keyCache);
      return { key: null, cached: false };
    }
  } else {
    logger.debug(
      "Failed to verify; key {keyId} returned an invalid object.",
      { keyId },
    );
    await keyCache?.set(cacheKey, null);
    await clearFetchErrorMetadata(cacheKey, keyCache);
    return { key: null, cached: false };
  }
  if (key.publicKey == null) {
    logger.debug(
      "Failed to verify; key {keyId} has no publicKeyPem field.",
      { keyId },
    );
    await keyCache?.set(cacheKey, null);
    await clearFetchErrorMetadata(cacheKey, keyCache);
    return { key: null, cached: false };
  }
  if (keyCache != null) {
    await keyCache.set(cacheKey, key);
    logger.debug("Key {keyId} cached.", { keyId });
  }
  await clearFetchErrorMetadata(cacheKey, keyCache);
  return {
    key: key as T & { publicKey: CryptoKey },
    cached: false,
  };
}

async function fetchKeyWithResult<
  T extends CryptographicKey | Multikey,
  TResult extends FetchKeyResult<T>,
>(
  cacheKey: URL,
  cls: FetchableKeyClass<T>,
  options: FetchKeyOptions,
  onCachedUnavailable: (
    cacheKey: URL,
    keyId: string,
    keyCache: FetchErrorMetadataCache | undefined,
    logger: ReturnType<typeof getLogger>,
  ) => Promise<TResult> | TResult,
  onFetchError: (
    error: unknown,
    cacheKey: URL,
    keyId: string,
    keyCache: FetchErrorMetadataCache | undefined,
    logger: ReturnType<typeof getLogger>,
  ) => Promise<TResult> | TResult,
): Promise<TResult> {
  const logger = getLogger(["fedify", "sig", "key"]);
  const keyId = cacheKey.href;
  const keyCache = options.keyCache as FetchErrorMetadataCache | undefined;
  const cached = await getCachedFetchKey(
    cacheKey,
    keyId,
    cls,
    keyCache,
    logger,
  );
  if (cached?.key === null && cached.cached) {
    return await onCachedUnavailable(cacheKey, keyId, keyCache, logger);
  }
  if (cached != null) return cached as TResult;
  logger.debug("Fetching key {keyId} to verify signature...", { keyId });
  let document: unknown;
  try {
    const remoteDocument =
      await (options.documentLoader ?? getDocumentLoader())(
        keyId,
      );
    document = remoteDocument.document;
  } catch (error) {
    return await onFetchError(
      error,
      cacheKey,
      keyId,
      keyCache,
      logger,
    );
  }
  return await resolveFetchedKey(
    document,
    cacheKey,
    keyId,
    cls,
    options,
    logger,
  ) as TResult;
}

async function fetchKeyInternal<T extends CryptographicKey | Multikey>(
  keyId: URL | string,
  cls: FetchableKeyClass<T>,
  options: FetchKeyOptions = {},
): Promise<FetchKeyResult<T>> {
  const cacheKey = typeof keyId === "string" ? new URL(keyId) : keyId;
  return await fetchKeyWithResult<T, FetchKeyResult<T>>(
    cacheKey,
    cls,
    options,
    (_cacheKey, _keyId, _keyCache, _logger) => {
      return { key: null, cached: true };
    },
    async (error, cacheKey, keyId, keyCache, logger) => {
      logger.debug("Failed to fetch key {keyId}.", { keyId, error });
      await keyCache?.set(cacheKey, null);
      if (error instanceof FetchError && error.response != null) {
        await keyCache?.setFetchError?.(cacheKey, {
          status: error.response.status,
          response: error.response.clone(),
        });
      } else {
        await keyCache?.setFetchError?.(cacheKey, {
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
      return { key: null, cached: false };
    },
  );
}

/**
 * A cache for storing cryptographic keys.
 * @since 0.12.0
 */
export interface KeyCache {
  /**
   * Gets a key from the cache.
   * @param keyId The key ID.
   * @returns The key if found, `null` if the key is not available (e.g.,
   *          fetching the key was tried but failed), or `undefined`
   *          if the cache is not available.
   */
  get(keyId: URL): Promise<CryptographicKey | Multikey | null | undefined>;

  /**
   * Sets a key to the cache.
   *
   * Note that this caches unavailable keys (i.e., `null`) as well,
   * and it is recommended to make unavailable keys expire after a short period.
   * @param keyId The key ID.
   * @param key The key to cache.  `null` means the key is not available
   *            (e.g., fetching the key was tried but failed).
   */
  set(keyId: URL, key: CryptographicKey | Multikey | null): Promise<void>;
}
