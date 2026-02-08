import type {
  Activity,
  Actor,
  Hashtag,
  Object,
  Recipient,
} from "@fedify/vocab";
import type {
  AuthenticatedDocumentLoaderFactory,
  DocumentLoaderFactory,
  GetUserAgentOptions,
} from "@fedify/vocab-runtime";
import type { TracerProvider } from "@opentelemetry/api";
import type { ActivityTransformer } from "../compat/types.ts";
import type { HttpMessageSignaturesSpec } from "../sig/http.ts";
import type {
  ActorAliasMapper,
  ActorDispatcher,
  ActorHandleMapper,
  ActorKeyPairsDispatcher,
  AuthorizePredicate,
  CollectionCounter,
  CollectionCursor,
  CollectionDispatcher,
  CustomCollectionCounter,
  CustomCollectionCursor,
  CustomCollectionDispatcher,
  InboxErrorHandler,
  InboxListener,
  NodeInfoDispatcher,
  ObjectAuthorizePredicate,
  ObjectDispatcher,
  OutboxErrorHandler,
  OutboxPermanentFailureHandler,
  SharedInboxKeyDispatcher,
  WebFingerLinksDispatcher,
} from "./callback.ts";
import type { Context, InboxContext, RequestContext } from "./context.ts";
import type { KvStore } from "./kv.ts";
import type {
  FederationKvPrefixes,
  FederationOrigin,
  FederationQueueOptions,
} from "./middleware.ts";
import type { MessageQueue } from "./mq.ts";
import type { Message } from "./queue.ts";
import type { RetryPolicy } from "./retry.ts";

/**
 * Options for {@link Federation.startQueue} method.
 * @since 1.0.0
 */
export interface FederationStartQueueOptions {
  /**
   * The signal to abort the task queue.
   */
  signal?: AbortSignal;

  /**
   * Starts the task worker only for the specified queue.  If unspecified,
   * which is the default, the task worker starts for all three queues:
   * inbox, outbox, and fanout.
   * @since 1.3.0
   */
  queue?: "inbox" | "outbox" | "fanout";
}

/**
 * A common interface between {@link Federation} and {@link FederationBuilder}.
 * @template TContextData The context data to pass to the {@link Context}.
 * @since 1.6.0
 */
export interface Federatable<TContextData> {
  /**
   * Registers a NodeInfo dispatcher.
   * @param path The URI path pattern for the NodeInfo dispatcher.  The syntax
   *             is based on URI Template
   *             ([RFC 6570](https://tools.ietf.org/html/rfc6570)).  The path
   *             must have no variables.
   * @param dispatcher A NodeInfo dispatcher callback to register.
   * @throws {RouterError} Thrown if the path pattern is invalid.
   */
  setNodeInfoDispatcher(
    path: string,
    dispatcher: NodeInfoDispatcher<TContextData>,
  ): void;

  /**
   * Registers a links dispatcher to WebFinger
   * @param dispatcher A links dispatcher callback to register.
   */
  setWebFingerLinksDispatcher(
    dispatcher: WebFingerLinksDispatcher<TContextData>,
  ): void;

  /**
   * Registers an actor dispatcher.
   *
   * @example
   * ``` typescript
   * federation.setActorDispatcher(
   *   "/users/{identifier}",
   *   async (ctx, identifier) => {
   *     return new Person({
   *       id: ctx.getActorUri(identifier),
   *       // ...
   *     });
   *   }
   * );
   * ```
   *
   * @param path The URI path pattern for the actor dispatcher.  The syntax is
   *             based on URI Template
   *             ([RFC 6570](https://tools.ietf.org/html/rfc6570)).  The path
   *             must have one variable: `{identifier}`.
   * @param dispatcher An actor dispatcher callback to register.
   * @returns An object with methods to set other actor dispatcher callbacks.
   * @throws {RouterError} Thrown if the path pattern is invalid.
   */
  setActorDispatcher(
    path:
      | `${string}${Rfc6570Expression<"identifier">}${string}`
      | `${string}${Rfc6570Expression<"handle">}${string}`,
    dispatcher: ActorDispatcher<TContextData>,
  ): ActorCallbackSetters<TContextData>;

  /**
   * Registers an object dispatcher.
   *
   * @template TContextData The context data to pass to the {@link Context}.
   * @template TObject The type of object to dispatch.
   * @template TParam The parameter names of the requested URL.
   * @param cls The Activity Vocabulary class of the object to dispatch.
   * @param path The URI path pattern for the object dispatcher.  The syntax is
   *             based on URI Template
   *             ([RFC 6570](https://tools.ietf.org/html/rfc6570)).  The path
   *             must have one or more variables.
   * @param dispatcher An object dispatcher callback to register.
   */
  setObjectDispatcher<TObject extends Object, TParam extends string>(
    cls: ConstructorWithTypeId<TObject>,
    path:
      `${string}{${TParam}}${string}{${TParam}}${string}{${TParam}}${string}{${TParam}}${string}{${TParam}}${string}{${TParam}}${string}`,
    dispatcher: ObjectDispatcher<TContextData, TObject, TParam>,
  ): ObjectCallbackSetters<TContextData, TObject, TParam>;

  /**
   * Registers an object dispatcher.
   *
   * @template TContextData The context data to pass to the {@link Context}.
   * @template TObject The type of object to dispatch.
   * @template TParam The parameter names of the requested URL.
   * @param cls The Activity Vocabulary class of the object to dispatch.
   * @param path The URI path pattern for the object dispatcher.  The syntax is
   *             based on URI Template
   *             ([RFC 6570](https://tools.ietf.org/html/rfc6570)).  The path
   *             must have one or more variables.
   * @param dispatcher An object dispatcher callback to register.
   */
  setObjectDispatcher<TObject extends Object, TParam extends string>(
    cls: ConstructorWithTypeId<TObject>,
    path:
      `${string}{${TParam}}${string}{${TParam}}${string}{${TParam}}${string}{${TParam}}${string}{${TParam}}${string}`,
    dispatcher: ObjectDispatcher<TContextData, TObject, TParam>,
  ): ObjectCallbackSetters<TContextData, TObject, TParam>;

