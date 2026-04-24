import {
  Activity,
  DataIntegrityProof,
  getTypeId,
  Multikey,
  type Object,
} from "@fedify/vocab";
import type { DocumentLoader } from "@fedify/vocab-runtime";
import { getLogger } from "@logtape/logtape";
import { SpanStatusCode, trace, type TracerProvider } from "@opentelemetry/api";
import { encodeHex } from "byte-encodings/hex";
import serialize from "json-canon";
import metadata from "../../deno.json" with { type: "json" };
import { normalizeOutgoingActivityJsonLd } from "../compat/outgoing-jsonld.ts";
import {
  fetchKey,
  type FetchKeyResult,
  type KeyCache,
  validateCryptoKey,
} from "./key.ts";

const logger = getLogger(["fedify", "sig", "proof"]);

/**
 * Checks if the given JSON-LD document has a DataIntegrityProof-like object,
 * without fully deserializing it into vocabulary classes.
 * @param jsonLd The JSON-LD document to check.
 * @returns `true` if the document has a proof-like object; `false` otherwise.
 * @since 2.2.0
 */
export function hasProofLike(jsonLd: unknown): boolean {
  if (typeof jsonLd !== "object" || jsonLd == null) return false;
  const record = jsonLd as Record<string, unknown>;
  const proof = record.proof ?? record["https://w3id.org/security#proof"];

  const getField = (
    source: Record<string, unknown>,
    compact: string,
    expanded: string,
  ): unknown => source[compact] ?? source[expanded];

  const isReference = (value: unknown): boolean => {
    if (typeof value === "string") return true;
    if (Array.isArray(value)) return value.some(isReference);
    return typeof value === "object" && value != null &&
      (("id" in value && typeof value.id === "string") ||
        ("@id" in value && typeof value["@id"] === "string") ||
        ("@value" in value && typeof value["@value"] === "string"));
  };

  const hasType = (value: unknown): boolean => {
    if (typeof value === "string") {
      return value === "DataIntegrityProof" ||
        value === "https://w3id.org/security#DataIntegrityProof";
    }
    if (Array.isArray(value)) return value.some(hasType);
    return false;
  };

  const isProofLike = (value: unknown): boolean => {
    if (typeof value !== "object" || value == null) return false;
    const proofRecord = value as Record<string, unknown>;
    return hasType(proofRecord.type ?? proofRecord["@type"]) &&
      isReference(getField(
        proofRecord,
        "verificationMethod",
        "https://w3id.org/security#verificationMethod",
      )) &&
      isReference(getField(
        proofRecord,
        "proofPurpose",
        "https://w3id.org/security#proofPurpose",
      )) &&
      isReference(getField(
        proofRecord,
        "proofValue",
        "https://w3id.org/security#proofValue",
      ));
  };

  return Array.isArray(proof) ? proof.some(isProofLike) : isProofLike(proof);
}

/**
 * Options for {@link createProof}.
 * @since 0.10.0
 */
export interface CreateProofOptions {
  /**
   * The context loader for loading remote JSON-LD contexts.
   */
  contextLoader?: DocumentLoader;

  /**
   * The JSON-LD context to use for serializing the object to sign.
   */
  context?:
    | string
    | Record<string, string>
    | (string | Record<string, string>)[];

  /**
   * The time when the proof was created.  If not specified, the current time
   * will be used.
   */
  created?: Temporal.Instant;
}

/**
 * Creates a proof for the given object.
 * @param object The object to create a proof for.
 * @param privateKey The private key to sign the proof with.
 * @param keyId The key ID to use in the proof. It will be used by the verifier.
 * @param options Additional options.  See also {@link CreateProofOptions}.
 * @returns The created proof.
 * @throws {TypeError} If the private key is invalid or unsupported.
 * @since 0.10.0
 */
