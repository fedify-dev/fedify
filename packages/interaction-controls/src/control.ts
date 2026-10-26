import { type Context, isActorAuthenticated } from "@fedify/fedify";
import {
  type DocumentLoader,
  getDocumentLoader,
  getFe34Origin,
  parseIri,
} from "@fedify/vocab-runtime";
import jsonld from "@fedify/vocab-runtime/jsonld";
import {
  Accept,
  type Activity,
  Delete,
  type InteractionRule,
  type Object as ASObject,
  PUBLIC_COLLECTION,
  Reject,
} from "@fedify/vocab";
import type {
  ImpoliteInteractionEvidence,
  InteractionAcceptOptions,
  InteractionAuthorizationVerification,
  InteractionAuthorizationVerificationOptions,
  InteractionControl,
  InteractionName,
  InteractionPolicyDecision,
  InteractionPolicyEvaluationOptions,
  InteractionPolicyMatchReason,
  InteractionPolicyProperty,
  InteractionRejectOptions,
  InteractionRequestVerification,
  InteractionRequestVerificationFailure,
  InteractionRequestVerificationOptions,
  MatchesApprovalCollection,
  RecognizedImpoliteInteraction,
} from "./types.ts";
import {
  classifyFailure,
  notDereferenceable,
  trackLoaders,
  type UnverifiableFailure,
} from "./loaders.ts";
import { resolveAuthoritativeObject } from "./collection.ts";
import {
  getPropertyValues,
  getRootNode,
  hasCredentials,
  hasType,
  isPortableClaim,
  resolveNodeId,
  sameId,
} from "./evidence.ts";

type VocabConstructor<T extends ASObject> = {
  readonly typeId: URL;
  new (
    values: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): T;
  fromJsonLd(
    json: unknown,
    options?: {
      documentLoader?: DocumentLoader;
      contextLoader?: DocumentLoader;
      baseUrl?: URL;
    },
  ): Promise<T>;
};

interface ControlConfig<
  TRequest extends Activity,
  TAuthorization extends ASObject,
  TInteracting extends ASObject,
  TTarget extends ASObject,
  TImpoliteSource extends ASObject,
  TRequestValidationOptions extends object = Record<never, never>,
> {
  readonly name: InteractionName;
  readonly policyProperty: InteractionPolicyProperty;
  readonly requestClass: VocabConstructor<TRequest>;
  readonly authorizationClass: VocabConstructor<TAuthorization>;
  readonly getInteractingObject: (
    request: TRequest,
    options: DereferenceOptions,
  ) => Promise<TInteracting | null>;
  readonly isInteractingObject?: (object: ASObject) => object is TInteracting;
  readonly interactingObjectTypes?: readonly URL[];
  readonly getInteractionTarget: (
    request: TRequest,
    options: DereferenceOptions,
  ) => Promise<TTarget | null>;
  readonly isInteractionTarget?: (object: ASObject) => object is TTarget;
  readonly interactionTargetTypes?: readonly URL[];
  readonly getRequester?: (
    request: TRequest,
    interactingObject: TInteracting,
    interactionTarget: TTarget,
  ) => URL | null;
  readonly validateRequest: (
    request: TRequest,
    interactingObject: TInteracting,
    interactionTarget: TTarget,
    requester: URL,
    options: TRequestValidationOptions,
  ) => RequestValidationFailure | null;
  readonly authorizationAttribution?: "required" | "optional";
  readonly getSelfActor: (subject: TTarget) => URL | null;
  readonly defaultMissingPolicy: "automatic" | "denied";
  readonly recognizeImpolite: (
    source: TImpoliteSource,
  ) =>
    | RecognizedImpoliteInteraction<
      TInteracting,
      TTarget,
      TImpoliteSource
    >
    | null;
  readonly getImplicitAutomaticActors?: (
    subject: TTarget,
    options: DereferenceOptions,
  ) => AsyncIterable<URL> | Iterable<URL>;
  /**
   * Whether the interacting object is always fetched from its ID and its
   * owner taken from that document, the request being bound to the
   * interpretation Fedify authenticated.  The requester of a request without
   * an actor is then the owner, who must have been authenticated.  The first
   * of {@link interactingObjectTypes} is the type the object must have.
   */
  readonly authoritativeInteractingObject?: boolean;
}

export interface DereferenceOptions {
  readonly documentLoader?: DocumentLoader;
  readonly contextLoader?: DocumentLoader;
  readonly suppressError?: boolean;
}

type RequestValidationFailure =
  | {
    readonly type: "objectMismatch" | "instrumentMismatch";
    readonly expected: URL;
    readonly actual?: URL;
  }
  | {
    readonly type: "requesterMismatch";
    readonly expected: URL;
    readonly actual?: URL;
  };

type RuleMatchResult =
  | {
    readonly result: "matched";
    readonly reason: InteractionPolicyMatchReason;
  }
  | {
    readonly result: "unverifiableCollection";
    readonly collection: URL;
    readonly cause: unknown;
  }
  | null;

export function createInteractionControl<
  TRequest extends Activity,
  TAuthorization extends ASObject,
  TInteracting extends ASObject,
  TTarget extends ASObject,
  TImpoliteSource extends ASObject,
  TRequestValidationOptions extends object = Record<never, never>,
>(
  config: ControlConfig<
    TRequest,
    TAuthorization,
    TInteracting,
    TTarget,
    TImpoliteSource,
    TRequestValidationOptions
  >,
): InteractionControl<
  TRequest,
  TAuthorization,
  TInteracting,
  TTarget,
  TImpoliteSource,
  TRequestValidationOptions