  /**
   * Registers an object dispatcher.
   *
   * @template TContextData The context data to pass to the {@link Context}.
   * @template TObject The type of object to dispatch.
   * @template TParam The parameter names of the requested URL.
   * @param cls The Activity Vocabulary class of the object to dispatch.
   * @param path The URI path pattern for the object dispatcher.  The syntax is
   *             based on URI Template
   *             ([RFC 6570](https://tools.ietf.org/html/rfc6570)).  The path
   *             must have one or more variables.
   * @param dispatcher An object dispatcher callback to register.
   */
  setObjectDispatcher<TObject extends Object, TParam extends string>(
    cls: ConstructorWithTypeId<TObject>,
    path:
      `${string}{${TParam}}${string}{${TParam}}${string}{${TParam}}${string}{${TParam}}${string}`,
    dispatcher: ObjectDispatcher<TContextData, TObject, TParam>,
  ): ObjectCallbackSetters<TContextData, TObject, TParam>;

  /**
   * Registers an object dispatcher.
   *
   * @template TContextData The context data to pass to the {@link Context}.
   * @template TObject The type of object to dispatch.
   * @template TParam The parameter names of the requested URL.
   * @param cls The Activity Vocabulary class of the object to dispatch.
   * @param path The URI path pattern for the object dispatcher.  The syntax is
   *             based on URI Template
   *             ([RFC 6570](https://tools.ietf.org/html/rfc6570)).  The path
   *             must have one or more variables.
   * @param dispatcher An object dispatcher callback to register.
   */
  setObjectDispatcher<TObject extends Object, TParam extends string>(
    cls: ConstructorWithTypeId<TObject>,
    path: `${string}${Rfc6570Expression<TParam>}${string}${Rfc6570Expression<
      TParam
    >}${string}${Rfc6570Expression<TParam>}${string}`,
    dispatcher: ObjectDispatcher<TContextData, TObject, TParam>,
  ): ObjectCallbackSetters<TContextData, TObject, TParam>;

  /**
   * Registers an object dispatcher.
   *
   * @template TContextData The context data to pass to the {@link Context}.
   * @template TObject The type of object to dispatch.
   * @template TParam The parameter names of the requested URL.
   * @param cls The Activity Vocabulary class of the object to dispatch.
   * @param path The URI path pattern for the object dispatcher.  The syntax is
   *             based on URI Template
   *             ([RFC 6570](https://tools.ietf.org/html/rfc6570)).  The path
   *             must have one or more variables.
   * @param dispatcher An object dispatcher callback to register.
   */
  setObjectDispatcher<TObject extends Object, TParam extends string>(
    cls: ConstructorWithTypeId<TObject>,
    path: `${string}${Rfc6570Expression<TParam>}${string}${Rfc6570Expression<
      TParam
    >}${string}`,
    dispatcher: ObjectDispatcher<TContextData, TObject, TParam>,
  ): ObjectCallbackSetters<TContextData, TObject, TParam>;

  /**
   * Registers an object dispatcher.
   *
   * @template TContextData The context data to pass to the {@link Context}.
   * @template TObject The type of object to dispatch.
   * @template TParam The parameter names of the requested URL.
   * @param cls The Activity Vocabulary class of the object to dispatch.
   * @param path The URI path pattern for the object dispatcher.  The syntax is
   *             based on URI Template
   *             ([RFC 6570](https://tools.ietf.org/html/rfc6570)).  The path
   *             must have one or more variables.
   * @param dispatcher An object dispatcher callback to register.
   */
  setObjectDispatcher<TObject extends Object, TParam extends string>(
    cls: ConstructorWithTypeId<TObject>,
    path: `${string}${Rfc6570Expression<TParam>}${string}`,
    dispatcher: ObjectDispatcher<TContextData, TObject, TParam>,
  ): ObjectCallbackSetters<TContextData, TObject, TParam>;

  /**
   * Registers an inbox dispatcher.
   *
   * @param path The URI path pattern for the inbox dispatcher.  The syntax is
   *             based on URI Template
   *             ([RFC 6570](https://tools.ietf.org/html/rfc6570)).  The path
   *             must have one variable: `{identifier}`, and must match
   *             the inbox listener path.
   * @param dispatcher An inbox dispatcher callback to register.
   * @throws {@link RouterError} Thrown if the path pattern is invalid.
   */
  setInboxDispatcher(
    path:
      | `${string}${Rfc6570Expression<"identifier">}${string}`
      | `${string}${Rfc6570Expression<"handle">}${string}`,
    dispatcher: CollectionDispatcher<
      Activity,
      RequestContext<TContextData>,
      TContextData,
      void
    >,
  ): CollectionCallbackSetters<
    RequestContext<TContextData>,
    TContextData,
    void
  >;

  /**
   * Registers an outbox dispatcher.
   *
   * @example
   * ``` typescript
   * federation.setOutboxDispatcher(
   *   "/users/{identifier}/outbox",
   *   async (ctx, identifier, options) => {
   *     let items: Activity[];
   *     let nextCursor: string;
   *     // ...
   *     return { items, nextCursor };
   *   }
   * );
   * ```
   *
   * @param path The URI path pattern for the outbox dispatcher.  The syntax is
   *             based on URI Template
   *             ([RFC 6570](https://tools.ietf.org/html/rfc6570)).  The path
   *             must have one variable: `{identifier}`.
   * @param dispatcher An outbox dispatcher callback to register.
   * @throws {@link RouterError} Thrown if the path pattern is invalid.
   */
  setOutboxDispatcher(
    path:
      | `${string}${Rfc6570Expression<"identifier">}${string}`
      | `${string}${Rfc6570Expression<"handle">}${string}`,
    dispatcher: CollectionDispatcher<
      Activity,
      RequestContext<TContextData>,
      TContextData,
      void
    >,
  ): CollectionCallbackSetters<
    RequestContext<TContextData>,
    TContextData,
    void
  >;

