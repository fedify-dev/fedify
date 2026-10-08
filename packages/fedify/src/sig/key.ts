import {
  verificationObservation,
  type VerificationObservationOptions,
} from "./verification.ts";
import {
  type Actor,
  CryptographicKey,
  isActor,
  Multikey,
  Object,
} from "@fedify/vocab";
import {
  type DidKeyVerificationMethod,
  type DocumentLoader,
  FetchError,
  getDocumentLoader,
  parseDidKeyVerificationMethod,
  UrlError,
} from "@fedify/vocab-runtime";
import { getLogger } from "@logtape/logtape";
import {
  type MeterProvider,
  SpanKind,
  SpanStatusCode,
  trace,
  type TracerProvider,
} from "@opentelemetry/api";
import metadata from "../../deno.json" with { type: "json" };
import {
  classifyFetchError,
  getDurationMs,
  type KeyLookupResult,
  recordKeyLookup,
} from "../federation/metrics.ts";
import {
  isCompatibleKeyId,
  isPortableActorDocument,
  isPortableId,
  isPortableUri,
  parseKeyIdString,
} from "./portable-key-id.ts";
import {
  attachKeyOwnerEvidence,
  MAX_PORTABLE_KEY_TTL,
} from "./key-owner-evidence.ts";
import type {
  PortableActorKeyResolution,
  PortableGatewayKeyResolution,
} from "./portable-key.ts";

/** Classifies decoding failures without hiding unexpected loader errors. */
function classifyKeyJsonLdError(
  error: unknown,
  seen = new Set<unknown>(),
): "invalid" | "fetch" | null {
  if (!(error instanceof Error) || !error.name.startsWith("jsonld.")) {
    return null;
  }
  if (seen.has(error)) throw error;
  seen.add(error);
  const details = (error as Error & {
    details?: { code?: unknown; cause?: unknown; url?: unknown };
  }).details;
  if (typeof details?.code !== "string") return null;
  if (
    details.code !== "loading remote context failed" ||
    (!("cause" in details) && !("cause" in error))
  ) return "invalid";

  // jsonld wraps both loader errors and JSON.parse failures in InvalidUrl.
  // A bad context body is invalid data; a failed fetch is a lookup failure.
  const cause = "cause" in details ? details.cause : error.cause;
  const nestedFailure = classifyKeyJsonLdError(cause, seen);
  if (nestedFailure != null) return nestedFailure;
  if (cause instanceof SyntaxError) return "invalid";
  if (cause instanceof FetchError || cause instanceof UrlError) return "fetch";
  if (
    cause instanceof Error &&
    ["AbortError", "TimeoutError", "NetworkError"].includes(cause.name)
  ) return "fetch";
  if (cause instanceof TypeError) {
    // The context loader can reject a malformed URL before any fetch occurs.
    // Match the same URL errors as the LD-signature context-loading boundary.
    const urlCode = (cause as TypeError & { code?: unknown }).code;
    if (cause.name === "InvalidContextReferenceError") return "invalid";
    if (
      urlCode === "ERR_INVALID_URL" ||
      cause.message === "Invalid URL string." ||
      /^Invalid URL(?::|$)/.test(cause.message) ||
      / cannot be parsed as a URL\.?$/.test(cause.message)
    ) {
      // A valid reference can still fail in a loader's URL handling.  Like
      // wrapContextLoaderForJsonLd(), keep that a fetch failure rather than
      // attributing it to malformed remote data.
      return typeof details.url === "string" &&
          /^[A-Za-z][A-Za-z0-9+.-]*:/.test(details.url) &&
          !URL.canParse(details.url)
        ? "invalid"
        : "fetch";
    }
    const networkCause = cause.cause as { code?: unknown } | undefined;
    const code = (cause as TypeError & { code?: unknown }).code ??
      networkCause?.code;
    if (
      typeof code === "string" && [
          "ECONNREFUSED",
          "ECONNRESET",
          "ECONNABORTED",
          "ETIMEDOUT",
          "EHOSTUNREACH",
          "ENETUNREACH",
          "ENOTFOUND",
          "EAI_AGAIN",
          "UND_ERR_CONNECT_TIMEOUT",
          "UND_ERR_HEADERS_TIMEOUT",
          "UND_ERR_BODY_TIMEOUT",
          "UND_ERR_SOCKET",
        ].includes(code) ||
      /^(fetch failed|Failed to fetch|error sending request|error reading a body from connection|Unable to connect|ConnectionRefused|Network connection lost|The socket connection was closed unexpectedly)/
        .test(cause.message)
    ) return "fetch";
  }
  // Keep the original error and stack for application/loader programming bugs.
  throw cause;
}

/** Carries a context transport failure through the key decoding boundary. */
class KeyContextFetchError extends Error {
  constructor(readonly error: unknown) {
    super("Failed to fetch a key's JSON-LD context.", { cause: error });
  }
}

function contextFetchError(error: unknown): KeyContextFetchError {
  const seen = new Set<unknown>();
  while (error instanceof Error && !seen.has(error)) {
    seen.add(error);
    const details = (error as Error & {
      details?: { code?: unknown; cause?: unknown };
    }).details;
    if (
      !error.name.startsWith("jsonld.") ||
      details?.code !== "loading remote context failed"
    ) break;
    error = "cause" in details ? details.cause : error.cause;
  }
  return new KeyContextFetchError(error);
}

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
export interface FetchKeyOptions extends VerificationObservationOptions {
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

