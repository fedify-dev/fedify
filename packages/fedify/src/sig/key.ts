import {
  type Actor,
  CryptographicKey,
  isActor,
  type Multikey,
  Object,
} from "@fedify/vocab";
import { type DocumentLoader, getDocumentLoader } from "@fedify/vocab-runtime";
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
 * Options for {@link verifyKeyOwnership}.
 * @internal
 */
export interface VerifyKeyOwnershipOptions {
  /**
   * The document loader for fetching the owner the key claims.
   */
  documentLoader?: DocumentLoader;

  /**
   * The context loader for loading remote JSON-LD contexts.
   */
  contextLoader?: DocumentLoader;

  /**
   * The OpenTelemetry tracer provider to use for tracing.  If omitted,
   * the global tracer provider is used.
   */
  tracerProvider?: TracerProvider;
}

/**
 * Fetches the document that the given actor URI dereferences to, and returns
 * the actor only if the host that served the document is authoritative for
 * the id the document claims.
 *
 * Only the origin that serves an actor id can speak for it.  Without that
 * rule any host could serve a document describing somebody else's actor—and
 * listing its own keys as that actor's.
 *
 * @param actorId The URI of the actor to fetch.
 * @param options Options for fetching the document.
 * @returns The actor, or `null` if the document cannot be fetched, is not an
 *          actor, or belongs to another origin.
 * @internal
 */
export async function fetchActorDocument(
  actorId: URL,
  options: VerifyKeyOwnershipOptions = {},
): Promise<Actor | null> {
  const logger = getLogger(["fedify", "sig", "key"]);
  const documentLoader = options.documentLoader ?? getDocumentLoader();
  const contextLoader = options.contextLoader ?? getDocumentLoader();
  const { tracerProvider } = options;
  let document: unknown;
  let documentUrl: URL = actorId;
  try {
    const remoteDocument = await documentLoader(actorId.href);
    document = remoteDocument.document;
    // A loader is free to report where the document ended up, which is what
    // a redirect makes authoritative; resolve it against the requested URL so
    // that a loader reporting nothing useful falls back to that URL.
    documentUrl = new URL(remoteDocument.documentUrl ?? "", actorId);
  } catch (error) {
    logger.debug(
      "Failed to fetch the actor {actorId}: {error}",
      { actorId: actorId.href, error },
    );
    return null;
  }
  let object: Object;
  try {
    object = await Object.fromJsonLd(document, {
      documentLoader,
      contextLoader,
      tracerProvider,
      baseUrl: documentUrl,
    });
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    logger.debug(
      "The document served at {documentUrl} is not a valid object: {error}",
      { documentUrl: documentUrl.href, error },
    );
    return null;
  }
  if (!isActor(object)) return null;
  if (object.id == null || object.id.origin !== documentUrl.origin) {
    logger.debug(
      "The document served at {documentUrl} claims to be the actor " +
        "{actorId}, which belongs to another origin; refusing to treat it " +
        "as that actor's document.",
      { documentUrl: documentUrl.href, actorId: object.id?.href },
    );
    return null;
  }
  return object;
}

/**
 * Resolves the owner that the given key claims, and returns it only if the
 * claim holds.
 *
 * The `owner` of a {@link CryptographicKey}, like the `controller` of
 * a {@link Multikey}, proves nothing on its own: the key document and the
 * claim inside it are served by the same host, so anyone able to serve a key
 * document can name any actor in the world as its owner.  The claim becomes
 * meaningful only once the named actor's own document is fetched and turns
 * out to link back to the key.  This function performs that mutual-link
 * check, which is the only sound way to learn a fetched key's owner.
 *
 * The claimed owner is always dereferenced, never read out of the key
 * document: an owner embedded there is written by whoever wrote the key.
 *
 * @param key The key whose ownership claim is to be verified.  It must carry
 *            an `id`, as that is what the owner has to link back to.
 * @param options Options for fetching the claimed owner.
 * @returns The verified owner, or `null` if the key claims no owner, the
 *          owner cannot be fetched, or the owner does not link back to
 *          the key.
 * @internal
 */