  /**
   * Registers a following collection dispatcher.
   * @param path The URI path pattern for the following collection.  The syntax
   *             is based on URI Template
   *             ([RFC 6570](https://tools.ietf.org/html/rfc6570)).  The path
   *             must have one variable: `{identifier}`.
   * @param dispatcher A following collection callback to register.
   * @returns An object with methods to set other following collection
   *          callbacks.
   * @throws {RouterError} Thrown if the path pattern is invalid.
   */
  setFollowingDispatcher(
    path:
      | `${string}${Rfc6570Expression<"identifier">}${string}`
      | `${string}${Rfc6570Expression<"handle">}${string}`,
    dispatcher: CollectionDispatcher<
      Actor | URL,
      RequestContext<TContextData>,
      TContextData,
      void
    >,
  ): CollectionCallbackSetters<
    RequestContext<TContextData>,
    TContextData,
    void
  >;

  /**
   * Registers a followers collection dispatcher.
   * @param path The URI path pattern for the followers collection.  The syntax
   *             is based on URI Template
   *             ([RFC 6570](https://tools.ietf.org/html/rfc6570)).  The path
   *             must have one variable: `{identifier}`.
   * @param dispatcher A followers collection callback to register.
   * @returns An object with methods to set other followers collection
   *          callbacks.
   * @throws {@link RouterError} Thrown if the path pattern is invalid.
   */
  setFollowersDispatcher(
    path:
      | `${string}${Rfc6570Expression<"identifier">}${string}`
      | `${string}${Rfc6570Expression<"handle">}${string}`,
    dispatcher: CollectionDispatcher<
      Recipient,
      Context<TContextData>,
      TContextData,
      URL
    >,
  ): CollectionCallbackSetters<Context<TContextData>, TContextData, URL>;

  /**
   * Registers a liked collection dispatcher.
   * @param path The URI path pattern for the liked collection.  The syntax
   *             is based on URI Template
   *             ([RFC 6570](https://tools.ietf.org/html/rfc6570)).  The path
   *             must have one variable: `{identifier}`.
   * @param dispatcher A liked collection callback to register.
   * @returns An object with methods to set other liked collection
   *          callbacks.
   * @throws {@link RouterError} Thrown if the path pattern is invalid.
   */
  setLikedDispatcher(
    path:
      | `${string}${Rfc6570Expression<"identifier">}${string}`
      | `${string}${Rfc6570Expression<"handle">}${string}`,
    dispatcher: CollectionDispatcher<
      Object | URL,
      RequestContext<TContextData>,
      TContextData,
      void
    >,
  ): CollectionCallbackSetters<
    RequestContext<TContextData>,
    TContextData,
    void
  >;

  /**
   * Registers a featured collection dispatcher.
   * @param path The URI path pattern for the featured collection.  The syntax
   *             is based on URI Template
   *             ([RFC 6570](https://tools.ietf.org/html/rfc6570)).  The path
   *             must have one variable: `{identifier}`.
   * @param dispatcher A featured collection callback to register.
   * @returns An object with methods to set other featured collection
   *          callbacks.
   * @throws {@link RouterError} Thrown if the path pattern is invalid.
   */
  setFeaturedDispatcher(
    path:
      | `${string}${Rfc6570Expression<"identifier">}${string}`
      | `${string}${Rfc6570Expression<"handle">}${string}`,
    dispatcher: CollectionDispatcher<
      Object,
      RequestContext<TContextData>,
      TContextData,
      void
    >,
  ): CollectionCallbackSetters<
    RequestContext<TContextData>,
    TContextData,
    void
  >;

  /**
   * Registers a featured tags collection dispatcher.
   * @param path The URI path pattern for the featured tags collection.
   *             The syntax is based on URI Template
   *             ([RFC 6570](https://tools.ietf.org/html/rfc6570)).  The path
   *             must have one variable: `{identifier}`.
   * @param dispatcher A featured tags collection callback to register.
   * @returns An object with methods to set other featured tags collection
   *          callbacks.
   * @throws {@link RouterError} Thrown if the path pattern is invalid.
   */
  setFeaturedTagsDispatcher(
    path:
      | `${string}${Rfc6570Expression<"identifier">}${string}`
      | `${string}${Rfc6570Expression<"handle">}${string}`,
    dispatcher: CollectionDispatcher<
      Hashtag,
      RequestContext<TContextData>,
      TContextData,
      void
    >,
  ): CollectionCallbackSetters<
    RequestContext<TContextData>,
    TContextData,
    void
  >;

  /**
   * Assigns the URL path for the inbox and starts setting inbox listeners.
   *
   * @example
   * ``` typescript
   * federation
   *   .setInboxListeners("/users/{identifier}/inbox", "/inbox")
   *   .on(Follow, async (ctx, follow) => {
   *     const from = await follow.getActor(ctx);
   *     if (!isActor(from)) return;
   *     // ...
   *   })
   *   .on(Undo, async (ctx, undo) => {
   *     // ...
   *   });
   * ```
   *
   * @param inboxPath The URI path pattern for the inbox.  The syntax is based
   *                  on URI Template
   *                  ([RFC 6570](https://tools.ietf.org/html/rfc6570)).
   *                  The path must have one variable: `{identifier}`, and must
   *                  match the inbox dispatcher path.
   * @param sharedInboxPath An optional URI path pattern for the shared inbox.
   *                        The syntax is based on URI Template
   *                        ([RFC 6570](https://tools.ietf.org/html/rfc6570)).
   *                        The path must have no variables.
   * @returns An object to register inbox listeners.
   * @throws {RouterError} Thrown if the path pattern is invalid.
   */
  setInboxListeners(
    inboxPath:
      | `${string}${Rfc6570Expression<"identifier">}${string}`
      | `${string}${Rfc6570Expression<"handle">}${string}`,
    sharedInboxPath?: string,
  ): InboxListenerSetters<TContextData>;