export async function createProof(
  object: Object,
  privateKey: CryptoKey,
  keyId: URL,
  { contextLoader, context, created }: CreateProofOptions = {},
): Promise<DataIntegrityProof> {
  validateCryptoKey(privateKey, "private");
  if (privateKey.algorithm.name !== "Ed25519") {
    throw new TypeError("Unsupported algorithm: " + privateKey.algorithm.name);
  }
  const objectWithoutProofs = object.clone({ proofs: [] });
  let compactMsg = await objectWithoutProofs.toJsonLd({
    format: "compact",
    contextLoader,
    context,
  });
  compactMsg = await normalizeOutgoingActivityJsonLd(
    compactMsg,
    contextLoader,
  );
  const msgCanon = serialize(compactMsg);
  const encoder = new TextEncoder();
  const msgBytes = encoder.encode(msgCanon);
  const msgDigest = await crypto.subtle.digest("SHA-256", msgBytes);
  created ??= Temporal.Now.instant();
  const proofConfig = {
    // deno-lint-ignore no-explicit-any
    "@context": (compactMsg as any)["@context"],
    type: "DataIntegrityProof",
    cryptosuite: "eddsa-jcs-2022",
    verificationMethod: keyId.href,
    proofPurpose: "assertionMethod",
    created: created.toString(),
  };
  const proofCanon = serialize(proofConfig);
  const proofBytes = encoder.encode(proofCanon);
  const proofDigest = await crypto.subtle.digest("SHA-256", proofBytes);
  const digest = new Uint8Array(proofDigest.byteLength + msgDigest.byteLength);
  digest.set(new Uint8Array(proofDigest), 0);
  digest.set(new Uint8Array(msgDigest), proofDigest.byteLength);
  const sig = await crypto.subtle.sign("Ed25519", privateKey, digest);
  return new DataIntegrityProof({
    cryptosuite: "eddsa-jcs-2022",
    verificationMethod: keyId,
    proofPurpose: "assertionMethod",
    created: created ?? Temporal.Now.instant(),
    proofValue: new Uint8Array(sig),
  });
}

/**
 * Options for {@link signObject}.
 * @since 0.10.0
 */
export interface SignObjectOptions extends CreateProofOptions {
  /**
   * The document loader for loading remote JSON-LD documents.
   */
  documentLoader?: DocumentLoader;

  /**
   * The OpenTelemetry tracer provider.  If omitted, the global tracer provider
   * is used.
   * @since 1.3.0
   */
  tracerProvider?: TracerProvider;
}

/**
 * Signs the given object with the private key and returns the signed object.
 * @param object The object to create a proof for.
 * @param privateKey The private key to sign the proof with.
 * @param keyId The key ID to use in the proof. It will be used by the verifier.
 * @param options Additional options.  See also {@link SignObjectOptions}.
 * @returns The signed object.
 * @throws {TypeError} If the private key is invalid or unsupported.
 * @since 0.10.0
 */
