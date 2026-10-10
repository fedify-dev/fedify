import type { Context } from "./context.ts";
import {
  FeaturedCollection,
  type FeatureRequest,
  Object as ActivityObject,
} from "@fedify/vocab";
import {
  type DocumentLoader,
  FetchError,
  UrlError,
} from "@fedify/vocab-runtime";
import type { InboxVerificationAttempt } from "../sig/verification.ts";
import {
  getPortableDid,
  isPortableId,
  isSameObjectId,
} from "../sig/portable-key-id.ts";

// FIXME: Replace this FeatureRequest-specific authentication bridge with the
// general inbox principal handling: https://github.com/fedify-dev/fedify/issues/1290
export async function resolveFeatureRequestActor<T>(
  context: Context<T>,
  request: FeatureRequest,
): Promise<URL | null> {
  if (request.instrumentIds.length !== 1) return null;
  const id = request.instrumentIds[0];
  // Never infer ownership from an instrument embedded by the sender.
  // Collection authorization uses the referenced resource, not account
  // discovery through WebFinger. Portable IDs retain their verified lookup.
  // Preserve loader failures that parsing or portable lookup may hide.
  let retryableFailure: { error: unknown } | undefined;
  const captureFailure =
    (loader: DocumentLoader): DocumentLoader => async (...args) => {
      try {
        return await loader(...args);
      } catch (error) {
        const status = error instanceof FetchError
          ? error.response?.status
          : null;
        const permanent =
          error instanceof UrlError && error.reason === "disallowed" ||
          status != null && status >= 400 && status < 500 &&
            status !== 408 && status !== 429;
        if (!permanent) retryableFailure ??= { error };
        throw error;
      }
    };
  let collection: ActivityObject | null;
  try {
    if (isPortableId(id)) {
      collection = await context.lookupObject(id, {
        documentLoader: captureFailure(context.documentLoader),
        contextLoader: captureFailure(context.contextLoader),
      });
    } else {
      const document = await captureFailure(context.documentLoader)(id.href);
      const documentUrl = new URL(document.documentUrl);
      // A web resource cannot vouch for an ID on another origin, even when
      // reached through a redirect from the requested collection URL.
      if (documentUrl.origin !== id.origin) return null;
      collection = await ActivityObject.fromJsonLd(document.document, {
        ...context,
        documentLoader: captureFailure(context.documentLoader),
        contextLoader: captureFailure(context.contextLoader),
        baseUrl: documentUrl,
      });
    }
  } catch (error) {
    if (retryableFailure != null) throw retryableFailure.error;
    const status = error instanceof FetchError ? error.response?.status : null;
    if (
      error instanceof TypeError ||
      error instanceof UrlError && error.reason === "disallowed" ||
      status != null && status >= 400 && status < 500 &&
        status !== 408 && status !== 429
    ) return null;
    throw error;
  }
  if (
    !(collection instanceof FeaturedCollection) || collection.id == null ||
    !isSameObjectId(collection.id, id) || collection.attributionIds.length !== 1
  ) {
    if (retryableFailure != null) throw retryableFailure.error;
    return null;
  }
  return collection.attributionIds[0];
}

// TODO: Replace this signature observation scan with shared inbox principals.
// https://github.com/fedify-dev/fedify/issues/1290
export function hasFeatureRequestSignature(
  attempts: readonly InboxVerificationAttempt[],
  actor: URL,
  mechanism: "linkedData" | "objectIntegrity",
): boolean {
  const portable = isPortableId(actor) || /^did:/i.test(actor.href);
  return attempts.some((attempt) =>
    attempt.subject.pointer === "" && attempt.mechanism === mechanism &&
    attempt.status === "verified" && attempt.signatures.some((signature) => {
      const key = signature.key;
      const owner = key.type === "cryptographicKey"
        ? key.ownerId
        : key.controllerId;
      if (owner == null) return false;
      if (!portable) return owner.href === actor.href;
      // A gateway's web key cannot authenticate a portable actor.  Mirror
      // the DID binding used by Object Integrity Proof verification.
      const did = getPortableDid(actor);
      return mechanism === "objectIntegrity" && did != null && key.id != null &&
        /^(?:did:|ap(?:\+ef61)?:\/\/)/i.test(key.id.href) &&
        getPortableDid(owner) === did && getPortableDid(key.id) === did;
    })
  );
}
