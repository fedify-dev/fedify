import { getLogger } from "@logtape/logtape";
import type {
  Span,
  SpanOptions,
  Tracer,
  TracerProvider,
} from "@opentelemetry/api";
import { SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import metadata from "../deno.json" with { type: "json" };
import type { DocumentLoader } from "../runtime/docloader.ts";
import { verifyRequest } from "../sig/http.ts";
import { detachSignature, verifyJsonLd } from "../sig/ld.ts";
import { doesActorOwnKey } from "../sig/owner.ts";
import { verifyObject } from "../sig/proof.ts";
import type { Recipient } from "../vocab/actor.ts";
import { getTypeId } from "../vocab/type.ts";
import {
  Activity,
  Collection,
  CollectionPage,
  type CryptographicKey,
  Link,
  Object,
  OrderedCollection,
  OrderedCollectionPage,
} from "../vocab/vocab.ts";
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
  ObjectAuthorizePredicate,
  ObjectDispatcher,
} from "./callback.ts";
import type { PageItems } from "./collection.ts";
import type { Context, InboxContext, RequestContext } from "./context.ts";
import type { ConstructorWithTypeId } from "./federation.ts";
import { type InboxListenerSet, routeActivity } from "./inbox.ts";
import { KvKeyCache } from "./keycache.ts";
import type { KvKey, KvStore } from "./kv.ts";
import type { MessageQueue } from "./mq.ts";
import { preferredMediaTypes } from "./negotiation.ts";

