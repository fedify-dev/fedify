import type { AcceptSignatureParameters } from "@fedify/fedify/sig";
import type { Recipient } from "@fedify/vocab";
import {
  Activity,
  Collection,
  CollectionPage,
  type CryptographicKey,
  getTypeId,
  Link,
  Object,
  OrderedCollection,
  OrderedCollectionPage,
  Tombstone,
} from "@fedify/vocab";
import type { DocumentLoader } from "@fedify/vocab-runtime";
import { getLogger } from "@logtape/logtape";
import type {
  MeterProvider,
  Span,
  SpanOptions,
  Tracer,
  TracerProvider,
} from "@opentelemetry/api";
import { SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import { uniq } from "es-toolkit";
import metadata from "../../deno.json" with { type: "json" };
import { formatAcceptSignature } from "../sig/accept.ts";
import {
  parseRfc9421SignatureInput,
  verifyRequestDetailed,
} from "../sig/http.ts";
import {
  compactJsonLd,
  detachSignature,
  getNormalizationContextLoader,
  hasSignature,
  InvalidContextReferenceError,
  isClearlyMalformedContextReference,
  isInvalidUrlTypeError,
  verifyCompactJsonLd,
  wrapContextLoaderForJsonLd,
} from "../sig/ld.ts";
import { doesActorOwnKey } from "../sig/owner.ts";
import { verifyObject } from "../sig/proof.ts";
import type {
  ActorDispatcher,
  AuthorizePredicate,
  CollectionCounter,
  CollectionCursor,
  CollectionDispatcher,
  CustomCollectionCounter,
  CustomCollectionCursor,
  CustomCollectionDispatcher,
  InboxErrorHandler,
  MediaUploaderCallback,
  ObjectAuthorizePredicate,
  ObjectDispatcher,
  OutboxListenerErrorHandler,
  UnverifiedActivityHandler,
} from "./callback.ts";
import type { PageItems } from "./collection.ts";
import type {
  Context,
  InboxContext,
  OutboxContext,
  RequestContext,
} from "./context.ts";
import type { ActivityListenerSet } from "./activity-listener.ts";
import type {
  ConstructorWithTypeId,
  IdempotencyKeyCallback,
  IdempotencyStrategy,
  InboxChallengePolicy,
} from "./federation.ts";
import { routeActivity } from "./inbox.ts";
import { KvKeyCache } from "./keycache.ts";
import type { KvKey, KvStore } from "./kv.ts";
import {
  type CollectionMetricAttributes,
  type CollectionMetricDispatcher,
  type CollectionMetricKind,
  type CollectionMetricResult,
  getDurationMs,
  getFederationMetrics,
  getRemoteHost,
  recordCollectionDispatchDuration,
  recordCollectionPageItems,
  recordCollectionRequest,
  recordCollectionTotalItems,
} from "./metrics.ts";
import type { MessageQueue } from "./mq.ts";
import { acceptsJsonLd } from "./negotiation.ts";
import { hasMalformedKnownTemporalLiteral } from "./temporal.ts";

export const rawInboxContextFactorySymbol: unique symbol = Symbol(
  "fedify.rawInboxContextFactory",
);

function isRemoteContextLoadingFailure(error: unknown): boolean {
  return error instanceof Error &&
    typeof (error as Error & { details?: { code?: unknown } }).details ===
      "object" &&
    (error as Error & { details?: { code?: unknown } }).details != null &&
    (error as Error & { details: { code?: unknown } }).details.code ===
      "loading remote context failed";
}

function isPermanentRemoteContextError(error: unknown): boolean {
  if (!(error instanceof Error) || error.name !== "jsonld.InvalidUrl") {
    return false;
  }
  const details = (error as Error & {
    details?: { code?: unknown; url?: unknown };
  }).details;
  if (details?.code === "invalid remote context") {
    return true;
  }
  return isRemoteContextLoadingFailure(error) &&
    typeof details?.url === "string" &&
    !URL.canParse(details.url) &&
    isClearlyMalformedContextReference(details.url);
}

function isInvalidJsonLdError(error: unknown): error is Error {
  if (!(error instanceof Error)) return false;
  const name = error.name;
  return name === "UnsafeJsonLdError" ||
    error instanceof InvalidContextReferenceError ||
    isPermanentRemoteContextError(error) ||
    (name === "jsonld.SyntaxError" &&
      !isRemoteContextLoadingFailure(error));
}

function isValidationTypeError(error: unknown): error is TypeError {
  return error instanceof TypeError &&
    (/^(Invalid JSON-LD:|Invalid type:|Unexpected type:|Invalid @id:)/
      .test(error.message) ||
      isInvalidUrlTypeError(error));
}

function isPermanentActivityParseError(error: unknown): error is Error {
  // jsonld.InvalidUrl is only treated as permanent for upstream
  // "invalid remote context" failures or for clearly malformed non-URL
  // context strings such as values containing whitespace/control characters.
  // Opaque or relative context ids may be valid for deployment-specific
  // loaders, so loading failures for other non-parseable ids stay
  // retryable/fallback-capable instead of being forced into the malformed
  // bucket.  jsonld.SyntaxError is similarly only permanent when it is local
  // to the payload rather than a remote-context loading failure.  Raw loader
  // TypeErrors for @context resolution are normalized earlier at the
  // context-loading layer, so any remaining invalid-URL TypeError here comes
  // from sender-controlled ActivityPub IRI fields and stays permanent.
  return isInvalidJsonLdError(error) || isValidationTypeError(error);
}

function hasHttpSignatureHeaders(request: Request): boolean {
  return request.headers.has("Signature") ||
    request.headers.has("Signature-Input");
}

function hasObjectIntegrityProof(json: unknown): boolean {
  return typeof json === "object" && json != null && "proof" in json;
}

/**
 * Parameters for handling an actor request.
 * @template TContextData The context data to pass to the context.
 */
export interface ActorHandlerParameters<TContextData> {
  identifier: string;
  context: RequestContext<TContextData>;
  actorDispatcher?: ActorDispatcher<TContextData>;
  authorizePredicate?: AuthorizePredicate<TContextData>;
  onUnauthorized(request: Request): Response | Promise<Response>;
  onNotFound(request: Request): Response | Promise<Response>;
}

/**
 * Handles an actor request.
 * @template TContextData The context data to pass to the context.
 * @param request The HTTP request.
 * @param parameters The parameters for handling the actor.
 * @returns A promise that resolves to an HTTP response.
 */
export async function handleActor<TContextData>(
  request: Request,
  {
    identifier,
    context,
    actorDispatcher,
    authorizePredicate,
    onNotFound,
    onUnauthorized,
  }: ActorHandlerParameters<TContextData>,
): Promise<Response> {
  const logger = getLogger(["fedify", "federation", "actor"]);
  if (actorDispatcher == null) {
    logger.debug("Actor dispatcher is not set.", { identifier });
    return await onNotFound(request);
  }
  const actor = await actorDispatcher(context, identifier);
  if (actor == null) {
    logger.debug("Actor {identifier} not found.", { identifier });
    return await onNotFound(request);
  }
  if (authorizePredicate != null) {
    if (!await authorizePredicate(context, identifier)) {
      return await onUnauthorized(request);
    }
  }
  if (actor instanceof Tombstone) {
    const jsonLd = await actor.toJsonLd(context);
    return new Response(JSON.stringify(jsonLd), {
      status: 410,
      headers: {
        "Content-Type": "application/activity+json",
        Vary: "Accept",
      },
    });
  }
  const jsonLd = await actor.toJsonLd(context);
  return new Response(JSON.stringify(jsonLd), {
    headers: {
      "Content-Type": "application/activity+json",
      Vary: "Accept",
    },
  });
}

/**
 * Parameters for handling an object request.
 * @template TContextData The context data to pass to the context.
 */
export interface ObjectHandlerParameters<TContextData> {
  values: Record<string, string>;
  context: RequestContext<TContextData>;
  objectDispatcher?: ObjectDispatcher<TContextData, Object, string>;
  authorizePredicate?: ObjectAuthorizePredicate<TContextData, string>;
  onUnauthorized(request: Request): Response | Promise<Response>;
  onNotFound(request: Request): Response | Promise<Response>;
}

/**
 * Handles an object request.
 * @template TContextData The context data to pass to the context.
 * @param request The HTTP request.
 * @param parameters The parameters for handling the object.
 * @returns A promise that resolves to an HTTP response.
 */
export async function handleObject<TContextData>(
  request: Request,
  {
    values,
    context,
    objectDispatcher,
    authorizePredicate,
    onNotFound,
    onUnauthorized,
  }: ObjectHandlerParameters<TContextData>,
): Promise<Response> {
  if (objectDispatcher == null) return await onNotFound(request);
  const object = await objectDispatcher(context, values);
  if (object == null) return await onNotFound(request);
  if (authorizePredicate != null) {
    if (!await authorizePredicate(context, values)) {
      return await onUnauthorized(request);
    }
  }
  const jsonLd = await object.toJsonLd(context);
  return new Response(JSON.stringify(jsonLd), {
    headers: {
      "Content-Type": "application/activity+json",
      Vary: "Accept",
    },
  });
}

/**
 * Callbacks for handling a collection.
 * @template TItem The type of items in the collection.
 * @template TContext The type of the context. {@link Context} or {@link RequestContext}.
 * @template TContextData The context data to pass to the `TContext`.
 * @template TFilter The type of the filter.
 */
export interface CollectionCallbacks<
  TItem,
  TContext extends Context<TContextData>,
  TContextData,
  TFilter,
> {
  /**
   * A callback that dispatches a collection.
   */
  dispatcher: CollectionDispatcher<TItem, TContext, TContextData, TFilter>;

  /**
   * A callback that counts the number of items in a collection.
   */
  counter?: CollectionCounter<TContextData, TFilter>;

  /**
   * A callback that returns the first cursor for a collection.
   */
  firstCursor?: CollectionCursor<TContext, TContextData, TFilter>;

  /**
   * A callback that returns the last cursor for a collection.
   */
  lastCursor?: CollectionCursor<TContext, TContextData, TFilter>;

  /**
   * A callback that determines if a request is authorized to access the collection.
   */
  authorizePredicate?: AuthorizePredicate<TContextData>;
}

/**
 * Parameters for handling a collection request.
 * @template TItem The type of items in the collection.
 * @template TContext The type of the context, extending {@link RequestContext}.
 * @template TContextData The context data to pass to the `TContext`.
 * @template TFilter The type of the filter.
 */
export interface CollectionHandlerParameters<
  TItem,
  TContext extends RequestContext<TContextData>,
  TContextData,
  TFilter,
> {
  name: string;
  identifier: string;
  uriGetter: (handle: string) => URL;
  filter?: TFilter;
  filterPredicate?: (item: TItem) => boolean;
  context: TContext;
  collectionCallbacks?: CollectionCallbacks<
    TItem,
    TContext,
    TContextData,
    TFilter
  >;
  tracerProvider?: TracerProvider;
  /**
   * The meter provider for recording collection metrics.
   * @since 2.3.0
   */
  meterProvider?: MeterProvider;
  onUnauthorized(request: Request): Response | Promise<Response>;
  onNotFound(request: Request): Response | Promise<Response>;
}

type CollectionMetricBase = Pick<
  CollectionMetricAttributes,
  "kind" | "page" | "dispatcher"
>;

const BUILT_IN_COLLECTION_METRIC_KINDS = new Set<string>([
  "inbox",
  "outbox",
  "following",
  "followers",
  "liked",
  "featured",
  "featured_tags",
]);

function getCollectionMetricKind(name: string): CollectionMetricKind {
  const normalized = name.trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/\s+/g, "_");
  return BUILT_IN_COLLECTION_METRIC_KINDS.has(normalized)
    ? normalized as CollectionMetricKind
    : "custom";
}

