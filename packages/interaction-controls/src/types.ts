import type { Context } from "@fedify/fedify";
import type { DocumentLoader } from "@fedify/vocab-runtime";
import type { Temporal } from "temporal-polyfill";
import type {
  Accept,
  Activity,
  Delete,
  InteractionRule,
  Object as ASObject,
  Reject,
} from "@fedify/vocab";

export type InteractionName =
  | "like"
  | "reply"
  | "announce"
  | "quote"
  | "feature";

export type InteractionPolicyProperty =
  | "canLike"
  | "canReply"
  | "canAnnounce"
  | "canQuote"
  | "canFeature";

export interface InteractionControl<
  TRequest extends Activity,
  TAuthorization extends ASObject,
  TInteracting extends ASObject,
  TTarget extends ASObject,
  TImpoliteSource extends ASObject,
  TRequestValidationOptions extends object = Record<never, never>,
> {
  readonly name: InteractionName;
  readonly policyProperty: InteractionPolicyProperty;
  readonly requestTypeId: URL;
  readonly authorizationTypeId: URL;
  readonly verifyRequest: <TContextData>(
    context: Context<TContextData>,
    options:
      & InteractionRequestVerificationOptions<TRequest>
      & TRequestValidationOptions,
  ) => Promise<
    InteractionRequestVerification<
      TRequest,
      TInteracting,
      TTarget
    >
  >;
  readonly evaluatePolicy: <TContextData>(
    context: Context<TContextData>,
    options: InteractionPolicyEvaluationOptions<TContextData, TTarget>,
  ) => Promise<InteractionPolicyDecision>;
  readonly createRequest: (
    options: InteractionRequestCreationOptions<TInteracting, TTarget>,
  ) => TRequest;
  readonly createAuthorization: (
    options: InteractionAuthorizationCreationOptions<TInteracting, TTarget>,
  ) => TAuthorization;
  readonly verifyAuthorization: <TContextData>(
    context: Context<TContextData>,
    options: InteractionAuthorizationVerificationOptions<
      TContextData,
      TAuthorization,
      TInteracting,
      TTarget
    >,
  ) => Promise<InteractionAuthorizationVerification<TAuthorization>>;
  readonly createAccept: (
    options: InteractionAcceptOptions<
      TRequest,
      TAuthorization,
      TInteracting,
      TTarget
    >,
  ) => Accept;
  readonly createReject: (
    options: InteractionRejectOptions<TRequest, TInteracting, TTarget>,
  ) => Reject;
  readonly createRevocation: (
    options: InteractionRevocationCreationOptions<TAuthorization>,
  ) => Delete;
  readonly recognizeImpolite: (
    source: TImpoliteSource,
  ) =>
    | RecognizedImpoliteInteraction<
      TInteracting,
      TTarget,
      TImpoliteSource
    >
    | null;
  readonly getInteractionKey: (
    input: InteractionKeyInput<TInteracting, TTarget>,
  ) => InteractionKey;
  readonly getAuthorizationKey: (
    input: InteractionAuthorizationKeyInput<TAuthorization>,
  ) => InteractionAuthorizationKey;
}

export interface InteractionRequestVerificationOptions<
  TRequest extends Activity,
> {
  readonly request: TRequest | URL;
  readonly documentLoader?: DocumentLoader;

  /**
   * The document loader for remote JSON-LD contexts.  Defaults to the
   * document loader used for objects.
   * @since 2.5.0
   */
  readonly contextLoader?: DocumentLoader;

  /**
   * The already resolved interaction target, used instead of dereferencing
   * the request's `object`.  It is used only when the request references its
   * `object` by ID; otherwise the request fails as it would without this
   * option.  When it is used, the request itself is left untouched.
   *
   * The value is trusted as the resolution of the request's `object`: its ID
   * does not have to match the reference (e.g., a share wrapper resolved to
   * the shared post), and no origin or provenance checks are applied to it.
   * The caller is responsible for those checks.  The target type and target
   * binding checks still apply.
   * @since 2.5.0
   */
  readonly resolvedInteractionTarget?: ASObject;

  /**
   * The already resolved interacting object, used instead of dereferencing
   * the request's `instrument`.  It is used only when the request references
   * its `instrument` by ID; otherwise the request fails as it would without
   * this option.  When it is used, the request itself is left untouched.
   *
   * The value is trusted as the resolution of the request's `instrument`: its
   * ID does not have to match the reference (e.g., after a redirect), and no
   * origin or provenance checks are applied to it.  The caller is responsible
   * for those checks, such as checking that the instrument comes from the
   * requester's origin; a matching attribution alone does not authenticate
   * it.  The instrument type, requester, and target binding checks still
   * apply.
   * @since 2.5.0
   */
  readonly resolvedInteractingObject?: ASObject;
}

