import type { Context } from "./context.ts";
import { hasMalformedKnownTemporalLiteral } from "./temporal.ts";
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
import { isInvalidUrlTypeError } from "../sig/ld.ts";
import type { InboxVerificationAttempt } from "../sig/verification.ts";
import {
  getPortableDid,
  isPortableId,
  isSameObjectId,
} from "../sig/portable-key-id.ts";

// A loader may report bad remote data as a parser/validation error. Raw
// TypeErrors also represent fetch failures, so do not classify them by type
// alone. Keep this consistent with the inbox's known validation errors.
// TODO: Fold this classification into shared principal resolution:
// https://github.com/fedify-dev/fedify/issues/1290
function isPermanentCollectionError(error: unknown): boolean {
  if (error instanceof SyntaxError || isInvalidUrlTypeError(error)) return true;
  if (
    error instanceof TypeError &&
    /^(Invalid JSON-LD:|Invalid type:|Unexpected type:|Invalid @id:|Invalid FEP-ef61 gateway:)/
      .test(error.message)
  ) return true;
  if (error instanceof Error) {
    const details = (error as Error & { details?: { code?: unknown } }).details;
    if (
      error.name === "jsonld.SyntaxError" &&
      details?.code !== "loading remote context failed"
    ) return true;
    if (
      error.name === "jsonld.InvalidUrl" &&
      details?.code === "invalid remote context"
    ) return true;
    if (
      error.name === "jsonld.ContextUrlError" &&
      (details?.code === "recursive context inclusion" ||
        details?.code === "context overflow")
    ) return true;
  }
  // This private loader error is identified by its stable name rather than
  // adding a vocab-runtime export in a patch release.
  if (error instanceof FetchError && error.name === "BodyTooLargeError") {
    return true;
  }
  const status = error instanceof FetchError ? error.response?.status : null;
  return error instanceof UrlError && error.reason === "disallowed" ||
    status != null && (
        // Successful responses can still be unusable documents (e.g., HTML
        // without an ActivityPub alternate), rather than transport failures.
        status >= 200 && status < 300 ||
        status >= 400 && status < 500 && status !== 408 && status !== 429
      );
}

// FIXME: Replace this FeatureRequest-specific authentication bridge with the
// general inbox principal handling: https://github.com/fedify-dev/fedify/issues/1290
export async function resolveFeatureRequestActor<T>(
  context: Context<T>,
  request: FeatureRequest,
): Promise<URL | null> {
  if (request.instrumentIds.length !== 1) return null;
  const id = request.instrumentIds[0];
  if (id.username !== "" || id.password !== "") return null;
  // ID accessors omit anonymous embedded values. Count the parsed values,
  // without dereferencing them or reinterpreting the original context.
  const expanded = await request.toJsonLd({ format: "expand" }) as Record<
    string,
    unknown
  >[];
  const instruments = expanded[0]?.[
    "https://www.w3.org/ns/activitystreams#instrument"
  ];
  if (!Array.isArray(instruments) || instruments.length !== 1) return null;
  // Never infer ownership from an instrument embedded by the sender.
  // Collection authorization uses the referenced resource, not account
  // discovery through WebFinger. Portable IDs retain their verified lookup.
  // Preserve loader failures that parsing or portable lookup may hide.
  let retryableFailure: { error: unknown } | undefined;
  let permanentFailure = false;
  const captureFailure =
    (loader: DocumentLoader): DocumentLoader => async (...args) => {
      try {
        return await loader(...args);
      } catch (error) {
        if (isPermanentCollectionError(error)) permanentFailure = true;
        else retryableFailure ??= { error };
        throw error;
      }
    };
  let collection: ActivityObject | null;
  let collectionDocument: unknown;
  try {
    if (isPortableId(id)) {
      collection = await context.lookupObject(id, {
        documentLoader: captureFailure(context.documentLoader),
        contextLoader: captureFailure(context.contextLoader),
      });
    } else {
      const document = await captureFailure(context.documentLoader)(id.href);
      collectionDocument = document.document;
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
    // Only a positively identified malformed temporal literal is permanent.
    // Loader RangeErrors were captured above and must remain retryable.
    if (
      error instanceof RangeError && collectionDocument != null &&
      await hasMalformedKnownTemporalLiteral(
        collectionDocument,
        context.contextLoader,
      )
    ) return null;
    // JSON-LD may wrap loader errors. Preserve the original classification
    // rather than treating a malformed remote context as a transient outage.
    if (
      permanentFailure || isPermanentCollectionError(error) ||
      error instanceof TypeError
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
