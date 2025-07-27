import { getLogger } from "@logtape/logtape";
import type { Span, TracerProvider } from "@opentelemetry/api";
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
  InboxErrorHandler,
  ObjectAuthorizePredicate,
  ObjectDispatcher,
} from "./callback.ts";
import type { Context, InboxContext, RequestContext } from "./context.ts";
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

export interface ActorHandlerParameters<TContextData> {
  identifier: string;
  context: RequestContext<TContextData>;
  actorDispatcher?: ActorDispatcher<TContextData>;
  authorizePredicate?: AuthorizePredicate<TContextData>;
  onUnauthorized(request: Request): Response | Promise<Response>;
  onNotFound(request: Request): Response | Promise<Response>;
  onNotAcceptable(request: Request): Response | Promise<Response>;
}

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

export interface ObjectHandlerParameters<TContextData> {
  values: Record<string, string>;
  context: RequestContext<TContextData>;
  objectDispatcher?: ObjectDispatcher<TContextData, Object, string>;
  authorizePredicate?: ObjectAuthorizePredicate<TContextData, string>;
  onUnauthorized(request: Request): Response | Promise<Response>;
  onNotFound(request: Request): Response | Promise<Response>;
  onNotAcceptable(request: Request): Response | Promise<Response>;
}

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
    activity: Activity
  ) => Promise<void>;
}

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