> {
  return {
    name: config.name,
    policyProperty: config.policyProperty,
    requestTypeId: config.requestClass.typeId,
    authorizationTypeId: config.authorizationClass.typeId,
    verifyRequest: (context, options) =>
      verifyRequest(context, options, config),
    evaluatePolicy: (context, options) =>
      evaluatePolicy(context, options, config),
    createRequest: (options) =>
      new config.requestClass({
        id: options.id,
        actor: options.actor,
        object: options.object,
        instrument: options.instrument,
        ...audience(options),
      }),
    createAuthorization: (options) =>
      new config.authorizationClass({
        id: options.id,
        attribution: options.attributedTo,
        interactingObject: getRequiredId(
          options.interactingObject,
          "interactingObject",
        ),
        interactionTarget: getRequiredId(
          options.interactionTarget,
          "interactionTarget",
        ),
      }),
    verifyAuthorization: (context, options) =>
      verifyAuthorization(context, options, config),
    createAccept: (options) => createAccept(options),
    createReject: (options) => createReject(options),
    createRevocation: (options) =>
      new Delete({
        id: options.id,
        actor: options.actor,
        object: options.embedAuthorization &&
            !(options.authorization instanceof URL)
          ? createEmbeddedAuthorization(options.authorization, config)
          : getRequiredId(options.authorization, "authorization"),
        ...audience(options),
      }),
    recognizeImpolite: config.recognizeImpolite,
    getInteractionKey: (input) => ({
      interaction: config.name,
      requester: input.requester,
      interactingObjectId: getRequiredId(
        input.interactingObject,
        "interactingObject",
      ),
      interactionTargetId: getRequiredId(
        input.interactionTarget,
        "interactionTarget",
      ),
    }),
    getAuthorizationKey: (input) => ({
      interaction: config.name,
      authorizationId: getRequiredId(input.authorization, "authorization"),
    }),
  };
}

function audience(
  options: {
    readonly to?: URL | readonly URL[];
    readonly cc?: URL | readonly URL[];
  },
): {
  readonly to?: URL;
  readonly tos?: URL[];
  readonly cc?: URL;
  readonly ccs?: URL[];
} {
  const to = options.to;
  const cc = options.cc;
  return {
    ...(to == null
      ? {}
      : Array.isArray(to)
      ? { tos: to as URL[] }
      : { to: to as URL }),
    ...(cc == null
      ? {}
      : Array.isArray(cc)
      ? { ccs: cc as URL[] }
      : { cc: cc as URL }),
  };
}

export function getRequiredId(value: ASObject | URL, name: string): URL {
  if (value instanceof URL) return value;
  if (value.id == null) {
    throw new TypeError(`The ${name} must have an id.`);
  }
  return value.id;
}

function createEmbeddedAuthorization<
  TRequest extends Activity,
  TAuthorization extends ASObject,
  TInteracting extends ASObject,
  TTarget extends ASObject,
  TImpoliteSource extends ASObject,
  TRequestValidationOptions extends object,
>(
  authorization: TAuthorization,
  config: ControlConfig<
    TRequest,
    TAuthorization,
    TInteracting,
    TTarget,
    TImpoliteSource,
    TRequestValidationOptions
  >,
): TAuthorization {
  const { interactingObjectId, interactionTargetId } = authorization as
    & ASObject
    & {
      readonly interactingObjectId?: URL | null;
      readonly interactionTargetId?: URL | null;
    };
  if (interactingObjectId == null) {
    throw new TypeError(
      "The authorization's interactingObject must have an id.",
    );
  }
  if (interactionTargetId == null) {
    throw new TypeError(
      "The authorization's interactionTarget must have an id.",
    );
  }
  // Only IDs are copied, so that the revocation does not leak the
  // interacting object or the interaction target (FEP-044f):
  return new config.authorizationClass({
    id: getRequiredId(authorization, "authorization"),
    attributions: authorization.attributionIds,
    interactingObject: interactingObjectId,
    interactionTarget: interactionTargetId,
  });
}

function getId(value: ASObject | URL): URL | null {
  return value instanceof URL ? value : value.id;
}

export function idsEqual(
  left: URL | null | undefined,
  right: URL | null | undefined,
): boolean {
  return left != null && right != null && left.href === right.href;
}

export function getTypeId(object: ASObject): URL {
  return (object.constructor as unknown as { readonly typeId: URL }).typeId;
}

async function verifyRequest<
  TRequest extends Activity,
  TAuthorization extends ASObject,
  TInteracting extends ASObject,
  TTarget extends ASObject,
  TImpoliteSource extends ASObject,
  TRequestValidationOptions extends object,
  TContextData,