/**
 * Options for relaxing how {@link quoteInteraction} validates a quote request.
 * The defaults apply the strictest checks.
 * @since 2.5.0
 */
export interface QuoteRequestValidationOptions {
  /**
   * How the quote post's FEP-044f `quote` and compatible `quoteUrl`
   * references are checked against the requested target:
   *
   *  -  `"strict"` (default): if both are present they must agree, and the
   *     reference must equal the target.
   *  -  `"preferQuote"`: `quote` must equal the target if present, otherwise
   *     `quoteUrl` must; a conflicting `quoteUrl` is ignored.
   *  -  `"any"`: either `quote` or `quoteUrl` equal to the target suffices,
   *     even when the two disagree.
   */
  readonly quoteReference?: "strict" | "preferQuote" | "any";

  /**
   * Which `attributedTo` entries of the quote post may match the requester:
   *
   *  -  `"first"` (default): the first attribution must be the requester.
   *  -  `"any"`: any attribution may be the requester.
   */
  readonly attribution?: "first" | "any";

  /**
   * What to do when the quote post has no attribution IRI, i.e., it has no
   * `attributedTo` at all or only attributions embedded without an `id`:
   *
   *  -  `"reject"` (default): fail with `requesterMismatch`.
   *  -  `"requester"`: treat the quote post as attributed to the requester.
   *
   * A present attribution IRI that does not match the requester always
   * fails.
   */
  readonly missingAttribution?: "reject" | "requester";
}

export type InteractionRequestVerification<
  TRequest extends Activity,
  TInteracting extends ASObject,
  TTarget extends ASObject,
> =
  | {
    readonly verified: true;
    readonly request: TRequest;
    readonly requestId: URL;
    readonly requester: URL;
    readonly interactingObject: TInteracting;
    readonly interactingObjectId: URL;
    readonly interactionTarget: TTarget;
    readonly interactionTargetId: URL;
  }
  | {
    readonly verified: false;
    readonly failure: InteractionRequestVerificationFailure;
    readonly request?: TRequest;
    readonly requestId?: URL;
  };

export type InteractionRequestVerificationFailure =
  | {
    readonly category: "unverifiable";
    readonly type: "notDereferenceable";
    readonly url: URL;
    readonly cause?: unknown;
    /**
     * Whether the failure is likely transient, so that verifying again later
     * could succeed.  Always set by the built-in helpers.
     * @since 2.5.0
     */
    readonly transient?: boolean;
  }
  | {
    readonly category: "unverifiable";
    readonly type: "unauthorizedFetchRequired";
    readonly url: URL;
    /**
     * Whether the failure is likely transient.
     * @since 2.5.0
     */
    readonly transient?: boolean;
  }
  | {
    readonly category: "unverifiable";
    readonly type: "invalidJsonLd";
    readonly cause?: unknown;
    /**
     * Whether the failure is likely transient.  Always `false` when set by
     * the built-in helpers.
     * @since 2.5.0
     */
    readonly transient?: boolean;
  }
  | {
    readonly category: "invalid";
    readonly type: "wrongType";
    readonly expectedType: URL;
    readonly actualTypes: readonly URL[];
  }
  | {
    readonly category: "invalid";
    readonly type: "wrongInstrumentType";
    readonly expectedTypes: readonly URL[];
    readonly actualTypes: readonly URL[];
  }
  | {
    readonly category: "invalid";
    readonly type: "wrongObjectType";
    readonly expectedTypes: readonly URL[];
    readonly actualTypes: readonly URL[];
  }
  | {
    readonly category: "invalid";
    readonly type:
      | "missingId"
      | "missingActor"
      | "missingObject"
      | "missingObjectId"
      | "missingInstrument"
      | "missingInstrumentId";
  }
  | {
    readonly category: "invalid";
    readonly type: "idMismatch" | "objectMismatch" | "instrumentMismatch";
    readonly expected: URL;
    readonly actual?: URL;
  }
  | {
    readonly category: "unauthorized";
    readonly type: "requesterMismatch";
    readonly expected: URL;
    readonly actual?: URL;
  };

