import type { Context } from "@fedify/fedify";
import {
  type DocumentLoader,
  FetchError,
  getFe34Origin,
  isTransientFetchError,
  parseIri,
} from "@fedify/vocab-runtime";
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
  const interactingResult = options.resolvedInteractingObject != null &&
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

type UnverifiableFailure = Extract<
  InteractionRequestVerificationFailure,
  {
    readonly category: "unverifiable";
    readonly type: "notDereferenceable" | "invalidJsonLd";
  }
>;

interface LoaderTracker {
  readonly documentLoader: DocumentLoader | undefined;
  readonly contextLoader: DocumentLoader | undefined;
  readonly records: ReadonlyMap<unknown, string>;
  readonly release: () => void;
}

/**
 * Wraps the loaders for a single dereferencing operation so that errors they
 * throw can be told apart from other errors afterwards.  Parsed objects keep
 * the loaders they were given, so the wrappers stop recording and pass calls
 * through once the operation is released.
 */
function trackLoaders(
  documentLoader: DocumentLoader | undefined,
  contextLoader: DocumentLoader | undefined,
): LoaderTracker {
  const records = new Map<unknown, string>();
  let released = false;
  const wrap = (
    loader: DocumentLoader | undefined,
  ): DocumentLoader | undefined => {
    if (loader == null) return undefined;
    return async (url, options) => {
      if (released) return await loader(url, options);
      let remoteDocument;
      try {
        remoteDocument = await loader(url, options);
      } catch (error) {
        if (!released) records.set(error, url);
        throw error;
      }
      if (remoteDocument == null) {
        const error = new FetchError(
          url,
          "The document loader returned no document.",
        );
        if (!released) records.set(error, url);
        throw error;
      }
      return remoteDocument;
    };
  };
  const wrappedDocumentLoader = wrap(documentLoader);
  return {
    documentLoader: wrappedDocumentLoader,
    contextLoader: contextLoader === documentLoader
      ? wrappedDocumentLoader
      : wrap(contextLoader),
    records,
    release: () => {
      released = true;
      records.clear();
    },
  };
}

const MAX_CAUSE_DEPTH = 8;

function collectCauses(
  error: unknown,
  causes: unknown[] = [],
  depth = 0,
): unknown[] {
  if (depth > MAX_CAUSE_DEPTH || causes.includes(error)) return causes;
  causes.push(error);
  if (typeof error !== "object" || error == null) return causes;
  if (error instanceof AggregateError) {
    for (const e of error.errors) collectCauses(e, causes, depth + 1);
  }
  // Loaders may throw anything, even null, so check for the properties
  // rather than their values:
  if ("cause" in error) collectCauses(error.cause, causes, depth + 1);
  // jsonld.js reports a failed remote context load as `details.cause`:
  const details = (error as { readonly details?: unknown }).details;
  if (typeof details === "object" && details != null && "cause" in details) {
    collectCauses(details.cause, causes, depth + 1);
  }
  return causes;
}

/**
 * Classifies the error thrown by a dereferencing operation.  It is a fetch
 * failure only if a loader error is among its causes; errors that loaders
 * threw during attempts the operation recovered from are ignored.
 */
function classifyFailure(
  error: unknown,
  tracker: LoaderTracker,
): UnverifiableFailure {
  const loaderErrors = collectCauses(error).filter((e) =>
    tracker.records.has(e)
  );
  // Loaders may throw anything, even null, so look up indices, not values:
  const transientIndex = loaderErrors.findIndex(isTransientFetchError);
  const selected = loaderErrors[transientIndex < 0 ? 0 : transientIndex];
  const url = loaderErrors.length < 1
    ? null
    : getFailedUrl(selected, tracker.records.get(selected)!);
  // A document referring to a URL that cannot even be parsed is malformed:
  if (url == null) {
    return {
      category: "unverifiable",
      type: "invalidJsonLd",
      cause: error,
      transient: false,
    };
  }
  return {
    category: "unverifiable",
    type: "notDereferenceable",
    url,
    cause: loaderErrors.length === 1 ? selected : error,
    transient: transientIndex >= 0,
  };
}

function getFailedUrl(error: unknown, requestedUrl: string): URL | null {
  const url = (error as { readonly url?: unknown } | null)?.url;
  if (url instanceof URL) return url;
  for (const candidate of [url, requestedUrl]) {
    if (typeof candidate !== "string") continue;
    try {
      return parseIri(candidate);
    } catch {
      continue;
    }
  }
  return null;
}

function notDereferenceable(url: URL): UnverifiableFailure {
  return {
    category: "unverifiable",
    type: "notDereferenceable",
    url,
    transient: false,
  };
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

async function materialize<T extends ASObject>(
  value: T | URL,
  constructor: VocabConstructor<T>,
  documentLoader: DocumentLoader | undefined,
  contextLoader: DocumentLoader | undefined,
): Promise<
  | { readonly ok: true; readonly object: T }
  | { readonly ok: false; readonly failure: UnverifiableFailure }
> {
  if (!(value instanceof URL)) return { ok: true, object: value };
  if (documentLoader == null) {
    return { ok: false, failure: notDereferenceable(value) };
  }
  const tracker = trackLoaders(documentLoader, contextLoader);
  try {
    const remoteDocument = await tracker.documentLoader!(value.href);
    return {
      ok: true,
      object: await constructor.fromJsonLd(remoteDocument.document, {
        documentLoader: tracker.documentLoader,
        contextLoader: tracker.contextLoader,
        baseUrl: value,
      }),
    };
  } catch (error) {
    return { ok: false, failure: classifyFailure(error, tracker) };
  } finally {
    tracker.release();
  }
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