>(
  context: Context<TContextData>,
  options:
    & InteractionRequestVerificationOptions<TRequest>
    & TRequestValidationOptions,
  config: ControlConfig<
    TRequest,
    TAuthorization,
    TInteracting,
    TTarget,
    TImpoliteSource,
    TRequestValidationOptions
  >,
): Promise<InteractionRequestVerification<TRequest, TInteracting, TTarget>> {
  const documentLoader = options.documentLoader ?? context.documentLoader;
  const contextLoader = options.contextLoader ?? documentLoader;
  const expectedRequestId = options.request instanceof URL
    ? options.request
    : null;
  const requestResult = await materialize(
    options.request,
    config.requestClass,
    documentLoader,
    contextLoader,
  );
  if (!requestResult.ok) {
    return {
      verified: false,
      failure: requestResult.failure,
    };
  }
  const request = requestResult.object;
  if (!(request instanceof config.requestClass)) {
    return {
      verified: false,
      request,
      requestId: request.id ?? undefined,
      failure: {
        category: "invalid",
        type: "wrongType",
        expectedType: config.requestClass.typeId,
        actualTypes: [getTypeId(request)],
      },
    };
  }
  if (request.id == null) {
    return {
      verified: false,
      request,
      failure: { category: "invalid", type: "missingId" },
    };
  }
  if (expectedRequestId != null && !idsEqual(request.id, expectedRequestId)) {
    return {
      verified: false,
      request,
      requestId: request.id,
      failure: {
        category: "invalid",
        type: "idMismatch",
        expected: expectedRequestId,
        actual: request.id,
      },
    };
  }
  // Evidence that authenticated nothing and kept no interpretation, e.g., for
  // an activity queued by an older version of Fedify, is no evidence at all:
  const authentication = options.authentication == null ||
      (!options.authentication.verified &&
        options.authentication.expandedActivity.length < 1)
    ? undefined
    : options.authentication;
  if (config.authoritativeInteractingObject) {
    const evidence = authentication != null
      ? {
        expanded: authentication.expandedActivity,
        baseUrl: authentication.baseUrl,
      }
      : requestResult.evidence;
    if (authentication == null && expectedRequestId != null) {
      if (evidence == null) {
        return {
          verified: false,
          request,
          requestId: request.id,
          failure: {
            category: "unauthorized",
            type: "unauthenticated-requester",
          },
        };
      }
    }
    const bindingFailure = bindRequest(
      request,
      evidence,
      config.requestClass.typeId,
    );
    if (bindingFailure != null) {
      return {
        verified: false,
        request,
        requestId: request.id,
        failure: bindingFailure,
      };
    }
    if (
      authentication != null && request.actorId != null &&
      !isActorAuthenticated(authentication, request.actorId)
    ) {
      return {
        verified: false,
        request,
        requestId: request.id,
        failure: {
          category: "unauthorized",
          type: "unauthenticated-requester",
          requester: request.actorId,
        },
      };
    }
  }
  const targetResult = options.resolvedInteractionTarget != null &&
      request.objectId != null
    // The type is checked by isInteractionTarget() below:
    ? { ok: true as const, value: options.resolvedInteractionTarget as TTarget }
    : await dereferenceField(
      request,
      request.objectId,
      config.getInteractionTarget,
      documentLoader,
      contextLoader,
    );
  if (!targetResult.ok) {
    return {
      verified: false,
      request,
      requestId: request.id,
      failure: targetResult.failure,
    };
  }
  const interactionTarget = targetResult.value;
  if (interactionTarget == null) {
    return {
      verified: false,
      request,
      requestId: request.id,
      failure: { category: "invalid", type: "missingObject" },
    };
  }
  if (
    config.isInteractionTarget != null &&
    !config.isInteractionTarget(interactionTarget)
  ) {
    return {
      verified: false,
      request,
      requestId: request.id,
      failure: {
        category: "invalid",
        type: "wrongObjectType",
        expectedTypes: config.interactionTargetTypes ?? [],
        actualTypes: [getTypeId(interactionTarget)],
      },
    };
  }
  let owner: URL | undefined;
  const interactingResult = config.authoritativeInteractingObject &&
      request.instrumentId != null
    ? await (async () => {
      const resolution = await resolveAuthoritativeObject(
        request.instrumentId!,
        {
          documentLoader,
          contextLoader,
          verifyPortableObject: context.verifyPortableObject,
          typeId: config.interactingObjectTypes![0],
          isObject: (object): object is TInteracting =>
            config.isInteractingObject?.(object) ?? true,
        },
      );
      if (!resolution.ok) {
        return { ok: false as const, failure: resolution.failure };
      }
      owner = resolution.owner;
      return { ok: true as const, value: resolution.object };
    })()
    : options.resolvedInteractingObject != null &&
        request.instrumentId != null
    // The type is checked by isInteractingObject() below:
    ? {
      ok: true as const,
      value: options.resolvedInteractingObject as TInteracting,
    }
    : await dereferenceField(
      request,
      request.instrumentId,
      config.getInteractingObject,
      documentLoader,
      contextLoader,
    );
  if (!interactingResult.ok) {
    return {
      verified: false,
      request,
      requestId: request.id,
      failure: interactingResult.failure,
    };
  }
  const interactingObject = interactingResult.value;
  if (interactingObject == null) {
    return {
      verified: false,
      request,
      requestId: request.id,
      failure: { category: "invalid", type: "missingInstrument" },
    };
  }
  if (
    config.isInteractingObject != null &&
    !config.isInteractingObject(interactingObject)
  ) {
    return {
      verified: false,
      request,
      requestId: request.id,
      failure: {
        category: "invalid",
        type: "wrongInstrumentType",
        expectedTypes: config.interactingObjectTypes ?? [],
        actualTypes: [getTypeId(interactingObject)],
      },
    };
  }
  if (
    config.authoritativeInteractingObject && request.actorId == null &&
    (owner == null || authentication == null ||
      !isActorAuthenticated(authentication, owner))
  ) {
    // Without an actor, the requester is the owner of the interacting object,
    // as its own document names it, and only if the owner was authenticated:
    return {
      verified: false,
      request,
      requestId: request.id,
      failure: authentication == null
        ? { category: "invalid", type: "missingActor" }
        : {
          category: "unauthorized",
          type: "unauthenticated-requester",
          ...(owner == null ? {} : { requester: owner }),
        },
    };
  }
  const requester = request.actorId ??
    (config.authoritativeInteractingObject
      ? owner
      : config.getRequester?.(request, interactingObject, interactionTarget));
  if (requester == null) {
    return {
      verified: false,
      request,
      requestId: request.id,
      failure: { category: "invalid", type: "missingActor" },
    };
  }
  const interactingObjectId = getId(interactingObject);
  if (interactingObjectId == null) {
    return {
      verified: false,
      request,
      requestId: request.id,
      failure: { category: "invalid", type: "missingInstrumentId" },
    };
  }
  const interactionTargetId = getId(interactionTarget);
  if (interactionTargetId == null) {
    return {
      verified: false,
      request,
      requestId: request.id,
      failure: { category: "invalid", type: "missingObjectId" },
    };
  }
  const validation = config.validateRequest(
    request,
    interactingObject,
    interactionTarget,
    requester,
    options,
  );
  if (validation != null) {
    return {
      verified: false,
      request,
      requestId: request.id,
      failure: validation.type === "requesterMismatch"
        ? {
          category: "unauthorized",
          type: validation.type,
          expected: validation.expected,
          actual: validation.actual,
        }
        : {
          category: "invalid",
          type: validation.type,
          expected: validation.expected,
          actual: validation.actual,
        },
    };
  }
  return {
    verified: true,
    request,
    requestId: request.id,
    requester,
    interactingObject,
    interactingObjectId,
    interactionTarget,
    interactionTargetId,
  };
}