export interface InteractionPolicyEvaluationOptions<
  TContextData,
  TTarget extends ASObject,
> {
  readonly subject: TTarget;
  readonly requester: URL;
  readonly documentLoader?: DocumentLoader;
  readonly matchesApprovalCollection?: MatchesApprovalCollection<TContextData>;

  /**
   * The rule to evaluate when the subject has no interaction policy, no rule
   * for this interaction, or a rule without any approval entries.  Without
   * it, such subjects get the interaction's default decision.
   * @since 2.5.0
   */
  readonly fallbackRule?: InteractionRule;

  /**
   * The order in which approval entries are matched:
   *
   *  -  `"actor"` (default): actors listed explicitly in either
   *     `automaticApproval` or `manualApproval` first, then the public
   *     collection and other collections, automatic before manual.  An actor
   *     listed in `manualApproval` thus gets a manual decision even when
   *     `automaticApproval` contains the public collection.
   *  -  `"automatic"`: every `automaticApproval` entry first, then every
   *     `manualApproval` entry.  If an `automaticApproval` collection cannot
   *     be checked and no other automatic entry matches, the decision is
   *     `denied` with an `unverifiableCollection` reason rather than a manual
   *     decision, since the collection could have granted automatic
   *     approval.
   * @since 2.5.0
   */
  readonly precedence?: "actor" | "automatic";

  /**
   * What to do when {@link matchesApprovalCollection} throws:
   *
   *  -  `"deny"` (default): skip the collection; if nothing else decides,
   *     the decision is `denied` with an `unverifiableCollection` reason
   *     carrying the error as its `cause`.
   *  -  `"throw"`: rethrow the first error immediately, without calling the
   *     callback for later collections, so that the caller can retry later
   *     instead of rejecting the interaction.
   * @since 2.5.0
   */
  readonly collectionErrors?: "deny" | "throw";
}

export type MatchesApprovalCollection<TContextData> = (
  collection: URL,
  actor: URL,
  context: Context<TContextData>,
) => boolean | Promise<boolean>;

export type InteractionPolicyDecision =
  | {
    readonly result: "automatic";
    readonly reason: InteractionPolicyMatchReason;
  }
  | {
    readonly result: "manual";
    readonly reason: InteractionPolicyMatchReason;
  }
  | {
    readonly result: "denied";
    readonly reason: InteractionPolicyDenialReason;
  };

export type InteractionPolicyMatchReason =
  | { readonly type: "self" }
  | { readonly type: "default"; readonly default: "publicAutomatic" }
  | { readonly type: "public" }
  | { readonly type: "actor"; readonly actor: URL }
  | { readonly type: "collection"; readonly collection: URL };

export type InteractionPolicyDenialReason =
  | { readonly type: "missingPolicy" }
  | { readonly type: "missingRule" }
  | { readonly type: "noMatch" }
  | {
    readonly type: "unverifiableCollection";
    readonly collection: URL;
    /**
     * The error thrown while checking the collection.
     * @since 2.5.0
     */
    readonly cause?: unknown;
  };

export interface InteractionRequestCreationOptions<
  TInteracting extends ASObject,
  TTarget extends ASObject,
> {
  readonly id: URL;
  readonly actor: URL;
  readonly object: TTarget | URL;
  readonly instrument: TInteracting | URL;
  readonly to?: URL | readonly URL[];
  readonly cc?: URL | readonly URL[];
}

export interface InteractionAuthorizationCreationOptions<
  TInteracting extends ASObject,
  TTarget extends ASObject,
> {
  readonly id: URL;
  readonly attributedTo?: URL;
  readonly interactingObject: TInteracting | URL;
  readonly interactionTarget: TTarget | URL;
}