  /**
   * Registers a collection of objects dispatcher.
   *
   * @template TContextData The context data to pass to the {@link Context}.
   * @template TObject The type of objects to dispatch.
   * @template TParam The parameter names of the requested URL.
   * @param name A unique name for the collection dispatcher.
   * @param itemType The Activity Vocabulary class of the object to dispatch.
   * @param path The URI path pattern for the collection dispatcher.
   *             The syntax is based on URI Template
   *             ([RFC 6570](https://tools.ietf.org/html/rfc6570)).
   *             The path must have one or more variables.
   * @param dispatcher A collection dispatcher callback to register.
   */
  setCollectionDispatcher<TObject extends Object, TParam extends string>(
    name: string | symbol,
    itemType: ConstructorWithTypeId<TObject>,
    path: `${string}${Rfc6570Expression<
      TParam
    >}${string}${Rfc6570Expression<
      TParam
    >}${string}${Rfc6570Expression<
      TParam
    >}${string}`,
    dispatcher: CustomCollectionDispatcher<
      TObject,
      TParam,
      RequestContext<TContextData>,
      TContextData
    >,
  ): CustomCollectionCallbackSetters<
    TParam,
    RequestContext<TContextData>,
    TContextData
  >;

  /**
   * Registers a collection of objects dispatcher.
   *
   * @template TContextData The context data to pass to the {@link Context}.
   * @template TObject The type of objects to dispatch.
   * @template TParam The parameter names of the requested URL.
   * @param name A unique name for the collection dispatcher.
   * @param itemType The Activity Vocabulary class of the object to dispatch.
   * @param path The URI path pattern for the collection dispatcher.
   *             The syntax is based on URI Template
   *             ([RFC 6570](https://tools.ietf.org/html/rfc6570)).
   *             The path must have one or more variables.
   * @param dispatcher A collection dispatcher callback to register.
   */
  setCollectionDispatcher<TObject extends Object, TParam extends string>(
    name: string | symbol,
    itemType: ConstructorWithTypeId<TObject>,
    path: `${string}${Rfc6570Expression<TParam>}${string}${Rfc6570Expression<
      TParam
    >}${string}`,
    dispatcher: CustomCollectionDispatcher<
      TObject,
      TParam,
      RequestContext<TContextData>,
      TContextData
    >,
  ): CustomCollectionCallbackSetters<
    TParam,
    RequestContext<TContextData>,
    TContextData
  >;

  /**
   * Registers a collection of objects dispatcher.
   *
   * @template TContextData The context data to pass to the {@link Context}.
   * @template TObject The type of objects to dispatch.
   * @template TParam The parameter names of the requested URL.
   * @param name A unique name for the collection dispatcher.
   * @param itemType The Activity Vocabulary class of the object to dispatch.
   * @param path The URI path pattern for the collection dispatcher.
   *             The syntax is based on URI Template
   *             ([RFC 6570](https://tools.ietf.org/html/rfc6570)).
   *             The path must have one or more variables.
   * @param dispatcher A collection dispatcher callback to register.
   */
  setCollectionDispatcher<TObject extends Object, TParam extends string>(
    name: string | symbol,
    itemType: ConstructorWithTypeId<TObject>,
    path: `${string}${Rfc6570Expression<TParam>}${string}`,
    dispatcher: CustomCollectionDispatcher<
      TObject,
      TParam,
      RequestContext<TContextData>,
      TContextData
    >,
  ): CustomCollectionCallbackSetters<
    TParam,
    RequestContext<TContextData>,
    TContextData
  >;

  /**
   * Registers an ordered collection of objects dispatcher.
   *
   * @template TContextData The context data to pass to the {@link Context}.
   * @template TObject The type of objects to dispatch.
   * @template TParam The parameter names of the requested URL.
   * @param name A unique name for the collection dispatcher.
   * @param itemType The Activity Vocabulary class of the object to dispatch.
   * @param path The URI path pattern for the collection dispatcher.
   *             The syntax is based on URI Template
   *             ([RFC 6570](https://tools.ietf.org/html/rfc6570)).
   *             The path must have one or more variables.
   * @param dispatcher A collection dispatcher callback to register.
   */
  setOrderedCollectionDispatcher<
    TObject extends Object,
    TParam extends string,
  >(
    name: string | symbol,
    itemType: ConstructorWithTypeId<TObject>,
    path: `${string}${Rfc6570Expression<TParam>}${string}${Rfc6570Expression<
      TParam
    >}${string}${Rfc6570Expression<TParam>}${string}`,
    dispatcher: CustomCollectionDispatcher<
      TObject,
      TParam,
      RequestContext<TContextData>,
      TContextData
    >,
  ): CustomCollectionCallbackSetters<
    TParam,
    RequestContext<TContextData>,
    TContextData
  >;

  /**
   * Registers an ordered collection of objects dispatcher.
   *
   * @template TContextData The context data to pass to the {@link Context}.
   * @template TObject The type of objects to dispatch.
   * @template TParam The parameter names of the requested URL.
   * @param name A unique name for the collection dispatcher.
   * @param itemType The Activity Vocabulary class of the object to dispatch.
   * @param path The URI path pattern for the collection dispatcher.
   *             The syntax is based on URI Template
   *             ([RFC 6570](https://tools.ietf.org/html/rfc6570)).
   *             The path must have one or more variables.
   * @param dispatcher A collection dispatcher callback to register.
   */
  setOrderedCollectionDispatcher<
    TObject extends Object,
    TParam extends string,
  >(
    name: string | symbol,
    itemType: ConstructorWithTypeId<TObject>,
    path: `${string}${Rfc6570Expression<TParam>}${string}${Rfc6570Expression<
      TParam
    >}${string}`,
    dispatcher: CustomCollectionDispatcher<
      TObject,
      TParam,
      RequestContext<TContextData>,
      TContextData
    >,
  ): CustomCollectionCallbackSetters<
    TParam,
    RequestContext<TContextData>,
    TContextData
  >;