async function verifyAuthorization<
  TRequest extends Activity,
  TAuthorization extends ASObject,
  TInteracting extends ASObject,
  TTarget extends ASObject,
  TImpoliteSource extends ASObject,
  TRequestValidationOptions extends object,
  TContextData,
>(
  context: Context<TContextData>,
  options: InteractionAuthorizationVerificationOptions<
    TContextData,
    TAuthorization,
    TInteracting,
    TTarget
  >,
  config: ControlConfig<
    TRequest,
    TAuthorization,
    TInteracting,
    TTarget,
    TImpoliteSource,
    TRequestValidationOptions
  >,
): Promise<InteractionAuthorizationVerification<TAuthorization>> {
  const authorizationUrl = options.authorization instanceof URL
    ? options.authorization
    : null;
  const embeddedAuthorization = authorizationUrl == null;
  const expectedAuthorizationId = options.authorizationId ?? authorizationUrl;
  // An off-origin authorization is acceptable only if the caller vouches for
  // its authenticity:
  const checkOrigin = !options.allowOffOrigin ||
    options.verifyAuthenticity == null;
  const expectedAttribution = options.attributedTo ??
    (!(options.interactionTarget instanceof URL)
      ? config.getSelfActor(options.interactionTarget)
      : null);
  if (
    authorizationUrl != null && options.authorizationId != null &&
    !idsEqual(authorizationUrl, options.authorizationId)
  ) {
    return {
      verified: false,
      authorizationId: authorizationUrl,
      failure: {
        category: "unauthorized",
        type: "idMismatch",
        expected: options.authorizationId,
        actual: authorizationUrl,
      },
    };
  }
  if (authorizationUrl != null && expectedAttribution == null) {
    return {
      verified: false,
      authorizationId: authorizationUrl,
      failure: { category: "unauthorized", type: "missingAttribution" },
    };
  }
  if (checkOrigin && authorizationUrl != null && expectedAttribution != null) {
    const expectedOrigin = getAuthorizationOrigin(expectedAttribution);
    const actualOrigin = getAuthorizationOrigin(authorizationUrl);
    if (
      expectedOrigin === "null" ||
      actualOrigin === "null" ||
      expectedOrigin !== actualOrigin
    ) {
      return {
        verified: false,
        authorizationId: authorizationUrl,
        failure: {
          category: "unauthorized",
          type: "originMismatch",
          expectedOrigin,
          actualOrigin,
        },
      };
    }
  }
  const documentLoader = options.documentLoader ?? context.documentLoader;
  const authorizationResult = await materialize(
    options.authorization,
    config.authorizationClass,
    documentLoader,
    options.contextLoader ?? documentLoader,
  );
  if (!authorizationResult.ok) {
    return { verified: false, failure: authorizationResult.failure };
  }
  const authorization = authorizationResult.object;
  if (!(authorization instanceof config.authorizationClass)) {
    return {
      verified: false,
      authorization,
      authorizationId: authorization.id ?? undefined,
      failure: {
        category: "unauthorized",
        type: "wrongType",
        expectedType: config.authorizationClass.typeId,
        actualTypes: [getTypeId(authorization)],
      },
    };
  }
  if (authorization.id == null) {
    return {
      verified: false,
      authorization,
      failure: { category: "unauthorized", type: "missingId" },
    };
  }
  if (
    expectedAuthorizationId != null &&
    !idsEqual(authorization.id, expectedAuthorizationId)
  ) {
    return {
      verified: false,
      authorization,
      authorizationId: authorization.id,
      failure: {
        category: "unauthorized",
        type: "idMismatch",
        expected: expectedAuthorizationId,
        actual: authorization.id,
      },
    };
  }
  const revocation = await options.getRevocation?.(authorization.id, context);
  if (revocation != null) {
    return {
      verified: false,
      authorization,
      authorizationId: authorization.id,
      failure: { category: "revoked", type: "deleted", ...revocation },
    };
  }
  const interactingObjectId = getId(options.interactingObject);
  if (interactingObjectId == null) {
    return {
      verified: false,
      authorization,
      authorizationId: authorization.id,
      failure: { category: "unauthorized", type: "missingObjectId" },
    };
  }
  const interactionTargetId = getId(options.interactionTarget);
  if (interactionTargetId == null) {
    return {
      verified: false,
      authorization,
      authorizationId: authorization.id,
      failure: { category: "unauthorized", type: "missingTargetId" },
    };
  }
  const actualInteractingId = (
    authorization as ASObject & { readonly interactingObjectId?: URL | null }
  ).interactingObjectId;
  if (!idsEqual(actualInteractingId, interactingObjectId)) {
    return {
      verified: false,
      authorization,
      authorizationId: authorization.id,
      failure: {
        category: "unauthorized",
        type: "objectMismatch",
        expected: interactingObjectId,
        actual: actualInteractingId ?? undefined,
      },
    };
  }
  const actualTargetId = (
    authorization as ASObject & { readonly interactionTargetId?: URL | null }
  ).interactionTargetId;
  if (!idsEqual(actualTargetId, interactionTargetId)) {
    return {
      verified: false,
      authorization,
      authorizationId: authorization.id,
      failure: {
        category: "unauthorized",
        type: "targetMismatch",
        expected: interactionTargetId,
        actual: actualTargetId ?? undefined,
      },
    };
  }
  if (expectedAttribution == null) {
    return {
      verified: false,
      authorization,
      authorizationId: authorization.id,
      failure: { category: "unauthorized", type: "missingAttribution" },
    };
  }
  const attributionRequired = config.authorizationAttribution !== "optional";
  if (
    attributionRequired &&
    !idsEqual(authorization.attributionId, expectedAttribution)
  ) {
    return {
      verified: false,
      authorization,
      authorizationId: authorization.id,
      failure: {
        category: "unauthorized",
        type: "attributionMismatch",
        expected: expectedAttribution,
        actual: authorization.attributionId ?? undefined,
      },
    };
  }
  if (
    authorization.attributionId != null &&
    !idsEqual(authorization.attributionId, expectedAttribution)
  ) {
    return {
      verified: false,
      authorization,
      authorizationId: authorization.id,
      failure: {
        category: "unauthorized",
        type: "attributionMismatch",
        expected: expectedAttribution,
        actual: authorization.attributionId,
      },
    };
  }
  const expectedOrigin = getAuthorizationOrigin(expectedAttribution);
  const actualOrigin = getAuthorizationOrigin(authorization.id);
  if (
    checkOrigin && (
      expectedOrigin === "null" ||
      actualOrigin === "null" ||
      expectedOrigin !== actualOrigin
    )
  ) {
    return {
      verified: false,
      authorization,
      authorizationId: authorization.id,
      failure: {
        category: "unauthorized",
        type: "originMismatch",
        expectedOrigin,
        actualOrigin,
      },
    };
  }
  if (embeddedAuthorization && options.verifyAuthenticity == null) {
    return {
      verified: false,
      authorization,
      authorizationId: authorization.id,
      failure: {
        category: "unauthorized",
        type: "notAuthentic",
        detail: "Embedded authorizations require authenticity verification.",
      },
    };
  }
  if (options.verifyAuthenticity != null) {
    let authentic: boolean;
    try {
      authentic = await options.verifyAuthenticity(authorization, context);
    } catch (cause) {
      return {
        verified: false,
        authorization,
        authorizationId: authorization.id,
        failure: { category: "unauthorized", type: "notAuthentic", cause },
      };
    }
    if (!authentic) {
      return {
        verified: false,
        authorization,
        authorizationId: authorization.id,
        failure: { category: "unauthorized", type: "notAuthentic" },
      };
    }
  }
  return { verified: true, authorization, authorizationId: authorization.id };
}

