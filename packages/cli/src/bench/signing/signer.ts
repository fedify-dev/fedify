/**
 * Signing one inbox delivery, reusing the `@fedify/fedify` signers so the
 * client pays realistic crypto cost.
 *
 * Document signatures are applied first (FEP-8b32 object proof, then LD
 * Signature on the serialized document), then the HTTP request signature is
 * applied to the final body, matching how a real sender composes a request.
 * @since 2.3.0
 * @module
 */

import { signJsonLd, signObject, signRequest } from "@fedify/fedify";
import type { Activity } from "@fedify/vocab";
import type { DocumentLoader } from "@fedify/vocab-runtime";
import type { SyntheticActor } from "../server/synthetic.ts";

/** Options for {@link signInboxDelivery}. */
export interface SignDeliveryOptions {
  /** The signing actor, with its keys and key ids. */
  readonly actor: SyntheticActor;
  /** The inbox URL to deliver to. */
  readonly inbox: URL;
  /** The activity to sign and deliver (its `id` must already be set). */
  readonly activity: Activity;
  /** The context loader used to serialize and canonicalize the document. */
  readonly contextLoader: DocumentLoader;
}

/**
 * Signs an inbox delivery and returns a ready-to-send `Request`.
 * @param options The delivery options.
 * @returns The signed POST request.
 * @throws {TypeError} If the actor lacks the RSA key required for HTTP signing.
 */
export async function signInboxDelivery(
  options: SignDeliveryOptions,
): Promise<Request> {
  const { actor, inbox, contextLoader } = options;
  if (actor.keys.rsa == null || actor.rsaKeyId == null) {
    throw new TypeError(
      "Actor is missing the RSA key required for HTTP request signing.",
    );
  }

  let activity = options.activity;
  if (
    actor.standards.includes("fep8b32") && actor.keys.ed25519 != null &&
    actor.ed25519KeyId != null
  ) {
    activity = await signObject(
      activity,
      actor.keys.ed25519.privateKey,
      actor.ed25519KeyId,
      { contextLoader },
    );
  }

  let document: unknown = await activity.toJsonLd({ contextLoader });
  if (actor.standards.includes("ld-signatures")) {
    document = await signJsonLd(
      document,
      actor.keys.rsa.privateKey,
      actor.rsaKeyId,
      { contextLoader },
    );
  }

  const body = new TextEncoder().encode(JSON.stringify(document));
  const request = new Request(inbox, {
    method: "POST",
    headers: { "content-type": "application/activity+json" },
    body,
    // Benchmark deliveries must not follow redirects to an ungated host; the
    // sender re-applies this as a safety net if signing drops it.
    redirect: "manual",
  });
  return await signRequest(
    request,
    actor.keys.rsa.privateKey,
    actor.rsaKeyId,
    { spec: actor.httpStandard, body: body.buffer as ArrayBuffer },
  );
}
