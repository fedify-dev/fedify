/**
 * Building the ActivityPub actor documents the synthetic key server serves.
 *
 * The target dereferences a signature's `keyId` during verification; serving a
 * normal actor document with an embedded `publicKey` (RSA, for HTTP and LD
 * Signatures) and `assertionMethod` (Ed25519 Multikey, for FEP-8b32) is exactly
 * what a real actor exposes, so verification resolves the key the same way.
 * @since 2.3.0
 * @module
 */

import { Application, CryptographicKey, Multikey } from "@fedify/vocab";
import type { DocumentLoader } from "@fedify/vocab-runtime";
import type { SyntheticActor } from "../server/synthetic.ts";

/**
 * Renders a synthetic actor as a compact JSON-LD actor document.
 * @param actor The synthetic actor, with its URLs and keys.
 * @param options The context loader used to compact the document.
 * @returns The JSON-LD actor document.
 */
export async function actorDocument(
  actor: SyntheticActor,
  options: { contextLoader: DocumentLoader },
): Promise<unknown> {
  const application = new Application({
    id: actor.id,
    preferredUsername: `bench-${actor.index}`,
    name: actor.name ?? `Benchmark actor ${actor.index}`,
    inbox: new URL(`${actor.id.href}/inbox`),
    publicKey: actor.keys.rsa == null ? undefined : new CryptographicKey({
      id: actor.rsaKeyId,
      owner: actor.id,
      publicKey: actor.keys.rsa.publicKey,
    }),
    assertionMethods: actor.keys.ed25519 == null ? [] : [
      new Multikey({
        id: actor.ed25519KeyId,
        controller: actor.id,
        publicKey: actor.keys.ed25519.publicKey,
      }),
    ],
  });
  return await application.toJsonLd({ contextLoader: options.contextLoader });
}
