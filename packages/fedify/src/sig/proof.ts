import { getLogger } from "@logtape/logtape";
import { SpanStatusCode, trace, type TracerProvider } from "@opentelemetry/api";
import { encodeHex } from "byte-encodings/hex";
// @ts-ignore: json-canon is not typed
import serialize from "json-canon";
import metadata from "../../deno.json" with { type: "json" };
import type { DocumentLoader } from "../runtime/docloader.ts";
import { getTypeId } from "../vocab/type.ts";
import {
  Activity,
  DataIntegrityProof,
  Multikey,
  type Object,
} from "../vocab/vocab.ts";
import {
  fetchKey,
  type FetchKeyResult,
  type KeyCache,
  validateCryptoKey,
} from "./key.ts";

const logger = getLogger(["fedify", "sig", "proof"]);

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
  const compactMsg = await objectWithoutProofs.toJsonLd({
    format: "compact",
    contextLoader,
    context,
  });
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
  const proofCanon = serialize(proofConfig);
  const encoder = new TextEncoder();
  const proofBytes = encoder.encode(proofCanon);
  const proofDigest = await crypto.subtle.digest("SHA-256", proofBytes);
  const msg = { ...jsonLd };
  if ("proof" in msg) delete msg.proof;
  const msgCanon = serialize(msg);
  const msgBytes = encoder.encode(msgCanon);
  const msgDigest = await crypto.subtle.digest("SHA-256", msgBytes);
  const digest = new Uint8Array(proofDigest.byteLength + msgDigest.byteLength);
  digest.set(new Uint8Array(proofDigest), 0);
  digest.set(new Uint8Array(msgDigest), proofDigest.byteLength);
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
          get: () => Promise.resolve(null),
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
  const verified = await crypto.subtle.verify(
    "Ed25519",
    publicKey.publicKey,
    proof.proofValue,
    digest,
  );
  if (!verified) {
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
  return publicKey;
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