function collectionAttributes(
  base: CollectionMetricBase,
  result: CollectionMetricResult,
  response?: Response,
): CollectionMetricAttributes {
  return {
    ...base,
    result,
    ...(response == null ? {} : { statusCode: response.status }),
  };
}

function recordCollectionMetrics(
  meterProvider: MeterProvider | undefined,
  base: CollectionMetricBase,
  result: CollectionMetricResult,
  options: {
    response?: Response;
    dispatchDurationMs?: number;
    itemCount?: number;
    totalItems?: number;
  } = {},
): void {
  const attrs = collectionAttributes(base, result, options.response);
  recordCollectionRequest(meterProvider, attrs);
  if (options.dispatchDurationMs != null) {
    recordCollectionDispatchDuration(
      meterProvider,
      options.dispatchDurationMs,
      attrs,
    );
  }
  if (options.itemCount != null) {
    recordCollectionPageItems(meterProvider, options.itemCount, attrs);
  }
  if (options.totalItems != null) {
    recordCollectionTotalItems(meterProvider, options.totalItems, attrs);
  }
}

/**
 * Handles a collection request.
 * @template TItem The type of items in the collection.
 * @template TContext The type of the context, extending {@link RequestContext}.
 * @template TContextData The context data to pass to the `TContext`.
 * @template TFilter The type of the filter.
 * @param request The HTTP request.
 * @param parameters The parameters for handling the collection.
 * @returns A promise that resolves to an HTTP response.
 */
export async function handleCollection<
  TItem extends URL | Object | Link | Recipient,
  TContext extends RequestContext<TContextData>,
  TContextData,
  TFilter,
>(
  request: Request,
  {
    name,
    identifier,
    uriGetter,
    filter,
    filterPredicate,
    context,
    collectionCallbacks,
    tracerProvider,
    meterProvider,
    onUnauthorized,
    onNotFound,
  }: CollectionHandlerParameters<TItem, TContext, TContextData, TFilter>,
): Promise<Response> {
  const spanName = name.trim().replace(/\s+/g, "_");
  tracerProvider = tracerProvider ?? trace.getTracerProvider();
  const tracer = tracerProvider.getTracer(metadata.name, metadata.version);
  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor");
  const metricBase = {
    kind: getCollectionMetricKind(name),
    page: cursor != null,
    dispatcher: "built_in" as CollectionMetricDispatcher,
  };
  let dispatchDurationMs: number | undefined;
  let itemCount: number | undefined;
  let totalItemCount: number | undefined;
  const finish = (
    response: Response,
    result: CollectionMetricResult,
  ): Response => {
    recordCollectionMetrics(meterProvider, metricBase, result, {
      response,
      dispatchDurationMs,
      itemCount,
      totalItems: totalItemCount,
    });
    return response;
  };
  try {
    if (collectionCallbacks == null) {
      return finish(await onNotFound(request), "not_found");
    }
    let collection: OrderedCollection | OrderedCollectionPage;
    const baseUri = uriGetter(identifier);
    if (cursor == null) {
      const firstCursor = await collectionCallbacks.firstCursor?.(
        context,
        identifier,
      );
      const totalItems = filter == null
        ? await collectionCallbacks.counter?.(context, identifier)
        : undefined;
      totalItemCount = totalItems == null ? undefined : Number(totalItems);
      if (firstCursor == null) {
        const itemsOrResponse = await tracer.startActiveSpan(
          `activitypub.dispatch_collection ${spanName}`,
          {
            kind: SpanKind.SERVER,
            attributes: {
              "activitypub.collection.id": baseUri.href,
              "activitypub.collection.type": OrderedCollection.typeId.href,
            },
          },
          async (span) => {
            if (totalItemCount != null) {
              span.setAttribute(
                "activitypub.collection.total_items",
                totalItemCount,
              );
            }
            const started = performance.now();
            try {
              const page = await collectionCallbacks.dispatcher(
                context,
                identifier,
                null,
                filter,
              );
              dispatchDurationMs = getDurationMs(started);
              if (page == null) {
                span.setStatus({ code: SpanStatusCode.ERROR });
                return await onNotFound(request);
              }
              const items = filterCollectionItems(
                page.items,
                name,
                filterPredicate,
              );
              itemCount = items.length;
              span.setAttribute("fedify.collection.items", itemCount);
              return items;
            } catch (e) {
              if (dispatchDurationMs == null) {
                dispatchDurationMs = getDurationMs(started);
              }
              span.setStatus({
                code: SpanStatusCode.ERROR,
                message: String(e),
              });
              throw e;
            } finally {
              span.end();
            }
          },
        );
        if (itemsOrResponse instanceof Response) {
          return finish(itemsOrResponse, "not_found");
        }
        collection = new OrderedCollection({
          id: baseUri,
          totalItems: totalItemCount ?? null,
          items: itemsOrResponse,
        });
      } else {
        const lastCursor = await collectionCallbacks.lastCursor?.(
          context,
          identifier,
        );
        const first = new URL(context.url);
        first.searchParams.set("cursor", firstCursor);
        let last = null;
        if (lastCursor != null) {
          last = new URL(context.url);
          last.searchParams.set("cursor", lastCursor);
        }
        collection = new OrderedCollection({
          id: baseUri,
          totalItems: totalItemCount ?? null,
          first,
          last,
        });
      }
    } else {
      const uri = new URL(baseUri);
      uri.searchParams.set("cursor", cursor);
      const pageOrResponse = await tracer.startActiveSpan(
        `activitypub.dispatch_collection_page ${name}`,
        {
          kind: SpanKind.SERVER,
          attributes: {
            "activitypub.collection.id": uri.href,
            "activitypub.collection.type": OrderedCollectionPage.typeId.href,
            "fedify.collection.cursor": cursor,
          },
        },
        async (span) => {
          const started = performance.now();
          try {
            const page = await collectionCallbacks.dispatcher(
              context,
              identifier,
              cursor,
              filter,
            );
            dispatchDurationMs = getDurationMs(started);
            if (page == null) {
              span.setStatus({ code: SpanStatusCode.ERROR });
              return await onNotFound(request);
            }
            const items = filterCollectionItems(
              page.items,
              name,
              filterPredicate,
            );
            itemCount = items.length;
            span.setAttribute("fedify.collection.items", itemCount);
            return { ...page, items };
          } catch (e) {
            if (dispatchDurationMs == null) {
              dispatchDurationMs = getDurationMs(started);
            }
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: String(e),
            });
            throw e;
          } finally {
            span.end();
          }
        },
      );
      if (pageOrResponse instanceof Response) {
        return finish(pageOrResponse, "not_found");
      }
      const { items, prevCursor, nextCursor } = pageOrResponse;
      let prev = null;
      if (prevCursor != null) {
        prev = new URL(context.url);
        prev.searchParams.set("cursor", prevCursor);
      }
      let next = null;
      if (nextCursor != null) {
        next = new URL(context.url);
        next.searchParams.set("cursor", nextCursor);
      }
      const partOf = new URL(context.url);
      partOf.searchParams.delete("cursor");
      collection = new OrderedCollectionPage({
        id: uri,
        prev,
        next,
        items,
        partOf,
      });
    }
    if (collectionCallbacks.authorizePredicate != null) {
      if (
        !await collectionCallbacks.authorizePredicate(context, identifier)
      ) {
        return finish(await onUnauthorized(request), "unauthorized");
      }
    }
    const jsonLd = await collection.toJsonLd(context);
    return finish(
      new Response(JSON.stringify(jsonLd), {
        headers: {
          "Content-Type": "application/activity+json",
          Vary: "Accept",
        },
      }),
      "served",
    );
  } catch (e) {
    recordCollectionMetrics(meterProvider, metricBase, "error", {
      dispatchDurationMs,
      itemCount,
      totalItems: totalItemCount,
    });
    throw e;
  }
}

/**
 * Filters collection items based on the provided predicate.
 * @template TItem The type of items to filter.
 * @param items The items to filter.
 * @param collectionName The name of the collection for logging purposes.
 * @param filterPredicate Optional predicate function to filter items.
 * @returns The filtered items as Objects, Links, or URLs.
 */
function filterCollectionItems<TItem extends Object | Link | Recipient | URL>(
  items: readonly TItem[],
  collectionName: string,
  filterPredicate?: (item: TItem) => boolean,
): (Object | Link | URL)[] {
  const result: (Object | Link | URL)[] = [];
  let logged = false;
  for (const item of items) {
    let mappedItem: Object | Link | URL;
    if (item instanceof Object || item instanceof Link || item instanceof URL) {
      mappedItem = item;
    } else if (item.id == null) continue;
    else mappedItem = item.id;
    if (filterPredicate != null && !filterPredicate(item)) {
      if (!logged) {
        getLogger(["fedify", "federation", "collection"]).warn(
          `The ${collectionName} collection apparently does not implement ` +
            "filtering.  This may result in a large response payload.  " +
            "Please consider implementing filtering for the collection.  " +
            "See also: https://fedify.dev/manual/collections#filtering-by-server",
        );
        logged = true;
      }
      continue;
    }
    result.push(mappedItem);
  }
  return result;
}

/**
 * Parameters for handling an outbox POST request.
 * @template TContextData The context data to pass to the context.
 */
export interface OutboxHandlerParameters<TContextData> {
  identifier: string;
  context: RequestContext<TContextData>;
  outboxContextFactory(
    identifier: string,
    activity: unknown,
    activityId: string | undefined,
    activityType: string,
  ): OutboxContext<TContextData>;
  actorDispatcher?: ActorDispatcher<TContextData>;
  authorizePredicate?: AuthorizePredicate<TContextData>;
  outboxListeners?: ActivityListenerSet<OutboxContext<TContextData>>;
  outboxErrorHandler?: OutboxListenerErrorHandler<TContextData>;
  onUnauthorized(request: Request): Response | Promise<Response>;
  onNotFound(request: Request): Response | Promise<Response>;
}