/**
 * Dereferences a field of the request, such as its `object` or `instrument`.
 * Returns `null` if the request has no such field at all.
 */
async function dereferenceField<TRequest extends Activity, T>(
  request: TRequest,
  reference: URL | null,
  dereference: (
    request: TRequest,
    options: DereferenceOptions,
  ) => Promise<T | null>,
  documentLoader: DocumentLoader | undefined,
  contextLoader: DocumentLoader | undefined,
): Promise<
  | { readonly ok: true; readonly value: T | null }
  | { readonly ok: false; readonly failure: UnverifiableFailure }
> {
  const tracker = trackLoaders(documentLoader, contextLoader);
  try {
    const value = await dereference(request, {
      documentLoader: tracker.documentLoader,
      contextLoader: tracker.contextLoader,
      suppressError: false,
    });
    if (value != null || reference == null) return { ok: true, value };
    // Fetch failures throw, so a null result for an existing reference means
    // the dereferenced document was rejected, e.g., for its origin:
    return { ok: false, failure: notDereferenceable(reference) };
  } catch (error) {
    return { ok: false, failure: classifyFailure(error, tracker) };
  } finally {
    tracker.release();
  }
}

/**
 * The interpretation of a request that authorization may rely on: its
 * expanded form, and the base URL it was decoded with.
 */
interface RequestEvidence {
  readonly expanded: readonly unknown[];
  readonly baseUrl: URL | null;
}