  /**
   * The OpenTelemetry meter provider to use for recording
   * `activitypub.key.lookup` and `activitypub.key.lookup.duration`.  If
   * omitted, the global meter provider is used.
   * @since 2.3.0
   */
  meterProvider?: MeterProvider;

  /**
   * An assertion by the caller that it has already bound this key's id to
   * whoever the key will be treated as speaking for, by means of its own that
   * key resolution cannot see.
   *
   * Key resolution normally settles ownership itself: it dereferences the
   * `owner`/`controller` a key claims and requires that actor's own document
   * to link back to the key, because the claim and the key document come from
   * the same host and so the claim proves nothing on its own.  See
   * GHSA-q9f8-5hc7-898f.
   *
   * That check presumes the ActivityPub shape of ownership, where the owner
   * is an actor carrying a `publicKey`/`assertionMethod` list.  It does not
   * fit every caller.  Portable objects (FEP-ef61) bind a key to an object
   * structurally instead: {@link verifyPortableObjectProof} requires the
   * verification method's FEP-ef34 origin to equal the object id's own
   * authority, so the signer is pinned by the identifier being verified,
   * before any key is fetched.  Demanding the ActivityPub check as well would
   * be impossible rather than merely redundant, since a DID dereferences to
   * a DID document, which is not an actor.
   *
   * This is not a way to accept whatever a key says about itself.  The claim
   * still has to be corroborated, just from the key id rather than from
   * a second document: a key may name an owner only when the key id is that
   * owner's own (a `did:…#fragment` belongs to the DID it is a fragment of,
   * exactly as a key embedded in an actor document belongs to that actor).
   * A key naming anyone else falls back to the ordinary check and is rejected
   * if it cannot pass it, so a key admitted here is as sound as any other and
   * is cached like any other.
   * @internal
   */
  keyIdBoundByCaller?: boolean;

  /**
   * Resolves keys of [FEP-ef61] portable actors, which only HTTP Signature
   * verification passes, so that only it accepts them.  Object Integrity
   * Proofs and Linked Data Signatures never do: such a key is rejected if
   * this is omitted.
   *
   * [FEP-ef61]: https://w3id.org/fep/ef61
   * @internal
   */
  portableKeyResolvers?: PortableKeyResolvers;
}

/**
 * Resolves keys of [FEP-ef61] portable actors for HTTP Signature
 * verification.  See {@link FetchKeyOptions.portableKeyResolvers}.
 *
 * [FEP-ef61]: https://w3id.org/fep/ef61
 * @internal
 */
export interface PortableKeyResolvers {
  /**
   * Resolves a gateway key, i.e., a key whose ID is a compatible identifier
   * and dereferences to a portable actor's document.
   */
  gatewayKey(
    document: unknown,
    actor: Actor,
    keyId: URL,
  ): Promise<PortableGatewayKeyResolution>;

  /**
   * Resolves a key of a portable actor itself, i.e., a key whose ID is an
   * `ap:` or `ap+ef61:` URI.
   */
  actorKey(keyId: URL): Promise<PortableActorKeyResolution>;
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
  return await fetchActorDocumentInternal(actorId, options, false);
}

async function fetchActorDocumentInternal(
  actorId: URL,
  options: VerifyKeyOwnershipOptions,
  propagateContextFetchErrors: boolean,
): Promise<Actor | null> {
  const logger = getLogger(["fedify", "sig", "key"]);
  if (isPortableId(actorId)) {
    // Only a proof by its DID speaks for a portable actor, whatever host
    // serves a compatible identifier of it:
    logger.debug(
      "The actor {actorId} is a portable actor, which is not authenticated " +
        "by the web origin that serves it.",
      { actorId: actorId.href },
    );
    return null;
  }
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
    const failure = classifyKeyJsonLdError(error);
    if (failure === "fetch" && propagateContextFetchErrors) {
      throw contextFetchError(error);
    }
    if (failure == null && !(error instanceof TypeError)) throw error;
    logger.debug(
      "Failed to decode the actor document at {documentUrl}: {error}",
      { documentUrl: documentUrl.href, failure: failure ?? "invalid", error },
    );
    return null;
  }
  if (!isActor(object)) return null;
  if (object.id != null && isPortableId(object.id)) {
    logger.debug(
      "The document served at {documentUrl} claims to be the portable actor " +
        "{actorId}, which is not authenticated by the web origin that " +
        "serves it.",
      { documentUrl: documentUrl.href, actorId: object.id?.href },
    );
    return null;
  }
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
  return await verifyKeyOwnershipInternal(key, options, false);
}