function summarizeJsonActivity(json: unknown): {
  activityId?: string;
  activityType?: string;
} {
  if (json == null || typeof json !== "object") return {};
  const activity = json as Record<string, unknown>;
  const id = typeof activity.id === "string" ? activity.id : undefined;
  const type = typeof activity.type === "string" ? activity.type : undefined;
  return { activityId: id, activityType: type };
}

/**
 * Handles an outbox POST request.
 * @template TContextData The context data to pass to the context.
 * @param request The HTTP request.
 * @param parameters The parameters for handling the request.
 * @returns A promise that resolves to an HTTP response.
 * @since 2.2.0
 */
export async function handleOutbox<TContextData>(
  request: Request,
  {
    identifier,
    context: ctx,
    outboxContextFactory,
    actorDispatcher,
    authorizePredicate,
    outboxListeners,
    outboxErrorHandler,
    onUnauthorized,
    onNotFound,
  }: OutboxHandlerParameters<TContextData>,
): Promise<Response> {
  const logger = getLogger(["fedify", "federation", "outbox"]);
  if (request.bodyUsed) {
    logger.error("Request body has already been read.", { identifier });
    return new Response("Internal server error.", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } else if (request.body?.locked) {
    logger.error("Request body is locked.", { identifier });
    return new Response("Internal server error.", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  if (actorDispatcher == null) {
    logger.error("Actor dispatcher is not set.", { identifier });
    return await onNotFound(request);
  }
  if (authorizePredicate != null) {
    const authorizeContext = ctx.clone(ctx.data) as
      & RequestContext<TContextData>
      & {
        request: Request;
      };
    authorizeContext.request = request.clone() as Request;
    const requestForUnauthorized = authorizeContext.request.clone() as Request;
    if (!await authorizePredicate(authorizeContext, identifier)) {
      return await onUnauthorized(requestForUnauthorized);
    }
  }
  const actor = await actorDispatcher(ctx, identifier);
  if (actor == null || actor instanceof Tombstone) {
    logger.error("Actor {identifier} not found.", { identifier });
    return await onNotFound(request);
  }
  const requestForParsing = request.clone();
  let json: unknown;
  try {
    json = await requestForParsing.json();
  } catch (error) {
    logger.error("Failed to parse JSON:\n{error}", { identifier, error });
    const outboxContext = outboxContextFactory(identifier, null, undefined, "");
    try {
      await outboxErrorHandler?.(outboxContext, error as Error);
    } catch (error) {
      logger.error(
        "An unexpected error occurred in outbox error handler:\n{error}",
        { error, identifier },
      );
    }
    return new Response("Invalid JSON.", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  let activity: Activity;
  try {
    activity = await Activity.fromJsonLd(json, ctx);
  } catch (error) {
    const summary = summarizeJsonActivity(json);
    logger.error("Failed to parse activity:\n{error}", {
      identifier,
      ...summary,
      error,
    });
    const outboxContext = outboxContextFactory(
      identifier,
      json,
      summary.activityId,
      summary.activityType ?? "",
    );
    try {
      await outboxErrorHandler?.(outboxContext, error as Error);
    } catch (error) {
      logger.error(
        "An unexpected error occurred in outbox error handler:\n{error}",
        { error, identifier, ...summary },
      );
    }
    return new Response("Invalid activity.", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  const outboxContext = outboxContextFactory(
    identifier,
    json,
    activity.id?.href,
    getTypeId(activity).href,
  );
  const expectedActorId = actor.id ?? ctx.getActorUri(identifier);
  if (activity.actorIds.length < 1) {
    const error = new Error("The posted activity has no actor.");
    logger.error("The posted activity has no actor for outbox {identifier}.", {
      identifier,
      activityId: activity.id?.href,
      expectedActorId: expectedActorId.href,
    });
    try {
      await outboxErrorHandler?.(outboxContext, error);
    } catch (error) {
      logger.error(
        "An unexpected error occurred in outbox error handler:\n{error}",
        {
          error,
          activityId: activity.id?.href,
          activityType: getTypeId(activity).href,
          identifier,
        },
      );
    }
    return new Response(error.message, {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  if (
    !activity.actorIds.every((actorId) => actorId.href === expectedActorId.href)
  ) {
    const error = new Error(
      "The activity actor does not match the outbox owner.",
    );
    logger.error(
      "The posted activity actor does not match outbox owner {identifier}.",
      {
        identifier,
        activityId: activity.id?.href,
        expectedActorId: expectedActorId.href,
        actorIds: activity.actorIds.map((actorId) => actorId.href),
      },
    );
    try {
      await outboxErrorHandler?.(outboxContext, error);
    } catch (error) {
      logger.error(
        "An unexpected error occurred in outbox error handler:\n{error}",
        {
          error,
          activityId: activity.id?.href,
          activityType: getTypeId(activity).href,
          identifier,
        },
      );
    }
    return new Response(error.message, {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  const dispatched = outboxListeners?.dispatchWithClass(activity);
  if (dispatched == null) {
    logger.debug("Unsupported activity type {activityType}.", {
      identifier,
      activityId: activity.id?.href,
      activityType: getTypeId(activity).href,
    });
    return new Response("", {
      status: 202,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  try {
    await dispatched.listener(outboxContext, activity);
  } catch (error) {
    try {
      await outboxErrorHandler?.(outboxContext, error as Error);
    } catch (error) {
      logger.error(
        "An unexpected error occurred in outbox error handler:\n{error}",
        {
          error,
          activityId: activity.id?.href,
          activityType: getTypeId(activity).href,
          identifier,
        },
      );
    }
    logger.error(
      "Failed to process the incoming activity {activityId}:\n{error}",
      {
        error,
        activityId: activity.id?.href,
        activityType: getTypeId(activity).href,
        identifier,
      },
    );
    return new Response("Internal server error.", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  if (!outboxContext.hasDeliveredActivity()) {
    logger.warn(
      "Outbox listener for {identifier} returned without delivering the posted activity; ctx.sendActivity() or ctx.forwardActivity() may have been skipped or resulted in no delivery.",
      {
        identifier,
        activityId: activity.id?.href,
        activityType: getTypeId(activity).href,
      },
    );
  }
  logger.info(
    "Activity {activityId} has been processed in outbox listener.",
    {
      activityId: activity.id?.href,
      activityType: getTypeId(activity).href,
      identifier,
    },
  );
  return new Response("", {
    status: 202,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

/**
 * Parameters for handling a media upload request.
 * @template TContextData The context data to pass to the context.
 * @since 2.4.0
 */
export interface MediaUploadHandlerParameters<TContextData> {
  identifier: string;
  context: RequestContext<TContextData>;
  mediaUploaderCallback: MediaUploaderCallback<TContextData>;
  actorDispatcher?: ActorDispatcher<TContextData>;
  authorizePredicate?: AuthorizePredicate<TContextData>;

  /**
   * Determines whether the given URI points at a registered object dispatcher
   * route on this server.  Used to warn when a media upload callback returns a
   * value that is not derived from `Context.getObjectUri()`.
   */
  isRegisteredObjectUri(uri: URL): boolean;
  onUnauthorized(request: Request): Response | Promise<Response>;
  onNotFound(request: Request): Response | Promise<Response>;
}

const plainTextHeaders = {
  "Content-Type": "text/plain; charset=utf-8",
} as const;

/**
 * Handles a media upload request (the [ActivityPub Media Upload
 * extension](https://www.w3.org/wiki/SocialCG/ActivityPub/MediaUpload)).
 * @template TContextData The context data to pass to the context.
 * @param request The HTTP request.
 * @param parameters The parameters for handling the request.
 * @returns A promise that resolves to an HTTP response.
 * @since 2.4.0
 */
export async function handleMediaUpload<TContextData>(
  request: Request,
  {
    identifier,
    context: ctx,
    mediaUploaderCallback,
    actorDispatcher,
    authorizePredicate,
    isRegisteredObjectUri,
    onUnauthorized,
    onNotFound,
  }: MediaUploadHandlerParameters<TContextData>,
): Promise<Response> {
  const logger = getLogger(["fedify", "federation", "mediaUploader"]);
  if (request.bodyUsed) {
    logger.error("Request body has already been read.", { identifier });
    return new Response("Internal server error.", {
      status: 500,
      headers: plainTextHeaders,
    });
  } else if (request.body?.locked) {
    logger.error("Request body is locked.", { identifier });
    return new Response("Internal server error.", {
      status: 500,
      headers: plainTextHeaders,
    });
  }
  const contentType = request.headers.get("content-type");
  if (
    contentType == null ||
    !contentType.toLowerCase().startsWith("multipart/form-data")
  ) {
    logger.error(
      "The media upload request is not multipart/form-data (got {contentType}).",
      { identifier, contentType },
    );
    return new Response("Unsupported media type.", {
      status: 415,
      headers: plainTextHeaders,
    });
  }
  if (actorDispatcher == null) {
    logger.error("Actor dispatcher is not set.", { identifier });
    return await onNotFound(request);
  }
  if (authorizePredicate != null) {
    // Give the authorization hook a header-only view of the request rather
    // than cloning it.  Cloning a request tees its body stream, so cloning a
    // multipart upload would force the entire file to be buffered a second
    // time for the (typically never consumed) authorize clone once the handler
    // reads the original with request.formData() below.  Authorization for a
    // media upload is header/token based, so a bodyless request is sufficient.
    const authorizeRequest = new Request(request.url, {
      method: request.method,
      headers: request.headers,
    });
    const authorizeContext = ctx.clone(ctx.data) as
      & RequestContext<TContextData>
      & { request: Request };
    authorizeContext.request = authorizeRequest;
    if (!await authorizePredicate(authorizeContext, identifier)) {
      // The original request body is still unread here (formData() runs only
      // after authorization succeeds), so hand it to onUnauthorized intact.
      return await onUnauthorized(request);
    }
  }
  const actor = await actorDispatcher(ctx, identifier);
  if (actor == null || actor instanceof Tombstone) {
    logger.error("Actor {identifier} not found.", { identifier });
    return await onNotFound(request);
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch (error) {
    logger.error("Failed to parse the multipart/form-data body:\n{error}", {
      identifier,
      error,
    });
    return new Response("Invalid multipart/form-data body.", {
      status: 400,
      headers: plainTextHeaders,
    });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    logger.error("The media upload request has no file field.", { identifier });
    return new Response("Missing file field.", {
      status: 400,
      headers: plainTextHeaders,
    });
  }
  const objectField = form.get("object");
  if (objectField == null) {
    logger.error("The media upload request has no object field.", {
      identifier,
    });
    return new Response("Missing object field.", {
      status: 400,
      headers: plainTextHeaders,
    });
  }
  let object: Object;
  try {
    const objectText = typeof objectField === "string"
      ? objectField
      : await objectField.text();
    object = await Object.fromJsonLd(JSON.parse(objectText), ctx);
  } catch (error) {
    logger.error("Failed to parse the object field:\n{error}", {
      identifier,
      error,
    });
    return new Response("Invalid object field.", {
      status: 400,
      headers: plainTextHeaders,
    });
  }
  let result: Object | URL;
  try {
    result = await mediaUploaderCallback(ctx, identifier, file, object);
  } catch (error) {
    logger.error("Failed to process the media upload:\n{error}", {
      identifier,
      error,
    });
    return new Response("Internal server error.", {
      status: 500,
      headers: plainTextHeaders,
    });
  }
  if (result == null) {
    // The callback's return type forbids this, but a JavaScript caller (or a
    // callback missing a return statement) could still yield null/undefined;
    // convert it into a controlled response instead of crashing below.
    logger.error(
      "The media uploader callback for {identifier} returned null or " +
        "undefined; it must return an object (201 Created) or a URL " +
        "(202 Accepted).",
      { identifier },
    );
    return new Response("Internal server error.", {
      status: 500,
      headers: plainTextHeaders,
    });
  }
  const warnUnlessRegistered = (target: URL): void => {
    if (isRegisteredObjectUri(target)) return;
    logger.warn(
      "The media uploader callback for {identifier} returned {target}, which " +
        "does not point at a registered object dispatcher route; derive the " +
        "returned id/URL from Context.getObjectUri().  The upload still " +
        "succeeded.",
      { identifier, target: target.href },
    );
  };
  if (result instanceof URL) {
    warnUnlessRegistered(result);
    logger.info(
      "The media upload for {identifier} is still being processed; " +
        "responding 202 Accepted.",
      { identifier, location: result.href },
    );
    return new Response(null, {
      status: 202,
      headers: { Location: result.href },
    });
  }
  if (result.id == null) {
    logger.error(
      "The media uploader callback for {identifier} returned an object " +
        "without an id, so a 201 Created response cannot include the required " +
        "Location header.  Set the object's id with Context.getObjectUri(), " +
        "or return the eventual URL to respond 202 Accepted instead.",
      { identifier },
    );
    return new Response("Internal server error.", {
      status: 500,
      headers: plainTextHeaders,
    });
  }
  warnUnlessRegistered(result.id);
  let jsonLd: unknown;
  try {
    jsonLd = await result.toJsonLd(ctx);
  } catch (error) {
    // Serialization can fail (e.g. a context loader error); convert it into a
    // controlled response, like every other failure mode in this handler,
    // rather than letting it propagate out of Federation.fetch().
    logger.error(
      "Failed to serialize the uploaded object to JSON-LD:\n{error}",
      { identifier, error },
    );
    return new Response("Internal server error.", {
      status: 500,
      headers: plainTextHeaders,
    });
  }
  logger.info(
    "The media upload for {identifier} is ready; responding 201 Created.",
    { identifier, location: result.id.href },
  );
  return new Response(JSON.stringify(jsonLd), {
    status: 201,
    headers: {
      "Content-Type": "application/activity+json",
      Location: result.id.href,
    },
  });
}

/**
 * Parameters for handling an inbox request.
 * @template TContextData The context data to pass to the context.
 */
export interface InboxHandlerParameters<TContextData> {
  recipient: string | null;
  context: RequestContext<TContextData>;
  inboxContextFactory(
    recipient: string | null,
    activity: unknown,
    activityId: string | undefined,
    activityType: string,
  ): InboxContext<TContextData>;
  kv: KvStore;
  kvPrefixes: {
    activityIdempotence: KvKey;
    publicKey: KvKey;
    acceptSignatureNonce: KvKey;
  };
  queue?: MessageQueue;
  actorDispatcher?: ActorDispatcher<TContextData>;
  inboxListeners?: ActivityListenerSet<InboxContext<TContextData>>;
  inboxErrorHandler?: InboxErrorHandler<TContextData>;
  unverifiedActivityHandler?: UnverifiedActivityHandler<TContextData>;
  onNotFound(request: Request): Response | Promise<Response>;
  signatureTimeWindow: Temporal.Duration | Temporal.DurationLike | false;
  skipSignatureVerification: boolean;
  inboxChallengePolicy?: InboxChallengePolicy;
  idempotencyStrategy?:
    | IdempotencyStrategy
    | IdempotencyKeyCallback<TContextData>;
  /**
   * The meter provider for recording metrics.
   * @since 2.3.0
   */
  meterProvider?: MeterProvider;
  tracerProvider?: TracerProvider;
}

/**
 * Handles an inbox request for ActivityPub activities.
 * @template TContextData The context data to pass to the context.
 * @param request The HTTP request.
 * @param options The parameters for handling the inbox.
 * @returns A promise that resolves to an HTTP response.
 */
export async function handleInbox<TContextData>(
  request: Request,
  options: InboxHandlerParameters<TContextData>,
): Promise<Response> {
  const tracerProvider = options.tracerProvider ?? trace.getTracerProvider();
  const tracer = tracerProvider.getTracer(metadata.name, metadata.version);
  return await tracer.startActiveSpan(
    "activitypub.inbox",
    {
      kind: options.queue == null ? SpanKind.SERVER : SpanKind.PRODUCER,
      attributes: { "activitypub.shared_inbox": options.recipient == null },
    },
    async (span) => {
      if (options.recipient != null) {
        span.setAttribute("fedify.inbox.recipient", options.recipient);
      }
      try {
        return await handleInboxInternal(request, options, span);
      } catch (e) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(e) });
        throw e;
      } finally {
        span.end();
      }
    },
  );
}

/**
 * Internal function for handling inbox requests with detailed processing.
 * @template TContextData The context data to pass to the context.
 * @param request The HTTP request.
 * @param options The parameters for handling the inbox.
 * @param span The OpenTelemetry span for tracing.
 * @returns A promise that resolves to an HTTP response.
 */
async function handleInboxInternal<TContextData>(
  request: Request,
  parameters: InboxHandlerParameters<TContextData>,
  span: Span,
): Promise<Response> {
  const {
    recipient,
    context: ctx,
    inboxContextFactory,
    kv,
    kvPrefixes,
    queue,
    actorDispatcher,
    inboxListeners,
    inboxErrorHandler,
    unverifiedActivityHandler,
    onNotFound,
    signatureTimeWindow,
    skipSignatureVerification,
    inboxChallengePolicy,
    meterProvider,
    tracerProvider,
  } = parameters;
  const logger = getLogger(["fedify", "federation", "inbox"]);
  if (actorDispatcher == null) {
    logger.error("Actor dispatcher is not set.", { recipient });
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: "Actor dispatcher is not set.",
    });
    return await onNotFound(request);
  } else if (recipient != null) {
    const actor = await actorDispatcher(ctx, recipient);
    if (actor == null || actor instanceof Tombstone) {
      logger.error("Actor {recipient} not found.", { recipient });
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: `Actor ${recipient} not found.`,
      });
      return await onNotFound(request);
    }
  }
  if (request.bodyUsed) {
    logger.error("Request body has already been read.", { recipient });
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: "Request body has already been read.",
    });
    return new Response("Internal server error.", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } else if (request.body?.locked) {
    logger.error("Request body is locked.", { recipient });
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: "Request body is locked.",
    });
    return new Response("Internal server error.", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  let json: unknown;
  try {
    json = await request.clone().json();
  } catch (error) {
    logger.error("Failed to parse JSON:\n{error}", { recipient, error });
    try {
      await inboxErrorHandler?.(ctx, error as Error);
    } catch (error) {
      logger.error(
        "An unexpected error occurred in inbox error handler:\n{error}",
        { error, activity: json, recipient },
      );
    }
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: `Failed to parse JSON:\n${error}`,
    });
    return new Response("Invalid JSON.", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  const keyCache = new KvKeyCache(kv, kvPrefixes.publicKey, ctx);
  const jsonWithoutSig = detachSignature(json);
  const hasLdSignature = hasSignature(json);
  const canAttemptAlternateAuthAfterLdSignatureFailure =
    skipSignatureVerification ||
    hasHttpSignatureHeaders(request) ||
    hasObjectIntegrityProof(jsonWithoutSig);
  let deferredLdSignatureError: unknown = undefined;
  const respondInvalidActivity = async (error: unknown): Promise<Response> => {
    logger.error("Failed to parse activity:\n{error}", {
      recipient,
      activity: json,
      error,
    });
    try {
      await inboxErrorHandler?.(ctx, error as Error);
    } catch (error) {
      logger.error(
        "An unexpected error occurred in inbox error handler:\n{error}",
        { error, activity: json, recipient },
      );
    }
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: `Failed to parse activity:\n${error}`,
    });
    return new Response("Invalid activity.", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  };
  let compactedJson = json;
  let compactedJsonWithoutSig = jsonWithoutSig;
  let ldSigVerified = false;
  if (hasLdSignature) {
    try {
      compactedJson = await compactJsonLd(json, ctx.contextLoader);
    } catch (error) {
      if (isInvalidJsonLdError(error)) {
        logger.error("Failed to parse JSON-LD:\n{error}", { recipient, error });
        return new Response("Invalid JSON-LD.", {
          status: 400,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
      if (!canAttemptAlternateAuthAfterLdSignatureFailure) throw error;
      // The presence of a proof block or HTTP signature headers is not enough
      // to discard a transient LDS normalization failure.  Keep that error
      // alive until another authentication path actually verifies, otherwise a
      // stale proof or invalid HTTP signature could turn a retriable remote
      // context outage into a permanent 400/401 response.
      if (!skipSignatureVerification) deferredLdSignatureError = error;
      logger.debug(
        "Failed to normalize JSON-LD for Linked Data Signatures; " +
          "deferring to another authentication path only if it verifies:\n" +
          "{error}",
        { recipient, error },
      );
    }
    if (compactedJson !== json) {
      compactedJsonWithoutSig = detachSignature(compactedJson);
      try {
        ldSigVerified = await verifyCompactJsonLd(compactedJson, {
          contextLoader: ctx.contextLoader,
          documentLoader: ctx.documentLoader,
          keyCache,
          meterProvider,
          tracerProvider,
        });
      } catch (error) {
        if (
          error instanceof RangeError &&
          await hasMalformedKnownTemporalLiteral(
            compactedJsonWithoutSig,
            ctx.contextLoader,
          )
        ) {
          return await respondInvalidActivity(error);
        }
        if (isInvalidJsonLdError(error)) {
          logger.error("Failed to parse JSON-LD:\n{error}", {
            recipient,
            error,
          });
          return new Response("Invalid JSON-LD.", {
            status: 400,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }
        if (!canAttemptAlternateAuthAfterLdSignatureFailure) throw error;
        if (!skipSignatureVerification) {
          try {
            await Object.fromJsonLd(compactedJson, {
              contextLoader: getNormalizationContextLoader(ctx.contextLoader),
              documentLoader: ctx.documentLoader,
              tracerProvider,
            });
          } catch (parseError) {
            if (
              parseError instanceof RangeError &&
              await hasMalformedKnownTemporalLiteral(
                compactedJsonWithoutSig,
                ctx.contextLoader,
              )
            ) {
              return await respondInvalidActivity(parseError);
            }
            if (isInvalidJsonLdError(parseError)) {
              logger.error("Failed to parse JSON-LD:\n{error}", {
                recipient,
                error: parseError,
              });
              return new Response("Invalid JSON-LD.", {
                status: 400,
                headers: { "Content-Type": "text/plain; charset=utf-8" },
              });
            }
            // verifyCompactJsonLd() covers both payload parsing and signature
            // verification.  Only keep a deferred error when reparsing the
            // sender's compacted payload still fails for a retryable reason;
            // otherwise unauthenticated requests could turn transient LDS key
            // lookup / parsing failures into retryable 5xxs instead of
            // falling through to the established 401 path.
            deferredLdSignatureError = parseError;
          }
        }
        ldSigVerified = false;
      }
    }
  }
  let activity: Activity | null = null;
  let activityVerified = false;
  if (ldSigVerified) {
    logger.debug("Linked Data Signatures are verified.", { recipient, json });
    try {
      activity = await Activity.fromJsonLd(compactedJsonWithoutSig, {
        ...ctx,
        contextLoader: getNormalizationContextLoader(ctx.contextLoader),
      });
    } catch (error) {
      if (
        error instanceof RangeError &&
        await hasMalformedKnownTemporalLiteral(
          compactedJsonWithoutSig,
          ctx.contextLoader,
        )
      ) {
        return await respondInvalidActivity(error);
      }
      if (!isPermanentActivityParseError(error)) throw error;
      return await respondInvalidActivity(error);
    }
    activityVerified = true;
  } else {
    logger.debug(
      "Linked Data Signatures are not verified.",
      { recipient, json },
    );
    try {
      activity = await verifyObject(Activity, jsonWithoutSig, {
        contextLoader: wrapContextLoaderForJsonLd(ctx.contextLoader),
        documentLoader: ctx.documentLoader,
        keyCache,
        meterProvider,
        tracerProvider,
      });
    } catch (error) {
      if (
        error instanceof RangeError &&
        await hasMalformedKnownTemporalLiteral(
          jsonWithoutSig,
          ctx.contextLoader,
        )
      ) {
        // A deferred LDS loader failure is still retriable, but it must not
        // hide a payload that this boundary can already prove is permanently
        // malformed.  Preserve the established 400/drop behavior first.
        return await respondInvalidActivity(error);
      }
      if (deferredLdSignatureError != null) {
        logger.debug(
          "Object Integrity Proof fallback did not supersede a deferred " +
            "Linked Data Signature failure:\n{error}",
          { recipient, error },
        );
        activity = null;
      }
      if (!isPermanentActivityParseError(error)) throw error;
      logger.error("Failed to parse activity:\n{error}", {
        recipient,
        activity: json,
        error,
      });
      try {
        await inboxErrorHandler?.(ctx, error as Error);
      } catch (error) {
        logger.error(
          "An unexpected error occurred in inbox error handler:\n{error}",
          { error, activity: json, recipient },
        );
      }
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: `Failed to parse activity:\n${error}`,
      });
      return new Response("Invalid activity.", {
        status: 400,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    if (activity == null) {
      logger.debug(
        "Object Integrity Proofs are not verified.",
        { recipient, activity: json },
      );
    } else {
      logger.debug(
        "Object Integrity Proofs are verified.",
        { recipient, activity: json },
      );
      activityVerified = true;
    }
  }
  let httpSigKey: CryptographicKey | null = null;
  // Nonce verification is deferred until after actor/key ownership is checked
  // to avoid consuming nonces on requests that will be rejected anyway.
  let pendingNonceLabel: string | undefined;
  if (activity == null) {
    if (!skipSignatureVerification) {
      const verification = await verifyRequestDetailed(request, {
        contextLoader: ctx.contextLoader,
        documentLoader: ctx.documentLoader,
        timeWindow: signatureTimeWindow,
        keyCache,
        meterProvider,
        tracerProvider,
      });
      if (verification.verified === false) {
        if (deferredLdSignatureError != null) throw deferredLdSignatureError;
        const reason = verification.reason;
        const remoteHost = "keyId" in reason && reason.keyId != null
          ? getRemoteHost(reason.keyId)
          : undefined;
        getFederationMetrics(parameters.meterProvider)
          .recordSignatureVerificationFailure(reason.type, remoteHost);
        logger.error(
          "Failed to verify the request's HTTP Signatures.",
          {
            recipient,
            reason: reason.type,
            keyId: "keyId" in reason ? reason.keyId?.href : undefined,
          },
        );
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: `Failed to verify the request's HTTP Signatures.`,
        });
        if (unverifiedActivityHandler == null) {
          return await getFailedSignatureResponse(
            inboxChallengePolicy,
            kv,
            kvPrefixes,
          );
        }
        try {
          activity = await Activity.fromJsonLd(jsonWithoutSig, ctx);
        } catch (error) {
          logger.error("Failed to parse activity:\n{error}", {
            recipient,
            activity: json,
            error,
          });
          try {
            await inboxErrorHandler?.(ctx, error as Error);
          } catch (error) {
            logger.error(
              "An unexpected error occurred in inbox error handler:\n{error}",
              { error, activity: json, recipient },
            );
          }
          return new Response("Invalid activity.", {
            status: 400,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }
        if (activity.id != null) {
          span.setAttribute("activitypub.activity.id", activity.id.href);
        }
        span.setAttribute(
          "activitypub.activity.type",
          getTypeId(activity).href,
        );
        const eventAttributes: Record<string, string | number | boolean> = {
          "activitypub.activity.json": JSON.stringify(json),
          "activitypub.activity.verified": false,
          "ld_signatures.verified": ldSigVerified,
          "http_signatures.verified": false,
          "http_signatures.key_id": "keyId" in reason
            ? (reason.keyId?.href ?? "")
            : "",
          "http_signatures.failure_reason": reason.type,
        };
        if (reason.type === "keyFetchError") {
          if ("status" in reason.result) {
            eventAttributes["http_signatures.key_fetch_status"] =
              reason.result.status;
          } else {
            eventAttributes["http_signatures.key_fetch_error"] =
              reason.result.error.name ||
              reason.result.error.constructor.name ||
              "Error";
          }
        }
        span.addEvent("activitypub.activity.received", eventAttributes);
        let response: void | Response;
        try {
          response = await unverifiedActivityHandler(
            ctx,
            activity,
            reason,
          );
        } catch (error) {
          logger.error(
            "An unexpected error occurred in unverified activity handler:\n" +
              "{error}",
            { error, activity: json, recipient },
          );
          try {
            await inboxErrorHandler?.(ctx, error as Error);
          } catch (error) {
            logger.error(
              "An unexpected error occurred in inbox error handler:\n{error}",
              { error, activity: json, recipient },
            );
          }
          return await getFailedSignatureResponse(
            inboxChallengePolicy,
            kv,
            kvPrefixes,
          );
        }
        if (response instanceof Response) return response;
        return await getFailedSignatureResponse(
          inboxChallengePolicy,
          kv,
          kvPrefixes,
        );
      } else {
        if (
          inboxChallengePolicy?.enabled && inboxChallengePolicy.requestNonce
        ) {
          // Defer nonce consumption until after actor/key ownership check to
          // avoid burning nonces on requests that will be rejected anyway.
          pendingNonceLabel = verification.signatureLabel;
        }
        logger.debug("HTTP Signatures are verified.", { recipient });
        activityVerified = true;
      }
      httpSigKey = verification.key;
    }
    try {
      activity = await Activity.fromJsonLd(jsonWithoutSig, {
        ...ctx,
        contextLoader: wrapContextLoaderForJsonLd(ctx.contextLoader),
      });
    } catch (error) {
      if (!isPermanentActivityParseError(error)) throw error;
      return await respondInvalidActivity(error);
    }
  }
  if (activity.id != null) {
    span.setAttribute("activitypub.activity.id", activity.id.href);
  }
  span.setAttribute("activitypub.activity.type", getTypeId(activity).href);

  // Record the received activity with verification details
  span.addEvent("activitypub.activity.received", {
    "activitypub.activity.json": JSON.stringify(json),
    "activitypub.activity.verified": activityVerified,
    "ld_signatures.verified": ldSigVerified,
    "http_signatures.verified": httpSigKey != null,
    "http_signatures.key_id": httpSigKey?.id?.href ?? "",
  });

  if (
    httpSigKey != null && !await doesActorOwnKey(activity, httpSigKey, ctx)
  ) {
    if (deferredLdSignatureError != null) throw deferredLdSignatureError;
    getFederationMetrics(parameters.meterProvider)
      .recordSignatureVerificationFailure(
        "actorKeyMismatch",
        httpSigKey.id == null ? undefined : getRemoteHost(httpSigKey.id),
      );
    logger.error(
      "The signer ({keyId}) and the actor ({actorId}) do not match.",
      {
        activity: json,
        recipient,
        keyId: httpSigKey.id?.href,
        actorId: activity.actorId?.href,
      },
    );
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: `The signer (${httpSigKey.id?.href}) and ` +
        `the actor (${activity.actorId?.href}) do not match.`,
    });
    return new Response("The signer and the actor do not match.", {
      status: 401,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  // Perform deferred nonce verification now that actor/key ownership is confirmed.
  if (pendingNonceLabel != null) {
    const nonceValid = await verifySignatureNonce(
      request,
      kv,
      kvPrefixes.acceptSignatureNonce,
      pendingNonceLabel,
    );
    if (!nonceValid) {
      getFederationMetrics(parameters.meterProvider)
        .recordSignatureVerificationFailure(
          "invalidNonce",
          httpSigKey?.id == null ? undefined : getRemoteHost(httpSigKey.id),
        );
      logger.error(
        "Signature nonce verification failed (missing, expired, or replayed).",
        { recipient },
      );
      return await getFailedSignatureResponse(
        inboxChallengePolicy,
        kv,
        kvPrefixes,
      );
    }
  }
  const routeResult = await routeActivity({
    context: ctx,
    // Direct handleInbox() consumers may later forward the payload from the
    // InboxContext returned by their public inboxContextFactory hook.  Favor
    // preserving the sender's exact signed body here; callers that need the
    // normalized representation can inspect the parsed Activity or compact the
    // payload explicitly.
    json,
    // Preserve the original payload for queue messages and for internal
    // InboxContextImpl instances that may forward the activity later.
    originalJson: json,
    // Queue workers may run later under stricter network or loader rules.
    // Keep any producer-side compaction result for signed payloads on the
    // queued message so workers can reuse the successful normalization without
    // re-fetching remote custom contexts.  This parse cache is intentionally
    // separate from ldSignatureVerified: fallback-authenticated traffic and
    // backlog messages from older producers can still depend on it, while the
    // raw payload stays preserved separately for forwarding and low-level
    // hooks.
    normalizedActivity: hasLdSignature && compactedJson !== json
      ? compactedJson
      : undefined,
    ldSignatureVerified: hasLdSignature ? ldSigVerified : undefined,
    activity,
    recipient,
    inboxListeners,
    inboxContextFactory,
    listenerInboxContextFactory: ldSigVerified
      ? (inboxContextFactory as typeof inboxContextFactory & {
        [rawInboxContextFactorySymbol]?: typeof inboxContextFactory;
      })[rawInboxContextFactorySymbol]
      : undefined,
    inboxErrorHandler,
    kv,
    kvPrefixes,
    queue,
    span,
    meterProvider: parameters.meterProvider,
    tracerProvider,
    idempotencyStrategy: parameters.idempotencyStrategy,
  });
  if (routeResult === "alreadyProcessed") {
    return new Response(
      `Activity <${activity.id}> has already been processed.`,
      {
        status: 202,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      },
    );
  } else if (routeResult === "missingActor") {
    return new Response("Missing actor.", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } else if (routeResult === "enqueued") {
    return new Response("Activity is enqueued.", {
      status: 202,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } else if (routeResult === "unsupportedActivity") {
    return new Response("", {
      status: 202,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } else if (routeResult === "error") {
    return new Response("Internal server error.", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } else {
    return new Response("", {
      status: 202,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

/**
 * Callbacks for handling a custom collection.
 * @template TItem The type of items in the collection.
 * @template TParam The parameter names of the requested URL.
 * @template TContext The type of the context. {@link Context} or {@link RequestContext}.
 * @template TContextData The context data to pass to the `TContext`.
 * @since 1.8.0
 */
export interface CustomCollectionCallbacks<
  TItem,
  TParam extends string,
  TContext extends Context<TContextData>,
  TContextData,
> {
  /**
   * A callback that dispatches a custom collection.
   */
  dispatcher: CustomCollectionDispatcher<
    TItem,
    TParam,
    TContext,
    TContextData
  >;

  /**
   * A callback that counts the number of items in a custom collection.
   */
  counter?: CustomCollectionCounter<TParam, TContextData>;

  /**
   * A callback that returns the first cursor for a custom collection.
   */
  firstCursor?: CustomCollectionCursor<TParam, TContext, TContextData>;

  /**
   * A callback that returns the last cursor for a custom collection.
   */
  lastCursor?: CustomCollectionCursor<TParam, TContext, TContextData>;

  /**
   * A callback that determines if a request is authorized to access the custom collection.
   */
  authorizePredicate?: ObjectAuthorizePredicate<
    TContextData,
    TParam
  >;
}

/**
 * Parameters for handling a custom collection.
 * @template TItem The type of items in the collection.
 * @template TParam The parameter names of the requested URL.
 * @template TContext The type of the context, extending {@link RequestContext}.
 * @template TContextData The context data to pass to the `TContext`.
 * @since 1.8.0
 */
export interface CustomCollectionHandlerParameters<
  TItem,
  TParam extends string,
  TContext extends RequestContext<TContextData>,
  TContextData,
> extends ErrorHandlers {
  name: string;
  values: Record<TParam, string>;
  filterPredicate?: (item: TItem) => boolean;
  context: TContext;
  collectionCallbacks?: CustomCollectionCallbacks<
    TItem,
    TParam,
    TContext,
    TContextData
  >;
  tracerProvider?: TracerProvider;
  /**
   * The meter provider for recording collection metrics.
   * @since 2.3.0
   */
  meterProvider?: MeterProvider;
}

/**
 * Handles a custom collection request.
 * @template TItem The type of items in the collection.
 * @template TParam The parameter names of the requested URL.
 * @template TContext The type of the context, extending {@link RequestContext}.
 * @template TContextData The context data to pass to the `TContext`.
 * @param request The HTTP request.
 * @param handleParams Parameters for handling the collection.
 * @returns A promise that resolves to an HTTP response.
 * @since 1.8.0
 */
export const handleCustomCollection: <
  TItem extends URL | Object | Link | Recipient,
  TParam extends string,
  TContext extends RequestContext<TContextData>,
  TContextData,
>(
  request: Request,
  handleParams: CustomCollectionHandlerParameters<
    TItem,
    TParam,
    TContext,
    TContextData
  >,
) => Promise<Response> = exceptWrapper(_handleCustomCollection);

type CollectionMetricMeasurement = {
  page: boolean;
  dispatchDurationMs?: number;
  itemCount?: number;
  totalItems?: number;
};

type PendingCollectionMetricRecorder = (
  result: CollectionMetricResult,
  response?: Response,
) => void;

const pendingCollectionMetricRecorders = new WeakMap<
  object,
  PendingCollectionMetricRecorder
>();

function deferPendingCollectionMetrics(
  error: unknown,
  recorder: PendingCollectionMetricRecorder,
): boolean {
  if (
    error == null ||
    (typeof error !== "object" && typeof error !== "function")
  ) {
    return false;
  }
  pendingCollectionMetricRecorders.set(error, recorder);
  return true;
}

function recordDeferredPendingCollectionMetrics(
  error: unknown,
  result: CollectionMetricResult,
  response?: Response,
): void {
  if (
    error == null ||
    (typeof error !== "object" && typeof error !== "function")
  ) {
    return;
  }
  const recorder = pendingCollectionMetricRecorders.get(error);
  pendingCollectionMetricRecorders.delete(error);
  recorder?.(result, response);
}

async function _handleCustomCollection<
  TItem extends URL | Object | Link | Recipient,
  TParam extends string,
  TContext extends RequestContext<TContextData>,
  TContextData,
>(
  request: Request,
  {
    name,
    values,
    context,
    tracerProvider,
    meterProvider,
    collectionCallbacks: callbacks,
    filterPredicate,
  }: CustomCollectionHandlerParameters<
    TItem,
    TParam,
    TContext,
    TContextData
  >,
): Promise<Response> {
  verifyDefined(callbacks);
  await authIfNeeded(context, values, callbacks);
  const cursor = new URL(request.url).searchParams.get("cursor");
  const handler = new CustomCollectionHandler(
    name,
    values,
    context,
    callbacks,
    tracerProvider,
    meterProvider,
    Collection,
    CollectionPage,
    filterPredicate,
  ).fetchCollection(cursor);
  try {
    const response = await handler.toJsonLd().then(respondAsActivity);
    handler.recordPendingCollectionMetrics("served", response);
    return response;
  } catch (e) {
    if (
      !deferPendingCollectionMetrics(
        e,
        (result, response) =>
          handler.recordPendingCollectionMetrics(result, response),
      )
    ) handler.recordPendingCollectionMetrics("error");
    throw e;
  }
}

/**
 * Handles an ordered collection request.
 * @template TItem The type of items in the collection.
 * @template TParam The parameter names of the requested URL.
 * @template TContext The type of the context, extending {@link RequestContext}.
 * @template TContextData The context data to pass to the `TContext`.
 * @param request The HTTP request.
 * @param handleParams Parameters for handling the collection.
 * @returns A promise that resolves to an HTTP response.
 * @since 1.8.0
 */
export const handleOrderedCollection: <
  TItem extends URL | Object | Link | Recipient,
  TParam extends string,
  TContext extends RequestContext<TContextData>,
  TContextData,
>(
  request: Request,
  handleParams: CustomCollectionHandlerParameters<
    TItem,
    TParam,
    TContext,
    TContextData
  >,
) => Promise<Response> = exceptWrapper(_handleOrderedCollection);
async function _handleOrderedCollection<
  TItem extends URL | Object | Link | Recipient,
  TParam extends string,
  TContext extends RequestContext<TContextData>,
  TContextData,
>(
  request: Request,
  {
    name,
    values,
    context,
    tracerProvider,
    meterProvider,
    collectionCallbacks: callbacks,
    filterPredicate,
  }: CustomCollectionHandlerParameters<
    TItem,
    TParam,
    TContext,
    TContextData
  >,
): Promise<Response> {
  verifyDefined(callbacks);
  await authIfNeeded(context, values, callbacks);
  const cursor = new URL(request.url).searchParams.get("cursor");
  const handler = new CustomCollectionHandler(
    name,
    values,
    context,
    callbacks,
    tracerProvider,
    meterProvider,
    OrderedCollection,
    OrderedCollectionPage,
    filterPredicate,
  ).fetchCollection(cursor);
  try {
    const response = await handler.toJsonLd().then(respondAsActivity);
    handler.recordPendingCollectionMetrics("served", response);
    return response;
  } catch (e) {
    if (
      !deferPendingCollectionMetrics(
        e,
        (result, response) =>
          handler.recordPendingCollectionMetrics(result, response),
      )
    ) handler.recordPendingCollectionMetrics("error");
    throw e;
  }
}

/**
 * Handling custom collections with support for pagination and filtering.
 * The main flow is on `getCollection`, `dispatch`.
 *
 * @template TItem The type of items in the collection.
 * @template TParam The parameter names of the requested URL.
 * @template TContext The type of the context. {@link Context} or {@link RequestContext}.
 * @template TContextData The context data to pass to the `TContext`.
 * @template TCollection The type of the collection, extending {@link Collection}.
 * @template TCollectionPage The type of the collection page, extending {@link CollectionPage}.
 * @since 1.8.0
 */
class CustomCollectionHandler<
  TItem extends URL | Object | Link | Recipient,
  TParam extends string,
  TContextData,
  TContext extends RequestContext<TContextData>,
  TCollection extends Collection,
  TCollectionPage extends CollectionPage,
> {
  /**
   * The tracer for telemetry.
   * @type {Tracer}
   */
  #tracer: Tracer;
  /**
   * The ID of the collection.
   * @type {URL}
   */
  #id: URL;
  /**
   * Store total count of items in the collection.
   * Use `this.totalItems` to access the total items count.
   * It is a promise because it may require an asynchronous operation to count items.
   * @type {Promise<number | null> | undefined}
   */
  #totalItems: Promise<number | null> | undefined = undefined;
  /**
   * The first cursor for pagination.
   * It is a promise because it may require an asynchronous operation to get the first cursor.
   * @type {Promise<string | null> | undefined}
   */
  #dispatcher: CustomCollectionDispatcher<
    TItem,
    TParam,
    TContext,
    TContextData
  >;
  #collection: Promise<TCollection | TCollectionPage> | null = null;
  #pendingCollectionMetrics: CollectionMetricMeasurement[] = [];

  /**
   * Creates a new CustomCollection instance.
   * @param name The name of the collection.
   * @param values The parameter values for the collection.
   * @param context The request context.
   * @param callbacks The collection callbacks.
   * @param tracerProvider The tracer provider for telemetry.
   * @param Collection The Collection constructor.
   * @param CollectionPage The CollectionPage constructor.
   * @param filterPredicate Optional filter predicate for items.
   */
  constructor(
    private readonly name: string,
    private readonly values: Record<TParam, string>,
    private readonly context: TContext,
    private readonly callbacks: CustomCollectionCallbacks<
      TItem,
      TParam,
      TContext,
      TContextData
    >,
    private readonly tracerProvider: TracerProvider = trace.getTracerProvider(),
    private readonly meterProvider: MeterProvider | undefined,
    private readonly Collection: ConstructorWithTypeId<TCollection>,
    private readonly CollectionPage: ConstructorWithTypeId<TCollectionPage>,
    private readonly filterPredicate?: (item: TItem) => boolean,
  ) {
    this.name = this.name.trim().replace(/\s+/g, "_");
    this.#tracer = this.tracerProvider.getTracer(
      metadata.name,
      metadata.version,
    );
    this.#id = new URL(this.context.url);
    this.#dispatcher = callbacks.dispatcher.bind(callbacks);
  }

  /**
   * Converts the collection to JSON-LD format.
   * @returns A promise that resolves to the JSON-LD representation.
   */
  async toJsonLd() {
    return (await this.collection).toJsonLd(this.context);
  }

  /**
   * Fetches the collection with optional cursor for pagination.
   * This method is defined for method chaining and to show processing flow properly.
   * So it is no problem to call `toJsonLd` directly on the instance.
   * @param cursor The cursor for pagination, or null for the first page.
   * @returns The CustomCollection instance for method chaining.
   */
  fetchCollection(cursor: string | null = null) {
    this.#collection = this.getCollection(cursor);
    return this;
  }

  /**
   * Gets the collection or collection page based on the cursor.
   * @param {string | null} cursor The cursor for pagination, or null for the main collection.
   * @returns {Promise<TCollection | TCollectionPage>} A promise that resolves to a Collection or CollectionPage.
   */
  async getCollection(
    cursor: string | null = null,
  ): Promise<TCollection | TCollectionPage> {
    if (cursor !== null) {
      const props = await this.getPageProps(cursor);
      return new this.CollectionPage(props);
    }
    const firstCursor = await this.firstCursor;
    const props = typeof firstCursor === "string"
      ? await this.getProps(firstCursor)
      : await this.getPropsWithoutCursor();
    return new this.Collection(props);
  }

  /**
   * Gets the properties for a collection page.
   * Returns the page properties including items, previous and next cursors.
   * @param {string} cursor The cursor for the page.
   * @returns A promise that resolves to the page properties.
   */
  async getPageProps(cursor: string) {
    const id = this.#id;
    const pages = await this.getPages({ cursor });
    const { prevCursor, nextCursor } = pages;
    const partOf = new URL(id);
    partOf.searchParams.delete("cursor");
    const items = this.filterItems(pages.items);
    this.recordPendingCollectionItemCount(true, items.length);
    return {
      id,
      partOf,
      items,
      prev: this.appendToUrl(prevCursor),
      next: this.appendToUrl(nextCursor),
    };
  }

  /**
   * Gets the properties for a collection with cursors.
   * Returns the first cursor and last cursor as URL, along with total items count.
   * @param {string} firstCursor The first cursor for pagination.
   * @returns A promise that resolves to the collection properties.
   */
  async getProps(firstCursor: string) {
    const lastCursor = await this.callbacks.lastCursor?.(
      this.context,
      this.values,
    );
    const totalItems = await this.totalItems;
    if (totalItems != null) {
      this.#pendingCollectionMetrics.push({
        page: false,
        totalItems: Number(totalItems),
      });
    }
    return {
      id: this.#id,
      first: this.appendToUrl(firstCursor),
      last: this.appendToUrl(lastCursor),
      totalItems,
    };
  }

  /**
   * Gets the properties for a collection of all items and the count.
   * @returns A promise that resolves to the collection properties.
   */
  async getPropsWithoutCursor() {
    const totalItems = await this.totalItems;
    const pages = await this.getPages({ totalItems });
    const items = this.filterItems(pages.items);
    this.recordPendingCollectionItemCount(false, items.length);
    return {
      id: this.#id,
      totalItems,
      items,
    };
  }

  /**
   * Gets a page of items from the collection.
   * Wraps the dispatcher in a span for telemetry.
   * @param options Options for getting the page, including cursor and total items.
   * @returns A promise that resolves to the page items.
   */
  async getPages(
    { cursor = null, totalItems = null }: {
      cursor?: string | null;
      totalItems?: number | null;
    },
  ): Promise<PageItems<TItem>> {
    return await this.#tracer.startActiveSpan(
      `${this.ATTRS.DISPATCH_COLLECTION} ${this.name}`,
      this.spanOptions(SpanKind.SERVER, cursor),
      this.spanPages({ cursor, totalItems }),
    );
  }

  /**
   * Creates span options for telemetry.
   * @param {SpanKind} kind The span kind.
   * @param {string | null} cursor The optional cursor value.
   * @returns {SpanOptions}The span options.
   */
  spanOptions = (kind: SpanKind, cursor?: string | null): SpanOptions => ({
    kind,
    attributes: {
      [this.ATTRS.ID]: this.#id.href,
      [this.ATTRS.TYPE]: this.Collection.typeId.href,
      ...(cursor ? { [this.ATTRS.CURSOR]: cursor } : {}),
    },
  });

  /**
   * Creates a function to wrap the dispatcher so tracing can be applied.
   * @param params Parameters including cursor and total items.
   * @returns A function that handles the span operation.
   */
  spanPages: (params: {
    totalItems?: number | null;
    cursor?: string | null;
  }) => (span: Span) => Promise<PageItems<TItem>> = ({
    totalItems = null,
    cursor = null,
  }) =>
  async (span: Span): Promise<PageItems<TItem>> => {
    const pageMetricBase = this.metricBase(cursor !== null);
    const started = performance.now();
    try {
      if (totalItems !== null) {
        span.setAttribute(this.ATTRS.TOTAL_ITEMS, totalItems);
      }
      const page = await this.dispatch(cursor);
      const durationMs = getDurationMs(started);
      span.setAttribute(this.ATTRS.ITEMS, page.items.length);
      this.#pendingCollectionMetrics.push({
        page: pageMetricBase.page,
        dispatchDurationMs: durationMs,
        totalItems: totalItems == null ? undefined : Number(totalItems),
      });
      return page;
    } catch (e) {
      this.#pendingCollectionMetrics.push({
        page: cursor !== null,
        dispatchDurationMs: getDurationMs(started),
      });
      const message = e instanceof Error ? e.message : String(e);
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      throw e;
    } finally {
      span.end();
    }
  };

  /**
   * Dispatches the collection request to get items.
   * @param cursor The cursor for pagination, or null for the first page.
   * @returns A promise that resolves to the page items.
   */
  async dispatch(
    cursor: string | null = null,
  ): Promise<PageItems<TItem>> {
    return await this.#dispatcher(
      this.context,
      this.values,
      cursor,
    ) ?? new ItemsNotFoundError().throw();
  }

  /**
   * Filters the items in the collection.
   * @param items The items to filter.
   * @returns The filtered items.
   */
  filterItems(items: readonly TItem[]): (Object | Link | URL)[] {
    return filterCollectionItems(items, this.name, this.filterPredicate);
  }

  metricBase(page: boolean): CollectionMetricBase {
    return { kind: "custom", page, dispatcher: "custom" };
  }

  metricAttributes(
    page: boolean,
    result: CollectionMetricResult,
    response?: Response,
  ): CollectionMetricAttributes {
    return collectionAttributes(this.metricBase(page), result, response);
  }

  recordPendingCollectionItemCount(page: boolean, itemCount: number): void {
    for (let i = this.#pendingCollectionMetrics.length - 1; i >= 0; i--) {
      const measurement = this.#pendingCollectionMetrics[i];
      if (
        measurement.page === page &&
        measurement.dispatchDurationMs != null &&
        measurement.itemCount == null
      ) {
        measurement.itemCount = itemCount;
        return;
      }
    }
    this.#pendingCollectionMetrics.push({ page, itemCount });
  }

  recordPendingCollectionMetrics(
    result: CollectionMetricResult,
    response?: Response,
  ): void {
    for (const measurement of this.#pendingCollectionMetrics.splice(0)) {
      const attrs = this.metricAttributes(measurement.page, result, response);
      if (measurement.dispatchDurationMs != null) {
        recordCollectionDispatchDuration(
          this.meterProvider,
          measurement.dispatchDurationMs,
          attrs,
        );
      }
      if (measurement.itemCount != null) {
        recordCollectionPageItems(
          this.meterProvider,
          measurement.itemCount,
          attrs,
        );
      }
      if (measurement.totalItems != null) {
        recordCollectionTotalItems(
          this.meterProvider,
          measurement.totalItems,
          attrs,
        );
      }
    }
  }

  /**
   * Appends a cursor to the URL if it exists.
   * @param cursor The cursor to append, or null/undefined.
   * @returns The URL with cursor appended, or null if cursor is null/undefined.
   */
  appendToUrl<Cursor extends string | null | undefined>(
    cursor: Cursor,
  ): Cursor extends string ? URL : null {
    return appendCursorIfExists(this.context.url, cursor);
  }

  /**
   * Gets the stored collection or collection page.
   * @returns A promise that resolves to the collection or collection page.
   */
  get collection(): Promise<TCollection | TCollectionPage> {
    if (this.#collection === null) {
      this.#collection = this.getCollection();
    }
    return this.#collection;
  }

  /**
   * Gets the total number of items in the collection.
   * @returns A promise that resolves to the total items count,
   *          or null if not available.
   */
  get totalItems(): Promise<number | null> {
    if (this.#totalItems === undefined) {
      this.totalItems = this.callbacks.counter?.(this.context, this.values);
    }
    return this.#totalItems as Promise<number | null>;
  }

  /**
   * Sets the total number of items in the collection.
   * @param value The total items count or a promise that resolves to it.
   */
  set totalItems(value: Promise<TotalItems> | TotalItems) {
    const toNumber = (value: TotalItems): number | null =>
      value == null ? null : Number(value);
    this.#totalItems = value instanceof Promise
      ? value.then(toNumber)
      : Promise.resolve(toNumber(value));
  }

  /**
   * Gets the first cursor for pagination.
   * @returns A promise that resolves to the first cursor,
   *          or null if not available.
   */
  get firstCursor(): Promise<string | null> {
    const cursor = this.callbacks.firstCursor?.(this.context, this.values);
    return (Promise.resolve(cursor ?? null));
  }

  /**
   * Attribute constants for telemetry spans.
   */
  ATTRS = {
    DISPATCH_COLLECTION: "activitypub.dispatch_collection",
    CURSOR: "fedify.collection.cursor",
    ID: "activitypub.collection.id",
    ITEMS: "fedify.collection.items",
    TOTAL_ITEMS: "activitypub.collection.total_items",
    TYPE: "activitypub.collection.type",
  } as const;
}

/** Type for `CustomCollection.TotalItems`.*/
type TotalItems = number | bigint | null | undefined;

/**
 * A wrapper function that catches specific errors and handles them appropriately.
 * @template TParams The type of parameters that extend ErrorHandlers.
 * @param handler The handler function to wrap.
 * @returns A wrapped handler function that catches and handles specific errors.
 * @since 1.8.0
 */
function exceptWrapper<TParams extends ErrorHandlers>(
  handler: (request: Request, handleParams: TParams) => Promise<Response>,
): (...args: Parameters<typeof handler>) => Promise<Response> {
  return async (request, handlerParams): Promise<Response> => {
    const page = new URL(request.url).searchParams.get("cursor") != null;
    const { meterProvider } = handlerParams;
    const metricBase: CollectionMetricBase = {
      kind: "custom",
      page,
      dispatcher: "custom",
    };
    try {
      const response = await handler(request, handlerParams);
      recordCollectionRequest(
        meterProvider,
        collectionAttributes(metricBase, "served", response),
      );
      return response;
    } catch (error) {
      const { onNotFound, onUnauthorized } = handlerParams;
      switch (error?.constructor) {
        case ItemsNotFoundError: {
          const response = await onNotFound(request);
          recordDeferredPendingCollectionMetrics(
            error,
            "not_found",
            response,
          );
          recordCollectionRequest(
            meterProvider,
            collectionAttributes(metricBase, "not_found", response),
          );
          return response;
        }
        case UnauthorizedError: {
          const response = await onUnauthorized(request);
          recordDeferredPendingCollectionMetrics(
            error,
            "unauthorized",
            response,
          );
          recordCollectionRequest(
            meterProvider,
            collectionAttributes(metricBase, "unauthorized", response),
          );
          return response;
        }
        default:
          recordDeferredPendingCollectionMetrics(error, "error");
          recordCollectionRequest(
            meterProvider,
            collectionAttributes(metricBase, "error"),
          );
          throw error;
      }
    }
  };
}

/**
 * Interface for error handler functions.
 * @since 1.8.0
 */
interface ErrorHandlers {
  meterProvider?: MeterProvider;
  onNotFound(request: Request): Response | Promise<Response>;
  onUnauthorized(request: Request): Response | Promise<Response>;
}

/**
 * Verifies that a value is defined (not undefined).
 * @template T The type of the value, excluding undefined.
 * @param callbacks The value to verify.
 * @throws {ItemsNotFoundError} If the value is undefined.
 * @since 1.8.0
 */
const verifyDefined: <T extends Exclude<unknown, undefined>>(
  obj: T | undefined,
) => asserts obj is T = <T extends Exclude<unknown, undefined>>(
  callbacks: T | undefined,
): asserts callbacks is T => {
  if (callbacks === undefined) throw new ItemsNotFoundError();
};

/**
 * Performs authorization if needed based on the authorization predicate.
 * @template TContextData The context data type.
 * @param {RequestContext<TContextData>} context The request context.
 * @param {Record<string, string>} values The parameter values.
 * @param options Options containing the authorization predicate.
 * @throws {UnauthorizedError} If authorization fails.
 * @since 1.8.0
 */
const authIfNeeded = async <TContextData>(
  context: RequestContext<TContextData>,
  values: Record<string, string>,
  {
    authorizePredicate: authorize = undefined,
  }: {
    authorizePredicate?: ObjectAuthorizePredicate<
      TContextData,
      string
    >;
  },
): Promise<void | never> => {
  if (authorize === undefined) return;
  if (!await authorize(context, values)) {
    throw new UnauthorizedError();
  }
};

/**
 * Appends a cursor parameter to a URL if the cursor exists.
 * @template Cursor The type of the cursor (string, null, or undefined).
 * @param {URL} url The base URL to append the cursor to.
 * @param {string | null | undefined} cursor The cursor value to append.
 * @returns The URL with cursor appended if cursor is a string, null otherwise.
 * @since 1.8.0
 */
const appendCursorIfExists = <Cursor extends string | null | undefined>(
  url: URL,
  cursor: Cursor,
): Cursor extends string ? URL : null => {
  if (cursor === null || cursor === undefined) {
    return null as Cursor extends string ? never : null;
  }
  const copied = new URL(url);
  copied.searchParams.set("cursor", cursor);
  return copied as Cursor extends string ? URL : never;
};

/**
 * Creates an HTTP response for ActivityPub data.
 * @param {unknown} data The data to serialize as JSON-LD.
 * @returns {Response} An HTTP response with the data as ActivityPub JSON.
 * @since 1.8.0
 */
const respondAsActivity = (data: unknown): Response =>
  new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/activity+json",
      Vary: "Accept",
    },
  });

/**
 * Base class for handler errors.
 * @since 1.8.0
 */
class HandlerError extends Error {
  constructor(message: string) {
    super(message);
  }

  /**
   * Throws this error.
   * @returns Never returns, always throws.
   */
  throw(): never {
    throw this;
  }
}

/**
 * Error thrown when items are not found in a collection.
 * @since 1.8.0
 */
class ItemsNotFoundError extends HandlerError {
  constructor() {
    super("Items not found in the collection.");
  }
}

/**
 * Error thrown when access to a collection is unauthorized.
 * @since 1.8.0
 */
class UnauthorizedError extends HandlerError {
  constructor() {
    super("Unauthorized access to the collection.");
  }
}

/**
 * Options for the {@link respondWithObject} and
 * {@link respondWithObjectIfAcceptable} functions.
 * @since 0.3.0
 */
export interface RespondWithObjectOptions {
  /**
   * The document loader to use for compacting JSON-LD.
   * @since 0.8.0
   */
  contextLoader: DocumentLoader;
}

/**
 * Responds with the given object in JSON-LD format.
 *
 * @param object The object to respond with.
 * @param options Options.
 * @since 0.3.0
 */
export async function respondWithObject(
  object: Object,
  options?: RespondWithObjectOptions,
): Promise<Response> {
  const jsonLd = await object.toJsonLd(options);
  return new Response(JSON.stringify(jsonLd), {
    headers: {
      "Content-Type": "application/activity+json",
    },
  });
}

/**
 * Responds with the given object in JSON-LD format if the request accepts
 * JSON-LD.
 *
 * @param object The object to respond with.
 * @param request The request to check for JSON-LD acceptability.
 * @param options Options.
 * @since 0.3.0
 */
export async function respondWithObjectIfAcceptable(
  object: Object,
  request: Request,
  options?: RespondWithObjectOptions,
): Promise<Response | null> {
  if (!acceptsJsonLd(request)) return null;
  const response = await respondWithObject(object, options);
  response.headers.set("Vary", "Accept");
  return response;
}

function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // Base64url encoding without padding
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function verifySignatureNonce(
  request: Request,
  kv: KvStore,
  noncePrefix: KvKey,
  verifiedLabel?: string,
): Promise<boolean> {
  const signatureInput = request.headers.get("Signature-Input");
  if (signatureInput == null) return false;
  const parsed = parseRfc9421SignatureInput(signatureInput);
  // Only check the nonce from the verified signature label to prevent bypass
  // attacks where a bogus signature carries a valid nonce while a different
  // signature (without a nonce) is the one that actually verified.
  // Nonces are only supported for RFC 9421 signatures.  If no verified label
  // is available (e.g., draft-cavage), skip nonce verification entirely to
  // prevent a decoupled-check bypass via a non-RFC-9421 path.
  if (verifiedLabel == null) return false;
  const sig = parsed[verifiedLabel];
  if (sig == null) return false;
  const nonce = sig.nonce;
  if (nonce == null) return false;
  const key = [...noncePrefix, nonce] as unknown as KvKey;
  if (kv.cas != null) {
    return await kv.cas(key, true, undefined);
  }
  const stored = await kv.get(key);
  if (stored != null) {
    await kv.delete(key);
    return true;
  }
  return false;
}

const getFailedSignatureResponse = async (
  policy: InboxChallengePolicy | undefined,
  kv: KvStore,
  kvPrefixes: { acceptSignatureNonce: KvKey },
): Promise<Response> => {
  const headers = await getFailedSignatureHeaders(
    policy,
    kv,
    kvPrefixes,
  );
  return new Response(
    "Failed to verify the request signature.",
    { status: 401, headers },
  );
};

const getFailedSignatureHeaders = async (
  policy: InboxChallengePolicy | undefined,
  kv: KvStore,
  kvPrefixes: { acceptSignatureNonce: KvKey },
) => ({
  "Content-Type": "text/plain; charset=utf-8",
  ...(policy?.enabled && {
    "Accept-Signature": await buildAcceptSignatureHeader(
      policy,
      kv,
      kvPrefixes.acceptSignatureNonce,
    ),
    "Cache-Control": "no-store",
    "Vary": "Accept, Signature",
  }),
});

async function buildAcceptSignatureHeader(
  policy: InboxChallengePolicy,
  kv: KvStore,
  noncePrefix: KvKey,
): Promise<string> {
  const parameters: AcceptSignatureParameters = { created: true };
  if (policy.requestNonce) {
    const nonce = generateNonce();
    const key: KvKey = [...noncePrefix, nonce];
    await setKey(kv, key, policy);
    parameters.nonce = nonce;
  }
  const baseComponents = policy.components ?? DEF_COMPONENTS;
  // Always include the minimum required components to ensure basic request
  // binding, then deduplicate and exclude response-only @status.
  const components = uniq(MIN_COMPONENTS.concat(baseComponents))
    .filter((c) => c !== "@status")
    .map((v) => ({ value: v, params: {} }));
  return formatAcceptSignature([{ label: "sig1", components, parameters }]);
}

async function setKey(kv: KvStore, key: KvKey, policy: InboxChallengePolicy) {
  const seconds = policy.nonceTtlSeconds ?? 300;
  const ttl = Temporal.Duration.from({ seconds });
  await kv.set(key, true, { ttl });
}

const DEF_COMPONENTS = [
  "@method",
  "@target-uri",
  "@authority",
  "content-digest",
];

// Minimum set of components that must always appear in a challenge to ensure
// basic request binding.  These are merged with any caller-supplied components.
const MIN_COMPONENTS = [
  "@method",
  "@target-uri",
  "@authority",
];
