/**
 * Key-pair generation for synthetic benchmark actors.
 *
 * An author picks signature standards, not key algorithms; the key set is
 * derived from the chosen standards, mirroring how a real Fedify actor exposes
 * keys.  HTTP request signatures and LD Signatures share one RSA key pair;
 * FEP-8b32 object integrity proofs use an Ed25519 key pair.
 * @since 2.3.0
 * @module
 */

import { generateCryptoKeyPair } from "@fedify/fedify";
import type { SignatureStandard } from "../scenario/types.ts";

/** The key pairs an actor holds, derived from its signature standards. */
export interface ActorKeys {
  /** The RSA pair for HTTP request signatures and LD Signatures. */
  readonly rsa?: CryptoKeyPair;
  /** The Ed25519 pair for FEP-8b32 object integrity proofs. */
  readonly ed25519?: CryptoKeyPair;
}

/** Whether a set of standards needs an RSA key pair. */
export function needsRsa(standards: readonly SignatureStandard[]): boolean {
  return standards.some((s) =>
    s === "draft-cavage-http-signatures-12" || s === "rfc9421" ||
    s === "ld-signatures"
  );
}

/** Whether a set of standards needs an Ed25519 key pair. */
export function needsEd25519(standards: readonly SignatureStandard[]): boolean {
  return standards.includes("fep8b32");
}

/**
 * Generates the key pairs an actor needs for its signature standards.
 * @param standards The actor's signature standards.
 * @returns The derived key pairs.
 */
export async function generateActorKeys(
  standards: readonly SignatureStandard[],
): Promise<ActorKeys> {
  const [rsa, ed25519] = await Promise.all([
    needsRsa(standards)
      ? generateCryptoKeyPair("RSASSA-PKCS1-v1_5")
      : Promise.resolve(undefined),
    needsEd25519(standards)
      ? generateCryptoKeyPair("Ed25519")
      : Promise.resolve(undefined),
  ]);
  return { rsa, ed25519 };
}