  /**
   * Registers an ordered collection of objects dispatcher.
   *
   * @template TContextData The context data to pass to the {@link Context}.
   * @template TObject The type of objects to dispatch.
   * @template TParam The parameter names of the requested URL.
   * @param name A unique name for the collection dispatcher.
   * @param itemType The Activity Vocabulary class of the object to dispatch.
   * @param path The URI path pattern for the collection dispatcher.
   *             The syntax is based on URI Template
   *             ([RFC 6570](https://tools.ietf.org/html/rfc6570)).
   *             The path must have one or more variables.
   * @param dispatcher A collection dispatcher callback to register.
   */
  setOrderedCollectionDispatcher<
    TObject extends Object,
    TParam extends string,
  >(
    name: string | symbol,
    itemType: ConstructorWithTypeId<TObject>,
    path: `${string}${Rfc6570Expression<TParam>}${string}`,
    dispatcher: CustomCollectionDispatcher<
      TObject,
      TParam,
      RequestContext<TContextData>,
      TContextData
    >,
  ): CustomCollectionCallbackSetters<
    TParam,
    RequestContext<TContextData>,
    TContextData
  >;

  /**
   * Registers a handler for permanent delivery failures.
   *
   * This handler is called when an inbox returns an HTTP status code
   * that indicates permanent failure (`410 Gone`, `404 Not Found`, etc.),
   * allowing the application to clean up followers that are no longer
   * reachable.
   *
   * Unlike `onOutboxError`, which is called for every delivery failure
   * (including retries), this handler is called only once for permanent
   * failures, after which delivery is not retried.
   *
   * @param handler A callback to handle permanent failures.
   * @since 2.0.0
   */
  setOutboxPermanentFailureHandler(
    handler: OutboxPermanentFailureHandler<TContextData>,
  ): void;
}

/**
 * An object that registers federation-related business logic and dispatches
 * requests to the appropriate handlers.
 *
 * It also provides a middleware interface for handling requests before your
 * web framework's router; see {@link Federation.fetch}.
 * @template TContextData The context data to pass to the {@link Context}.
 * @since 0.13.0
 */
export interface Federation<TContextData> extends Federatable<TContextData> {
  /**
   * Manually start the task queue.
   *
   * This method is useful when you set the `manuallyStartQueue` option to
   * `true` in the {@link createFederation} function.
   * @param contextData The context data to pass to the context.
   * @param options Additional options for starting the queue.
   */
  startQueue(
    contextData: TContextData,
    options?: FederationStartQueueOptions,
  ): Promise<void>;

  /**
   * Processes a queued message task.  This method handles different types of
   * tasks such as fanout, outbox, and inbox messages.
   *
   * Note that you usually do not need to call this method directly unless you
   * are deploying your federated application on a platform that does not
   * support long-running processing, such as Cloudflare Workers.
   * @param contextData The context data to pass to the context.
   * @param message The message that represents the task to be processed.
   * @returns A promise that resolves when the message has been processed.
   * @since 1.6.0
   */
  processQueuedTask(contextData: TContextData, message: Message): Promise<void>;

  /**
   * Create a new context.
   * @param baseUrl The base URL of the server.  The `pathname` remains root,
   *                and the `search` and `hash` are stripped.
   * @param contextData The context data to pass to the context.
   * @returns The new context.
   */
  createContext(baseUrl: URL, contextData: TContextData): Context<TContextData>;

  /**
   * Create a new context for a request.
   * @param request The request object.
   * @param contextData The context data to pass to the context.
   * @returns The new request context.
   */
  createContext(
    request: Request,
    contextData: TContextData,
  ): RequestContext<TContextData>;

  /**
   * Handles a request related to federation.  If a request is not related to
   * federation, the `onNotFound` or `onNotAcceptable` callback is called.
   *
   * Usually, this method is called from a server's request handler or
   * a web framework's middleware.
   *
   * @param request The request object.
   * @param parameters The parameters for handling the request.
   * @returns The response to the request.
   */
  fetch(
    request: Request,
    options: FederationFetchOptions<TContextData>,
  ): Promise<Response>;
}

/**
 * A builder for creating a {@link Federation} object. It defers the actual
 * instantiation of the {@link Federation} object until the {@link build}
 * method is called so that dispatchers and listeners can be registered
 * before the {@link Federation} object is instantiated.
 * @template TContextData The context data to pass to the {@link Context}.
 * @since 1.6.0
 */
export interface FederationBuilder<TContextData>
  extends Federatable<TContextData> {
  /**
   * Builds the federation object.
   * @returns The federation object.
   */
  build(
    options: FederationOptions<TContextData>,
  ): Promise<Federation<TContextData>>;
}

/**
 * Options for creating a {@link Federation} object.
 * @template TContextData The context data to pass to the {@link Context}.
 * @since 1.6.0
 */
export interface FederationOptions<TContextData> {
  /**
   * The key–value store used for caching, outbox queues, and inbox idempotence.
   */
  kv: KvStore;

  /**
   * Prefixes for namespacing keys in the Deno KV store.  By default, all keys
   * are prefixed with `["_fedify"]`.
   */
  kvPrefixes?: Partial<FederationKvPrefixes>;

  /**
   * The message queue for sending and receiving activities.  If not provided,
   * activities will not be queued and will be processed immediately.
   *
   * If a `MessageQueue` is provided, both the `inbox` and `outbox` queues
   * will be set to the same queue.
   *
   * If a `FederationQueueOptions` object is provided, you can set the queues
   * separately (since Fedify 1.3.0).
   */
  queue?: FederationQueueOptions | MessageQueue;

  /**
   * Whether to start the task queue manually or automatically.
   *
   * If `true`, the task queue will not start automatically and you need to
   * manually start it by calling the {@link Federation.startQueue} method.
   *
   * If `false`, the task queue will start automatically as soon as
   * the first task is enqueued.
   *
   * By default, the queue starts automatically.
   *
   * @since 0.12.0
   */
  manuallyStartQueue?: boolean;

  /**
   * The canonical base URL of the server.  This is used for constructing
   * absolute URLs and fediverse handles.
   * @since 1.5.0
   */
  origin?: string | FederationOrigin;

  /**
   * A custom JSON-LD document loader factory.  By default, this uses
   * the built-in cache-backed loader that fetches remote documents over
   * HTTP(S).
   * @since 1.4.0
   */
  documentLoaderFactory?: DocumentLoaderFactory;

