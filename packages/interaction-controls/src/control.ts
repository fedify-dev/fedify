import type { Context } from "@fedify/fedify";
import { type DocumentLoader, getFe34Origin } from "@fedify/vocab-runtime";
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
  InteractionRequestVerificationOptions,
  MatchesApprovalCollection,
  RecognizedImpoliteInteraction,
} from "./types.ts";

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
}

export interface DereferenceOptions {
  readonly documentLoader?: DocumentLoader;
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

export function createInteractionControl<
  TRequest extends Activity,
  TAuthorization extends ASObject,
  TInteracting extends ASObject,
  TTarget extends ASObject,
  TImpoliteSource extends ASObject,
>(
  config: ControlConfig<
    TRequest,
    TAuthorization,
    TInteracting,
    TTarget,
    TImpoliteSource
  >,
): InteractionControl<
  TRequest,
  TAuthorization,
  TInteracting,
  TTarget,
  TImpoliteSource
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
        object: getRequiredId(options.authorization, "authorization"),
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
    ...(to == null ? {} : to instanceof URL ? { to } : { tos: [...to] }),
    ...(cc == null ? {} : cc instanceof URL ? { cc } : { ccs: [...cc] }),
  };
}

export function getRequiredId(value: ASObject | URL, name: string): URL {
  if (value instanceof URL) return value;
  if (value.id == null) {
    throw new TypeError(`The ${name} must have an id.`);
  }
  return value.id;
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
  TContextData,
>(
  context: Context<TContextData>,
  options: InteractionRequestVerificationOptions<TRequest>,
  config: ControlConfig<
    TRequest,
    TAuthorization,
    TInteracting,
    TTarget,
    TImpoliteSource
  >,
): Promise<InteractionRequestVerification<TRequest, TInteracting, TTarget>> {
  const documentLoader = options.documentLoader ?? context.documentLoader;
  const expectedRequestId = options.request instanceof URL
    ? options.request
    : null;
  const requestResult = await materialize(
    options.request,
    config.requestClass,
    documentLoader,
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
  const dereferenceOptions = {
    documentLoader,
    suppressError: true,
  };
  const interactionTarget = await config.getInteractionTarget(
    request,
    dereferenceOptions,
  );
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
  const interactingObject = await config.getInteractingObject(
    request,
    dereferenceOptions,
  );
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
  const requester = request.actorId ??
    config.getRequester?.(request, interactingObject, interactionTarget);
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
    TImpoliteSource
  >,
): Promise<InteractionAuthorizationVerification<TAuthorization>> {
  const embeddedAuthorization = !(options.authorization instanceof URL);
  const expectedAuthorizationId = options.authorization instanceof URL
    ? options.authorization
    : null;
  const authorizationResult = await materialize(
    options.authorization,
    config.authorizationClass,
    options.documentLoader ?? context.documentLoader,
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
  const interactingObjectId = getRequiredId(
    options.interactingObject,
    "interactingObject",
  );
  const interactionTargetId = getRequiredId(
    options.interactionTarget,
    "interactionTarget",
  );
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
  const expectedAttribution = options.attributedTo ??
    (!(options.interactionTarget instanceof URL)
      ? config.getSelfActor(options.interactionTarget)
      : null);
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
    expectedOrigin === "null" ||
    actualOrigin === "null" ||
    expectedOrigin !== actualOrigin
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

async function materialize<T extends ASObject>(
  value: T | URL,
  constructor: VocabConstructor<T>,
  documentLoader: DocumentLoader | undefined,
): Promise<
  | { readonly ok: true; readonly object: T }
  | {
    readonly ok: false;
    readonly failure:
      | {
        readonly category: "unverifiable";
        readonly type: "notDereferenceable";
        readonly url: URL;
        readonly cause?: unknown;
      }
      | {
        readonly category: "unverifiable";
        readonly type: "invalidJsonLd";
        readonly cause?: unknown;
      };
  }
> {
  if (!(value instanceof URL)) return { ok: true, object: value };
  const loader = documentLoader;
  if (loader == null) {
    return {
      ok: false,
      failure: {
        category: "unverifiable",
        type: "notDereferenceable",
        url: value,
      },
    };
  }
  let remoteDocument;
  try {
    remoteDocument = await loader(value.href);
  } catch (cause) {
    return {
      ok: false,
      failure: {
        category: "unverifiable",
        type: "notDereferenceable",
        url: value,
        cause,
      },
    };
  }
  if (remoteDocument == null) {
    return {
      ok: false,
      failure: {
        category: "unverifiable",
        type: "notDereferenceable",
        url: value,
      },
    };
  }
  try {
    return {
      ok: true,
      object: await constructor.fromJsonLd(remoteDocument.document, {
        documentLoader: loader,
        baseUrl: value,
      }),
    };
  } catch (cause) {
    return {
      ok: false,
      failure: { category: "unverifiable", type: "invalidJsonLd", cause },
    };
  }
}

async function evaluatePolicy<
  TRequest extends Activity,
  TAuthorization extends ASObject,
  TInteracting extends ASObject,
  TTarget extends ASObject,
  TImpoliteSource extends ASObject,
  TContextData,
>(
  context: Context<TContextData>,
  options: InteractionPolicyEvaluationOptions<TContextData, TTarget>,
  config: ControlConfig<
    TRequest,
    TAuthorization,
    TInteracting,
    TTarget,
    TImpoliteSource
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
  if (policy == null) return missingPolicyDecision(config);
  const rule = policy[config.policyProperty] as InteractionRule | null;
  if (rule == null) return missingRuleDecision(config);
  const automaticApprovals = rule.automaticApprovals ?? [];
  const manualApprovals = rule.manualApprovals ?? [];
  const automatic = await matchRule(
    automaticApprovals,
    options.requester,
    context,
    options.matchesApprovalCollection,
    { actorOnly: true },
  );
  if (automatic != null) {
    return { result: "automatic", reason: automatic };
  }
  const manual = await matchRule(
    manualApprovals,
    options.requester,
    context,
    options.matchesApprovalCollection,
    { actorOnly: true },
  );
  if (manual != null) {
    return { result: "manual", reason: manual };
  }
  const broadAutomatic = await matchRule(
    automaticApprovals,
    options.requester,
    context,
    options.matchesApprovalCollection,
  );
  if (broadAutomatic != null) {
    return { result: "automatic", reason: broadAutomatic };
  }
  const broadManual = await matchRule(
    manualApprovals,
    options.requester,
    context,
    options.matchesApprovalCollection,
  );
  if (broadManual != null) {
    return { result: "manual", reason: broadManual };
  }
  const unknownCollection = firstUnverifiableCollection(
    [...automaticApprovals, ...manualApprovals],
    options.matchesApprovalCollection,
  );
  if (unknownCollection != null) {
    return {
      result: "denied",
      reason: { type: "unverifiableCollection", collection: unknownCollection },
    };
  }
  return { result: "denied", reason: { type: "noMatch" } };
}

async function matchImplicitAutomaticActors<
  TRequest extends Activity,
  TAuthorization extends ASObject,
  TInteracting extends ASObject,
  TTarget extends ASObject,
  TImpoliteSource extends ASObject,
>(
  subject: TTarget,
  requester: URL,
  options: DereferenceOptions,
  config: ControlConfig<
    TRequest,
    TAuthorization,
    TInteracting,
    TTarget,
    TImpoliteSource
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
>(
  config: ControlConfig<
    TRequest,
    TAuthorization,
    TInteracting,
    TTarget,
    TImpoliteSource
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
>(
  config: ControlConfig<
    TRequest,
    TAuthorization,
    TInteracting,
    TTarget,
    TImpoliteSource
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
  requester: URL,
  context: Context<TContextData>,
  matchesApprovalCollection:
    | MatchesApprovalCollection<TContextData>
    | undefined,
  options: { readonly actorOnly?: boolean } = {},
): Promise<InteractionPolicyMatchReason | null> {
  for (const entry of entries) {
    if (entry.href === requester.href) {
      return { type: "actor", actor: entry };
    }
  }
  if (options.actorOnly) return null;
  for (const entry of entries) {
    if (entry.href === PUBLIC_COLLECTION.href) {
      return { type: "public" };
    }
  }
  if (matchesApprovalCollection != null) {
    for (const entry of entries) {
      if (
        entry.href === PUBLIC_COLLECTION.href || entry.href === requester.href
      ) {
        continue;
      }
      if (await matchesApprovalCollection(entry, requester, context)) {
        return { type: "collection", collection: entry };
      }
    }
  }
  return null;
}

function getAuthorizationOrigin(id: URL): string {
  try {
    return getFe34Origin(id);
  } catch (error) {
    if (error instanceof TypeError) return id.origin;
    throw error;
  }
}

function firstUnverifiableCollection<TContextData>(
  entries: readonly URL[],
  matchesApprovalCollection:
    | MatchesApprovalCollection<TContextData>
    | undefined,
): URL | null {
  if (matchesApprovalCollection != null) return null;
  return entries.find((entry) => entry.href !== PUBLIC_COLLECTION.href) ?? null;
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