export function acceptsJsonLd(request: Request): boolean {
  const accept = request.headers.get("Accept");
  const types = accept ? preferredMediaTypes(accept) : ["*/*"];
  if (types == null) return true;
  if (types[0] === "text/html" || types[0] === "application/xhtml+xml") {
    return false;
  }
  return types.includes("application/activity+json") ||
    types.includes("application/ld+json") ||
    types.includes("application/json");
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
  onNotAcceptable(request: Request): Response | Promise<Response>;
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
    onNotAcceptable,
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
  if (!acceptsJsonLd(request)) return await onNotAcceptable(request);
  if (authorizePredicate != null) {
    let key = await context.getSignedKey();
    key = key?.clone({}, {
      // @ts-expect-error: $warning is not part of the type definition
      $warning: {
        category: ["fedify", "federation", "actor"],
        message: "The third parameter of AuthorizePredicate is deprecated " +
          "in favor of RequestContext.getSignedKey() method.  The third " +
          "parameter will be removed in a future release.",
      },
    }) ?? null;
    let keyOwner = await context.getSignedKeyOwner();
    keyOwner = keyOwner?.clone({}, {
      // @ts-expect-error: $warning is not part of the type definition
      $warning: {
        category: ["fedify", "federation", "actor"],
        message: "The fourth parameter of AuthorizePredicate is deprecated " +
          "in favor of RequestContext.getSignedKeyOwner() method.  The " +
          "fourth parameter will be removed in a future release.",
      },
    }) ?? null;
    if (!await authorizePredicate(context, identifier, key, keyOwner)) {
      return await onUnauthorized(request);
    }
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
  onNotAcceptable(request: Request): Response | Promise<Response>;
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
    onNotAcceptable,
    onUnauthorized,
  }: ObjectHandlerParameters<TContextData>,
): Promise<Response> {
  if (objectDispatcher == null) return await onNotFound(request);
  const object = await objectDispatcher(context, values);
  if (object == null) return await onNotFound(request);
  if (!acceptsJsonLd(request)) return await onNotAcceptable(request);
  if (authorizePredicate != null) {
    let key = await context.getSignedKey();
    key = key?.clone({}, {
      // @ts-expect-error: $warning is not part of the type definition
      $warning: {
        category: ["fedify", "federation", "object"],
        message: "The third parameter of ObjectAuthorizePredicate is " +
          "deprecated in favor of RequestContext.getSignedKey() method.  " +
          "The third parameter will be removed in a future release.",
      },
    }) ?? null;
    let keyOwner = await context.getSignedKeyOwner();
    keyOwner = keyOwner?.clone({}, {
      // @ts-expect-error: $warning is not part of the type definition
      $warning: {
        category: ["fedify", "federation", "object"],
        message: "The fourth parameter of ObjectAuthorizePredicate is " +
          "deprecated in favor of RequestContext.getSignedKeyOwner() method.  " +
          "The fourth parameter will be removed in a future release.",
      },
    }) ?? null;
    if (!await authorizePredicate(context, values, key, keyOwner)) {
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
  onUnauthorized(request: Request): Response | Promise<Response>;
  onNotFound(request: Request): Response | Promise<Response>;
  onNotAcceptable(request: Request): Response | Promise<Response>;
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
    onUnauthorized,
    onNotFound,
    onNotAcceptable,
  }: CollectionHandlerParameters<TItem, TContext, TContextData, TFilter>,
): Promise<Response> {
  const spanName = name.trim().replace(/\s+/g, "_");
  tracerProvider = tracerProvider ?? trace.getTracerProvider();
  const tracer = tracerProvider.getTracer(metadata.name, metadata.version);
  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor");
  if (collectionCallbacks == null) return await onNotFound(request);
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
          if (totalItems != null) {
            span.setAttribute(
              "activitypub.collection.total_items",
              Number(totalItems),
            );
          }
          try {
            const page = await collectionCallbacks.dispatcher(
              context,
              identifier,
              null,
              filter,
            );
            if (page == null) {
              span.setStatus({ code: SpanStatusCode.ERROR });
              return await onNotFound(request);
            }
            const { items } = page;
            span.setAttribute("fedify.collection.items", items.length);
            return items;
          } catch (e) {
            span.setStatus({ code: SpanStatusCode.ERROR, message: String(e) });
            throw e;
          } finally {
            span.end();
          }
        },
      );
      if (itemsOrResponse instanceof Response) return itemsOrResponse;
      collection = new OrderedCollection({
        id: baseUri,
        totalItems: totalItems == null ? null : Number(totalItems),
        items: filterCollectionItems(itemsOrResponse, name, filterPredicate),
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
        totalItems: totalItems == null ? null : Number(totalItems),
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
        try {
          const page = await collectionCallbacks.dispatcher(
            context,
            identifier,
            cursor,
            filter,
          );
          if (page == null) {
            span.setStatus({ code: SpanStatusCode.ERROR });
            return await onNotFound(request);
          }
          span.setAttribute("fedify.collection.items", page.items.length);
          return page;
        } catch (e) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: String(e) });
          throw e;
        } finally {
          span.end();
        }
      },
    );
    if (pageOrResponse instanceof Response) return pageOrResponse;
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
      items: filterCollectionItems(items, name, filterPredicate),
      partOf,
    });
  }
  if (!acceptsJsonLd(request)) return await onNotAcceptable(request);
  if (collectionCallbacks.authorizePredicate != null) {
    let key = await context.getSignedKey();
    key = key?.clone({}, {
      // @ts-expect-error: $warning is not part of the type definition
      $warning: {
        category: ["fedify", "federation", "collection"],
        message: "The third parameter of AuthorizePredicate is deprecated in " +
          "favor of RequestContext.getSignedKey() method.  The third " +
          "parameter will be removed in a future release.",
      },
    }) ?? null;
    let keyOwner = await context.getSignedKeyOwner();
    keyOwner = keyOwner?.clone({}, {
      // @ts-expect-error: $warning is not part of the type definition
      $warning: {
        category: ["fedify", "federation", "collection"],
        message:
          "The fourth parameter of AuthorizePredicate is deprecated in " +
          "favor of RequestContext.getSignedKeyOwner() method.  The fourth " +
          "parameter will be removed in a future release.",
      },
    }) ?? null;
    if (
      !await collectionCallbacks.authorizePredicate(
        context,
        identifier,
        key,
        keyOwner,
      )
    ) {
      return await onUnauthorized(request);
    }
  }
  const jsonLd = await collection.toJsonLd(context);
  return new Response(JSON.stringify(jsonLd), {
    headers: {
      "Content-Type": "application/activity+json",
      Vary: "Accept",
    },
  });
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
  items: TItem[],
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
  };
  queue?: MessageQueue;
  actorDispatcher?: ActorDispatcher<TContextData>;
  inboxListeners?: InboxListenerSet<TContextData>;
  inboxErrorHandler?: InboxErrorHandler<TContextData>;
  onNotFound(request: Request): Response | Promise<Response>;
  signatureTimeWindow: Temporal.Duration | Temporal.DurationLike | false;
  skipSignatureVerification: boolean;
  tracerProvider?: TracerProvider;
  notifyInboundActivity?: (
    context: Context<TContextData>,
    activity: Activity,
  ) => Promise<void>;
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
  {
    recipient,
    context: ctx,
    inboxContextFactory,
    kv,
    kvPrefixes,
    queue,
    actorDispatcher,
    inboxListeners,
    inboxErrorHandler,
    onNotFound,
    signatureTimeWindow,
    skipSignatureVerification,
    tracerProvider,
    notifyInboundActivity,
  }: InboxHandlerParameters<TContextData>,
  span: Span,
): Promise<Response> {
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
    if (actor == null) {
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
  let ldSigVerified: boolean;
  try {
    ldSigVerified = await verifyJsonLd(json, {
      contextLoader: ctx.contextLoader,
      documentLoader: ctx.documentLoader,
      keyCache,
      tracerProvider,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "jsonld.SyntaxError") {
      logger.error("Failed to parse JSON-LD:\n{error}", { recipient, error });
      return new Response("Invalid JSON-LD.", {
        status: 400,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    ldSigVerified = false;
  }
  const jsonWithoutSig = detachSignature(json);
  let activity: Activity | null = null;
  if (ldSigVerified) {
    logger.debug("Linked Data Signatures are verified.", { recipient, json });
    activity = await Activity.fromJsonLd(jsonWithoutSig, ctx);
  } else {
    logger.debug(
      "Linked Data Signatures are not verified.",
      { recipient, json },
    );
    try {
      activity = await verifyObject(Activity, jsonWithoutSig, {
        contextLoader: ctx.contextLoader,
        documentLoader: ctx.documentLoader,
        keyCache,
        tracerProvider,
      });
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
    }
  }
  let httpSigKey: CryptographicKey | null = null;
  if (activity == null) {
    if (!skipSignatureVerification) {
      const key = await verifyRequest(request, {
        contextLoader: ctx.contextLoader,
        documentLoader: ctx.documentLoader,
        timeWindow: signatureTimeWindow,
        keyCache,
        tracerProvider,
      });
      if (key == null) {
        logger.error(
          "Failed to verify the request's HTTP Signatures.",
          { recipient },
        );
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: `Failed to verify the request's HTTP Signatures.`,
        });
        const response = new Response(
          "Failed to verify the request signature.",
          {
            status: 401,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          },
        );
        return response;
      } else {
        logger.debug("HTTP Signatures are verified.", { recipient });
      }
      httpSigKey = key;
    }
    activity = await Activity.fromJsonLd(jsonWithoutSig, ctx);
  }
  if (activity.id != null) {
    span.setAttribute("activitypub.activity.id", activity.id.href);
  }
  span.setAttribute("activitypub.activity.type", getTypeId(activity).href);

  // Notify observers about the inbound activity
  if (notifyInboundActivity != null) {
    try {
      await notifyInboundActivity(ctx, activity);
    } catch (error) {
      logger.error("Failed to notify inbound activity observer", { error });
      // Don't fail the request if observer fails
    }
  }

  const routeResult = await routeActivity({
    context: ctx,
    json,
    activity,
    recipient,
    inboxListeners,
    inboxContextFactory,
    inboxErrorHandler,
    kv,
    kvPrefixes,
    queue,
    span,
    tracerProvider,
  });
  if (
    httpSigKey != null && !await doesActorOwnKey(activity, httpSigKey, ctx)
  ) {
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
 * @template TParams The parameter names of the requested URL.
 * @template TContext The type of the context. {@link Context} or {@link RequestContext}.
 * @template TContextData The context data to pass to the `TContext`.
 * @since 1.8.0
 */
export interface CustomCollectionCallbacks<
  TItem,
  TParams extends Record<string, string>,
  TContext extends Context<TContextData>,
  TContextData,
> {
  /**
   * A callback that dispatches a custom collection.
   */
  dispatcher: CustomCollectionDispatcher<
    TItem,
    TParams,
    TContext,
    TContextData
  >;

  /**
   * A callback that counts the number of items in a custom collection.
   */
  counter?: CustomCollectionCounter<TParams, TContextData>;

  /**
   * A callback that returns the first cursor for a custom collection.
   */
  firstCursor?: CustomCollectionCursor<TParams, TContext, TContextData>;

  /**
   * A callback that returns the last cursor for a custom collection.
   */
  lastCursor?: CustomCollectionCursor<TParams, TContext, TContextData>;

  /**
   * A callback that determines if a request is authorized to access the custom collection.
   */
  authorizePredicate?: ObjectAuthorizePredicate<
    TContextData,
    keyof TParams & string
  >;
}

/**
 * Parameters for handling a custom collection.
 * @template TItem The type of items in the collection.
 * @template TParams The parameter names of the requested URL.
 * @template TContext The type of the context, extending {@link RequestContext}.
 * @template TContextData The context data to pass to the `TContext`.
 * @since 1.8.0
 */
export interface CustomCollectionHandlerParameters<
  TItem,
  TParams extends Record<string, string>,
  TContext extends RequestContext<TContextData>,
  TContextData,
> extends ErrorHandlers {
  name: string;
  values: TParams;
  filterPredicate?: (item: TItem) => boolean;
  context: TContext;
  collectionCallbacks?: CustomCollectionCallbacks<
    TItem,
    TParams,
    TContext,
    TContextData
  >;
  tracerProvider?: TracerProvider;
}

/**
 * Handles a custom collection request.
 * @template TItem The type of items in the collection.
 * @template TParams The parameter names of the requested URL.
 * @template TContext The type of the context, extending {@link RequestContext}.
 * @template TContextData The context data to pass to the `TContext`.
 * @param request The HTTP request.
 * @param handleParams Parameters for handling the collection.
 * @returns A promise that resolves to an HTTP response.
 * @since 1.8.0
 */
export const handleCustomCollection: <
  TItem extends URL | Object | Link | Recipient,
  TParams extends Record<string, string>,
  TContext extends RequestContext<TContextData>,
  TContextData,
>(
  request: Request,
  handleParams: CustomCollectionHandlerParameters<
    TItem,
    TParams,
    TContext,
    TContextData
  >,
) => Promise<Response> = exceptWrapper(_handleCustomCollection);
async function _handleCustomCollection<
  TItem extends URL | Object | Link | Recipient,
  TParams extends Record<string, string>,
  TContext extends RequestContext<TContextData>,
  TContextData,
>(
  request: Request,
  {
    name,
    values,
    context,
    tracerProvider,
    collectionCallbacks: callbacks,
    filterPredicate,
  }: CustomCollectionHandlerParameters<
    TItem,
    TParams,
    TContext,
    TContextData
  >,
): Promise<Response> {
  verifyDefined(callbacks);
  verifyJsonLdRequest(request);
  await authIfNeeded(context, values, callbacks);
  const cursor = new URL(request.url).searchParams.get("cursor");
  return await new CustomCollectionHandler(
    name,
    values,
    context,
    callbacks,
    tracerProvider,
    Collection,
    CollectionPage,
    filterPredicate,
  ).fetchCollection(cursor)
    .toJsonLd()
    .then(respondAsActivity);
}

/**
 * Handles an ordered collection request.
 * @template TItem The type of items in the collection.
 * @template TParams The parameter names of the requested URL.
 * @template TContext The type of the context, extending {@link RequestContext}.
 * @template TContextData The context data to pass to the `TContext`.
 * @param request The HTTP request.
 * @param handleParams Parameters for handling the collection.
 * @returns A promise that resolves to an HTTP response.
 * @since 1.8.0
 */
export const handleOrderedCollection: <
  TItem extends URL | Object | Link | Recipient,
  TParams extends Record<string, string>,
  TContext extends RequestContext<TContextData>,
  TContextData,
>(
  request: Request,
  handleParams: CustomCollectionHandlerParameters<
    TItem,
    TParams,
    TContext,
    TContextData
  >,
) => Promise<Response> = exceptWrapper(_handleOrderedCollection);
async function _handleOrderedCollection<
  TItem extends URL | Object | Link | Recipient,
  TParams extends Record<string, string>,
  TContext extends RequestContext<TContextData>,
  TContextData,
>(
  request: Request,
  {
    name,
    values,
    context,
    tracerProvider,
    collectionCallbacks: callbacks,
    filterPredicate,
  }: CustomCollectionHandlerParameters<
    TItem,
    TParams,
    TContext,
    TContextData
  >,
): Promise<Response> {
  verifyDefined(callbacks);
  verifyJsonLdRequest(request);
  await authIfNeeded(context, values, callbacks);
  const cursor = new URL(request.url).searchParams.get("cursor");
  return await new CustomCollectionHandler(
    name,
    values,
    context,
    callbacks,
    tracerProvider,
    OrderedCollection,
    OrderedCollectionPage,
    filterPredicate,
  ).fetchCollection(cursor)
    .toJsonLd()
    .then(respondAsActivity);
}

/**
 * Handling custom collections with support for pagination and filtering.
 * The main flow is on `getCollection`, `dispatch`.
 *
 * @template TItem The type of items in the collection.
 * @template TParams The parameter names of the requested URL.
 * @template TContext The type of the context. {@link Context} or {@link RequestContext}.
 * @template TContextData The context data to pass to the `TContext`.
 * @template TCollection The type of the collection, extending {@link Collection}.
 * @template TCollectionPage The type of the collection page, extending {@link CollectionPage}.
 * @since 1.8.0
 */
class CustomCollectionHandler<
  TItem extends URL | Object | Link | Recipient,
  TParams extends Record<string, string>,
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
    TParams,
    TContext,
    TContextData
  >;
  #collection: Promise<TCollection | TCollectionPage> | null = null;

  /**
   * Creates a new CustomCollection instance.
   * @param {string} name The name of the collection.
   * @param {TParams} values The parameter values for the collection.
   * @param {TContext} context The request context.
   * @param {CustomCollectionCallbacks} callbacks The collection callbacks.
   * @param {TracerProvider} tracerProvider The tracer provider for telemetry.
   * @param {ConstructorWithTypeId<TCollection>} Collection The Collection constructor.
   * @param {ConstructorWithTypeId<TCollectionPage>} CollectionPage The CollectionPage constructor.
   * @param {(item: TItem) => boolean} filterPredicate Optional filter predicate for items.
   */
  constructor(
    private readonly name: string,
    private readonly values: TParams,
    private readonly context: TContext,
    private readonly callbacks: CustomCollectionCallbacks<
      TItem,
      TParams,
      TContext,
      TContextData
    >,
    private readonly tracerProvider: TracerProvider = trace.getTracerProvider(),
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
    return {
      id,
      partOf,
      items: this.filterItems(pages.items),
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
    return {
      id: this.#id,
      first: this.appendToUrl(firstCursor),
      last: this.appendToUrl(lastCursor),
      totalItems: await this.totalItems,
    };
  }

  /**
   * Gets the properties for a collection of all items and the count.
   * @returns A promise that resolves to the collection properties.
   */
  async getPropsWithoutCursor() {
    const totalItems = await this.totalItems;
    const pages = await this.getPages({ totalItems });
    return {
      id: this.#id,
      totalItems,
      items: this.filterItems(pages.items),
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
   * @returns {(span: Span) => Promise<PageItems<TItem>>} A function that handles the span operation.
   */
  spanPages: (params: {
    totalItems?: number | null;
    cursor?: string | null;
  }) => (span: Span) => Promise<PageItems<TItem>> = ({
    totalItems = null,
    cursor = null,
  }) =>
  async (span: Span): Promise<PageItems<TItem>> => {
    try {
      if (totalItems !== null) {
        span.setAttribute(this.ATTRS.TOTAL_ITEMS, totalItems);
      }
      const page = await this.dispatch(cursor);
      span.setAttribute(this.ATTRS.ITEMS, page.items.length);
      return page;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      throw e;
    } finally {
      span.end();
    }
  };

  /**
   * Dispatches the collection request to get items.
   * @param {string | null} cursor The cursor for pagination, or null for the first page.
   * @returns {Promise<PageItems<TItem>>} A promise that resolves to the page items.
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
   * @param {TItem[]} items The items to filter.
   * @returns {(Object | Link | URL)[]} The filtered items.
   */
  filterItems(items: TItem[]): (Object | Link | URL)[] {
    return filterCollectionItems(items, this.name, this.filterPredicate);
  }

  /**
   * Appends a cursor to the URL if it exists.
   * @param {string | null | undefined} cursor The cursor to append, or null/undefined.
   * @returns The URL with cursor appended, or null if cursor is null/undefined.
   */
  appendToUrl<Cursor extends string | null | undefined>(
    cursor: Cursor,
  ): Cursor extends string ? URL : null {
    return appendCursorIfExists(this.context.url, cursor);
  }

  /**
   * Gets the stored collection or collection page.
   * @returns {Promise<TCollection | TCollectionPage>} A promise that resolves to
      the collection or collection page.
   */
  get collection(): Promise<TCollection | TCollectionPage> {
    if (this.#collection === null) {
      this.#collection = this.getCollection();
    }
    return this.#collection;
  }

  /**
   * Gets the total number of items in the collection.
   * @returns {Promise<number | null>} A promise that
      resolves to the total items count, or null if not available.
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
   * @returns {Promise<string | null>} A promise that resolves to the first cursor,
      or null if not available.
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
    try {
      return await handler(request, handlerParams);
    } catch (error) {
      const { onNotFound, onNotAcceptable, onUnauthorized } = handlerParams;
      switch (error?.constructor) {
        case ItemsNotFoundError:
          return await onNotFound(request);
        case NotAcceptableError:
          return await onNotAcceptable(request);
        case UnauthorizedError:
          return await onUnauthorized(request);
        default:
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
  onNotFound(request: Request): Response | Promise<Response>;
  onNotAcceptable(request: Request): Response | Promise<Response>;
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
 * Verifies that a request accepts JSON-LD content type.
 * @param request The HTTP request to verify.
 * @throws {NotAcceptableError} If the request doesn't accept JSON-LD.
 * @since 1.8.0
 */
const verifyJsonLdRequest = (request: Request): void | never => {
  if (!acceptsJsonLd(request)) throw new NotAcceptableError();
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
  const key = (await context.getSignedKey())
    // @ts-expect-error: $warning is not part of the type definition
    ?.clone({}, warning.key) ?? null;
  const keyOwner = (await context.getSignedKeyOwner())
    // @ts-expect-error: $warning is not part of the type definition
    ?.clone({}, warning.keyOwner) ?? null;
  if (!await authorize(context, values, key, keyOwner)) {
    throw new UnauthorizedError();
  }
};

/** Warning messages for `authIfNeeded`. */
const warning = {
  key: {
    $warning: {
      category: ["fedify", "federation", "collection"],
      message:
        "The third parameter of AuthorizePredicate is deprecated in favor of " +
        "RequestContext.getSignedKey() method.  The third parameter will be " +
        "removed in a future release.",
    },
  },
  keyOwner: {
    $warning: {
      category: ["fedify", "federation", "collection"],
      message: "The fourth parameter of AuthorizePredicate is deprecated in " +
        "favor of RequestContext.getSignedKeyOwner() method.  The fourth " +
        "parameter will be removed in a future release.",
    },
  },
} as const;

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
 * Error thrown when the request is not acceptable (e.g., wrong content type).
 * @since 1.8.0
 */
class NotAcceptableError extends HandlerError {
  constructor() {
    super("The request is not acceptable.");
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