  /**
   * A custom JSON-LD context loader factory.  By default, this uses the same
   * loader as the document loader.
   * @since 1.4.0
   */
  contextLoaderFactory?: DocumentLoaderFactory;

  /**
   * A factory function that creates an authenticated document loader for a
   * given identity.  This is used for fetching documents that require
   * authentication.
   */
  authenticatedDocumentLoaderFactory?: AuthenticatedDocumentLoaderFactory;

  /**
   * Whether to allow fetching private network addresses in the document loader.
   *
   * If turned on, {@link CreateFederationOptions.documentLoader},
   * {@link CreateFederationOptions.contextLoader}, and
   * {@link CreateFederationOptions.authenticatedDocumentLoaderFactory}
   * cannot be configured.
   *
   * Mostly useful for testing purposes.  *Do not use in production.*
   *
   * Turned off by default.
   * @since 0.15.0
   */
  allowPrivateAddress?: boolean;

  /**
   * Options for making `User-Agent` strings for HTTP requests.
   * If a string is provided, it is used as the `User-Agent` header.
   * If an object is provided, it is passed to the {@link getUserAgent}
   * function.
   * @since 1.3.0
   */
  userAgent?: GetUserAgentOptions | string;

  /**
   * A callback that handles errors during outbox processing.  Note that this
   * callback can be called multiple times for the same activity, because
   * the delivery is retried according to the backoff schedule until it
   * succeeds or reaches the maximum retry count.
   *
   * If any errors are thrown in this callback, they are ignored.
   */
  onOutboxError?: OutboxErrorHandler;

  /**
   * HTTP status codes that should be treated as permanent delivery failures.
   * When an inbox returns one of these codes, the delivery will not be retried
   * and the permanent failure handler (if registered via
   * {@link Federatable.setOutboxPermanentFailureHandler}) will be called.
   *
   * By default, `[404, 410]`.
   *
   * @since 2.0.0
   */
  permanentFailureStatusCodes?: readonly number[];

  /**
   * The time window for verifying HTTP Signatures of incoming requests.  If the
   * request is older or newer than this window, it is rejected.  Or if it is
   * `false`, the request's timestamp is not checked at all.
   *
   * By default, the window is an hour.
   */
  signatureTimeWindow?: Temporal.Duration | Temporal.DurationLike | false;

  /**
   * Whether to skip HTTP Signatures verification for incoming activities.
   * This is useful for testing purposes, but should not be used in production.
   *
   * By default, this is `false` (i.e., signatures are verified).
   * @since 0.13.0
   */
  skipSignatureVerification?: boolean;

  /**
   * The HTTP Signatures specification to use for the first signature
   * attempt when communicating with unknown servers. This option affects
   * the "double-knocking" mechanism as described in the ActivityPub HTTP
   * Signature documentation.
   *
   * When making HTTP requests to servers that haven't been encountered before,
   * Fedify will first attempt to sign the request using the specified
   * signature specification. If the request fails, it will retry with the
   * alternative specification.
   *
   * Defaults to `"rfc9421"` (HTTP Message Signatures).
   *
   * @see {@link https://swicg.github.io/activitypub-http-signature/#how-to-upgrade-supported-versions}
   * @default `"rfc9421"`
   * @since 1.7.0
   */
  firstKnock?: HttpMessageSignaturesSpec;

  /**
   * The retry policy for sending activities to recipients' inboxes.
   * By default, this uses an exponential backoff strategy with a maximum of
   * 10 attempts and a maximum delay of 12 hours.
   * @since 0.12.0
   */
  outboxRetryPolicy?: RetryPolicy;

  /**
   * The retry policy for processing incoming activities.  By default, this
   * uses an exponential backoff strategy with a maximum of 10 attempts and a
   * maximum delay of 12 hours.
   * @since 0.12.0
   */
  inboxRetryPolicy?: RetryPolicy;

  /**
   * Activity transformers that are applied to outgoing activities.  It is
   * useful for adjusting outgoing activities to satisfy some ActivityPub
   * implementations.
   *
   * By default, {@link defaultActivityTransformers} are applied.
   * @since 1.4.0
   */
  activityTransformers?: readonly ActivityTransformer<TContextData>[];

  /**
   * Whether the router should be insensitive to trailing slashes in the URL
   * paths.  For example, if this option is `true`, `/foo` and `/foo/` are
   * treated as the same path.  Turned off by default.
   * @since 0.12.0
   */
  trailingSlashInsensitive?: boolean;

  /**
   * The OpenTelemetry tracer provider for tracing operations.  If not provided,
   * the default global tracer provider is used.
   * @since 1.3.0
   */
  tracerProvider?: TracerProvider;
}

/**
 * Additional settings for the actor dispatcher.
 *
 * ``` typescript
 * const federation = createFederation<void>({ ... });
 * federation
 *   .setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
 *     // ...
 *   })
 *   .setKeyPairsDispatcher(async (ctxData, identifier) => {
 *     // ...
 *   });
 * ```
 */
export interface ActorCallbackSetters<TContextData> {
  /**
   * Sets the key pairs dispatcher for actors.
   * @param dispatcher A callback that returns the key pairs for an actor.
   * @returns The setters object so that settings can be chained.
   * @since 0.10.0
   */
  setKeyPairsDispatcher(
    dispatcher: ActorKeyPairsDispatcher<TContextData>,
  ): ActorCallbackSetters<TContextData>;

  /**
   * Sets the callback function that maps a WebFinger username to
   * the corresponding actor's identifier.  If it's omitted, the identifier
   * is assumed to be the same as the WebFinger username, which makes your
   * actors have the immutable handles.  If you want to let your actors change
   * their fediverse handles, you should set this dispatcher.
   * @param mapper A callback that maps a WebFinger username to
   *               the corresponding actor's identifier.
   * @returns The setters object so that settings can be chained.
   * @since 0.15.0
   */
  mapHandle(
    mapper: ActorHandleMapper<TContextData>,
  ): ActorCallbackSetters<TContextData>;

