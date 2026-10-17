import {
  getCanonicalPortableId,
  getPortableDid,
  isPortableId,
} from "../sig/portable-key-id.ts";

/**
 * A party that Fedify authenticated for an incoming activity, independently
 * of the activity's declared `actor`.
 * @since 2.5.0
 */
export interface InboxPrincipal {
  /**
   * What {@link InboxPrincipal.id} is:
   *
   *  -  `"actor"`: an actor whose ownership of the verifying key Fedify
   *     confirmed with the actor's own document.
   *  -  `"portableAuthority"`: a DID whose verification method made a valid
   *     Object Integrity Proof.  It authenticates the [FEP-ef61] portable
   *     actors of that DID, and nothing else.
   *
   * [FEP-ef61]: https://w3id.org/fep/ef61
   */
  readonly kind: "actor" | "portableAuthority";

  /** The actor ID, or the DID if {@link kind} is `"portableAuthority"`. */
  readonly id: URL;

  /**
   * How the principal was authenticated:
   *
   *  -  `"httpSignatures"`: it signed the HTTP request.
   *  -  `"linkedDataSignatures"`: it made the Linked Data Signature of the
   *     activity.
   *  -  `"objectIntegrityProofs"`: it made an Object Integrity Proof of the
   *     activity.
   *  -  `"origin"`: the activity was fetched again from the actor's own web
   *     origin, which happens only for `Context.routeActivity()`.
   */
  readonly mechanism:
    | "httpSignatures"
    | "linkedDataSignatures"
    | "objectIntegrityProofs"
    | "origin";

  /** The key or verification method that authenticated the principal. */
  readonly keyId: URL | null;
}

/**
 * Who Fedify authenticated for an incoming activity, and the interpretation of
 * the activity it authenticated.  Inbox listeners receive it as
 * {@link InboxContext.authentication}.
 *
 * Authenticated principals are independent of the activity's declared
 * `actor`: an activity forwarded by a relay is signed by the relay in its
 * HTTP request, but its document may be signed by its author, and some
 * activities, such as [FEP-7aa9] `FeatureRequest`s sent by Mastodon, declare
 * no `actor` at all.  A valid signature alone does not authorize anything;
 * use {@link isActorAuthenticated} to check whether a specific actor was
 * authenticated.
 *
 * [FEP-7aa9]: https://w3id.org/fep/7aa9
 * @since 2.5.0
 */
export interface InboxAuthenticationEvidence {
  /**
   * Whether signatures were verified at all.  It is `false` only when
   * signature verification is skipped, or when there is no evidence, e.g.,
   * for an activity queued by an older version of Fedify.  In that case all
   * the principal lists are empty.
   */
  readonly verified: boolean;

  /**
   * The principals that signed the HTTP request, i.e., the server that
   * delivered the activity, which may have forwarded it.  It is empty when
   * the activity document was authenticated by its own signatures, so that
   * HTTP Signatures did not need to be verified.
   */
  readonly requestSigners: readonly InboxPrincipal[];

  /**
   * The principals that made the verified Linked Data Signature or Object
   * Integrity Proofs of the activity document.  All of them are listed when
   * there are several proofs.
   */
  readonly documentSigners: readonly InboxPrincipal[];

  /**
   * The actors authenticated because `Context.routeActivity()` fetched the
   * activity again from their own web origin.  It is always empty for
   * activities delivered to an inbox.
   */
  readonly originAuthenticated: readonly InboxPrincipal[];

  /**
   * The activity as Fedify interpreted it while authenticating it, in
   * expanded JSON-LD.  Typed vocabulary objects omit some values, such as
   * blank node references and values they cannot decode, so authorization
   * that has to count every value of a property, e.g., that a property has
   * exactly one value, should inspect this instead.  It is deeply frozen.
   * It is empty when there is no evidence.
   */
  readonly expandedActivity: readonly Record<string, unknown>[];

  /**
   * The base URL the activity was decoded with, e.g., the URL an activity
   * fetched by `Context.routeActivity()` was finally retrieved from, or
   * `null` if none was given.  Relative IRIs left in
   * {@link expandedActivity} resolve against it, or against the activity's
   * own `@id` if it is `null`, as the decoder resolves them.
   */
  readonly baseUrl: URL | null;
}

