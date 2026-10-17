import {
  type DocumentLoader,
  isTransientFetchError,
  parseIri,
  type PortableObjectVerifier,
} from "@fedify/vocab-runtime";
import jsonld from "@fedify/vocab-runtime/jsonld";
import type { DereferenceFailure } from "@fedify/vocab-runtime/internal/portable-dereference";
import {
  lookupObject,
  lookupObserver,
  type Object as ASObject,
} from "@fedify/vocab";
import {
  getPropertyValues,
  getRootNode,
  hasCredentials,
  hasType,
  resolveNodeId,
  sameId,
} from "./evidence.ts";
import {
  classifyFailure,
  collectCauses,
  trackLoaders,
  type UnverifiableFailure,
} from "./loaders.ts";
import type { InteractionRequestVerificationFailure } from "./types.ts";

const ATTRIBUTED_TO = "https://www.w3.org/ns/activitystreams#attributedTo";

/**
 * Why a document was not accepted as the authoritative representation of an
 * interacting object.
 */
export type AuthoritativeObjectRejection =
  | "credentials"
  | "id"
  | "type"
  | "attribution";

/**
 * The result of {@link resolveAuthoritativeObject}.
 */
export type AuthoritativeObjectResolution<T extends ASObject> =
  | {
    readonly ok: true;
    readonly object: T;
    /** The only owner the object's own document names. */
    readonly owner: URL;
  }
  | {
    readonly ok: false;
    readonly failure:
      | UnverifiableFailure
      | Extract<
        InteractionRequestVerificationFailure,
        { readonly type: "credentialsInUrl" | "invalidInteractingObject" }
      >;
  };

/**
 * Options for {@link resolveAuthoritativeObject}.
 */
export interface ResolveAuthoritativeObjectOptions<T extends ASObject> {
  readonly documentLoader: DocumentLoader | undefined;
  readonly contextLoader: DocumentLoader | undefined;
  readonly verifyPortableObject: PortableObjectVerifier | undefined;
  /** The type the object must have. */
  readonly typeId: URL;
  /** Tells whether a parsed object is of the right class. */
  readonly isObject: (object: ASObject) => object is T;
}

/**
 * Fetches an interacting object, such as a featured collection, from its ID
 * and determines its owner from that document only.
 *
 * What the request embeds is never trusted.  An ordinary web document must
 * be served from the origin of its ID, and an [FEP-ef61] portable object
 * must satisfy the portable object policy, as `lookupObject()` checks.  The
 * owner is the only `attributedTo` value of the document's expanded form, so
 * that values typed parsing drops, such as anonymous attributions, are
 * counted, and it has to agree with the parsed object.  WebFinger is not
 * used.
 *
 * [FEP-ef61]: https://w3id.org/fep/ef61
 * @param id The ID of the object.
 * @param options Options.
 * @returns The object and its owner, or why they could not be resolved.
 */
export async function resolveAuthoritativeObject<T extends ASObject>(
  id: URL,
  options: ResolveAuthoritativeObjectOptions<T>,
): Promise<AuthoritativeObjectResolution<T>> {
  if (hasCredentials(id)) {
    return {
      ok: false,
      failure: { category: "invalid", type: "credentialsInUrl", url: id },
    };
  }
  const tracker = trackLoaders(options.documentLoader, options.contextLoader);
  const failures: DereferenceFailure[] = [];
  const rejections: AuthoritativeObjectRejection[] = [];
  let accepted: { object: T; owner: URL } | undefined;
  const reject = (reason: AuthoritativeObjectRejection): false => {
    rejections.push(reason);
    return false;
  };
  try {
    const object = await lookupObject(id, {
      documentLoader: tracker.documentLoader,
      contextLoader: tracker.contextLoader,
      verifyPortableObject: options.verifyPortableObject,
      crossOrigin: "ignore",
      [lookupObserver]: {
        webFinger: false,
        failed: (failure) => failures.push(failure),
        accept: async (candidate) => {
          let documentUrl: URL;
          try {
            documentUrl = parseIri(candidate.documentUrl);
          } catch {
            return reject("id");
          }
          if (hasCredentials(documentUrl)) return reject("credentials");
          // The candidate's loader serves the context documents the object
          // was parsed with, so the expansion is the parsed interpretation:
          const expanded = await jsonld.expand(
            // deno-lint-ignore no-explicit-any
            candidate.document as any,
            // deno-lint-ignore no-explicit-any
            { documentLoader: candidate.contextLoader } as any,
          );
          const root = getRootNode(expanded);
          if (root == null) return reject("id");
          const rootId = resolveNodeId(root, candidate.baseUrl);
          if (
            rootId == null || !sameId(rootId, id) ||
            !sameId(candidate.object.id, id)
          ) {
            return reject("id");
          }
          if (
            !hasType(root, options.typeId.href) ||
            !options.isObject(candidate.object)
          ) {
            return reject("type");
          }
          const owners = getPropertyValues(root, ATTRIBUTED_TO);
          if (owners.length !== 1) return reject("attribution");
          const owner = resolveNodeId(owners[0], candidate.baseUrl);
          if (owner == null || !sameId(owner, candidate.object.attributionId)) {
            return reject("attribution");
          }
          accepted = { object: candidate.object, owner };
          return true;
        },
      },
    });
    if (object != null && accepted != null) {
      return { ok: true, ...accepted };
    }
    return { ok: false, failure: classifyNull(id, failures, rejections) };
  } catch (error) {
    const parseFailure = failures.find((failure) =>
      failure.operation === "parse" && failure.error === error
    );
    if (
      parseFailure != null &&
      !collectCauses(error).some((cause) => tracker.records.has(cause))
    ) {
      return {
        ok: false,
        failure: {
          category: "invalid",
          type: "invalidInteractingObject",
          reason: "decoding",
          cause: error,
        },
      };
    }
    return { ok: false, failure: classifyFailure(error, tracker) };
  } finally {
    tracker.release();
  }

  function classifyNull(
    id: URL,
    failures: readonly DereferenceFailure[],
    rejections: readonly AuthoritativeObjectRejection[],
  ): Extract<
    AuthoritativeObjectResolution<T>,
    { readonly ok: false }
  >["failure"] {
    // No candidate succeeded, so every loader failure during the lookup
    // counts, including those that a verifier swallowed, e.g., when the
    // owner of a portable collection could not be fetched:
    const loaderErrors = [
      ...failures.flatMap((failure) =>
        failure.error === undefined
          ? []
          : collectCauses(failure.error).filter((cause) =>
            failure.operation === "fetch" || tracker.records.has(cause)
          )
      ),
      ...tracker.records.keys(),
    ];
    const transient = loaderErrors.find(isTransientFetchError);
    if (transient !== undefined) {
      return {
        category: "unverifiable",
        type: "notDereferenceable",
        url: id,
        cause: transient,
        transient: true,
      };
    }
    const decoding = failures.find((failure) =>
      failure.operation === "parse" &&
      !collectCauses(failure.error).some((cause) => tracker.records.has(cause))
    );
    if (decoding != null) {
      return {
        category: "invalid",
        type: "invalidInteractingObject",
        reason: "decoding",
        cause: decoding.error,
      };
    }
    if (rejections.length > 0) {
      return {
        category: "invalid",
        type: "invalidInteractingObject",
        reason: rejections[rejections.length - 1],
      };
    }
    return {
      category: "unverifiable",
      type: "notDereferenceable",
      url: id,
      ...(loaderErrors.length > 0 ? { cause: loaderErrors[0] } : {}),
      transient: false,
    };
  }
}
