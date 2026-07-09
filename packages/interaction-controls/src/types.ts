import type { Context } from "@fedify/fedify";
import type { DocumentLoader } from "@fedify/vocab-runtime";
import type {
  Accept,
  Activity,
  Delete,
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
> {
  readonly name: InteractionName;
  readonly policyProperty: InteractionPolicyProperty;
  readonly requestTypeId: URL;
  readonly authorizationTypeId: URL;
  readonly verifyRequest: <TContextData>(
    context: Context<TContextData>,
    options: InteractionRequestVerificationOptions<TRequest>,
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
  }
  | {
    readonly category: "unverifiable";
    readonly type: "unauthorizedFetchRequired";
    readonly url: URL;
  }
  | {
    readonly category: "unverifiable";
    readonly type: "invalidJsonLd";
    readonly cause?: unknown;
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
    readonly type: "objectMismatch" | "instrumentMismatch";
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
  readonly matchesApprovalCollection?: MatchesApprovalCollection<TContextData>;
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
  | { readonly type: "unverifiableCollection"; readonly collection: URL };

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
  }
  | {
    readonly category: "unverifiable";
    readonly type: "unauthorizedFetchRequired";
    readonly url: URL;
  }
  | {
    readonly category: "unverifiable";
    readonly type: "invalidJsonLd";
    readonly cause?: unknown;
  }
  | {
    readonly category: "unauthorized";
    readonly type: "wrongType";
    readonly expectedType: URL;
    readonly actualTypes: readonly URL[];
  }
  | {
    readonly category: "unauthorized";
    readonly type: "missingId";
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
    readonly id: URL;
    readonly actor: URL;
    readonly request: TRequest | URL;
    readonly authorization: TAuthorization | URL;
    readonly to: URL | readonly URL[];
    readonly cc?: URL | readonly URL[];
  }
  | {
    readonly mode: "impolite";
    readonly id: URL;
    readonly actor: URL;
    readonly interactingObject: TInteracting | URL;
    readonly interactionTarget: TTarget | URL;
    readonly authorization: TAuthorization | URL;
    readonly to: URL | readonly URL[];
    readonly cc?: URL | readonly URL[];
  };

export type InteractionRejectOptions<
  TRequest extends Activity,
  TInteracting extends ASObject,
  TTarget extends ASObject,
> =
  | {
    readonly mode: "polite";
    readonly id: URL;
    readonly actor: URL;
    readonly request: TRequest | URL;
    readonly to: URL | readonly URL[];
    readonly cc?: URL | readonly URL[];
  }
  | {
    readonly mode: "impolite";
    readonly id: URL;
    readonly actor: URL;
    readonly interactingObject: TInteracting | URL;
    readonly interactionTarget: TTarget | URL;
    readonly to: URL | readonly URL[];
    readonly cc?: URL | readonly URL[];
  };

export interface InteractionRevocationCreationOptions<
  TAuthorization extends ASObject,
> {
  readonly id: URL;
  readonly actor: URL;
  readonly authorization: TAuthorization | URL;
  readonly to: URL | readonly URL[];
  readonly cc?: URL | readonly URL[];
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