export interface InteractionAuthorizationVerificationOptions<
  TContextData,
  TAuthorization extends ASObject,
  TInteracting extends ASObject,
  TTarget extends ASObject,
> {
  readonly authorization: TAuthorization | URL;
  readonly interactingObject: TInteracting | URL;
  readonly interactionTarget: TTarget | URL;
  readonly attributedTo?: URL;
  readonly documentLoader?: DocumentLoader;

  /**
   * The document loader for remote JSON-LD contexts.  Defaults to the
   * document loader used for objects.
   * @since 2.5.0
   */
  readonly contextLoader?: DocumentLoader;

  /**
   * The expected ID of the authorization.  When the authorization is given
   * as an object, its ID must equal this, or verification fails with
   * `idMismatch`.  When it is given as a URL, the URL must equal this.
   *
   * This only checks the identity of the authorization; it does not
   * establish its authenticity.  An authorization given as an object still
   * needs {@link verifyAuthenticity}.
   * @since 2.5.0
   */
  readonly authorizationId?: URL;

  /**
   * Whether to accept an authorization whose ID is on a different origin
   * than its attributed actor, if {@link verifyAuthenticity} approves it.
   * This is for authorizations whose authenticity is established by other
   * means, such as a signed `Accept` from the attributed actor or a locally
   * stored grant.  Without {@link verifyAuthenticity}, such authorizations
   * still fail with `originMismatch`.  All other checks still apply.
   * Defaults to `false`.
   * @since 2.5.0
   */
  readonly allowOffOrigin?: boolean;
  readonly getRevocation?: GetInteractionAuthorizationRevocation<TContextData>;
  readonly verifyAuthenticity?: (
    authorization: TAuthorization,
    context: Context<TContextData>,
  ) => boolean | Promise<boolean>;
}

export type InteractionAuthorizationVerification<
  TAuthorization extends ASObject,
> =
  | {
    readonly verified: true;
    readonly authorization: TAuthorization;
    readonly authorizationId: URL;
  }
  | {
    readonly verified: false;
    readonly failure: InteractionAuthorizationVerificationFailure;
    readonly authorization?: TAuthorization;
    readonly authorizationId?: URL;
  };

export type InteractionAuthorizationVerificationFailure =
  | {
    readonly category: "unverifiable";
    readonly type: "notDereferenceable";
    readonly url: URL;
    readonly cause?: unknown;
    /**
     * Whether the failure is likely transient, so that verifying again later
     * could succeed.  Always set by the built-in helpers.
     * @since 2.5.0
     */
    readonly transient?: boolean;
  }
  | {
    readonly category: "unverifiable";
    readonly type: "unauthorizedFetchRequired";
    readonly url: URL;
    /**
     * Whether the failure is likely transient.
     * @since 2.5.0
     */
    readonly transient?: boolean;
  }
  | {
    readonly category: "unverifiable";
    readonly type: "invalidJsonLd";
    readonly cause?: unknown;
    /**
     * Whether the failure is likely transient.  Always `false` when set by
     * the built-in helpers.
     * @since 2.5.0
     */
    readonly transient?: boolean;
  }
  | {
    readonly category: "unauthorized";
    readonly type: "wrongType";
    readonly expectedType: URL;
    readonly actualTypes: readonly URL[];
  }
  | {
    readonly category: "unauthorized";
    readonly type: "missingId" | "missingObjectId" | "missingTargetId";
  }
  | {
    readonly category: "unauthorized";
    readonly type: "missingAttribution";
  }
  | {
    readonly category: "unauthorized";
    readonly type: "idMismatch" | "objectMismatch" | "targetMismatch";
    readonly expected: URL;
    readonly actual?: URL;
  }
  | {
    readonly category: "unauthorized";
    readonly type: "attributionMismatch";
    readonly expected: URL;
    readonly actual?: URL;
  }
  | {
    readonly category: "unauthorized";
    readonly type: "originMismatch";
    readonly expectedOrigin: string;
    readonly actualOrigin: string;
  }
  | {
    readonly category: "unauthorized";
    readonly type: "notAuthentic";
    readonly detail?: string;
    readonly cause?: unknown;
  }
  | {
    readonly category: "revoked";
    readonly type: "deleted";
    readonly revoker?: URL;
    readonly revoked?: Temporal.Instant;
    readonly activity?: Delete;
  };

