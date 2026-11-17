import { DataIntegrityProof } from "@fedify/vocab";
import type { CryptoKeyLike } from "@fedify/vocab-runtime";
import { asCryptoKey } from "@fedify/vocab-runtime/internal";
import serialize from "json-canon";
import { validateCryptoKey } from "./key.ts";

/** Signs the exact serialized message supplied by an internal producer. */
export async function createProofForJsonLd(
  jsonLd: unknown,
  privateKey: CryptoKeyLike,
  keyId: URL,
  created?: Temporal.Instant,
): Promise<DataIntegrityProof> {
  validateCryptoKey(privateKey, "private");
  if (privateKey.algorithm.name !== "Ed25519") {
    throw new TypeError("Unsupported algorithm: " + privateKey.algorithm.name);
  }
  const encoder = new TextEncoder();
  const msgDigest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(serialize(jsonLd)),
  );
  created ??= Temporal.Now.instant();
  const proofConfig = {
    "@context": (jsonLd as Record<string, unknown>)["@context"],
    type: "DataIntegrityProof",
    cryptosuite: "eddsa-jcs-2022",
    verificationMethod: keyId.href,
    proofPurpose: "assertionMethod",
    created: created.toString(),
  };
  const proofDigest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(serialize(proofConfig)),
  );
  const digest = new Uint8Array(proofDigest.byteLength + msgDigest.byteLength);
  digest.set(new Uint8Array(proofDigest), 0);
  digest.set(new Uint8Array(msgDigest), proofDigest.byteLength);
  const sig = await crypto.subtle.sign(
    "Ed25519",
    asCryptoKey(privateKey),
    digest,
  );
  return new DataIntegrityProof({
    cryptosuite: "eddsa-jcs-2022",
    verificationMethod: keyId,
    proofPurpose: "assertionMethod",
    created,
    proofValue: new Uint8Array(sig),
  });
}
