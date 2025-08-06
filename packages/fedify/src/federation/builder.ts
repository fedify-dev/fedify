import { getLogger } from "@logtape/logtape";
import { SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import metadata from "../../deno.json" with { type: "json" };
import type { Actor, Recipient } from "../vocab/actor.ts";
import { getTypeId } from "../vocab/type.ts";
import type { Activity, Hashtag, Like, Object } from "../vocab/vocab.ts";
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
  SharedInboxKeyDispatcher,
} from "./callback.ts";
import type { Context, RequestContext } from "./context.ts";
import type {
  ActorCallbackSetters,
  CollectionCallbackSetters,
  ConstructorWithTypeId,
  CustomCollectionCallbackSetters,
  Federation,
  FederationBuilder,
  FederationOptions,
  InboxListenerSetters,
  ObjectCallbackSetters,
  ParamsKeyPath,
} from "./federation.ts";
import type {
  CollectionCallbacks,
  CustomCollectionCallbacks,
} from "./handler.ts";
import { InboxListenerSet } from "./inbox.ts";
import { Router, RouterError } from "./router.ts";

export class FederationBuilderImpl<TContextData>
  implements FederationBuilder<TContextData> {
  router: Router;
  actorCallbacks?: ActorCallbacks<TContextData>;
  nodeInfoDispatcher?: NodeInfoDispatcher<TContextData>;
  objectCallbacks: Record<string, ObjectCallbacks<TContextData, string>>;
  objectTypeIds: Record<
    string,
    // deno-lint-ignore no-explicit-any
    (new (...args: any[]) => Object) & { typeId: URL }
  >;
  inboxPath?: string;
  inboxCallbacks?: CollectionCallbacks<
    Activity,
    RequestContext<TContextData>,
    TContextData,
    void
  >;
  outboxCallbacks?: CollectionCallbacks<
    Activity,
    RequestContext<TContextData>,
    TContextData,
    void
  >;
  followingCallbacks?: CollectionCallbacks<
    Actor | URL,
    RequestContext<TContextData>,
    TContextData,
    void
  >;
  followersCallbacks?: CollectionCallbacks<
    Recipient,
    Context<TContextData>,
    TContextData,
    URL
  >;
  likedCallbacks?: CollectionCallbacks<
    Like,
    RequestContext<TContextData>,
    TContextData,
    void
  >;
  featuredCallbacks?: CollectionCallbacks<
    Object,
    RequestContext<TContextData>,
    TContextData,
    void
  >;
  featuredTagsCallbacks?: CollectionCallbacks<
    Hashtag,
    RequestContext<TContextData>,
    TContextData,
    void
  >;
  inboxListeners?: InboxListenerSet<TContextData>;
  inboxErrorHandler?: InboxErrorHandler<TContextData>;
  sharedInboxKeyDispatcher?: SharedInboxKeyDispatcher<TContextData>;
  collectionTypeIds: Record<
    string | symbol,
    ConstructorWithTypeId<Object>
  >;
  collectionCallbacks: Record<
    string | symbol,
    CustomCollectionCallbacks<
      Object,
      Record<string, string>,
      RequestContext<TContextData>,
      TContextData
    >
  >;

  /**
   * Symbol registry for unique identification of unnamed symbols.
   */
  #symbolRegistry = new Map<symbol, string>();

  constructor() {
    this.router = new Router();
    this.objectCallbacks = {};
    this.objectTypeIds = {};
    this.collectionCallbacks = {};
    this.collectionTypeIds = {};
  }

  async build(
    options: FederationOptions<TContextData>,
  ): Promise<Federation<TContextData>> {
    const { FederationImpl } = await import("./middleware.ts");
    const f = new FederationImpl(options);

    // In order to ensure `build()` can be called multiple times and
    // each instance does not share their state, we clone everything
    // that is mutable.  This includes the router and callbacks.

    // Assign the existing router instance but preserve the settings
    // Keep the original trailingSlashInsensitive configuration
    const trailingSlashInsensitiveValue = f.router.trailingSlashInsensitive;
    f.router = this.router.clone();
    f.router.trailingSlashInsensitive = trailingSlashInsensitiveValue;
    f._initializeRouter();

    f.actorCallbacks = this.actorCallbacks == null
      ? undefined
      : { ...this.actorCallbacks };
    f.nodeInfoDispatcher = this.nodeInfoDispatcher;
    f.objectCallbacks = { ...this.objectCallbacks };
    f.objectTypeIds = { ...this.objectTypeIds };
    f.inboxPath = this.inboxPath;
    f.inboxCallbacks = this.inboxCallbacks == null
      ? undefined
      : { ...this.inboxCallbacks };
    f.outboxCallbacks = this.outboxCallbacks == null
      ? undefined
      : { ...this.outboxCallbacks };
    f.followingCallbacks = this.followingCallbacks == null
      ? undefined
      : { ...this.followingCallbacks };
    f.followersCallbacks = this.followersCallbacks == null
      ? undefined
      : { ...this.followersCallbacks };
    f.likedCallbacks = this.likedCallbacks == null
      ? undefined
      : { ...this.likedCallbacks };
    f.featuredCallbacks = this.featuredCallbacks == null
      ? undefined
      : { ...this.featuredCallbacks };
    f.featuredTagsCallbacks = this.featuredTagsCallbacks == null
      ? undefined
      : { ...this.featuredTagsCallbacks };
    f.inboxListeners = this.inboxListeners?.clone();
    f.inboxErrorHandler = this.inboxErrorHandler;
    f.sharedInboxKeyDispatcher = this.sharedInboxKeyDispatcher;
    return f;
  }

  _getTracer() {
    return trace.getTracer(metadata.name, metadata.version);
  }

  setActorDispatcher(
    path: `${string}{identifier}${string}` | `${string}{handle}${string}`,
    dispatcher: ActorDispatcher<TContextData>,
  ): ActorCallbackSetters<TContextData> {
    if (this.router.has("actor")) {
      throw new RouterError("Actor dispatcher already set.");
    }
    const variables = this.router.add(path, "actor");
    if (
      variables.size !== 1 ||
      !(variables.has("identifier") || variables.has("handle"))
    ) {
      throw new RouterError(
        "Path for actor dispatcher must have one variable: {identifier}",
      );
    }
    if (variables.has("handle")) {
      getLogger(["fedify", "federation", "actor"]).warn(
        "The {{handle}} variable in the actor dispatcher path is deprecated. " +
          "Use {{identifier}} instead.",
      );
    }
    const callbacks: ActorCallbacks<TContextData> = {
      dispatcher: async (context, identifier) => {
        const actor = await this._getTracer().startActiveSpan(
          "activitypub.dispatch_actor",
          {
            kind: SpanKind.SERVER,
            attributes: { "fedify.actor.identifier": identifier },
          },
          async (span) => {
            try {
              const actor = await dispatcher(context, identifier);
              span.setAttribute(
                "activitypub.actor.id",
                (actor?.id ?? context.getActorUri(identifier)).href,
              );
              if (actor == null) {
                span.setStatus({ code: SpanStatusCode.ERROR });
              } else {
                span.setAttribute(
                  "activitypub.actor.type",
                  getTypeId(actor).href,
                );
              }
              return actor;
            } catch (error) {
              span.setStatus({
                code: SpanStatusCode.ERROR,
                message: String(error),
              });
              throw error;
            } finally {
              span.end();
            }
          },
        );
        if (actor == null) return null;
        const logger = getLogger(["fedify", "federation", "actor"]);
        if (actor.id == null) {
          logger.warn(
            "Actor dispatcher returned an actor without an id property.  " +
              "Set the property with Context.getActorUri(identifier).",
          );
        } else if (actor.id.href != context.getActorUri(identifier).href) {
          logger.warn(
            "Actor dispatcher returned an actor with an id property that " +
              "does not match the actor URI.  Set the property with " +
              "Context.getActorUri(identifier).",
          );
        }
        if (
          this.followingCallbacks != null &&
          this.followingCallbacks.dispatcher != null
        ) {
          if (actor.followingId == null) {
            logger.warn(
              "You configured a following collection dispatcher, but the " +
                "actor does not have a following property.  Set the property " +
                "with Context.getFollowingUri(identifier).",
            );
          } else if (
            actor.followingId.href != context.getFollowingUri(identifier).href
          ) {
            logger.warn(
              "You configured a following collection dispatcher, but the " +
                "actor's following property does not match the following " +
                "collection URI.  Set the property with " +
                "Context.getFollowingUri(identifier).",
            );
          }
        }
        if (
          this.followersCallbacks != null &&
          this.followersCallbacks.dispatcher != null
        ) {
          if (actor.followersId == null) {
            logger.warn(
              "You configured a followers collection dispatcher, but the " +
                "actor does not have a followers property.  Set the property " +
                "with Context.getFollowersUri(identifier).",
            );
          } else if (
            actor.followersId.href != context.getFollowersUri(identifier).href
          ) {
            logger.warn(
              "You configured a followers collection dispatcher, but the " +
                "actor's followers property does not match the followers " +
                "collection URI.  Set the property with " +
                "Context.getFollowersUri(identifier).",
            );
          }
        }
        if (
          this.outboxCallbacks != null &&
          this.outboxCallbacks.dispatcher != null
        ) {
          if (actor?.outboxId == null) {
            logger.warn(
              "You configured an outbox collection dispatcher, but the " +
                "actor does not have an outbox property.  Set the property " +
                "with Context.getOutboxUri(identifier).",
            );
          } else if (
            actor.outboxId.href != context.getOutboxUri(identifier).href
          ) {
            logger.warn(
              "You configured an outbox collection dispatcher, but the " +
                "actor's outbox property does not match the outbox collection " +
                "URI.  Set the property with Context.getOutboxUri(identifier).",
            );
          }
        }
        if (
          this.likedCallbacks != null &&
          this.likedCallbacks.dispatcher != null
        ) {
          if (actor?.likedId == null) {
            logger.warn(
              "You configured a liked collection dispatcher, but the " +
                "actor does not have a liked property.  Set the property " +
                "with Context.getLikedUri(identifier).",
            );
          } else if (
            actor.likedId.href != context.getLikedUri(identifier).href
          ) {
            logger.warn(
              "You configured a liked collection dispatcher, but the " +
                "actor's liked property does not match the liked collection " +
                "URI.  Set the property with Context.getLikedUri(identifier).",
            );
          }
        }
        if (
          this.featuredCallbacks != null &&
          this.featuredCallbacks.dispatcher != null
        ) {
          if (actor?.featuredId == null) {
            logger.warn(
              "You configured a featured collection dispatcher, but the " +
                "actor does not have a featured property.  Set the property " +
                "with Context.getFeaturedUri(identifier).",
            );
          } else if (
            actor.featuredId.href != context.getFeaturedUri(identifier).href
          ) {
            logger.warn(
              "You configured a featured collection dispatcher, but the " +
                "actor's featured property does not match the featured collection " +
                "URI.  Set the property with Context.getFeaturedUri(identifier).",
            );
          }
        }
        if (
          this.featuredTagsCallbacks != null &&
          this.featuredTagsCallbacks.dispatcher != null
        ) {
          if (actor?.featuredTagsId == null) {
            logger.warn(
              "You configured a featured tags collection dispatcher, but the " +
                "actor does not have a featuredTags property.  Set the property " +
                "with Context.getFeaturedTagsUri(identifier).",
            );
          } else if (
            actor.featuredTagsId.href !=
              context.getFeaturedTagsUri(identifier).href
          ) {
            logger.warn(
              "You configured a featured tags collection dispatcher, but the " +
                "actor's featuredTags property does not match the featured tags " +
                "collection URI.  Set the property with " +
                "Context.getFeaturedTagsUri(identifier).",
            );
          }
        }
        if (this.router.has("inbox")) {
          if (actor.inboxId == null) {
            logger.warn(
              "You configured inbox listeners, but the actor does not " +
                "have an inbox property.  Set the property with " +
                "Context.getInboxUri(identifier).",
            );
          } else if (
            actor.inboxId.href != context.getInboxUri(identifier).href
          ) {
            logger.warn(
              "You configured inbox listeners, but the actor's inbox " +
                "property does not match the inbox URI.  Set the property " +
                "with Context.getInboxUri(identifier).",
            );
          }
          if (actor.endpoints == null || actor.endpoints.sharedInbox == null) {
            logger.warn(
              "You configured inbox listeners, but the actor does not have " +
                "a endpoints.sharedInbox property.  Set the property with " +
                "Context.getInboxUri().",
            );
          } else if (
            actor.endpoints.sharedInbox.href != context.getInboxUri().href
          ) {
            logger.warn(
              "You configured inbox listeners, but the actor's " +
                "endpoints.sharedInbox property does not match the shared inbox " +
                "URI.  Set the property with Context.getInboxUri().",
            );
          }
        }
        if (callbacks.keyPairsDispatcher != null) {
          if (actor.publicKeyId == null) {
            logger.warn(
              "You configured a key pairs dispatcher, but the actor does " +
                "not have a publicKey property.  Set the property with " +
                "Context.getActorKeyPairs(identifier).",
            );
          }
          if (actor.assertionMethodId == null) {
            logger.warn(
              "You configured a key pairs dispatcher, but the actor does " +
                "not have an assertionMethod property.  Set the property " +
                "with Context.getActorKeyPairs(identifier).",
            );
          }
        }
        return actor;
      },
    };
    this.actorCallbacks = callbacks;
    const setters: ActorCallbackSetters<TContextData> = {
      setKeyPairsDispatcher: (
        dispatcher: ActorKeyPairsDispatcher<TContextData>,
      ) => {
        callbacks.keyPairsDispatcher = (ctx, identifier) =>
          this._getTracer().startActiveSpan(
            "activitypub.dispatch_actor_key_pairs",
            {
              kind: SpanKind.SERVER,
              attributes: {
                "activitypub.actor.id": ctx.getActorUri(identifier).href,
                "fedify.actor.identifier": identifier,
              },
            },
            async (span) => {
              try {
                return await dispatcher(ctx, identifier);
              } catch (e) {
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
        return setters;
      },
      mapHandle(mapper: ActorHandleMapper<TContextData>) {
        callbacks.handleMapper = mapper;
        return setters;
      },
      mapAlias(mapper: ActorAliasMapper<TContextData>) {
        callbacks.aliasMapper = mapper;
        return setters;
      },
      authorize(predicate: AuthorizePredicate<TContextData>) {
        callbacks.authorizePredicate = predicate;
        return setters;
      },
    };
    return setters;
  }

  setNodeInfoDispatcher(
    path: string,
    dispatcher: NodeInfoDispatcher<TContextData>,
  ) {
    if (this.router.has("nodeInfo")) {
      throw new RouterError("NodeInfo dispatcher already set.");
    }
    const variables = this.router.add(path, "nodeInfo");
    if (variables.size !== 0) {
      throw new RouterError(
        "Path for NodeInfo dispatcher must have no variables.",
      );
    }
    this.nodeInfoDispatcher = dispatcher;
  }

  setObjectDispatcher<TObject extends Object, TParam extends string>(
    // deno-lint-ignore no-explicit-any
    cls: (new (...args: any[]) => TObject) & { typeId: URL },
    path:
      `${string}{${TParam}}${string}{${TParam}}${string}{${TParam}}${string}{${TParam}}${string}{${TParam}}${string}{${TParam}}${string}`,
    dispatcher: ObjectDispatcher<TContextData, TObject, TParam>,
  ): ObjectCallbackSetters<TContextData, TObject, TParam>;
  setObjectDispatcher<TObject extends Object, TParam extends string>(
    // deno-lint-ignore no-explicit-any
    cls: (new (...args: any[]) => TObject) & { typeId: URL },
    path:
      `${string}{${TParam}}${string}{${TParam}}${string}{${TParam}}${string}{${TParam}}${string}{${TParam}}${string}`,
    dispatcher: ObjectDispatcher<TContextData, TObject, TParam>,
  ): ObjectCallbackSetters<TContextData, TObject, TParam>;
  setObjectDispatcher<TObject extends Object, TParam extends string>(
    // deno-lint-ignore no-explicit-any
    cls: (new (...args: any[]) => TObject) & { typeId: URL },
    path:
      `${string}{${TParam}}${string}{${TParam}}${string}{${TParam}}${string}{${TParam}}${string}`,
    dispatcher: ObjectDispatcher<TContextData, TObject, TParam>,
  ): ObjectCallbackSetters<TContextData, TObject, TParam>;
  setObjectDispatcher<TObject extends Object, TParam extends string>(
    // deno-lint-ignore no-explicit-any
    cls: (new (...args: any[]) => TObject) & { typeId: URL },
    path:
      `${string}{${TParam}}${string}{${TParam}}${string}{${TParam}}${string}`,
    dispatcher: ObjectDispatcher<TContextData, TObject, TParam>,
  ): ObjectCallbackSetters<TContextData, TObject, TParam>;
  setObjectDispatcher<TObject extends Object, TParam extends string>(
    // deno-lint-ignore no-explicit-any
    cls: (new (...args: any[]) => TObject) & { typeId: URL },
    path: `${string}{${TParam}}${string}{${TParam}}${string}`,
    dispatcher: ObjectDispatcher<TContextData, TObject, TParam>,
  ): ObjectCallbackSetters<TContextData, TObject, TParam>;
  setObjectDispatcher<TObject extends Object, TParam extends string>(
    // deno-lint-ignore no-explicit-any
    cls: (new (...args: any[]) => TObject) & { typeId: URL },
    path: `${string}{${TParam}}${string}`,
    dispatcher: ObjectDispatcher<TContextData, TObject, TParam>,
  ): ObjectCallbackSetters<TContextData, TObject, TParam>;
  setObjectDispatcher<TObject extends Object, TParam extends string>(
    // deno-lint-ignore no-explicit-any
    cls: (new (...args: any[]) => TObject) & { typeId: URL },
    path: string,
    dispatcher: ObjectDispatcher<TContextData, TObject, TParam>,
  ): ObjectCallbackSetters<TContextData, TObject, TParam> {
    const routeName = `object:${cls.typeId.href}`;
    if (this.router.has(routeName)) {
      throw new RouterError(`Object dispatcher for ${cls.name} already set.`);
    }
    const variables = this.router.add(path, routeName);
    if (variables.size < 1) {
      throw new RouterError(
        "Path for object dispatcher must have at least one variable.",
      );
    }
    const callbacks: ObjectCallbacks<TContextData, TParam> = {
      dispatcher: (ctx, values) => {
        const tracer = this._getTracer();
        return tracer.startActiveSpan(
          "activitypub.dispatch_object",
          {
            kind: SpanKind.SERVER,
            attributes: {
              "fedify.object.type": cls.typeId.href,
              ...globalThis.Object.fromEntries(
                globalThis.Object.entries(values).map(([k, v]) => [
                  `fedify.object.values.${k}`,
                  v,
                ]),
              ),
            },
          },
          async (span) => {
            try {
              const object = await dispatcher(ctx, values);
              span.setAttribute(
                "activitypub.object.id",
                (object?.id ?? ctx.getObjectUri(cls, values)).href,
              );
              if (object == null) {
                span.setStatus({ code: SpanStatusCode.ERROR });
              } else {
                span.setAttribute(
                  "activitypub.object.type",
                  getTypeId(object).href,
                );
              }
              return object;
            } catch (e) {
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
      },
      parameters: variables as unknown as Set<TParam>,
    };
    this.objectCallbacks[cls.typeId.href] = callbacks;
    this.objectTypeIds[cls.typeId.href] = cls;
    const setters: ObjectCallbackSetters<TContextData, TObject, TParam> = {
      authorize(predicate: ObjectAuthorizePredicate<TContextData, TParam>) {
        callbacks.authorizePredicate = predicate;
        return setters;
      },
    };
    return setters;
  }

  setInboxDispatcher(
    path: `${string}{identifier}${string}` | `${string}{handle}${string}`,
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
  > {
    if (this.inboxCallbacks != null) {
      throw new RouterError("Inbox dispatcher already set.");
    }
    if (this.router.has("inbox")) {
      if (this.inboxPath !== path) {
        throw new RouterError(
          "Inbox dispatcher path must match inbox listener path.",
        );
      }
    } else {
      const variables = this.router.add(path, "inbox");
      if (
        variables.size !== 1 ||
        !(variables.has("identifier") || variables.has("handle"))
      ) {
        throw new RouterError(
          "Path for inbox dispatcher must have one variable: {identifier}",
        );
      }
      if (variables.has("handle")) {
        getLogger(["fedify", "federation", "inbox"]).warn(
          "The {{handle}} variable in the inbox dispatcher path is deprecated. " +
            "Use {{identifier}} instead.",
        );
      }
      this.inboxPath = path;
    }
    const callbacks: CollectionCallbacks<
      Activity,
      RequestContext<TContextData>,
      TContextData,
      void
    > = { dispatcher };
    this.inboxCallbacks = callbacks;
    const setters: CollectionCallbackSetters<
      RequestContext<TContextData>,
      TContextData,
      void
    > = {
      setCounter(counter: CollectionCounter<TContextData, void>) {
        callbacks.counter = counter;
        return setters;
      },
      setFirstCursor(
        cursor: CollectionCursor<
          RequestContext<TContextData>,
          TContextData,
          void
        >,
      ) {
        callbacks.firstCursor = cursor;
        return setters;
      },
      setLastCursor(
        cursor: CollectionCursor<
          RequestContext<TContextData>,
          TContextData,
          void
        >,
      ) {
        callbacks.lastCursor = cursor;
        return setters;
      },
      authorize(predicate: AuthorizePredicate<TContextData>) {
        callbacks.authorizePredicate = predicate;
        return setters;
      },
    };
    return setters;
  }

  setOutboxDispatcher(
    path: `${string}{identifier}${string}` | `${string}{handle}${string}`,
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
  > {
    if (this.router.has("outbox")) {
      throw new RouterError("Outbox dispatcher already set.");
    }
    const variables = this.router.add(path, "outbox");
    if (
      variables.size !== 1 ||
      !(variables.has("identifier") || variables.has("handle"))
    ) {
      throw new RouterError(
        "Path for outbox dispatcher must have one variable: {identifier}",
      );
    }
    if (variables.has("handle")) {
      getLogger(["fedify", "federation", "outbox"]).warn(
        "The {{handle}} variable in the outbox dispatcher path is deprecated. " +
          "Use {{identifier}} instead.",
      );
    }
    const callbacks: CollectionCallbacks<
      Activity,
      RequestContext<TContextData>,
      TContextData,
      void
    > = { dispatcher };
    this.outboxCallbacks = callbacks;
    const setters: CollectionCallbackSetters<
      RequestContext<TContextData>,
      TContextData,
      void
    > = {
      setCounter(counter: CollectionCounter<TContextData, void>) {
        callbacks.counter = counter;
        return setters;
      },
      setFirstCursor(
        cursor: CollectionCursor<
          RequestContext<TContextData>,
          TContextData,
          void
        >,
      ) {
        callbacks.firstCursor = cursor;
        return setters;
      },
      setLastCursor(
        cursor: CollectionCursor<
          RequestContext<TContextData>,
          TContextData,
          void
        >,
      ) {
        callbacks.lastCursor = cursor;
        return setters;
      },
      authorize(predicate: AuthorizePredicate<TContextData>) {
        callbacks.authorizePredicate = predicate;
        return setters;
      },
    };
    return setters;
  }

  setFollowingDispatcher(
    path: `${string}{identifier}${string}` | `${string}{handle}${string}`,
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
  > {
    if (this.router.has("following")) {
      throw new RouterError("Following collection dispatcher already set.");
    }
    const variables = this.router.add(path, "following");
    if (
      variables.size !== 1 ||
      !(variables.has("identifier") || variables.has("handle"))
    ) {
      throw new RouterError(
        "Path for following collection dispatcher must have one variable: " +
          "{identifier}",
      );
    }
    if (variables.has("handle")) {
      getLogger(["fedify", "federation", "collection"]).warn(
        "The {{handle}} variable in the following collection dispatcher path " +
          "is deprecated. Use {{identifier}} instead.",
      );
    }
    const callbacks: CollectionCallbacks<
      Actor | URL,
      RequestContext<TContextData>,
      TContextData,
      void
    > = { dispatcher };
    this.followingCallbacks = callbacks;
    const setters: CollectionCallbackSetters<
      RequestContext<TContextData>,
      TContextData,
      void
    > = {
      setCounter(counter: CollectionCounter<TContextData, void>) {
        callbacks.counter = counter;
        return setters;
      },
      setFirstCursor(
        cursor: CollectionCursor<
          RequestContext<TContextData>,
          TContextData,
          void
        >,
      ) {
        callbacks.firstCursor = cursor;
        return setters;
      },
      setLastCursor(
        cursor: CollectionCursor<
          RequestContext<TContextData>,
          TContextData,
          void
        >,
      ) {
        callbacks.lastCursor = cursor;
        return setters;
      },
      authorize(predicate: AuthorizePredicate<TContextData>) {
        callbacks.authorizePredicate = predicate;
        return setters;
      },
    };
    return setters;
  }

  setFollowersDispatcher(
    path: `${string}{identifier}${string}` | `${string}{handle}${string}`,
    dispatcher: CollectionDispatcher<
      Recipient,
      Context<TContextData>,
      TContextData,
      URL
    >,
  ): CollectionCallbackSetters<Context<TContextData>, TContextData, URL> {
    if (this.router.has("followers")) {
      throw new RouterError("Followers collection dispatcher already set.");
    }
    const variables = this.router.add(path, "followers");
    if (
      variables.size !== 1 ||
      !(variables.has("identifier") || variables.has("handle"))
    ) {
      throw new RouterError(
        "Path for followers collection dispatcher must have one variable: " +
          "{identifier}",
      );
    }
    if (variables.has("handle")) {
      getLogger(["fedify", "federation", "collection"]).warn(
        "The {{handle}} variable in the followers collection dispatcher path " +
          "is deprecated. Use {{identifier}} instead.",
      );
    }
    const callbacks: CollectionCallbacks<
      Recipient,
      Context<TContextData>,
      TContextData,
      URL
    > = { dispatcher };
    this.followersCallbacks = callbacks;
    const setters: CollectionCallbackSetters<
      Context<TContextData>,
      TContextData,
      URL
    > = {
      setCounter(counter: CollectionCounter<TContextData, URL>) {
        callbacks.counter = counter;
        return setters;
      },
      setFirstCursor(
        cursor: CollectionCursor<Context<TContextData>, TContextData, URL>,
      ) {
        callbacks.firstCursor = cursor;
        return setters;
      },
      setLastCursor(
        cursor: CollectionCursor<Context<TContextData>, TContextData, URL>,
      ) {
        callbacks.lastCursor = cursor;
        return setters;
      },
      authorize(predicate: AuthorizePredicate<TContextData>) {
        callbacks.authorizePredicate = predicate;
        return setters;
      },
    };
    return setters;
  }

  setLikedDispatcher(
    path: `${string}{identifier}${string}` | `${string}{handle}${string}`,
    dispatcher: CollectionDispatcher<
      Like,
      RequestContext<TContextData>,
      TContextData,
      void
    >,
  ): CollectionCallbackSetters<
    RequestContext<TContextData>,
    TContextData,
    void
  > {
    if (this.router.has("liked")) {
      throw new RouterError("Liked collection dispatcher already set.");
    }
    const variables = this.router.add(path, "liked");
    if (
      variables.size !== 1 ||
      !(variables.has("identifier") || variables.has("handle"))
    ) {
      throw new RouterError(
        "Path for liked collection dispatcher must have one variable: " +
          "{identifier}",
      );
    }
    if (variables.has("handle")) {
      getLogger(["fedify", "federation", "collection"]).warn(
        "The {{handle}} variable in the liked collection dispatcher path " +
          "is deprecated. Use {{identifier}} instead.",
      );
    }
    const callbacks: CollectionCallbacks<
      Like,
      RequestContext<TContextData>,
      TContextData,
      void
    > = { dispatcher };
    this.likedCallbacks = callbacks;
    const setters: CollectionCallbackSetters<
      RequestContext<TContextData>,
      TContextData,
      void
    > = {
      setCounter(counter: CollectionCounter<TContextData, void>) {
        callbacks.counter = counter;
        return setters;
      },
      setFirstCursor(
        cursor: CollectionCursor<
          RequestContext<TContextData>,
          TContextData,
          void
        >,
      ) {
        callbacks.firstCursor = cursor;
        return setters;
      },
      setLastCursor(
        cursor: CollectionCursor<
          RequestContext<TContextData>,
          TContextData,
          void
        >,
      ) {
        callbacks.lastCursor = cursor;
        return setters;
      },
      authorize(predicate: AuthorizePredicate<TContextData>) {
        callbacks.authorizePredicate = predicate;
        return setters;
      },
    };
    return setters;
  }

  setFeaturedDispatcher(
    path: `${string}{identifier}${string}` | `${string}{handle}${string}`,
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
  > {
    if (this.router.has("featured")) {
      throw new RouterError("Featured collection dispatcher already set.");
    }
    const variables = this.router.add(path, "featured");
    if (
      variables.size !== 1 ||
      !(variables.has("identifier") || variables.has("handle"))
    ) {
      throw new RouterError(
        "Path for featured collection dispatcher must have one variable: " +
          "{identifier}",
      );
    }
    if (variables.has("handle")) {
      getLogger(["fedify", "federation", "collection"]).warn(
        "The {{handle}} variable in the featured collection dispatcher path " +
          "is deprecated. Use {{identifier}} instead.",
      );
    }
    const callbacks: CollectionCallbacks<
      Object,
      RequestContext<TContextData>,
      TContextData,
      void
    > = { dispatcher };
    this.featuredCallbacks = callbacks;
    const setters: CollectionCallbackSetters<
      RequestContext<TContextData>,
      TContextData,
      void
    > = {
      setCounter(counter: CollectionCounter<TContextData, void>) {
        callbacks.counter = counter;
        return setters;
      },
      setFirstCursor(
        cursor: CollectionCursor<
          RequestContext<TContextData>,
          TContextData,
          void
        >,
      ) {
        callbacks.firstCursor = cursor;
        return setters;
      },
      setLastCursor(
        cursor: CollectionCursor<
          RequestContext<TContextData>,
          TContextData,
          void
        >,
      ) {
        callbacks.lastCursor = cursor;
        return setters;
      },
      authorize(predicate: AuthorizePredicate<TContextData>) {
        callbacks.authorizePredicate = predicate;
        return setters;
      },
    };
    return setters;
  }

  setFeaturedTagsDispatcher(
    path: `${string}{identifier}${string}` | `${string}{handle}${string}`,
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
  > {
    if (this.router.has("featuredTags")) {
      throw new RouterError("Featured tags collection dispatcher already set.");
    }
    const variables = this.router.add(path, "featuredTags");
    if (
      variables.size !== 1 ||
      !(variables.has("identifier") || variables.has("handle"))
    ) {
      throw new RouterError(
        "Path for featured tags collection dispatcher must have one " +
          "variable: {identifier}",
      );
    }
    if (variables.has("handle")) {
      getLogger(["fedify", "federation", "collection"]).warn(
        "The {{handle}} variable in the featured tags collection dispatcher " +
          "path is deprecated. Use {{identifier}} instead.",
      );
    }
    const callbacks: CollectionCallbacks<
      Hashtag,
      RequestContext<TContextData>,
      TContextData,
      void
    > = { dispatcher };
    this.featuredTagsCallbacks = callbacks;
    const setters: CollectionCallbackSetters<
      RequestContext<TContextData>,
      TContextData,
      void
    > = {
      setCounter(counter: CollectionCounter<TContextData, void>) {
        callbacks.counter = counter;
        return setters;
      },
      setFirstCursor(
        cursor: CollectionCursor<
          RequestContext<TContextData>,
          TContextData,
          void
        >,
      ) {
        callbacks.firstCursor = cursor;
        return setters;
      },
      setLastCursor(
        cursor: CollectionCursor<
          RequestContext<TContextData>,
          TContextData,
          void
        >,
      ) {
        callbacks.lastCursor = cursor;
        return setters;
      },
      authorize(predicate: AuthorizePredicate<TContextData>) {
        callbacks.authorizePredicate = predicate;
        return setters;
      },
    };
    return setters;
  }

  setInboxListeners(
    inboxPath: `${string}{identifier}${string}` | `${string}{handle}${string}`,
    sharedInboxPath?: string,
  ): InboxListenerSetters<TContextData> {
    if (this.inboxListeners != null) {
      throw new RouterError("Inbox listeners already set.");
    }
    if (this.router.has("inbox")) {
      if (this.inboxPath !== inboxPath) {
        throw new RouterError(
          "Inbox listener path must match inbox dispatcher path.",
        );
      }
    } else {
      const variables = this.router.add(inboxPath, "inbox");
      if (
        variables.size !== 1 ||
        !(variables.has("identifier") || variables.has("handle"))
      ) {
        throw new RouterError(
          "Path for inbox must have one variable: {identifier}",
        );
      }
      this.inboxPath = inboxPath;
      if (variables.has("handle")) {
        getLogger(["fedify", "federation", "inbox"]).warn(
          "The {{handle}} variable in the inbox path is deprecated. " +
            "Use {{identifier}} instead.",
        );
      }
    }
    if (sharedInboxPath != null) {
      const siVars = this.router.add(sharedInboxPath, "sharedInbox");
      if (siVars.size !== 0) {
        throw new RouterError(
          "Path for shared inbox must have no variables.",
        );
      }
    }
    const listeners = this.inboxListeners = new InboxListenerSet();
    const setters: InboxListenerSetters<TContextData> = {
      on<TActivity extends Activity>(
        // deno-lint-ignore no-explicit-any
        type: new (...args: any[]) => TActivity,
        listener: InboxListener<TContextData, TActivity>,
      ): InboxListenerSetters<TContextData> {
        listeners.add(type, listener as InboxListener<TContextData, Activity>);
        return setters;
      },
      onError: (
        handler: InboxErrorHandler<TContextData>,
      ): InboxListenerSetters<TContextData> => {
        this.inboxErrorHandler = handler;
        return setters;
      },
      setSharedKeyDispatcher: (
        dispatcher: SharedInboxKeyDispatcher<TContextData>,
      ): InboxListenerSetters<TContextData> => {
        this.sharedInboxKeyDispatcher = dispatcher;
        return setters;
      },
    };
    return setters;
  }

  setCollectionDispatcher<
    TObject extends Object,
    TParams extends Record<string, string>,
  >(
    name: string | symbol,
    ...args: [
      ConstructorWithTypeId<TObject>,
      ParamsKeyPath<TParams>,
      CustomCollectionDispatcher<
        TObject,
        TParams,
        RequestContext<TContextData>,
        TContextData
      >,
    ]
  ): CustomCollectionCallbackSetters<
    TParams,
    RequestContext<TContextData>,
    TContextData
  > {
    return this.#setCustomCollectionDispatcher(
      name,
      "collection",
      ...args,
    );
  }

  setOrderedCollectionDispatcher<
    TObject extends Object,
    TParams extends Record<string, string>,
  >(
    name: string | symbol,
    ...args: [
      ConstructorWithTypeId<TObject>,
      ParamsKeyPath<TParams>,
      CustomCollectionDispatcher<
        TObject,
        TParams,
        RequestContext<TContextData>,
        TContextData
      >,
    ]
  ): CustomCollectionCallbackSetters<
    TParams,
    RequestContext<TContextData>,
    TContextData
  > {
    return this.#setCustomCollectionDispatcher(
      name,
      "orderedCollection",
      ...args,
    );
  }
  #setCustomCollectionDispatcher<
    TObject extends Object,
    TParams extends Record<string, string>,
  >(
    name: string | symbol,
    collectionType: "collection" | "orderedCollection",
    itemType: ConstructorWithTypeId<TObject>,
    path: ParamsKeyPath<TParams>,
    dispatcher: CustomCollectionDispatcher<
      TObject,
      TParams,
      RequestContext<TContextData>,
      TContextData
    >,
  ): CustomCollectionCallbackSetters<
    TParams,
    RequestContext<TContextData>,
    TContextData
  > {
    const strName = String(name);
    const routeName = `${collectionType}:${this.#uniqueCollectionId(name)}`;
    if (this.router.has(routeName)) {
      throw new RouterError(
        `Collection dispatcher for ${strName} already set.`,
      );
    }

    // Check if identifier is already used in collectionCallbacks
    if (this.collectionCallbacks[name] != null) {
      throw new RouterError(
        `Collection dispatcher for ${strName} already set.`,
      );
    }

    const variables = this.router.add(path, routeName);
    if (variables.size < 1) {
      throw new RouterError(
        "Path for collection dispatcher must have at least one variable.",
      );
    }

    const callbacks: CustomCollectionCallbacks<
      TObject,
      TParams,
      RequestContext<TContextData>,
      TContextData
    > = { dispatcher };

    // @ts-ignore: TypeScript does not infer the type correctly
    this.collectionCallbacks[name] = callbacks;
    this.collectionTypeIds[name] = itemType;

    const setters: CustomCollectionCallbackSetters<
      TParams,
      RequestContext<TContextData>,
      TContextData
    > = {
      setCounter(
        counter: CustomCollectionCounter<
          TParams,
          TContextData
        >,
      ) {
        callbacks.counter = counter;
        return setters;
      },
      setFirstCursor(
        cursor: CustomCollectionCursor<
          TParams,
          RequestContext<TContextData>,
          TContextData
        >,
      ) {
        callbacks.firstCursor = cursor;
        return setters;
      },
      setLastCursor(
        cursor: CustomCollectionCursor<
          TParams,
          RequestContext<TContextData>,
          TContextData
        >,
      ) {
        callbacks.lastCursor = cursor;
        return setters;
      },
      authorize(
        predicate: ObjectAuthorizePredicate<
          TContextData,
          keyof TParams & string
        >,
      ) {
        callbacks.authorizePredicate = predicate;
        return setters;
      },
    };
    return setters;
  }

  /**
   * Get the URL path for a custom collection.
   * If the collection is not registered, returns null.
   * @template TParam The parameter names of the requested URL.
   * @param {string | symbol} name The name of the custom collection.
   * @param {TParam} values The values to fill in the URL parameters.
   * @returns {string | null} The URL path for the custom collection, or null if not registered.
   */
  getCollectionPath<TParam extends Record<string, string>>(
    name: string | symbol,
    values: TParam,
  ): string | null {
    // Check if it's a registered custom collection
    if (!(name in this.collectionCallbacks)) return null;
    const routeName = this.#uniqueCollectionId(name);
    const path = this.router.build(`collection:${routeName}`, values) ??
      this.router.build(`orderedCollection:${routeName}`, values);
    return path;
  }

  /**
   * Converts a name (string or symbol) to a unique string identifier.
   * For symbols, generates and caches a UUID if not already present.
   * For strings, returns the string as-is.
   * @param name The name to convert to a unique identifier
   * @returns A unique string identifier
   */
  #uniqueCollectionId(name: string | symbol): string {
    if (typeof name === "string") return name;
    // Check if symbol already has a unique ID
    if (!this.#symbolRegistry.has(name)) {
      // Generate a new UUID for this symbol
      this.#symbolRegistry.set(name, crypto.randomUUID());
    }

    return this.#symbolRegistry.get(name)!;
  }
}

/**
 * Creates a new {@link FederationBuilder} instance.
 * @returns A new {@link FederationBuilder} instance.
 * @since 1.6.0
 */
export function createFederationBuilder<TContextData>(): FederationBuilder<
  TContextData
> {
  return new FederationBuilderImpl<TContextData>();
}

interface ActorCallbacks<TContextData> {
  dispatcher?: ActorDispatcher<TContextData>;
  keyPairsDispatcher?: ActorKeyPairsDispatcher<TContextData>;
  handleMapper?: ActorHandleMapper<TContextData>;
  aliasMapper?: ActorAliasMapper<TContextData>;
  authorizePredicate?: AuthorizePredicate<TContextData>;
}

interface ObjectCallbacks<TContextData, TParam extends string> {
  dispatcher: ObjectDispatcher<TContextData, Object, string>;
  parameters: Set<TParam>;
  authorizePredicate?: ObjectAuthorizePredicate<TContextData, TParam>;
}