export async function signObject<T extends Object>(
  object: T,
  privateKey: CryptoKey,
  keyId: URL,
  options: SignObjectOptions = {},
): Promise<T> {
  const tracerProvider = options.tracerProvider ?? trace.getTracerProvider();
  const tracer = tracerProvider.getTracer(metadata.name, metadata.version);
  return await tracer.startActiveSpan(
    "object_integrity_proofs.sign",
    {
      attributes: { "activitypub.object.type": getTypeId(object).href },
    },
    async (span) => {
      try {
        if (object.id != null) {
          span.setAttribute("activitypub.object.id", object.id.href);
        }
        const existingProofs: DataIntegrityProof[] = [];
        for await (const proof of object.getProofs(options)) {
          existingProofs.push(proof);
        }
        const proof = await createProof(object, privateKey, keyId, options);
        if (span.isRecording()) {
          if (proof.cryptosuite != null) {
            span.setAttribute(
              "object_integrity_proofs.cryptosuite",
              proof.cryptosuite,
            );
          }
          if (proof.verificationMethodId != null) {
            span.setAttribute(
              "object_integrity_proofs.key_id",
              proof.verificationMethodId.href,
            );
          }
          if (proof.proofValue != null) {
            span.setAttribute(
              "object_integrity_proofs.signature",
              encodeHex(proof.proofValue),
            );
          }
        }
        return object.clone({ proofs: [...existingProofs, proof] }) as T;
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

/**
 * Options for {@link verifyProof}.
 * @since 0.10.0
 */
export interface VerifyProofOptions {
  /**
   * The context loader for loading remote JSON-LD contexts.
   */
  contextLoader?: DocumentLoader;

  /**
   * The document loader for loading remote JSON-LD documents.
   */
  documentLoader?: DocumentLoader;

  /**
   * The key cache to use for caching public keys.
   * @since 0.12.0
   */
  keyCache?: KeyCache;

  /**
   * The OpenTelemetry tracer provider.  If omitted, the global tracer provider
   * is used.
   * @since 1.3.0
   */
  tracerProvider?: TracerProvider;
}

/**
 * Verifies the given proof for the object.
 * @param jsonLd The JSON-LD object to verify the proof for.  If it contains
 *               any proofs, they will be ignored.
 * @param proof The proof to verify.
 * @param options Additional options.  See also {@link VerifyProofOptions}.
 * @returns The public key that was used to sign the proof, or `null` if the
 *          proof is invalid.
 * @since 0.10.0
 */
export async function verifyProof(
  jsonLd: unknown,
  proof: DataIntegrityProof,
  options: VerifyProofOptions = {},
): Promise<Multikey | null> {
  const tracerProvider = options.tracerProvider ?? trace.getTracerProvider();
  const tracer = tracerProvider.getTracer(metadata.name, metadata.version);
  return await tracer.startActiveSpan(
    "object_integrity_proofs.verify",
    async (span) => {
      if (span.isRecording()) {
        if (proof.cryptosuite != null) {
          span.setAttribute(
            "object_integrity_proofs.cryptosuite",
            proof.cryptosuite,
          );
        }
        if (proof.verificationMethodId != null) {
          span.setAttribute(
            "object_integrity_proofs.key_id",
            proof.verificationMethodId.href,
          );
        }
        if (proof.proofValue != null) {
          span.setAttribute(
            "object_integrity_proofs.signature",
            encodeHex(proof.proofValue),
          );
        }
      }
      try {
        const key = await verifyProofInternal(jsonLd, proof, options);
        if (key == null) span.setStatus({ code: SpanStatusCode.ERROR });
        return key;
      } catch (error) {
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

async function verifyProofInternal(
  jsonLd: unknown,
  proof: DataIntegrityProof,
  options: VerifyProofOptions,
): Promise<Multikey | null> {
  if (
    typeof jsonLd !== "object" ||
    jsonLd == null ||
    Array.isArray(jsonLd) ||
    proof.cryptosuite !== "eddsa-jcs-2022" ||
    proof.verificationMethodId == null ||
    proof.proofPurpose !== "assertionMethod" ||
    proof.proofValue == null ||
    proof.created == null
  ) return null;
  const publicKeyPromise = fetchKey(
    proof.verificationMethodId,
    Multikey,
    options,
  );
  const proofConfig = {
    // deno-lint-ignore no-explicit-any
    "@context": (jsonLd as any)["@context"],
    type: "DataIntegrityProof",
    cryptosuite: proof.cryptosuite,
    verificationMethod: proof.verificationMethodId.href,
    proofPurpose: proof.proofPurpose,
    created: proof.created.toString(),
  };
  const encoder = new TextEncoder();
  const proofBytes = encoder.encode(serialize(proofConfig));
  const proofDigest = await crypto.subtle.digest("SHA-256", proofBytes);
  const msg = { ...(jsonLd as Record<string, unknown>) };
  // `verifyProof()` promises to ignore existing proofs on the input;
  // strip both the compact (`proof`) and the expanded
  // (`https://w3id.org/security#proof`) forms so callers passing JSON-LD
  // in either shape do not have the proof bytes folded into the JCS
  // message digest.
  if ("proof" in msg) delete msg.proof;
  if ("https://w3id.org/security#proof" in msg) {
    delete msg["https://w3id.org/security#proof"];
  }
  // Try the on-wire form first.  Only if that fails do we fall back to
  // Fedify's outgoing JSON-LD compatibility form so that signatures created
  // by `createProof` (which signs the normalized bytes) still verify when the
  // caller passes the default `toJsonLd({ format: "compact" })` output.
  //
  // This fallback must stay on normalizeOutgoingActivityJsonLd()'s
  // preloaded-only default loader: it runs on inbound, potentially adversarial
  // JSON-LD, and must not let attacker-supplied `@context` URLs steer
  // canonicalization into a network fetch through `options.contextLoader`.
  let fetchedKey: FetchKeyResult<Multikey> | null;
  try {
    fetchedKey = await publicKeyPromise;
  } catch (error) {
    logger.debug(
      "Failed to get the key (verificationMethod) for the proof:\n{proof}",
      { proof, keyId: proof.verificationMethodId.href, error },
    );
    return null;
  }
  const publicKey = fetchedKey.key;
  if (publicKey == null) {
    logger.debug(
      "Failed to get the key (verificationMethod) for the proof:\n{proof}",
      { proof, keyId: proof.verificationMethodId.href },
    );
    return null;
  }
  if (publicKey.publicKey.algorithm.name !== "Ed25519") {
    if (fetchedKey.cached) {
      logger.debug(
        "The cached key (verificationMethod) for the proof is not a valid " +
          "Ed25519 key:\n{keyId}; retrying with the freshly fetched key...",
        { proof, keyId: proof.verificationMethodId.href },
      );
      return await verifyProof(jsonLd, proof, {
        ...options,
        keyCache: {
          // Returning `undefined` signals "nothing cached" and forces
          // `fetchKey()` to refetch from the network; returning `null`
          // would instead be interpreted as a cached-unavailable result
          // and short-circuit the retry.
          get: () => Promise.resolve(undefined),
          set: async (keyId, key) => await options.keyCache?.set(keyId, key),
        },
      });
    }
    logger.debug(
      "The fetched key (verificationMethod) for the proof is not a valid " +
        "Ed25519 key:\n{keyId}",
      { proof, keyId: proof.verificationMethodId.href },
    );
    return null;
  }
  // SHA-256 always produces 32 bytes; `proofDigest` is constant across
  // candidates, so allocate the combined digest buffer once and only
  // rewrite the message-digest tail per iteration.
  const SHA256_LENGTH = 32;
  const digest = new Uint8Array(proofDigest.byteLength + SHA256_LENGTH);
  digest.set(new Uint8Array(proofDigest), 0);
  const proofValue = proof.proofValue;
  const verifyCandidate = async (candidate: unknown): Promise<boolean> => {
    const msgBytes = encoder.encode(serialize(candidate));
    const msgDigest = await crypto.subtle.digest("SHA-256", msgBytes);
    digest.set(new Uint8Array(msgDigest), proofDigest.byteLength);
    return await crypto.subtle.verify(
      "Ed25519",
      publicKey.publicKey,
      // `.slice()` narrows `Uint8Array<ArrayBufferLike>` (which can be
      // backed by a `SharedArrayBuffer`) to `Uint8Array<ArrayBuffer>`,
      // which is what `crypto.subtle.verify` expects.
      proofValue.slice(),
      digest,
    );
  };
  if (await verifyCandidate(msg)) return publicKey;
  // This fallback runs on inbound, attacker-controlled JSON-LD.  Keep it on
  // normalizeOutgoingActivityJsonLd()'s restricted fallback loader so custom
  // `@context` values cannot trigger network fetches here.
  const normalized = await normalizeOutgoingActivityJsonLd(msg);
  if (normalized !== msg && await verifyCandidate(normalized)) {
    return publicKey;
  }
  if (fetchedKey.cached) {
    logger.debug(
      "Failed to verify the proof with the cached key {keyId}; retrying " +
        "with the freshly fetched key...",
      { keyId: proof.verificationMethodId.href, proof },
    );
    return await verifyProof(jsonLd, proof, {
      ...options,
      keyCache: {
        get: () => Promise.resolve(undefined),
        set: async (keyId, key) => await options.keyCache?.set(keyId, key),
      },
    });
  }
  logger.debug(
    "Failed to verify the proof with the fetched key {keyId}:\n{proof}",
    { keyId: proof.verificationMethodId.href, proof },
  );
  return null;
}

/**
 * Options for {@link verifyObject}.
 * @since 0.10.0
 */
export interface VerifyObjectOptions extends VerifyProofOptions {
}

/**
 * Verifies the given object.  It will verify all the proofs in the object,
 * and succeed only if all the proofs are valid and all attributions and
 * actors are authenticated by the proofs.
 * @template T The type of the object to verify.
 * @param cls The class of the object to verify.  It must be a subclass of
 *            the {@link Object}.
 * @param jsonLd The JSON-LD object to verify.  It's assumed that the object
 *               is a compacted JSON-LD representation of a `T` with `@context`.
 * @param options Additional options.  See also {@link VerifyObjectOptions}.
 * @returns The object if it's verified, or `null` if it's not.
 * @throws {TypeError} If the object is invalid or unsupported.
 * @since 0.10.0
 */
export async function verifyObject<T extends Object>(
  // deno-lint-ignore no-explicit-any
  cls: (new (...args: any[]) => T) & {
    fromJsonLd(jsonLd: unknown, options: VerifyObjectOptions): Promise<T>;
  },
  jsonLd: unknown,
  options: VerifyObjectOptions = {},
): Promise<T | null> {
  const logger = getLogger(["fedify", "sig", "proof"]);
  const object = await cls.fromJsonLd(jsonLd, options);
  const attributions = new Set(object.attributionIds.map((uri) => uri.href));
  if (object instanceof Activity) {
    for (const uri of object.actorIds) attributions.add(uri.href);
  }
  for await (const proof of object.getProofs(options)) {
    const key = await verifyProof(jsonLd, proof, options);
    if (key === null) return null;
    if (key.controllerId == null) {
      logger.debug(
        "Key {keyId} does not have a controller.",
        { keyId: key.id?.href },
      );
      continue;
    }
    attributions.delete(key.controllerId.href);
  }
  if (attributions.size > 0) {
    logger.debug(
      "Some attributions are not authenticated by the proofs: {attributions}.",
      { attributions: [...attributions] },
    );
    return null;
  }
  return object;
}