/**
 * The evidence of an activity that has not been authenticated by Fedify.
 */
const EMPTY_EVIDENCE: InboxAuthenticationEvidence = Object.freeze({
  verified: false,
  requestSigners: Object.freeze([]),
  documentSigners: Object.freeze([]),
  originAuthenticated: Object.freeze([]),
  expandedActivity: Object.freeze([]),
  baseUrl: null,
});

/**
 * Gets the evidence of an activity that has not been authenticated.
 * @internal
 */
export function getEmptyAuthenticationEvidence(): InboxAuthenticationEvidence {
  return EMPTY_EVIDENCE;
}

/**
 * Options for {@link isActorAuthenticated}.
 * @since 2.5.0
 */
export interface IsActorAuthenticatedOptions {
  /**
   * Which principals to consider:
   *
   *  -  `"effective"` (default): the document signers if there are any,
   *     otherwise the request signers if there are any, otherwise the actors
   *     authenticated by their origin.
   *  -  `"document"`: the document signers only.
   */
  readonly scope?: "effective" | "document";
}

/**
 * Gets the principals that an authorization decision should rely on.
 * @param evidence The evidence.
 * @param scope See {@link IsActorAuthenticatedOptions.scope}.
 * @returns The principals.
 * @internal
 */
export function getEffectivePrincipals(
  evidence: InboxAuthenticationEvidence,
  scope: "effective" | "document" = "effective",
): readonly InboxPrincipal[] {
  if (scope === "document" || evidence.documentSigners.length > 0) {
    return evidence.documentSigners;
  }
  if (evidence.requestSigners.length > 0) return evidence.requestSigners;
  return evidence.originAuthenticated;
}

/**
 * Normalizes an actor ID for comparison: portable IDs and compatible
 * identifiers to their canonical portable ID, other IDs to their `href`.
 * @returns The normalized ID, or `null` for a malformed portable ID.
 */
function normalizeActorId(id: URL): string | null {
  return isPortableId(id) ? getCanonicalPortableId(id) : id.href;
}

/**
 * Checks whether the given principal authenticates the given actor.
 * @param principal The principal.
 * @param actorId The actor ID.
 * @returns `true` if the principal authenticates the actor.
 * @internal
 */
export function principalAuthenticates(
  principal: InboxPrincipal,
  actorId: URL,
): boolean {
  if (principal.kind === "portableAuthority") {
    if (!isPortableId(actorId)) return false;
    const did = getPortableDid(actorId);
    return did != null && did === getPortableDid(principal.id);
  }
  const expected = normalizeActorId(actorId);
  return expected != null && normalizeActorId(principal.id) === expected;
}

/**
 * Checks whether the given evidence authenticates the given actor.
 *
 * Actor IDs are compared exactly, except that [FEP-ef61] portable IDs and
 * compatible identifiers are compared by their canonical portable IDs, and
 * a portable authority (a DID) authenticates the portable actors of that DID.
 *
 * @example
 * ``` typescript
 * federation
 *   .setInboxListeners("/users/{identifier}/inbox", "/inbox")
 *   .on(Follow, async (ctx, follow) => {
 *     if (follow.actorId == null) return;
 *     // The actor is always authenticated for activities that declare one,
 *     // but the same check works for any actor an activity names:
 *     isActorAuthenticated(ctx.authentication, follow.actorId);
 *   });
 * ```
 *
 * [FEP-ef61]: https://w3id.org/fep/ef61
 * @param evidence The authentication evidence, usually
 *                 {@link InboxContext.authentication}.
 * @param actorId The actor ID to check.
 * @param options Options.
 * @returns `true` if the actor is authenticated.
 * @since 2.5.0
 */
export function isActorAuthenticated(
  evidence: InboxAuthenticationEvidence,
  actorId: URL,
  options: IsActorAuthenticatedOptions = {},
): boolean {
  return getEffectivePrincipals(evidence, options.scope).some((principal) =>
    principalAuthenticates(principal, actorId)
  );
}

/**
 * A {@link InboxPrincipal} as stored in a queued message.
 * @internal
 */