async function materialize<T extends ASObject>(
  value: T | URL,
  constructor: VocabConstructor<T>,
  documentLoader: DocumentLoader | undefined,
  contextLoader: DocumentLoader | undefined,
): Promise<
  | {
    readonly ok: true;
    readonly object: T;
    /**
     * The fetched request's interpretation, if the request was fetched from
     * the web origin that speaks for it and its actors.
     */
    readonly evidence: RequestEvidence | null;
  }
  | { readonly ok: false; readonly failure: UnverifiableFailure }
> {
  if (!(value instanceof URL)) {
    return { ok: true, object: value, evidence: null };
  }
  if (documentLoader == null) {
    return { ok: false, failure: notDereferenceable(value) };
  }
  const tracker = trackLoaders(documentLoader, contextLoader);
  try {
    const remoteDocument = await tracker.documentLoader!(value.href);
    // The request is parsed and expanded with the same context documents:
    const memoizedContextLoader = memoizeLoader(
      tracker.contextLoader ?? getDocumentLoader(),
    );
    const object = await constructor.fromJsonLd(remoteDocument.document, {
      documentLoader: tracker.documentLoader,
      contextLoader: memoizedContextLoader,
      baseUrl: value,
    });
    let evidence: RequestEvidence | null = null;
    let documentUrl: URL | null;
    try {
      documentUrl = parseIri(remoteDocument.documentUrl);
    } catch {
      documentUrl = null;
    }
    // Only the web origin of an ordinary ID speaks for the request and its
    // actors; FEP-ef61 portable objects are never authenticated by where
    // they were fetched from:
    if (
      documentUrl != null && !isPortableClaim(value) &&
      !isPortableClaim(documentUrl) && !hasCredentials(documentUrl) &&
      documentUrl.origin === value.origin
    ) {
      const expanded = await jsonld.expand(
        // deno-lint-ignore no-explicit-any
        remoteDocument.document as any,
        // deno-lint-ignore no-explicit-any
        { documentLoader: memoizedContextLoader } as any,
      );
      const root = getRootNode(expanded);
      const rootId = root == null ? null : resolveNodeId(root, value);
      const actors = root == null
        ? []
        : getPropertyValues(root, AS_ACTOR).map((actor) =>
          resolveNodeId(actor, value)
        );
      if (
        rootId != null && !isPortableClaim(rootId) &&
        rootId.href === value.href &&
        actors.every((actor) =>
          actor != null && !isPortableClaim(actor) &&
          actor.origin === value.origin
        )
      ) {
        evidence = { expanded, baseUrl: value };
      }
    }
    return { ok: true, object, evidence };
  } catch (error) {
    return { ok: false, failure: classifyFailure(error, tracker) };
  } finally {
    tracker.release();
  }
}

function memoizeLoader(loader: DocumentLoader): DocumentLoader {
  const cache = new Map<string, ReturnType<DocumentLoader>>();
  return async (url, options) => {
    let promise = cache.get(url);
    if (promise == null) {
      promise = loader(url, options);
      cache.set(url, promise);
    }
    return structuredClone(await promise);
  };
}

const AS_ACTOR = "https://www.w3.org/ns/activitystreams#actor";
const AS_OBJECT = "https://www.w3.org/ns/activitystreams#object";
const AS_INSTRUMENT = "https://www.w3.org/ns/activitystreams#instrument";

/**
 * Checks that a request has exactly the type, ID, actors, `object`, and
 * `instrument` that its authenticated interpretation has, counting every
 * value, including those typed parsing drops.
 * @returns The failure, or `null` if the request is bound to the evidence.
 */
function bindRequest(
  request: Activity,
  evidence: RequestEvidence | null,
  typeId: URL,
): InteractionRequestVerificationFailure | null {
  if (evidence == null) {
    // Nothing tells which values typed parsing dropped, so only an actor that
    // Fedify authenticated before parsing makes the request acceptable:
    if (request.actorIds.length < 1) {
      return { category: "invalid", type: "missingActor" };
    }
    if (
      request.objectIds.length !== 1 ||
      !sameId(request.objectIds[0], request.objectId)
    ) {
      return {
        category: "invalid",
        type: "ambiguous-request",
        property: "object",
      };
    }
    if (
      request.instrumentIds.length !== 1 ||
      !sameId(request.instrumentIds[0], request.instrumentId)
    ) {
      return {
        category: "invalid",
        type: "ambiguous-request",
        property: "instrument",
      };
    }
    return null;
  }
  const root = getRootNode(evidence.expanded);
  if (root == null) {
    return { category: "invalid", type: "ambiguous-request", property: "id" };
  }
  if (!hasType(root, typeId.href)) {
    return { category: "invalid", type: "ambiguous-request", property: "type" };
  }
  const rootId = resolveNodeId(root, evidence.baseUrl);
  if (rootId == null || !sameId(rootId, request.id)) {
    return { category: "invalid", type: "ambiguous-request", property: "id" };
  }
  // The decoder resolves references against the given base URL, or against
  // the object's own ID:
  const base = evidence.baseUrl ?? rootId;
  const actors = getPropertyValues(root, AS_ACTOR);
  if (
    actors.length !== request.actorIds.length ||
    !actors.every((actor, i) =>
      sameId(resolveNodeId(actor, base), request.actorIds[i])
    )
  ) {
    return {
      category: "invalid",
      type: "ambiguous-request",
      property: "actor",
    };
  }
  for (
    const [iri, property, missing, id] of [
      [AS_OBJECT, "object", "missingObject", request.objectId],
      [AS_INSTRUMENT, "instrument", "missingInstrument", request.instrumentId],
    ] as const
  ) {
    const values = getPropertyValues(root, iri);
    if (values.length < 1) return { category: "invalid", type: missing };
    if (values.length !== 1 || !sameId(resolveNodeId(values[0], base), id)) {
      return { category: "invalid", type: "ambiguous-request", property };
    }
  }
  return null;
}

