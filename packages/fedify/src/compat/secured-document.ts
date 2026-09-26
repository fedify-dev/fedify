/**
 * Options shared by the outgoing JSON-LD compatibility normalizers.
 *
 * @internal
 */
export interface OutgoingNormalizationOptions {
  /**
   * Whether to leave a nested self-contained secured document untouched.
   *
   * A map that carries its own `@context` and one direct, well-formed
   * `DataIntegrityProof` is an independently verifiable document under
   * Fedify's map-local compound-proof profile.  Rewriting anything inside it
   * changes the bytes its proof covers, so the producer path leaves it alone.
   *
   * Off by default, so that `verifyProof()`'s inbound compatibility fallback
   * keeps reproducing exactly the digests it reproduces today.
   */
  readonly preserveNestedSecuredDocuments?: boolean;
}

function isJsonMap(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function hasDataIntegrityProofType(value: unknown): boolean {
  const types = Array.isArray(value) ? value : [value];
  return types.some((type) =>
    type === "DataIntegrityProof" ||
    type === "https://w3id.org/security#DataIntegrityProof"
  );
}

/**
 * Checks whether a JSON value is a complete, self-contained secured document:
 * a map with its own `@context` and exactly one direct, map-valued `proof`
 * that carries every member `eddsa-jcs-2022` proof generation produces.
 *
 * This is deliberately stricter than {@link hasProofLike}, which exists to
 * decide whether a document is worth verifying.  Here a false positive would
 * silently suppress a wire-compatibility fix on an ordinary document, so a
 * partial or malformed proof does not qualify.
 *
 * @internal
 */
export function isSelfContainedSecuredDocument(value: unknown): boolean {
  if (!isJsonMap(value)) return false;
  if (!Object.hasOwn(value, "@context") || value["@context"] == null) {
    return false;
  }
  if (!Object.hasOwn(value, "proof")) return false;
  const proof = value.proof;
  if (!isJsonMap(proof)) return false;
  return hasDataIntegrityProofType(proof.type) &&
    isNonEmptyString(proof.cryptosuite) &&
    isNonEmptyString(proof.created) &&
    isNonEmptyString(proof.verificationMethod) &&
    isNonEmptyString(proof.proofPurpose) &&
    isNonEmptyString(proof.proofValue);
}