async function verifyKeyOwnershipInternal(
  key: CryptographicKey | Multikey,
  options: VerifyKeyOwnershipOptions,
  propagateContextFetchErrors: boolean,
): Promise<Actor | null> {
  const logger = getLogger(["fedify", "sig", "key"]);
  const keyId = key.id;
  if (keyId == null) return null;
  const claimedOwnerId = key instanceof CryptographicKey
    ? key.ownerId
    : key.controllerId;
  if (claimedOwnerId == null) return null;
  const owner = await fetchActorDocumentInternal(
    claimedOwnerId,
    options,
    propagateContextFetchErrors,
  );
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

/**
 * What a key at an [FEP-ef61] compatible identifier is looked up for.  Such
 * a key may be a gateway key of a portable actor, which only HTTP Signatures
 * accept, so each purpose resolves it on its own:
 *
 *  -  `"httpSignature"`: HTTP Signature verification, which accepts gateway
 *     keys;
 *  -  `"cryptographicKey"`: any other lookup of a {@link CryptographicKey},
 *     e.g., for Linked Data Signatures;
 *  -  `"multikey"`: any lookup of a {@link Multikey}, e.g., for Object
 *     Integrity Proofs.
 *
 * [FEP-ef61]: https://w3id.org/fep/ef61
 * @internal
 */
export type CompatibleKeyScope =
  | "httpSignature"
  | "cryptographicKey"
  | "multikey";

/**
 * Options for {@link CompatibleKeyCache.set}.
 * @internal
 */
export interface CompatibleKeyCacheSetOptions {
  /**
   * The time after which the entry must not be used anymore, e.g., when
   * the proof of the document that vouches for the key expires.
   */
  readonly expires?: Temporal.Instant;

  /**
   * The expanded root node of the verified document of the portable actor
   * that owns the key, which is stored along with the key so that the owner
   * does not have to be fetched and verified again.
   */
  readonly owner?: Record<string, unknown>;
}

/**
 * An entry of a {@link CompatibleKeyCache}.
 * @internal
 */
export interface CompatibleKeyCacheEntry {
  readonly key: CryptographicKey | Multikey;
  /** See {@link CompatibleKeyCacheSetOptions.owner}. */
  readonly owner?: Record<string, unknown>;
  /** When the entry must not be used anymore. */
  readonly expires: Temporal.Instant;
}

/**
 * A cache namespace for keys at compatible identifiers looked up for one
 * {@link CompatibleKeyScope}.  Unlike the shared namespace, a `null` entry
 * here only ever means the key was resolved and turned out to be invalid for
 * that purpose; transport-level fetch failures, which fail every purpose
 * alike, are cached in the shared namespace instead.
 * @internal
 */
export interface CompatibleKeyCache {
  get(keyId: URL): Promise<CryptographicKey | Multikey | null | undefined>;

  /**
   * Same as {@link get}, but a key comes with the rest of its entry, read
   * together with it.
   */
  getEntry?(keyId: URL): Promise<CompatibleKeyCacheEntry | null | undefined>;

  /**
   * Caches a key, or the fact that it is invalid for the purpose.
   * @returns When the entry expires, if a key was cached.
   */
  set(
    keyId: URL,
    key: CryptographicKey | Multikey | null,
    options?: CompatibleKeyCacheSetOptions,
  ): Promise<Temporal.Instant | undefined | void>;

  delete(keyId: URL): Promise<void>;
}

/**
 * Internal extensions that Fedify's own key cache implements on top of
 * the public {@link KeyCache} interface.
 * @internal
 */
export interface FetchErrorMetadataCache extends KeyCache {
  getFetchError?(keyId: URL): Promise<FetchKeyErrorResult | undefined>;
  setFetchError?(
    keyId: URL,
    error: FetchKeyErrorResult | null,
  ): Promise<void>;
  /**
   * Returns a namespace, separate from the shared one and from those of
   * the other purposes, for keys at [FEP-ef61] compatible identifiers looked
   * up for the given purpose.  A cache without it caches only transport-level
   * fetch failures of such keys.
   *
   * [FEP-ef61]: https://w3id.org/fep/ef61
   */
  compatibleKeyScope?(scope: CompatibleKeyScope): CompatibleKeyCache;
}

/**
 * Wraps a key cache so that lookups through the wrapper miss, while
 * whatever they resolve is still written to the cache.  It is used to retry
 * a verification that failed with a cached key with a freshly fetched one.
 * @param keyCache The key cache to wrap.
 * @returns The wrapped key cache.
 * @internal
 */
export function bypassKeyCacheReads(keyCache?: KeyCache): KeyCache {
  const cache = keyCache as FetchErrorMetadataCache | undefined;
  const bypassed: FetchErrorMetadataCache = {
    // Returning `undefined` signals "nothing cached" and forces `fetchKey()`
    // to refetch from the network; returning `null` would instead be
    // interpreted as a cached-unavailable result and short-circuit the retry.
    get: () => Promise.resolve(undefined),
    set: async (keyId, key) => await cache?.set(keyId, key),
    getFetchError: () => Promise.resolve(undefined),
    setFetchError: async (keyId, error) =>
      await cache?.setFetchError?.(keyId, error),
  };
  if (cache?.compatibleKeyScope != null) {
    bypassed.compatibleKeyScope = (scope) => {
      const scoped = cache.compatibleKeyScope!(scope);
      return {
        get: () => Promise.resolve(undefined),
        getEntry: () => Promise.resolve(undefined),
        set: async (keyId, key, options) =>
          await scoped.set(keyId, key, options),
        delete: async (keyId) => await scoped.delete(keyId),
      };
    };
  }
  return bypassed;
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

/**
 * Parses a key ID given as a string.  Unlike `new URL()`, it accepts `ap:`
 * and `ap+ef61:` URIs, and refuses a portable or compatible key ID whose
 * identity URL parsing would change, e.g., by resolving dot segments.
 * @throws {TypeError} If the key ID is invalid.
 */
function parseKeyIdOrThrow(keyId: string): URL {
  const parsed = parseKeyIdString(keyId);
  if (parsed == null) throw new TypeError(`Invalid key ID: ${keyId}`);
  return parsed;
}

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
 * the corresponding key in the `publicKey` or `assertionMethod` property. *
 * Gateway keys of [FEP-ef61] portable actors, i.e., keys whose IDs are
 * compatible identifiers that dereference to portable actor documents, are
 * not resolved by this function, as they only authenticate HTTP requests;
 * use `verifyRequest()` or `getKeyOwner()` for them instead.  Nor are keys
 * of portable actors whose IDs are `ap:` or `ap+ef61:` URIs, for the same
 * reason.  Keys whose IDs are compatible identifiers or `ap:` or `ap+ef61:`
 * URIs are never read from or written to the key cache under their IDs,
 * except for failures to fetch them.
 *
 * [FEP-ef61]: https://w3id.org/fep/ef61
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
  keyId = typeof keyId === "string" ? parseKeyIdOrThrow(keyId) : keyId;
  return withFetchKeySpan(
    keyId,
    options.tracerProvider,
    () => fetchKeyInternal(keyId, cls, options),
  );
}

/**
 * Fetches a {@link CryptographicKey} or {@link Multikey} from the given URL,
 * preserving transport-level fetch failures for callers that need to inspect
 * why the key could not be loaded. *
 * Gateway keys of [FEP-ef61] portable actors, i.e., keys whose IDs are
 * compatible identifiers that dereference to portable actor documents, are
 * not resolved by this function, as they only authenticate HTTP requests;
 * use `verifyRequest()` or `getKeyOwner()` for them instead.  Nor are keys
 * of portable actors whose IDs are `ap:` or `ap+ef61:` URIs, for the same
 * reason.  Keys whose IDs are compatible identifiers or `ap:` or `ap+ef61:`
 * URIs are never read from or written to the key cache under their IDs,
 * except for failures to fetch them.
 *
 * [FEP-ef61]: https://w3id.org/fep/ef61
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
  const cacheKey = typeof keyId === "string" ? parseKeyIdOrThrow(keyId) : keyId;
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
  const hit = checkCachedKeyHit(cachedKey, keyId, cls, logger);
  if (hit != null) return hit;
  if (cachedKey === null) {
    logger.debug(
      "Entry {keyId} found in cache, but it is unavailable.",
      { keyId },
    );
    return { key: null, cached: true };
  }
  return null;
}

function checkCachedKeyHit<T extends CryptographicKey | Multikey>(
  cachedKey: CryptographicKey | Multikey | null | undefined,
  keyId: string,
  cls: FetchableKeyClass<T>,
  logger: ReturnType<typeof getLogger>,
): FetchKeyResult<T> | null {
  if (cachedKey instanceof cls && cachedKey.publicKey != null) {
    logger.debug("Key {keyId} found in cache.", { keyId });
    return {
      key: cachedKey as T & { publicKey: CryptoKey },
      cached: true,
    };
  }
  return null;
}

/**
 * Looks up a key at a compatible identifier, or at an `ap:` or `ap+ef61:`
 * URI, in the cache namespace of a purpose, like {@link getCachedFetchKey}.
 * A key that the verified document of its portable actor was cached with
 * gets the actor's evidence attached from the same entry; see
 * {@link attachKeyOwnerEvidence}.
 */
async function getCachedCompatibleKey<T extends CryptographicKey | Multikey>(
  cacheKey: URL,
  keyId: string,
  cls: FetchableKeyClass<T>,
  scopedCache: CompatibleKeyCache | undefined,
  logger: ReturnType<typeof getLogger>,
): Promise<FetchKeyResult<T> | null> {
  if (scopedCache?.getEntry == null) {
    return await getCachedFetchKey(
      cacheKey,
      keyId,
      cls,
      // Only get() is used, whose signature is the same:
      scopedCache as KeyCache | undefined,
      logger,
    );
  }
  const entry = await scopedCache.getEntry(cacheKey);
  if (entry === undefined) return null;
  if (entry === null) {
    logger.debug(
      "Entry {keyId} found in cache, but it is unavailable.",
      { keyId },
    );
    return { key: null, cached: true };
  }
  const hit = checkCachedKeyHit(entry.key, keyId, cls, logger);
  if (hit?.key instanceof CryptographicKey && entry.owner != null) {
    // The cache is trusted with the owner as much as with the key itself:
    // both were stored together, once the owner's document vouched for
    // the key:
    attachKeyOwnerEvidence(hit.key, entry.owner, entry.expires);
  }
  return hit;
}

/**
 * Attaches the evidence of the portable actor whose document has just
 * vouched for a key to the key.  The evidence expires with the cache entry
 * of the key, so that it is never trusted longer than the key is cached.
 * Without a cache, it expires with the proof of the document, but no later
 * than {@link MAX_PORTABLE_KEY_TTL}, as a cache entry would.
 * @param resolution The resolution of the key.
 * @param scopedCache The cache namespace the key was stored in, if any.
 * @param cached When the cache entry expires, if the cache stored one.
 */
function attachResolvedKeyOwnerEvidence(
  resolution: Extract<PortableGatewayKeyResolution, { type: "verified" }>,
  scopedCache: CompatibleKeyCache | undefined,
  cached: Temporal.Instant | undefined | void,
): void {
  let expires: Temporal.Instant | undefined;
  if (scopedCache != null) {
    // A cache that did not tell when its entry expires, or that did not store
    // one at all, e.g., because the proof has already expired, leaves no
    // deadline to trust the evidence until:
    if (cached == null) return;
    expires = cached;
  } else {
    expires = Temporal.Now.instant().add(MAX_PORTABLE_KEY_TTL);
    if (
      resolution.expires != null &&
      Temporal.Instant.compare(resolution.expires, expires) < 0
    ) {
      expires = resolution.expires;
    }
  }
  attachKeyOwnerEvidence(resolution.key, resolution.document, expires);
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

/**
 * Returns the identifier a fragment-bearing DID URL is a fragment of, or
 * `null` if the URL is not a DID URL.  `did:web:example.com#key` is thereby
 * traced back to `did:web:example.com`, the DID that resolving the key went
 * through in the first place.
 */
function stripFragment(keyId: URL): URL | null {
  if (keyId.protocol !== "did:") return null;
  const did = new URL(keyId.href);
  did.hash = "";
  return did;
}

function isDidKeyUrl(keyId: URL): boolean {
  return keyId.protocol === "did:" && keyId.pathname.startsWith("key:");
}

async function doRawKeysMatch(
  left: CryptoKey,
  right: CryptoKey,
): Promise<boolean> {
  const [leftRaw, rightRaw] = await Promise.all([
    crypto.subtle.exportKey("raw", left),
    crypto.subtle.exportKey("raw", right),
  ]);
  if (leftRaw.byteLength !== rightRaw.byteLength) return false;
  const leftBytes = new Uint8Array(leftRaw);
  const rightBytes = new Uint8Array(rightRaw);
  return leftBytes.every((byte, index) => byte === rightBytes[index]);
}

async function isCachedDidKeyValid(
  key: Multikey & { publicKey: CryptoKey },
  verificationMethod: DidKeyVerificationMethod,
): Promise<boolean> {
  try {
    return key.id?.href === verificationMethod.id.href &&
      key.controllerId?.href === verificationMethod.controller.href &&
      await doRawKeysMatch(key.publicKey, verificationMethod.publicKey);
  } catch {
    return false;
  }
}

async function resolveDidKey<T extends CryptographicKey | Multikey>(
  cacheKey: URL,
  cls: FetchableKeyClass<T>,
  keyCache: KeyCache | undefined,
  logger: ReturnType<typeof getLogger>,
): Promise<FetchKeyResult<T> | null> {
  if (!isDidKeyUrl(cacheKey)) return null;
  const keyId = cacheKey.href;
  const clsIsMultikey = cls ===
    (Multikey as unknown as FetchableKeyClass<T>);
  if (!clsIsMultikey) {
    logger.debug(
      "Failed to resolve did:key {keyId}; did:key verification methods " +
        "are only supported as Multikey values.",
      { keyId },
    );
    return { key: null, cached: false };
  }
  let verificationMethod: DidKeyVerificationMethod;
  try {
    verificationMethod = await parseDidKeyVerificationMethod(cacheKey);
  } catch (error) {
    logger.debug(
      "Failed to resolve did:key verification method {keyId}: {error}",
      { keyId, error },
    );
    return { key: null, cached: false };
  }
  const cachedKey = await keyCache?.get(cacheKey);
  const hit = checkCachedKeyHit(cachedKey, keyId, cls, logger);
  if (
    hit?.key instanceof Multikey &&
    await isCachedDidKeyValid(hit.key, verificationMethod)
  ) {
    return hit;
  }
  const key = new Multikey({
    id: verificationMethod.id,
    controller: verificationMethod.controller,
    publicKey: verificationMethod.publicKey,
  }) as unknown as T & { publicKey: CryptoKey };
  await keyCache?.set(cacheKey, key);
  await clearFetchErrorMetadata(cacheKey, keyCache);
  logger.debug("Resolved did:key verification method {keyId}.", { keyId });
  return { key, cached: false };
}

async function resolveFetchedKey<T extends CryptographicKey | Multikey>(
  document: unknown,
  cacheKey: URL,
  // The URL the document actually came from, which may differ from the
  // requested one after redirects.  It is the host that served those bytes,
  // not the host that was asked, that the document can speak for.
  documentUrl: URL,
  keyId: string,
  cls: FetchableKeyClass<T>,
  {
    documentLoader,
    contextLoader,
    keyCache,
    tracerProvider,
    keyIdBoundByCaller,
    portableKeyResolvers,
  }: FetchKeyOptions,
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
    const failure = classifyKeyJsonLdError(e);
    if (failure === "fetch") throw contextFetchError(e);
    if (failure != null) {
      logger.debug(
        "Failed to decode key {keyId}: {error}",
        { keyId, failure, error: e },
      );
      await keyCache?.set(cacheKey, null);
      await clearFetchErrorMetadata(cacheKey, keyCache);
      return { key: null, cached: false };
    }
    if (!(e instanceof TypeError)) throw e;
    try {
      object = await cls.fromJsonLd(document, {
        documentLoader,
        contextLoader,
        tracerProvider,
      });
    } catch (e) {
      const failure = classifyKeyJsonLdError(e);
      if (failure === "fetch") throw contextFetchError(e);
      if (failure != null || e instanceof TypeError) {
        logger.debug(
          "Failed to decode key {keyId}: {error}",
          { keyId, failure: failure ?? "invalid", error: e },
        );
        await keyCache?.set(cacheKey, null);
        await clearFetchErrorMetadata(cacheKey, keyCache);
        return { key: null, cached: false };
      }
      throw e;
    }
  }
  if (isCompatibleKeyId(cacheKey) && isPortableActorDocument(object)) {
    // A compatible key ID that dereferences to a portable actor names a key
    // that a gateway holds for the actor.  The host that served the document
    // does not speak for the actor, only the actor's DID does, so there is
    // no falling back to the checks below, which trust web origins.
    // The key cache here is the namespace of this lookup's purpose (see
    // fetchKeyWithResult()), so whatever is cached below is never read for
    // another purpose:
    const scopedCache = keyCache as CompatibleKeyCache | undefined;
    if (
      portableKeyResolvers == null ||
      cls !== (CryptographicKey as unknown as FetchableKeyClass<T>)
    ) {
      logger.debug(
        "Failed to verify; key {keyId} is a gateway key of the portable " +
          "actor {actorId}, which is only accepted for HTTP Signatures.",
        { keyId, actorId: object.id?.href },
      );
      await scopedCache?.set(cacheKey, null);
      return { key: null, cached: false };
    }
    const resolution = await portableKeyResolvers.gatewayKey(
      document,
      object,
      cacheKey,
    );
    if (resolution.type !== "verified") {
      logger.debug(
        "Failed to verify; the portable actor {actorId} does not vouch for " +
          "its gateway key {keyId}.",
        { keyId, actorId: object.id?.href },
      );
      await scopedCache?.set(cacheKey, null);
      return { key: null, cached: false };
    }
    // The key is only as good as the proof of the document that vouches for
    // it, so it must not outlive the proof:
    const expires = await scopedCache?.set(cacheKey, resolution.key, {
      expires: resolution.expires,
      owner: resolution.document,
    });
    attachResolvedKeyOwnerEvidence(resolution, scopedCache, expires);
    return {
      key: resolution.key as unknown as T & { publicKey: CryptoKey },
      cached: false,
    };
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
    // A portable actor belongs to no web origin at all; only its DID speaks
    // for it, through the gateway key path above:
    if (
      object.id == null || isPortableId(object.id) ||
      object.id.origin !== documentUrl.origin
    ) {
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
  // Whom the key belongs to has to be settled here, before any caller can act
  // on it.  The `owner`/`controller` field of a key document is written by
  // the very host that served the key, so by itself it says nothing about the
  // actor it names; leaving it unchecked let anyone impersonate any actor.
  // See GHSA-q9f8-5hc7-898f.
  const claimedOwnerId = key instanceof CryptographicKey
    ? key.ownerId
    : (key as Multikey).controllerId;
  // One case settles itself without a second document: the caller has bound
  // the key id already (see `FetchKeyOptions.keyIdBoundByCaller`) and the key
  // names that id's own DID as its owner.  A `did:…#fragment` belongs to the
  // DID it is a fragment of the same way a key embedded in an actor document
  // belongs to that actor—the identifier that led here is the owner—so the
  // claim adds nothing to dereference.  A key naming anyone else falls
  // through to the ordinary check, where it has to stand on its own.
  const ownedByItsOwnKeyId = keyIdBoundByCaller && claimedOwnerId != null &&
    claimedOwnerId.href === stripFragment(cacheKey)?.href;
  if (!ownedByItsOwnKeyId) {
    if (claimedOwnerId != null && isPortableId(claimedOwnerId)) {
      // Only the gateway key path above binds a key to a portable actor,
      // by the actor's DID-signed document; the claim of a key served
      // elsewhere cannot be confirmed by any web origin:
      logger.debug(
        "Failed to verify; key {keyId} claims the portable actor " +
          "{claimedOwnerId} as its owner, but is not its gateway key.",
        { keyId, claimedOwnerId: claimedOwnerId.href },
      );
      await keyCache?.set(cacheKey, null);
      await clearFetchErrorMetadata(cacheKey, keyCache);
      return { key: null, cached: false };
    }
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
      const owner = await verifyKeyOwnershipInternal(key, {
        documentLoader,
        contextLoader,
        tracerProvider,
      }, true);
      if (owner == null) {
        logger.debug(
          "Failed to verify; the owner {claimedOwnerId} that key {keyId} " +
            "claims does not list the key as its own.",
          { keyId, claimedOwnerId: claimedOwnerId.href },
        );
        await keyCache?.set(cacheKey, null);
        await clearFetchErrorMetadata(cacheKey, keyCache);
        return { key: null, cached: false };
      }
    }
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

/**
 * Tells whether a key claims a portable actor as its owner.  Such a key can
 * only be a gateway key, which is never cached under its ID, so a cached one
 * was cached by an older version that trusted web origins, and is fetched
 * again.
 */
function claimsPortableOwner(key: CryptographicKey | Multikey | null): boolean {
  const ownerId = key instanceof CryptographicKey
    ? key.ownerId
    : key?.controllerId;
  return ownerId != null && isPortableId(ownerId);
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
  const start = performance.now();
  let outcome: { result: KeyLookupResult; statusCode?: number } = {
    result: "error",
  };
  try {
    const logger = getLogger(["fedify", "sig", "key"]);
    const keyId = cacheKey.href;
    const keyCache = options.keyCache as FetchErrorMetadataCache | undefined;
    if (isPortableUri(cacheKey)) {
      const result = await fetchPortableActorKey(
        cacheKey,
        cls,
        options,
        onCachedUnavailable,
        onFetchError,
        logger,
      );
      outcome = result.outcome;
      return result.result;
    }
    if (isCompatibleKeyId(cacheKey)) {
      const result = await fetchCompatibleKey(
        cacheKey,
        cls,
        options,
        onCachedUnavailable,
        onFetchError,
        logger,
      );
      outcome = result.outcome;
      return result.result;
    }
    const didKey = await resolveDidKey(cacheKey, cls, keyCache, logger);
    if (didKey != null) {
      outcome = {
        result: didKey.key == null
          ? "invalid"
          : didKey.cached
          ? "hit"
          : "fetched",
      };
      return didKey as TResult;
    }
    const cached = await getCachedFetchKey(
      cacheKey,
      keyId,
      cls,
      keyCache,
      logger,
    );
    if (cached?.key === null && cached.cached) {
      const cachedUnavailable = await onCachedUnavailable(
        cacheKey,
        keyId,
        keyCache,
        logger,
      );
      outcome = { result: "hit" };
      return cachedUnavailable;
    }
    if (cached != null && !claimsPortableOwner(cached.key)) {
      outcome = { result: "hit" };
      return cached as TResult;
    }
    logger.debug("Fetching key {keyId} to verify signature...", { keyId });
    let document: unknown;
    let documentUrl: URL = cacheKey;
    try {
      const remoteDocument =
        await (options.documentLoader ?? getDocumentLoader())(
          keyId,
        );
      document = remoteDocument.document;
      documentUrl = new URL(remoteDocument.documentUrl ?? "", cacheKey);
    } catch (error) {
      const classified = classifyFetchError(error);
      const errored = await onFetchError(
        error,
        cacheKey,
        keyId,
        keyCache,
        logger,
      );
      outcome = classified;
      return errored;
    }
    try {
      const resolved = await resolveFetchedKey(
        document,
        cacheKey,
        documentUrl,
        keyId,
        cls,
        options,
        logger,
      );
      outcome = { result: resolved.key != null ? "fetched" : "invalid" };
      return resolved as TResult;
    } catch (error) {
      if (!(error instanceof KeyContextFetchError)) throw error;
      const classified = classifyFetchError(error.error);
      const errored = await onFetchError(
        error.error,
        cacheKey,
        keyId,
        keyCache,
        logger,
      );
      outcome = classified;
      return errored;
    }
  } finally {
    recordKeyLookup(options.meterProvider, {
      durationMs: getDurationMs(start),
      result: outcome.result,
      remoteUrl: cacheKey,
      cacheEnabled: options.keyCache != null,
      statusCode: outcome.statusCode,
    });
  }
}

/**
 * Tells which purpose a lookup of a key at a compatible identifier serves.
 */
function getCompatibleKeyScope<T extends CryptographicKey | Multikey>(
  cls: FetchableKeyClass<T>,
  options: FetchKeyOptions,
): CompatibleKeyScope {
  if (cls !== (CryptographicKey as unknown as FetchableKeyClass<T>)) {
    return "multikey";
  }
  return options.portableKeyResolvers == null
    ? "cryptographicKey"
    : "httpSignature";
}

/**
 * Looks up a key at an [FEP-ef61] compatible identifier.  Such a key may be
 * a gateway key of a portable actor, which is accepted for some purposes but
 * not for others, so everything resolved from the document at the key ID is
 * cached in a namespace of the lookup's purpose, and one purpose never reuses
 * what another resolved, nor what another rejected.  A failure to fetch
 * the document fails every purpose alike, so it is cached in the shared
 * namespace, as for any other key.
 *
 * [FEP-ef61]: https://w3id.org/fep/ef61
 */
async function fetchCompatibleKey<
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
  logger: ReturnType<typeof getLogger>,
): Promise<{
  result: TResult;
  outcome: { result: KeyLookupResult; statusCode?: number };
}> {
  const keyId = cacheKey.href;
  const sharedCache = options.keyCache as FetchErrorMetadataCache | undefined;
  const scopedCache = sharedCache?.compatibleKeyScope?.(
    getCompatibleKeyScope(cls, options),
  );
  // What this purpose resolved takes precedence over the shared namespace:
  const cached = await getCachedCompatibleKey(
    cacheKey,
    keyId,
    cls,
    scopedCache,
    logger,
  );
  if (cached != null) {
    // A null entry here means the key was resolved and found invalid for this
    // purpose, not that fetching it failed, so there is no fetch error:
    return { result: cached as TResult, outcome: { result: "hit" } };
  }
  // The shared namespace only has fetch failures of compatible key IDs.  A key
  // found there was cached by an older version that did not tell purposes
  // apart, and is fetched again:
  if (await sharedCache?.get(cacheKey) === null) {
    logger.debug(
      "Entry {keyId} found in cache, but it could not be fetched.",
      { keyId },
    );
    return {
      result: await onCachedUnavailable(cacheKey, keyId, sharedCache, logger),
      outcome: { result: "hit" },
    };
  }
  logger.debug("Fetching key {keyId} to verify signature...", { keyId });
  let document: unknown;
  let documentUrl: URL;
  try {
    const remoteDocument =
      await (options.documentLoader ?? getDocumentLoader())(keyId);
    document = remoteDocument.document;
    documentUrl = new URL(remoteDocument.documentUrl ?? "", cacheKey);
  } catch (error) {
    const outcome = classifyFetchError(error);
    const result = await onFetchError(
      error,
      cacheKey,
      keyId,
      sharedCache,
      logger,
    );
    // A key this purpose resolved before is not fresh anymore, e.g., when
    // it has just failed to verify a signature and is being refetched:
    await scopedCache?.delete(cacheKey);
    return { result, outcome };
  }
  const resolved = await resolveFetchedKey(
    document,
    cacheKey,
    documentUrl,
    keyId,
    cls,
    // Only the namespace of this purpose is written, and a successful fetch
    // does not clear the shared fetch failure metadata, which has to stay
    // paired with the shared entry that nothing can delete:
    // What set() returns is only for resolveFetchedKey(), which knows it is
    // the namespace of this purpose:
    { ...options, keyCache: scopedCache as KeyCache | undefined },
    logger,
  );
  return {
    result: resolved as TResult,
    outcome: { result: resolved.key != null ? "fetched" : "invalid" },
  };
}

/**
 * Looks up a key of an [FEP-ef61] portable actor at an `ap:` or `ap+ef61:`
 * key ID.  Such a key is accepted only for HTTP Signatures, and is rejected
 * for any other purpose without being fetched.  Like keys at compatible
 * identifiers, what it resolves to is cached in the namespace of the lookup's
 * purpose, and a failure to fetch the actor's document from every gateway is
 * cached in the shared namespace.  A failure that is neither, e.g., one
 * gateway being unreachable while another served an invalid document, is not
 * cached at all.
 *
 * [FEP-ef61]: https://w3id.org/fep/ef61
 */
async function fetchPortableActorKey<
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
  logger: ReturnType<typeof getLogger>,
): Promise<{
  result: TResult;
  outcome: { result: KeyLookupResult; statusCode?: number };
}> {
  const keyId = cacheKey.href;
  const resolvers = options.portableKeyResolvers;
  if (
    resolvers == null ||
    cls !== (CryptographicKey as unknown as FetchableKeyClass<T>)
  ) {
    logger.debug(
      "Failed to verify; key {keyId} is a key of a portable actor, which is " +
        "only accepted for HTTP Signatures.",
      { keyId },
    );
    return {
      result: { key: null, cached: false } as TResult,
      outcome: { result: "invalid" },
    };
  }
  const sharedCache = options.keyCache as FetchErrorMetadataCache | undefined;
  const scopedCache = sharedCache?.compatibleKeyScope?.("httpSignature");
  // What HTTP Signatures resolved takes precedence over the shared namespace:
  const cached = await getCachedCompatibleKey(
    cacheKey,
    keyId,
    cls,
    scopedCache,
    logger,
  );
  if (cached != null) {
    return { result: cached as TResult, outcome: { result: "hit" } };
  }
  // The shared namespace only has fetch failures of portable key IDs.  A key
  // found there was not cached by this function, and is resolved again:
  if (await sharedCache?.get(cacheKey) === null) {
    logger.debug(
      "Entry {keyId} found in cache, but it could not be fetched.",
      { keyId },
    );
    return {
      result: await onCachedUnavailable(cacheKey, keyId, sharedCache, logger),
      outcome: { result: "hit" },
    };
  }
  logger.debug("Resolving key {keyId} to verify signature...", { keyId });
  const resolution = await resolvers.actorKey(cacheKey);
  if (resolution.type === "verified") {
    // The key is only as good as the proof of the document that vouches for
    // it, so it must not outlive the proof:
    const expires = await scopedCache?.set(cacheKey, resolution.key, {
      expires: resolution.expires,
      owner: resolution.document,
    });
    attachResolvedKeyOwnerEvidence(resolution, scopedCache, expires);
    return {
      result: {
        key: resolution.key as unknown as T & { publicKey: CryptoKey },
        cached: false,
      } as TResult,
      outcome: { result: "fetched" },
    };
  }
  if (resolution.type === "rejected") {
    await scopedCache?.set(cacheKey, null);
    return {
      result: { key: null, cached: false } as TResult,
      outcome: { result: "invalid" },
    };
  }
  // A key resolved before is not fresh anymore, e.g., when it has just
  // failed to verify a signature and is being resolved again:
  await scopedCache?.delete(cacheKey);
  const result = await onFetchError(
    resolution.error,
    cacheKey,
    keyId,
    resolution.cacheable ? sharedCache : undefined,
    logger,
  );
  return {
    result,
    outcome: resolution.cacheable
      ? classifyFetchError(resolution.error)
      : { result: "error" },
  };
}

async function fetchKeyInternal<T extends CryptographicKey | Multikey>(
  keyId: URL | string,
  cls: FetchableKeyClass<T>,
  options: FetchKeyOptions = {},
): Promise<FetchKeyResult<T>> {
  const cacheKey = typeof keyId === "string" ? parseKeyIdOrThrow(keyId) : keyId;
  return await fetchKeyWithResult<T, FetchKeyResult<T>>(
    cacheKey,
    cls,
    options,
    async (_cacheKey, _keyId, _keyCache, _logger) => {
      const check = options[verificationObservation]?.check;
      if (check != null) {
        try {
          const result = await _keyCache?.getFetchError?.(_cacheKey);
          if (result != null) {
            check.reason = {
              type: "keyFetchError",
              keyId: new URL(_cacheKey.href),
              result,
            };
          }
        } catch {
          // Optional diagnostic metadata must not change a cached miss.
        }
      }
      return { key: null, cached: true };
    },
    async (error, cacheKey, keyId, keyCache, logger) => {
      const check = options[verificationObservation]?.check;
      if (check != null) {
        let result: FetchKeyErrorResult;
        try {
          result = error instanceof FetchError && error.response != null
            ? {
              status: error.response.status,
              response: error.response.clone(),
            }
            : {
              error: error instanceof Error ? error : new Error(String(error)),
            };
        } catch {
          // A custom loader can provide a response whose body is already used.
          // Collecting evidence must preserve the original verification result.
          result = { error: error instanceof Error ? error : new Error() };
        }
        check.reason = {
          type: "keyFetchError",
          keyId: new URL(cacheKey.href),
          result,
        };
      }
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