async function evaluatePolicy<
  TRequest extends Activity,
  TAuthorization extends ASObject,
  TInteracting extends ASObject,
  TTarget extends ASObject,
  TImpoliteSource extends ASObject,
  TRequestValidationOptions extends object,
  TContextData,
>(
  context: Context<TContextData>,
  options: InteractionPolicyEvaluationOptions<TContextData, TTarget>,
  config: ControlConfig<
    TRequest,
    TAuthorization,
    TInteracting,
    TTarget,
    TImpoliteSource,
    TRequestValidationOptions
  >,
): Promise<InteractionPolicyDecision> {
  const selfActor = config.getSelfActor(options.subject);
  if (idsEqual(selfActor, options.requester)) {
    return { result: "automatic", reason: { type: "self" } };
  }
  const implicitAutomatic = await matchImplicitAutomaticActors(
    options.subject,
    options.requester,
    {
      documentLoader: options.documentLoader ?? context.documentLoader,
      suppressError: true,
    },
    config,
  );
  if (implicitAutomatic != null) {
    return { result: "automatic", reason: implicitAutomatic };
  }
  const policy = options.subject.interactionPolicy;
  let rule = getApprovalRule(
    policy?.[config.policyProperty] as InteractionRule | null | undefined,
  );
  if (rule == null) {
    rule = getApprovalRule(options.fallbackRule);
    if (rule == null) {
      return policy == null
        ? missingPolicyDecision(config)
        : missingRuleDecision(config);
    }
  }
  const { automaticApprovals, manualApprovals } = rule;
  const matchOptions = {
    requester: options.requester,
    context,
    matchesApprovalCollection: options.matchesApprovalCollection,
    throwCollectionErrors: options.collectionErrors === "throw",
  };
  if (options.precedence === "automatic") {
    const automatic = await matchRule(automaticApprovals, matchOptions);
    if (automatic?.result === "matched") {
      return { result: "automatic", reason: automatic.reason };
    } else if (automatic?.result === "unverifiableCollection") {
      return deniedUnverifiableCollection(automatic);
    }
    const manual = await matchRule(manualApprovals, matchOptions);
    if (manual?.result === "matched") {
      return { result: "manual", reason: manual.reason };
    } else if (manual?.result === "unverifiableCollection") {
      return deniedUnverifiableCollection(manual);
    }
    return { result: "denied", reason: { type: "noMatch" } };
  }
  const automatic = await matchRule(automaticApprovals, {
    ...matchOptions,
    actorOnly: true,
  });
  if (automatic?.result === "matched") {
    return { result: "automatic", reason: automatic.reason };
  }
  const manual = await matchRule(manualApprovals, {
    ...matchOptions,
    actorOnly: true,
  });
  if (manual?.result === "matched") {
    return { result: "manual", reason: manual.reason };
  }
  const broadAutomatic = await matchRule(automaticApprovals, matchOptions);
  const unverifiableAutomatic = broadAutomatic?.result ===
      "unverifiableCollection"
    ? broadAutomatic
    : null;
  if (broadAutomatic?.result === "matched") {
    return { result: "automatic", reason: broadAutomatic.reason };
  }
  const broadManual = await matchRule(manualApprovals, matchOptions);
  if (broadManual?.result === "unverifiableCollection") {
    return deniedUnverifiableCollection(broadManual);
  } else if (broadManual?.result === "matched") {
    return { result: "manual", reason: broadManual.reason };
  }
  if (unverifiableAutomatic != null) {
    return deniedUnverifiableCollection(unverifiableAutomatic);
  }
  return { result: "denied", reason: { type: "noMatch" } };
}

function getApprovalRule(
  rule: InteractionRule | null | undefined,
): {
  readonly automaticApprovals: readonly URL[];
  readonly manualApprovals: readonly URL[];
} | null {
  if (rule == null) return null;
  const automaticApprovals = rule.automaticApprovals ?? [];
  const manualApprovals = rule.manualApprovals ?? [];
  if (automaticApprovals.length < 1 && manualApprovals.length < 1) {
    return null;
  }
  return { automaticApprovals, manualApprovals };
}

async function matchImplicitAutomaticActors<
  TRequest extends Activity,
  TAuthorization extends ASObject,
  TInteracting extends ASObject,
  TTarget extends ASObject,
  TImpoliteSource extends ASObject,
  TRequestValidationOptions extends object,
>(
  subject: TTarget,
  requester: URL,
  options: DereferenceOptions,
  config: ControlConfig<
    TRequest,
    TAuthorization,
    TInteracting,
    TTarget,
    TImpoliteSource,
    TRequestValidationOptions
  >,
): Promise<InteractionPolicyMatchReason | null> {
  if (config.getImplicitAutomaticActors == null) return null;
  for await (
    const actor of config.getImplicitAutomaticActors(subject, options)
  ) {
    if (idsEqual(actor, requester)) {
      return { type: "actor", actor };
    }
  }
  return null;
}

function missingPolicyDecision<
  TRequest extends Activity,
  TAuthorization extends ASObject,
  TInteracting extends ASObject,
  TTarget extends ASObject,
  TImpoliteSource extends ASObject,
  TRequestValidationOptions extends object,