export interface SerializedInboxPrincipal {
  readonly kind: InboxPrincipal["kind"];
  readonly id: string;
  readonly mechanism: InboxPrincipal["mechanism"];
  readonly keyId: string | null;
}

/**
 * The principals of an {@link InboxAuthenticationEvidence} as stored in
 * a queued message.  The expanded activity and the base URL are restored
 * from the queued verified view instead.
 * @internal
 */
export interface SerializedInboxAuthentication {
  readonly verified: boolean;
  readonly requestSigners: readonly SerializedInboxPrincipal[];
  readonly documentSigners: readonly SerializedInboxPrincipal[];
  readonly originAuthenticated: readonly SerializedInboxPrincipal[];
}

function serializePrincipal(
  principal: InboxPrincipal,
): SerializedInboxPrincipal {
  return {
    kind: principal.kind,
    id: principal.id.href,
    mechanism: principal.mechanism,
    keyId: principal.keyId?.href ?? null,
  };
}

/**
 * Serializes the principals of the given evidence for a queued message.
 * @internal
 */
export function serializeAuthentication(
  evidence: InboxAuthenticationEvidence,
): SerializedInboxAuthentication {
  return {
    verified: evidence.verified,
    requestSigners: evidence.requestSigners.map(serializePrincipal),
    documentSigners: evidence.documentSigners.map(serializePrincipal),
    originAuthenticated: evidence.originAuthenticated.map(serializePrincipal),
  };
}

const KINDS = new Set(["actor", "portableAuthority"]);
const MECHANISMS = new Set([
  "httpSignatures",
  "linkedDataSignatures",
  "objectIntegrityProofs",
  "origin",
]);

function deserializePrincipals(value: unknown): InboxPrincipal[] | null {
  if (!Array.isArray(value)) return null;
  const principals: InboxPrincipal[] = [];
  for (const item of value) {
    if (
      item == null || typeof item !== "object" || !KINDS.has(item.kind) ||
      !MECHANISMS.has(item.mechanism) || typeof item.id !== "string" ||
      !URL.canParse(item.id) ||
      (item.keyId != null &&
        (typeof item.keyId !== "string" || !URL.canParse(item.keyId)))
    ) {
      return null;
    }
    principals.push(Object.freeze({
      kind: item.kind,
      id: new URL(item.id),
      mechanism: item.mechanism,
      keyId: item.keyId == null ? null : new URL(item.keyId),
    }));
  }
  return principals;
}

/**
 * Restores the evidence of a queued message.
 * @param value The serialized principals.
 * @param expandedActivity The expanded activity, restored from the queued
 *                         verified view.
 * @param baseUrl The base URL, restored from the queued verified view.
 * @returns The evidence, or `null` if the serialized value is malformed.
 * @internal
 */
export function deserializeAuthentication(
  value: unknown,
  expandedActivity: readonly Record<string, unknown>[],
  baseUrl: URL | null,
): InboxAuthenticationEvidence | null {
  if (
    value == null || typeof value !== "object" ||
    typeof (value as { verified?: unknown }).verified !== "boolean"
  ) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const requestSigners = deserializePrincipals(record.requestSigners);
  const documentSigners = deserializePrincipals(record.documentSigners);
  const originAuthenticated = deserializePrincipals(
    record.originAuthenticated,
  );
  if (
    requestSigners == null || documentSigners == null ||
    originAuthenticated == null
  ) {
    return null;
  }
  return createAuthenticationEvidence({
    verified: record.verified as boolean,
    requestSigners,
    documentSigners,
    originAuthenticated,
    expandedActivity,
    baseUrl,
  });
}

/**
 * Creates frozen evidence.
 * @internal
 */
export function createAuthenticationEvidence(
  evidence: InboxAuthenticationEvidence,
): InboxAuthenticationEvidence {
  return Object.freeze({
    verified: evidence.verified,
    requestSigners: Object.freeze([...evidence.requestSigners]),
    documentSigners: Object.freeze([...evidence.documentSigners]),
    originAuthenticated: Object.freeze([...evidence.originAuthenticated]),
    expandedActivity: evidence.expandedActivity,
    baseUrl: evidence.baseUrl,
  });
}
