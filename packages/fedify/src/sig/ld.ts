import { Activity, CryptographicKey, getTypeId, Object } from "@fedify/vocab";
import { type DocumentLoader, getDocumentLoader } from "@fedify/vocab-runtime";
import { getLogger } from "@logtape/logtape";
import { SpanStatusCode, trace, type TracerProvider } from "@opentelemetry/api";
import { decodeBase64, encodeBase64 } from "byte-encodings/base64";
import { encodeHex } from "byte-encodings/hex";
import jsonld from "jsonld";
import metadata from "../../deno.json" with { type: "json" };
import { fetchKey, type KeyCache, validateCryptoKey } from "./key.ts";

const logger = getLogger(["fedify", "sig", "ld"]);

/**
 * A signature of a JSON-LD document.
 * @since 1.0.0
 */
export interface Signature {
  "@context"?: "https://w3id.org/identity/v1";
  type: "RsaSignature2017";
  id?: string;
  creator: string;
  created: string;
  signatureValue: string;
}

/**
 * Attaches a LD signature to the given JSON-LD document.
 * @param jsonLd The JSON-LD document to attach the signature to.  It is not
 *               modified.
 * @param signature The signature to attach.
 * @returns The JSON-LD document with the attached signature.
 * @throws {TypeError} If the input document is not a valid JSON-LD document.
 * @since 1.0.0
 */
export function attachSignature(
  jsonLd: unknown,
  signature: Signature,
): { signature: Signature } {
  if (typeof jsonLd !== "object" || jsonLd == null) {
    throw new TypeError(
      "Failed to attach signature; invalid JSON-LD document.",
    );
  }
  return { ...jsonLd, signature };
}

/**
 * Options for creating Linked Data Signatures.
 * @since 1.0.0
 */
export interface CreateSignatureOptions {
  /**
   * The context loader for loading remote JSON-LD contexts.
   */
  contextLoader?: DocumentLoader;

  /**
   * The time when the signature was created.  If not specified, the current
   * time will be used.
   */
  created?: Temporal.Instant;
}

/**
 * Creates a LD signature for the given JSON-LD document.
 * @param jsonLd The JSON-LD document to sign.
 * @param privateKey The private key to sign the document.
 * @param keyId The ID of the public key that corresponds to the private key.
 * @param options Additional options for creating the signature.
 *                See also {@link CreateSignatureOptions}.
 * @return The created signature.
 * @throws {TypeError} If the private key is invalid or unsupported.
 * @since 1.0.0
 */
export async function createSignature(
  jsonLd: unknown,
  privateKey: CryptoKey,
  keyId: URL,
  { contextLoader, created }: CreateSignatureOptions = {},
): Promise<Signature> {
  validateCryptoKey(privateKey, "private");
  if (privateKey.algorithm.name !== "RSASSA-PKCS1-v1_5") {
    throw new TypeError("Unsupported algorithm: " + privateKey.algorithm.name);
  }
  const options = {
    "@context": "https://w3id.org/identity/v1" as const,
    creator: keyId.href,
    created: created?.toString() ?? new Date().toISOString(),
  };
  const optionsHash = await hashJsonLd(options, contextLoader);
  const docHash = await hashJsonLd(jsonLd, contextLoader);
  const message = optionsHash + docHash;
  const encoder = new TextEncoder();
  const messageBytes = encoder.encode(message);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    messageBytes,
  );
  return {
    ...options,
    type: "RsaSignature2017",
    signatureValue: encodeBase64(signature),
  };
}

/**
 * Options for signing JSON-LD documents.
 * @since 1.0.0
 */
export interface SignJsonLdOptions extends CreateSignatureOptions {
  /**
   * The OpenTelemetry tracer provider for tracing the signing process.
   * If omitted, the global tracer provider is used.
   * @since 1.3.0
   */
  tracerProvider?: TracerProvider;
}

/**
 * Signs the given JSON-LD document with the private key and returns the signed
 * JSON-LD document.
 * @param jsonLd The JSON-LD document to sign.
 * @param privateKey The private key to sign the document.
 * @param keyId The key ID to use in the signature.  It will be used by the
 *              verifier to fetch the corresponding public key.
 * @param options Additional options for signing the document.
 *                See also {@link SignJsonLdOptions}.
 * @returns The signed JSON-LD document.
 * @throws {TypeError} If the private key is invalid or unsupported.
 * @since 1.0.0
 */