  /**
   * Sets the callback function that maps a WebFinger query to the corresponding
   * actor's identifier or username.  If it's omitted, the WebFinger handler
   * only supports the actor URIs and `acct:` URIs.  If you want to support
   * other queries, you should set this dispatcher.
   * @param mapper A callback that maps a WebFinger query to the corresponding
   *               actor's identifier or username.
   * @returns The setters object so that settings can be chained.
   * @since 1.4.0
   */
  mapAlias(
    mapper: ActorAliasMapper<TContextData>,
  ): ActorCallbackSetters<TContextData>;

  /**
   * Specifies the conditions under which requests are authorized.
   * @param predicate A callback that returns whether a request is authorized.
   * @returns The setters object so that settings can be chained.
   * @since 0.7.0
   */
  authorize(
    predicate: AuthorizePredicate<TContextData>,
  ): ActorCallbackSetters<TContextData>;
}

/**
 * Additional settings for an object dispatcher.
 */
export interface ObjectCallbackSetters<
  TContextData,
  TObject extends Object,
  TParam extends string,
> {
  /**
   * Specifies the conditions under which requests are authorized.
   * @param predicate A callback that returns whether a request is authorized.
   * @returns The setters object so that settings can be chained.
   * @since 0.7.0
   */
  authorize(
    predicate: ObjectAuthorizePredicate<TContextData, TParam>,
  ): ObjectCallbackSetters<TContextData, TObject, TParam>;
}

/**
 * Additional settings for a collection dispatcher.
 *
 * @template TContext The type of the context.  {@link Context} or
 *                     {@link RequestContext}.
 * @template TContextData The context data to pass to the {@link Context}.
 * @template TFilter The type of filter for the collection.
 */
export interface CollectionCallbackSetters<
  TContext extends Context<TContextData>,
  TContextData,
  TFilter,
> {
  /**
   * Sets the counter for the collection.
   * @param counter A callback that returns the number of items in the collection.
   * @returns The setters object so that settings can be chained.
   */
  setCounter(
    counter: CollectionCounter<TContextData, TFilter>,
  ): CollectionCallbackSetters<TContext, TContextData, TFilter>;

  /**
   * Sets the first cursor for the collection.
   * @param cursor The cursor for the first item in the collection.
   * @returns The setters object so that settings can be chained.
   */
  setFirstCursor(
    cursor: CollectionCursor<TContext, TContextData, TFilter>,
  ): CollectionCallbackSetters<TContext, TContextData, TFilter>;

  /**
   * Sets the last cursor for the collection.
   * @param cursor The cursor for the last item in the collection.
   * @returns The setters object so that settings can be chained.
   */
  setLastCursor(
    cursor: CollectionCursor<TContext, TContextData, TFilter>,
  ): CollectionCallbackSetters<TContext, TContextData, TFilter>;

  /**
   * Specifies the conditions under which requests are authorized.
   * @param predicate A callback that returns whether a request is authorized.
   * @returns The setters object so that settings can be chained.
   * @since 0.7.0
   */
  authorize(
    predicate: AuthorizePredicate<TContextData>,
  ): CollectionCallbackSetters<TContext, TContextData, TFilter>;
}

/**
 * The strategy for handling activity idempotency in inbox processing.
 *
 *  -  `"global"`: Activities are deduplicated globally across all inboxes and
 *     origins.  The same activity ID will be processed only once, regardless
 *     of which inbox receives it or which server sent it.
 *
 *  -  `"per-origin"`: Activities are deduplicated per receiving server's origin.
 *     The same activity ID will be processed only once on each receiving server,
 *     but can be processed separately on different receiving servers. This had
 *     been the default behavior in Fedify 1.x versions.
 *
 *  -  `"per-inbox"`: Activities are deduplicated per inbox. The same activity
 *     ID can be processed once per inbox, allowing the same activity to be
 *     delivered to multiple inboxes independently.  This follows standard
 *     ActivityPub behavior and is the default strategy since Fedify 2.0.0.
 *
 * @since 1.9.0
 */
export type IdempotencyStrategy = "global" | "per-origin" | "per-inbox";

/**
 * A callback to generate a custom idempotency key for an activity.
 * Returns the cache key to use, or null to skip idempotency checking.
 * @template TContextData The context data to pass to the {@link InboxContext}.
 * @param ctx The inbox context.
 * @param activity The activity being processed.
 * @returns The idempotency key to use for caching, or null to skip caching.
 * @since 1.9.0
 */
export type IdempotencyKeyCallback<TContextData> = (
  ctx: InboxContext<TContextData>,
  activity: Activity,
) => string | null | Promise<string | null>;

/**
 * Registry for inbox listeners for different activity types.
 */
export interface InboxListenerSetters<TContextData> {
  /**
   * Registers a listener for a specific incoming activity type.
   *
   * @param type A subclass of {@link Activity} to listen to.
   * @param listener A callback to handle an incoming activity.
   * @returns The setters object so that settings can be chained.
   */
  on<TActivity extends Activity>(
    // deno-lint-ignore no-explicit-any
    type: new (...args: any[]) => TActivity,
    listener: InboxListener<TContextData, TActivity>,
  ): InboxListenerSetters<TContextData>;

  /**
   * Registers an error handler for inbox listeners.  Any exceptions thrown
   * from the listeners are caught and passed to this handler.
   *
   * @param handler A callback to handle an error.
   * @returns The setters object so that settings can be chained.
   */
  onError(
    handler: InboxErrorHandler<TContextData>,
  ): InboxListenerSetters<TContextData>;

  /**
   * Configures a callback to dispatch the key pair for the authenticated
   * document loader of the {@link Context} passed to the shared inbox listener.
   *
   * @param dispatcher A callback to dispatch the key pair for the authenticated
   *                   document loader.
   * @returns The setters object so that settings can be chained.
   * @since 0.11.0
   */
  setSharedKeyDispatcher(
    dispatcher: SharedInboxKeyDispatcher<TContextData>,
  ): InboxListenerSetters<TContextData>;