export type GetInteractionAuthorizationRevocation<TContextData> = (
  authorizationId: URL,
  context: Context<TContextData>,
) =>
  | InteractionAuthorizationRevocation
  | null
  | Promise<InteractionAuthorizationRevocation | null>;

export interface InteractionAuthorizationRevocation {
  readonly revoker?: URL;
  readonly revoked?: Temporal.Instant;
  readonly activity?: Delete;
}

export type InteractionAcceptOptions<
  TRequest extends Activity,
  TAuthorization extends ASObject,
  TInteracting extends ASObject,
  TTarget extends ASObject,
> =
  | {
    readonly mode: "polite";
    readonly id?: URL;
    readonly actor: URL;
    readonly request: TRequest | URL;
    readonly authorization: TAuthorization | URL;
    readonly to?: URL | readonly URL[];
    readonly cc?: URL | readonly URL[];
  }
  | {
    readonly mode: "impolite";
    readonly id?: URL;
    readonly actor: URL;
    readonly interactingObject: TInteracting | URL;
    readonly interactionTarget: TTarget | URL;
    readonly authorization: TAuthorization | URL;
    readonly to?: URL | readonly URL[];
    readonly cc?: URL | readonly URL[];
  };

export type InteractionRejectOptions<
  TRequest extends Activity,
  TInteracting extends ASObject,
  TTarget extends ASObject,
> =
  | {
    readonly mode: "polite";
    readonly id?: URL;
    readonly actor: URL;
    readonly request: TRequest | URL;
    readonly to?: URL | readonly URL[];
    readonly cc?: URL | readonly URL[];
  }
  | {
    readonly mode: "impolite";
    readonly id?: URL;
    readonly actor: URL;
    readonly interactingObject: TInteracting | URL;
    readonly interactionTarget: TTarget | URL;
    readonly to?: URL | readonly URL[];
    readonly cc?: URL | readonly URL[];
  };

export interface InteractionRevocationCreationOptions<
  TAuthorization extends ASObject,
> {
  readonly id?: URL;
  readonly actor: URL;
  readonly authorization: TAuthorization | URL;
  readonly to?: URL | readonly URL[];
  readonly cc?: URL | readonly URL[];

  /**
   * Whether to embed the authorization in the `Delete` activity instead of
   * referring to it by its ID.  Applies only when the authorization is given
   * as an object.  The embedded copy contains only the authorization's ID,
   * attribution, and the IDs of its interacting object and interaction
   * target, so that the revocation does not leak them.  Defaults to `false`.
   * @since 2.5.0
   */
  readonly embedAuthorization?: boolean;
}

export interface RecognizedImpoliteInteraction<
  TInteracting extends ASObject,
  TTarget extends ASObject,
  TImpoliteSource extends ASObject,
> {
  readonly requester: URL;
  readonly interactingObject: TInteracting;
  readonly interactingObjectId: URL;
  readonly interactionTarget?: TTarget;
  readonly interactionTargetId: URL;
  readonly source: TImpoliteSource;
  readonly evidence: ImpoliteInteractionEvidence;
}

export type ImpoliteInteractionEvidence =
  | { readonly type: "activity"; readonly activityType: URL }
  | { readonly type: "property"; readonly property: URL }
  | { readonly type: "linkRel"; readonly rel: URL };

export interface InteractionKeyInput<
  TInteracting extends ASObject,
  TTarget extends ASObject,
> {
  readonly requester: URL;
  readonly interactingObject: TInteracting | URL;
  readonly interactionTarget: TTarget | URL;
}

export interface InteractionKey {
  readonly interaction: string;
  readonly requester: URL;
  readonly interactingObjectId: URL;
  readonly interactionTargetId: URL;
}

export interface InteractionAuthorizationKeyInput<
  TAuthorization extends ASObject,
> {
  readonly authorization: TAuthorization | URL;
}

export interface InteractionAuthorizationKey {
  readonly interaction: string;
  readonly authorizationId: URL;
}