export async function signJsonLd(
  jsonLd: unknown,
  privateKey: CryptoKey,
  keyId: URL,
  options: SignJsonLdOptions,
): Promise<{ signature: Signature }> {
  const tracerProvider = options.tracerProvider ?? trace.getTracerProvider();
  const tracer = tracerProvider.getTracer(metadata.name, metadata.version);
  return await tracer.startActiveSpan(
    "ld_signatures.sign",
    {
      attributes: { "ld_signatures.key_id": keyId.href },
    },
    async (span) => {
      try {
        const signature = await createSignature(
          jsonLd,
          privateKey,
          keyId,
          options,
        );
        if (span.isRecording()) {
          span.setAttribute("ld_signatures.type", signature.type);
          span.setAttribute(
            "ld_signatures.signature",
            encodeHex(decodeBase64(signature.signatureValue)),
          );
        }
        return attachSignature(jsonLd, signature);
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

interface SignedJsonLd {
  signature: Signature;
}

/**
 * Checks if the given JSON-LD document has a Linked Data Signature.
 * @param jsonLd The JSON-LD document to check.
 * @returns `true` if the document has a signature; `false` otherwise.
 * @since 1.0.0
 */
export function hasSignature(jsonLd: unknown): jsonLd is SignedJsonLd {
  if (typeof jsonLd !== "object" || jsonLd == null) return false;
  if ("signature" in jsonLd) {
    const signature = jsonLd.signature;
    if (typeof signature !== "object" || signature == null) return false;
    return "type" in signature && signature.type === "RsaSignature2017" &&
      "creator" in signature && typeof signature.creator === "string" &&
      "created" in signature && typeof signature.created === "string" &&
      "signatureValue" in signature &&
      typeof signature.signatureValue === "string";
  }
  return false;
}

/**
 * Detaches Linked Data Signatures from the given JSON-LD document.
 * @param jsonLd The JSON-LD document to modify.
 * @returns The modified JSON-LD document.  If the input document does not
 *          contain a signature, the original document is returned.
 * @since 1.0.0
 */
export function detachSignature(jsonLd: unknown): unknown {
  if (typeof jsonLd !== "object" || jsonLd == null) return jsonLd;
  const doc: { signature?: unknown } = { ...jsonLd };
  delete doc.signature;
  return doc;
}

/**
 * Options for verifying Linked Data Signatures.
 * @since 1.0.0
 */
export interface VerifySignatureOptions {
  /**
   * The document loader to use for fetching the public key.
   */
  documentLoader?: DocumentLoader;

  /**
   * The context loader to use for JSON-LD context retrieval.
   */
  contextLoader?: DocumentLoader;

  /**
   * The key cache to use for caching public keys.
   */
  keyCache?: KeyCache;

  /**
   * The OpenTelemetry tracer provider for tracing the verification process.
   * If omitted, the global tracer provider is used.
   * @since 1.3.0
   */
  tracerProvider?: TracerProvider;
}

/**
 * Verifies Linked Data Signatures of the given JSON-LD document.
 * @param jsonLd The JSON-LD document to verify.
 * @param options Options for verifying the signature.
 * @returns The public key that signed the document or `null` if the signature
 *          is invalid or the key is not found.
 * @since 1.0.0
 */
export async function verifySignature(
  jsonLd: unknown,
  options: VerifySignatureOptions = {},
): Promise<CryptographicKey | null> {
  if (!hasSignature(jsonLd)) return null;
  const sig = jsonLd.signature;
  let signature: Uint8Array;
  try {
    signature = decodeBase64(sig.signatureValue);
  } catch (error) {
    logger.debug(
      "Failed to verify; invalid base64 signatureValue: {signatureValue}",
      { ...sig, error },
    );
    return null;
  }
  const { key, cached } = await fetchKey(
    new URL(sig.creator),
    CryptographicKey,
    options,
  );
  if (key == null) return null;
  const sigOpts: {
    "@context": string;
    type?: string;
    id?: string;
    signatureValue?: string;
  } = {
    ...sig,
    "@context": "https://w3id.org/identity/v1",
  };
  delete sigOpts.type;
  delete sigOpts.id;
  delete sigOpts.signatureValue;
  let sigOptsHash: string;
  try {
    sigOptsHash = await hashJsonLd(sigOpts, options.contextLoader);
  } catch (error) {
    logger.warn(
      "Failed to verify; failed to hash the signature options: {signatureOptions}\n{error}",
      { signatureOptions: sigOpts, error },
    );
    return null;
  }
  const document: { signature?: unknown } = { ...jsonLd };
  delete document.signature;
  let docHash: string;
  try {
    docHash = await hashJsonLd(document, options.contextLoader);
  } catch (error) {
    logger.warn(
      "Failed to verify; failed to hash the document: {document}\n{error}",
      { document, error },
    );
    return null;
  }
  const encoder = new TextEncoder();
  const message = sigOptsHash + docHash;
  const messageBytes = encoder.encode(message);
  const verified = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key.publicKey,
    signature.slice(),
    messageBytes,
  );
  if (verified) return key;
  if (cached) {
    logger.debug(
      "Failed to verify with the cached key {keyId}; " +
        "signature {signatureValue} is invalid.  " +
        "Retrying with the freshly fetched key...",
      { keyId: sig.creator, ...sig },
    );
    const { key } = await fetchKey(
      new URL(sig.creator),
      CryptographicKey,
      {
        ...options,
        keyCache: {
          get: () => Promise.resolve(undefined),
          set: async (keyId, key) => await options.keyCache?.set(keyId, key),
        },
      },
    );
    if (key == null) return null;
    const verified = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key.publicKey,
      signature.slice(),
      messageBytes,
    );
    return verified ? key : null;
  }
  logger.debug(
    "Failed to verify with the fetched key {keyId}; " +
      "signature {signatureValue} is invalid.  " +
      "Check if the key is correct or if the signed message is correct.  " +
      "The message to sign is:\n{message}",
    { keyId: sig.creator, ...sig, message },
  );
  return null;
}

/**
 * Options for verifying JSON-LD documents.
 */
export interface VerifyJsonLdOptions extends VerifySignatureOptions {
}

/**
 * Verify the authenticity of the given JSON-LD document using Linked Data
 * Signatures.  If the document is signed, this function verifies the signature
 * and checks if the document is attributed to the owner of the public key.
 * If the document is not signed, this function returns `false`.
 * @param jsonLd The JSON-LD document to verify.
 * @param options Options for verifying the document.
 * @returns `true` if the document is authentic; `false` otherwise.
 */
export async function verifyJsonLd(
  jsonLd: unknown,
  options: VerifyJsonLdOptions = {},
): Promise<boolean> {
  const tracerProvider = options.tracerProvider ?? trace.getTracerProvider();
  const tracer = tracerProvider.getTracer(metadata.name, metadata.version);
  return await tracer.startActiveSpan(
    "ld_signatures.verify",
    async (span) => {
      try {
        const object = await Object.fromJsonLd(jsonLd, options);
        if (object.id != null) {
          span.setAttribute("activitypub.object.id", object.id.href);
        }
        span.setAttribute("activitypub.object.type", getTypeId(object).href);
        if (
          typeof jsonLd === "object" && jsonLd != null &&
          "signature" in jsonLd && typeof jsonLd.signature === "object" &&
          jsonLd.signature != null
        ) {
          if (
            "creator" in jsonLd.signature &&
            typeof jsonLd.signature.creator === "string"
          ) {
            span.setAttribute(
              "ld_signatures.key_id",
              jsonLd.signature.creator,
            );
          }
          if (
            "signatureValue" in jsonLd.signature &&
            typeof jsonLd.signature.signatureValue === "string"
          ) {
            span.setAttribute(
              "ld_signatures.signature",
              jsonLd.signature.signatureValue,
            );
          }
          if (
            "type" in jsonLd.signature &&
            typeof jsonLd.signature.type === "string"
          ) {
            span.setAttribute("ld_signatures.type", jsonLd.signature.type);
          }
        }
        const attributions = new Set(
          object.attributionIds.map((uri) => uri.href),
        );
        if (object instanceof Activity) {
          for (const uri of object.actorIds) attributions.add(uri.href);
        }
        const key = await verifySignature(jsonLd, options);
        if (key == null) return false;
        if (key.ownerId == null) {
          logger.debug("Key {keyId} has no owner.", { keyId: key.id?.href });
          return false;
        }
        attributions.delete(key.ownerId.href);
        if (attributions.size > 0) {
          logger.debug(
            "Some attributions are not authenticated by the Linked Data " +
              "Signatures: {attributions}.",
            { attributions: [...attributions] },
          );
          return false;
        }
        return true;
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

async function hashJsonLd(
  jsonLd: unknown,
  contextLoader: DocumentLoader | undefined,
): Promise<string> {
  const canon = await jsonld.canonize(jsonLd, {
    format: "application/n-quads",
    documentLoader: contextLoader ?? getDocumentLoader(),
  });
  const encoder = new TextEncoder();
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(canon));
  return encodeHex(hash);
}

// cSpell: ignore URGNA2012