>(
  config: ControlConfig<
    TRequest,
    TAuthorization,
    TInteracting,
    TTarget,
    TImpoliteSource,
    TRequestValidationOptions
  >,
): InteractionPolicyDecision {
  if (config.defaultMissingPolicy === "automatic") {
    return {
      result: "automatic",
      reason: { type: "default", default: "publicAutomatic" },
    };
  }
  return { result: "denied", reason: { type: "missingPolicy" } };
}

function missingRuleDecision<
  TRequest extends Activity,
  TAuthorization extends ASObject,
  TInteracting extends ASObject,
  TTarget extends ASObject,
  TImpoliteSource extends ASObject,
  TRequestValidationOptions extends object,
>(
  config: ControlConfig<
    TRequest,
    TAuthorization,
    TInteracting,
    TTarget,
    TImpoliteSource,
    TRequestValidationOptions
  >,
): InteractionPolicyDecision {
  if (config.defaultMissingPolicy === "automatic") {
    return {
      result: "automatic",
      reason: { type: "default", default: "publicAutomatic" },
    };
  }
  return { result: "denied", reason: { type: "missingRule" } };
}

async function matchRule<TContextData>(
  entries: readonly URL[],
  options: {
    readonly requester: URL;
    readonly context: Context<TContextData>;
    readonly matchesApprovalCollection?: MatchesApprovalCollection<
      TContextData
    >;
    readonly throwCollectionErrors: boolean;
    readonly actorOnly?: boolean;
  },
): Promise<RuleMatchResult> {
  const { requester, matchesApprovalCollection } = options;
  for (const entry of entries) {
    if (entry.href === requester.href) {
      return { result: "matched", reason: { type: "actor", actor: entry } };
    }
  }
  if (options.actorOnly) return null;
  for (const entry of entries) {
    if (entry.href === PUBLIC_COLLECTION.href) {
      return { result: "matched", reason: { type: "public" } };
    }
  }
  if (matchesApprovalCollection != null) {
    let unverifiable:
      | { readonly collection: URL; readonly cause: unknown }
      | null = null;
    for (const entry of entries) {
      if (
        entry.href === PUBLIC_COLLECTION.href || entry.href === requester.href
      ) {
        continue;
      }
      let matched;
      try {
        matched = await matchesApprovalCollection(
          entry,
          requester,
          options.context,
        );
      } catch (cause) {
        if (options.throwCollectionErrors) throw cause;
        unverifiable ??= { collection: entry, cause };
        continue;
      }
      if (matched) {
        return {
          result: "matched",
          reason: { type: "collection", collection: entry },
        };
      }
    }
    if (unverifiable != null) {
      return { result: "unverifiableCollection", ...unverifiable };
    }
  }
  return null;
}

function deniedUnverifiableCollection(
  failure: { readonly collection: URL; readonly cause: unknown },
): InteractionPolicyDecision {
  return {
    result: "denied",
    reason: {
      type: "unverifiableCollection",
      collection: failure.collection,
      cause: failure.cause,
    },
  };
}

function getAuthorizationOrigin(id: URL): string {
  try {
    return getFe34Origin(id);
  } catch {
    return id.origin;
  }
}

function createAccept<
  TRequest extends Activity,
  TAuthorization extends ASObject,
  TInteracting extends ASObject,
  TTarget extends ASObject,
>(
  options: InteractionAcceptOptions<
    TRequest,
    TAuthorization,
    TInteracting,
    TTarget
  >,
): Accept {
  if (options.mode === "polite") {
    return new Accept({
      id: options.id,
      actor: options.actor,
      object: options.request,
      result: options.authorization,
      ...audience(options),
    });
  }
  return new Accept({
    id: options.id,
    actor: options.actor,
    object: getRequiredId(options.interactingObject, "interactingObject"),
    target: getRequiredId(options.interactionTarget, "interactionTarget"),
    result: getRequiredId(options.authorization, "authorization"),
    ...audience(options),
  });
}

function createReject<
  TRequest extends Activity,
  TInteracting extends ASObject,
  TTarget extends ASObject,
>(
  options: InteractionRejectOptions<TRequest, TInteracting, TTarget>,
): Reject {
  if (options.mode === "polite") {
    return new Reject({
      id: options.id,
      actor: options.actor,
      object: options.request,
      ...audience(options),
    });
  }
  return new Reject({
    id: options.id,
    actor: options.actor,
    object: getRequiredId(options.interactingObject, "interactingObject"),
    target: getRequiredId(options.interactionTarget, "interactionTarget"),
    ...audience(options),
  });
}

export function recognized<
  TInteracting extends ASObject,
  TTarget extends ASObject,
  TImpoliteSource extends ASObject,
  TRequestValidationOptions extends object,
>(
  values: {
    readonly requester: URL | null;
    readonly interactingObject: TInteracting;
    readonly interactionTarget?: TTarget;
    readonly interactionTargetId: URL | null;
    readonly source: TImpoliteSource;
    readonly evidence: ImpoliteInteractionEvidence;
  },
):
  | RecognizedImpoliteInteraction<
    TInteracting,
    TTarget,
    TImpoliteSource
  >
  | null {
  if (values.requester == null || values.interactionTargetId == null) {
    return null;
  }
  const interactingObjectId = values.interactingObject.id;
  if (interactingObjectId == null) return null;
  return {
    requester: values.requester,
    interactingObject: values.interactingObject,
    interactingObjectId,
    interactionTarget: values.interactionTarget,
    interactionTargetId: values.interactionTargetId,
    source: values.source,
    evidence: values.evidence,
  };
}
