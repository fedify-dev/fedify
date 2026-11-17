import {
  type Activity,
  type DataIntegrityProof,
  getTypeId,
} from "@fedify/vocab";
import {
  type CryptoKeyLike,
  type DocumentLoader,
  encodeMultibase,
} from "@fedify/vocab-runtime";
import { SpanStatusCode, trace, type TracerProvider } from "@opentelemetry/api";
import { encodeHex } from "byte-encodings/hex";
import metadata from "../../deno.json" with { type: "json" };
import { createProofForJsonLd } from "../sig/proof-creation.ts";
import { normalizeAttachmentArrays } from "./attachment-arrays.ts";

/**
 * Returns changed attachment JSON only; unchanged documents keep the existing
 * delivery signing path.  This uses ordinary vocabulary serialization, without
 * retaining or repairing independently signed child representations.
 */
export async function prepareActivityJsonLd(
  activity: Activity,
  contextLoader: DocumentLoader,
): Promise<Record<string, unknown> | undefined> {
  if (activity.proofIds.length > 0) return undefined;
  for await (const _ of activity.getProofs({ contextLoader })) return undefined;
  const source = await activity.clone().toJsonLd({
    format: "compact",
    contextLoader,
  });
  const prepared = await normalizeAttachmentArrays(source, contextLoader);
  return prepared !== source && typeof prepared === "object" &&
      prepared != null && !Array.isArray(prepared)
    ? prepared as Record<string, unknown>
    : undefined;
}

interface DeliverySigningKey {
  readonly privateKey: CryptoKeyLike;
  readonly keyId: URL;
}

/** Signs a changed, proof-free delivery map without serializing it again. */
export async function signActivityJsonLd(
  activity: Activity,
  unsigned: Record<string, unknown>,
  keys: readonly DeliverySigningKey[],
  options: { tracerProvider: TracerProvider },
): Promise<{ activity: Activity; jsonLd: unknown }> {
  const proofs: DataIntegrityProof[] = [];
  const serializedProofs: Record<string, unknown>[] = [];
  const tracer = (options.tracerProvider ?? trace.getTracerProvider())
    .getTracer(metadata.name, metadata.version);
  for (const { privateKey, keyId } of keys) {
    const proof = await tracer.startActiveSpan(
      "object_integrity_proofs.sign",
      { attributes: { "activitypub.object.type": getTypeId(activity).href } },
      async (span) => {
        try {
          if (activity.id != null) {
            span.setAttribute("activitypub.object.id", activity.id.href);
          }
          const proof = await createProofForJsonLd(unsigned, privateKey, keyId);
          if (span.isRecording()) {
            span.setAttribute(
              "object_integrity_proofs.cryptosuite",
              "eddsa-jcs-2022",
            );
            span.setAttribute("object_integrity_proofs.key_id", keyId.href);
            span.setAttribute(
              "object_integrity_proofs.signature",
              encodeHex(proof.proofValue!),
            );
          }
          return proof;
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
    proofs.push(proof);
    // This is the configuration createProofForJsonLd() hashes.  The generated
    // activity context is unchanged; no compaction runs after signing.
    serializedProofs.push({
      "@context": unsigned["@context"],
      type: "DataIntegrityProof",
      cryptosuite: proof.cryptosuite,
      verificationMethod: keyId.href,
      proofPurpose: "assertionMethod",
      created: proof.created!.toString(),
      proofValue: new TextDecoder().decode(
        encodeMultibase("base58btc", proof.proofValue!),
      ),
    });
  }
  if (proofs.length === 0) return { activity, jsonLd: unsigned };
  return {
    activity: activity.clone({ proofs }),
    jsonLd: {
      ...unsigned,
      proof: serializedProofs.length === 1
        ? serializedProofs[0]
        : serializedProofs,
    },
  };
}