export async function verifyKeyOwnership(
  key: CryptographicKey | Multikey,
  options: VerifyKeyOwnershipOptions = {},
): Promise<Actor | null> {
  const logger = getLogger(["fedify", "sig", "key"]);
  const keyId = key.id;
  if (keyId == null) return null;
  const claimedOwnerId = key instanceof CryptographicKey
    ? key.ownerId
    : key.controllerId;
  if (claimedOwnerId == null) return null;
  const owner = await fetchActorDocument(claimedOwnerId, options);
  if (owner == null) {
    logger.debug(
      "The owner ({claimedOwnerId}) that key {keyId} claims could not be " +
        "resolved.",
      { keyId: keyId.href, claimedOwnerId: claimedOwnerId.href },
    );
    return null;
  }
  // Both directions have to agree: the key points at the owner, and the
  // owner's own document lists the key.
  const linkedKeyIds = key instanceof CryptographicKey
    ? owner.publicKeyIds
    : owner.assertionMethodIds;
  for (const linkedKeyId of linkedKeyIds) {
    if (linkedKeyId.href === keyId.href) return owner;
  }
  logger.debug(
    "The owner ({claimedOwnerId}) that key {keyId} claims does not list " +
      "the key as its own.",
    { keyId: keyId.href, claimedOwnerId: claimedOwnerId.href },
  );
  return null;
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
  // deno-lint-ignore no-explicit-any
  cls: (new (...args: any[]) => T) & {
    fromJsonLd(
      jsonLd: unknown,
      options: {
        documentLoader?: DocumentLoader;
        contextLoader?: DocumentLoader;
        tracerProvider?: TracerProvider;
      },
    ): Promise<T>;
  },
  options: FetchKeyOptions = {},
): Promise<FetchKeyResult<T>> {
  const tracerProvider = options.tracerProvider ?? trace.getTracerProvider();
  const tracer = tracerProvider.getTracer(metadata.name, metadata.version);
  keyId = typeof keyId === "string" ? new URL(keyId) : keyId;
  return tracer.startActiveSpan(
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
        const result = await fetchKeyInternal(keyId, cls, options);
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

async function fetchKeyInternal<T extends CryptographicKey | Multikey>(
  keyId: URL | string,
  // deno-lint-ignore no-explicit-any
  cls: (new (...args: any[]) => T) & {
    fromJsonLd(
      jsonLd: unknown,
      options: {
        documentLoader?: DocumentLoader;
        contextLoader?: DocumentLoader;
        tracerProvider?: TracerProvider;
      },
    ): Promise<T>;
  },
  { documentLoader, contextLoader, keyCache, tracerProvider }: FetchKeyOptions =
    {},
): Promise<FetchKeyResult<T>> {
  const logger = getLogger(["fedify", "sig", "key"]);
  const cacheKey = typeof keyId === "string" ? new URL(keyId) : keyId;
  keyId = typeof keyId === "string" ? keyId : keyId.href;
  if (keyCache != null) {
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
  }
  logger.debug("Fetching key {keyId} to verify signature...", { keyId });
  let document: unknown;
  // The URL the document actually came from, which may differ from the
  // requested one after redirects.  It is the host that served those bytes,
  // not the host that was asked, that the document can speak for.
  let documentUrl: URL = cacheKey;
  try {
    const remoteDocument = await (documentLoader ?? getDocumentLoader())(keyId);
    document = remoteDocument.document;
    documentUrl = new URL(remoteDocument.documentUrl ?? "", cacheKey);
  } catch (_) {
    logger.debug("Failed to fetch key {keyId}.", { keyId });
    await keyCache?.set(cacheKey, null);
    return { key: null, cached: false };
  }
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
        return { key: null, cached: false };
      }
      throw e;
    }
  }
  let key: T | null = null;
  // Set when the fetched document turned out to be the owner's own actor
  // document.  Such a document establishes the key's ownership by itself:
  // it is the owner speaking about its own keys.
  let ownerDocument: Actor | null = null;
  if (
    object instanceof cls &&
    (object.id == null || object.id.href === keyId)
  ) {
    // A standalone key document may leave its id implicit.  The URL it was
    // fetched from is then the only id it has, and the ownership check below
    // needs an id to look for in the owner's document.
    key = object.id == null
      ? (object as CryptographicKey).clone({ id: cacheKey }) as T
      : object;
  } else if (isActor(object)) {
    // A host may only speak for actor ids on its own origin.  Without this
    // check, anyone serving a key document could dress it up as somebody
    // else's actor document and have the key attributed to that actor.
    if (object.id == null || object.id.origin !== documentUrl.origin) {
      logger.debug(
        "Failed to verify; the document served at {documentUrl} claims to be " +
          "the actor {actorId}, which belongs to another origin.",
        { keyId, documentUrl: documentUrl.href, actorId: object.id?.href },
      );
      await keyCache?.set(cacheKey, null);
      return { key: null, cached: false };
    }
    ownerDocument = object;
    // Treat malformed remote actor keys as missing keys.
    // @ts-ignore: cls is either CryptographicKey or Multikey
    const keys = cls === CryptographicKey
      ? object.getPublicKeys({
        documentLoader,
        contextLoader,
        suppressError: true,
        tracerProvider,
      })
      : object.getAssertionMethods({
        documentLoader,
        contextLoader,
        suppressError: true,
        tracerProvider,
      });
    let length = 0;
    let lastKey: T | null = null;
    try {
      for await (const k of keys) {
        length++;
        lastKey = k as T;
        if (k.id?.href === keyId) {
          key = k as T;
          break;
        }
      }
    } catch (e) {
      if (!(e instanceof TypeError)) throw e;
      logger.debug(
        "Failed to verify; a malformed key was encountered while iterating " +
          "the keys of {keyId}; treating it as a missing key: {error}",
        { keyId, error: e },
      );
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
      return { key: null, cached: false };
    }
  } else {
    logger.debug(
      "Failed to verify; key {keyId} returned an invalid object.",
      { keyId },
    );
    await keyCache?.set(cacheKey, null);
    return { key: null, cached: false };
  }
  if (key.publicKey == null) {
    logger.debug(
      "Failed to verify; key {keyId} has no publicKeyPem field.",
      { keyId },
    );
    await keyCache?.set(cacheKey, null);
    return { key: null, cached: false };
  }
  // Whom the key belongs to has to be settled here, before any caller can act
  // on it.  The `owner`/`controller` field of a key document is written by
  // the very host that served the key, so by itself it says nothing about the
  // actor it names; leaving it unchecked let anyone impersonate any actor.
  // See GHSA-q9f8-5hc7-898f.
  const claimedOwnerId = key instanceof CryptographicKey
    ? key.ownerId
    : (key as Multikey).controllerId;
  if (ownerDocument != null && claimedOwnerId == null) {
    // The key came out of an actor's own document and names no owner of its
    // own, so that one fetch settled the question.  Record the answer on the
    // key, so that callers—and the key cache—never have to take it up again.
    key = key instanceof CryptographicKey
      ? key.clone({ owner: ownerDocument.id! }) as T
      : (key as Multikey).clone({ controller: ownerDocument.id! }) as T;
  } else if (
    claimedOwnerId != null &&
    claimedOwnerId.href !== ownerDocument?.id?.href
  ) {
    // Either the key stood on its own, or the actor document that carried it
    // is not the actor the key names—and sharing an origin with that actor
    // proves nothing, since one origin may serve documents for parties that
    // do not speak for each other.  Either way the named actor has to be
    // resolved and has to link back to the key.
    const owner = await verifyKeyOwnership(key, {
      documentLoader,
      contextLoader,
      tracerProvider,
    });
    if (owner == null) {
      logger.debug(
        "Failed to verify; the owner {claimedOwnerId} that key {keyId} " +
          "claims does not list the key as its own.",
        { keyId, claimedOwnerId: claimedOwnerId.href },
      );
      await keyCache?.set(cacheKey, null);
      return { key: null, cached: false };
    }
  }
  if (keyCache != null) {
    await keyCache.set(cacheKey, key);
    logger.debug("Key {keyId} cached.", { keyId });
  }
  return {
    key: key as T & { publicKey: CryptoKey },
    cached: false,
  };
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