  /**
   * Configures the strategy for handling activity idempotency in inbox processing.
   *
   * @example
   * Use per-inbox strategy (standard ActivityPub behavior):
   * ```
   * federation
   *   .setInboxListeners("/users/{identifier}/inbox", "/inbox")
   *   .withIdempotency("per-inbox");
   * ```
   *
   * Use custom strategy:
   * ```
   * federation
   *   .setInboxListeners("/users/{identifier}/inbox", "/inbox")
   *   .withIdempotency((ctx, activity) => {
   *     // Return null to skip idempotency
   *     return `${ctx.origin}:${activity.id?.href}:${ctx.recipient}`;
   *   });
   * ```
   *
   * @param strategy The idempotency strategy to use. Can be:
   *   - `"global"`: Activities are deduplicated across all inboxes and origins
   *   - `"per-origin"`: Activities are deduplicated per inbox origin
   *   - `"per-inbox"`: Activities are deduplicated per inbox
   *   - A custom callback function that returns the cache key to use
   * @returns The setters object so that settings can be chained.
   * @since 1.9.0
   */
  withIdempotency(
    strategy: IdempotencyStrategy | IdempotencyKeyCallback<TContextData>,
  ): InboxListenerSetters<TContextData>;
}

/**
 * Parameters of {@link Federation.fetch} method.
 *
 * @template TContextData The context data to pass to the {@link Context}.
 * @since 0.6.0
 */
export interface FederationFetchOptions<TContextData> {
  /**
   * The context data to pass to the {@link Context}.
   */
  contextData: TContextData;

  /**
   * A callback to handle a request when the route is not found.
   * If not provided, a 404 response is returned.
   * @param request The request object.
   * @returns The response to the request.
   */
  onNotFound?: (request: Request) => Response | Promise<Response>;

  /**
   * A callback to handle a request when the request's `Accept` header is not
   * acceptable.  If not provided, a 406 response is returned.
   * @param request The request object.
   * @returns The response to the request.
   */
  onNotAcceptable?: (request: Request) => Response | Promise<Response>;

  /**
   * A callback to handle a request when the request is unauthorized.
   * If not provided, a 401 response is returned.
   * @param request The request object.
   * @returns The response to the request.
   * @since 0.7.0
   */
  onUnauthorized?: (request: Request) => Response | Promise<Response>;
}

/**
 * Additional settings for a custom collection dispatcher.
 *
 * @template TParam The type of the parameters in the URL path.
 * @template TContext The type of the context.  {@link Context} or
 *                     {@link RequestContext}.
 * @template TContextData The context data to pass to the {@link Context}.
 * @template TFilter The type of filter for the collection.
 */
export interface CustomCollectionCallbackSetters<
  TParam extends string,
  TContext extends Context<TContextData>,
  TContextData,
> {
  /**
   * Sets the counter for the custom collection.
   * @param counter A callback that returns the number of items in the custom collection.
   * @returns The setters object so that settings can be chained.
   */
  setCounter(
    counter: CustomCollectionCounter<
      TParam,
      TContextData
    >,
  ): CustomCollectionCallbackSetters<
    TParam,
    TContext,
    TContextData
  >;

  /**
   * Sets the first cursor for the custom collection.
   * @param cursor The cursor for the first item in the custom collection.
   * @returns The setters object so that settings can be chained.
   */
  setFirstCursor(
    cursor: CustomCollectionCursor<
      TParam,
      TContext,
      TContextData
    >,
  ): CustomCollectionCallbackSetters<
    TParam,
    TContext,
    TContextData
  >;

  /**
   * Sets the last cursor for the custom collection.
   * @param cursor The cursor for the last item in the custom collection.
   * @returns The setters object so that settings can be chained.
   */
  setLastCursor(
    cursor: CustomCollectionCursor<
      TParam,
      TContext,
      TContextData
    >,
  ): CustomCollectionCallbackSetters<
    TParam,
    TContext,
    TContextData
  >;

  /**
   * Specifies the conditions under which requests are authorized.
   * @param predicate A callback that returns whether a request is authorized.
   * @returns The setters object so that settings can be chained.
   * @since 0.7.0
   */
  authorize(
    predicate: ObjectAuthorizePredicate<TContextData, string>,
  ): CustomCollectionCallbackSetters<
    TParam,
    TContext,
    TContextData
  >;
}

/**
 * Represents an object with a type ID, which is either a constructor or an
 * instance of the object.
 *
 * @template TObject The type of the object.
 */
export type ConstructorWithTypeId<TObject extends Object> =
  // deno-lint-ignore no-explicit-any
  (new (...args: any[]) => TObject) & { typeId: URL };

/**
 * Defines a union of all valid RFC 6570 URI Template expressions for a given
 * parameter name.
 *
 * RFC 6570 specifies a syntax for URI templates, allowing for variable
 * expansion. This type captures all Level 1-4 operator expressions for a
 * single, named variable.
 *
 * The supported expression types are:
 * - `{Param}`: Simple string expansion
 * - `+{Param}`: Reserved string expansion
 * - `#{Param}`: Fragment expansion
 * - `{.Param}`: Label expansion with a dot-prefix
 * - `{/Param}`: Path segment expansion
 * - `{;Param}`: Path-style parameter expansion
 * - `{?Param}`: Query component expansion
 * - `{&Param}`: Query continuation expansion
 *
 * @template Param The name of the parameter to be used in the expressions.
 * @example
 * ```ts
 * type UserIdExpression = Rfc6570Expression<"userId">;
 *
 * // The variable `userPath` can be assigned any of the valid expressions.
 * const userPath: UserIdExpression = "{/userId}";
 * ```
 * @see {@link https://tools.ietf.org/html/rfc6570} for the full specification.
 */
export type Rfc6570Expression<Param extends string> =
  | `{${Param}}`
  | `{+${Param}}`
  | `{#${Param}}`
  | `{.${Param}}`
  | `{/${Param}}`
  | `{;${Param}}`
  | `{?${Param}}`
  | `{&${Param}}`;
