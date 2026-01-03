import type {
  Activity,
  Actor,
  Collection,
  CryptographicKey,
  Link,
  LookupObjectOptions,
  Multikey,
  Object,
  Recipient,
  TraverseCollectionOptions,
} from "@fedify/vocab";
import type { DocumentLoader } from "@fedify/vocab-runtime";
import type { LookupWebFingerOptions, ResourceDescriptor } from "@fedify/webfinger";
import type { TracerProvider } from "@opentelemetry/api";
import type { GetNodeInfoOptions } from "../nodeinfo/client.ts";
import type { JsonValue, NodeInfo } from "../nodeinfo/types.ts";
import type { GetKeyOwnerOptions } from "../sig/owner.ts";
import type { ConstructorWithTypeId, Federation } from "./federation.ts";
import type { SenderKeyPair } from "./send.ts";

/**
 * A context.
 */
export interface Context<TContextData> {
  /**
   * The origin of the federated server, including the scheme (`http://` or
   * `https://`) and the host (e.g., `example.com:8080`).
   * @since 0.12.0
   */
  readonly origin: string;

  /**
   * The canonical origin of the federated server, including the scheme
   * (`http://` or `https://`) and the host (e.g., `example.com:8080`).
   *
   * When the associated {@link Federation} object does not have any explicit
   * canonical origin, it is the same as the {@link Context.origin}.
   * @since 1.5.0
   */
  readonly canonicalOrigin: string;

  /**
   * The host of the federated server, including the hostname
   * (e.g., `example.com`) and the port following a colon (e.g., `:8080`)
   * if it is not the default port for the scheme.
   * @since 0.12.0
   */
  readonly host: string;

  /**
   * The hostname of the federated server (e.g., `example.com`).  This is
   * the same as the host without the port.
   * @since 0.12.0
   */
  readonly hostname: string;

  /**
   * The user-defined data associated with the context.
   */
  readonly data: TContextData;

  /**
   * The OpenTelemetry tracer provider.
   * @since 1.3.0
   */
  readonly tracerProvider: TracerProvider;

  /**
   * The document loader for loading remote JSON-LD documents.
   */
  readonly documentLoader: DocumentLoader;

  /**
   * The context loader for loading remote JSON-LD contexts.
   */
  readonly contextLoader: DocumentLoader;

  /**
   * The federation object that this context belongs to.
   * @since 1.6.0
   */
  readonly federation: Federation<TContextData>;

  /**
   * Creates a new context with the same properties as this one,
   * but with the given data.
   * @param data The new data to associate with the context.
   * @returns A new context with the same properties as this one,
   *          but with the given data.
   * @since 1.6.0
   */
  clone(data: TContextData): Context<TContextData>;

  /**
   * Builds the URI of the NodeInfo document.
   * @returns The NodeInfo URI.
   * @throws {RouterError} If no NodeInfo dispatcher is available.
   * @since 0.2.0
   */
  getNodeInfoUri(): URL;

  /**
   * Builds the URI of an actor with the given identifier.
   * @param identifier The actor's identifier.
   * @returns The actor's URI.
   * @throws {RouterError} If no actor dispatcher is available.
   */
  getActorUri(identifier: string): URL;

  /**
   * Builds the URI of an object with the given class and values.
   * @param cls The class of the object.
   * @param values The values to pass to the object dispatcher.
   * @returns The object's URI.
   * @throws {RouteError} If no object dispatcher is available for the class.
   * @throws {TypeError} If values are invalid.
   * @since 0.7.0
   */
  getObjectUri<TObject extends Object>(
    cls: ConstructorWithTypeId<TObject>,
    values: Record<string, string>,
  ): URL;

  /**
   * Builds the URI of an actor's outbox with the given identifier.
   * @param identifier The actor's identifier.
   * @returns The actor's outbox URI.
   * @throws {RouterError} If no outbox dispatcher is available.
   */
  getOutboxUri(identifier: string): URL;

  /**
   * Builds the URI of the shared inbox.
   * @returns The shared inbox URI.
   * @throws {RouterError} If no inbox listener is available.
   */
  getInboxUri(): URL;

  /**
   * Builds the URI of an actor's inbox with the given identifier.
   * @param identifier The actor's identifier.
   * @returns The actor's inbox URI.
   * @throws {RouterError} If no inbox listener is available.
   */
  getInboxUri(identifier: string): URL;

  /**
   * Builds the URI of an actor's following collection with the given
   * identifier.
   * @param identifier The actor's identifier.
   * @returns The actor's following collection URI.
   * @throws {RouterError} If no following collection is available.
   */
  getFollowingUri(identifier: string): URL;

  /**
   * Builds the URI of an actor's followers collection with the given
   * identifier.
   * @param identifier The actor's identifier.
   * @returns The actor's followers collection URI.
   * @throws {RouterError} If no followers collection is available.
   */
  getFollowersUri(identifier: string): URL;

  /**
   * Builds the URI of an actor's liked collection with the given identifier.
   * @param identifier The actor's identifier.
   * @returns The actor's liked collection URI.
   * @throws {RouterError} If no liked collection is available.
   * @since 0.11.0
   */
  getLikedUri(identifier: string): URL;

  /**
   * Builds the URI of an actor's featured collection with the given identifier.
   * @param identifier The actor's identifier.
   * @returns The actor's featured collection URI.
   * @throws {RouterError} If no featured collection is available.
   * @since 0.11.0
   */
  getFeaturedUri(identifier: string): URL;

  /**
   * Builds the URI of an actor's featured tags collection with the given
   * identifier.
   * @param identifier The actor's identifier.
   * @returns The actor's featured tags collection URI.
   * @throws {RouterError} If no featured tags collection is available.
   * @since 0.11.0
   */
  getFeaturedTagsUri(identifier: string): URL;

  /**
   * Determines the type of the URI and extracts the associated data.
   * @param uri The URI to parse.
   * @returns The result of parsing the URI.  If `null` is given or
   *          the URI is not recognized, `null` is returned.
   * @since 0.9.0
   */
  parseUri(uri: URL | null): ParseUriResult | null;

  /**
   * Gets the key pairs for an actor.
   * @param identifier The actor's identifier.
   * @returns An async iterable of the actor's key pairs.  It can be empty.
   * @since 0.10.0
   */
  getActorKeyPairs(identifier: string): Promise<ActorKeyPair[]>;

  /**
   * Gets an authenticated {@link DocumentLoader} for the given identity.
   * Note that an authenticated document loader intentionally does not cache
   * the fetched documents.
   * @param identity The identity to get the document loader for.
   *                 The actor's identifier or username.
   * @returns The authenticated document loader.
   * @throws {Error} If the identity is not valid.
   * @throws {TypeError} If the key is invalid or unsupported.
   * @since 0.4.0
   */
  getDocumentLoader(
    identity:
      | { identifier: string }
      | { username: string }
      | { handle: string },
  ): Promise<DocumentLoader>;

  /**
   * Gets an authenticated {@link DocumentLoader} for the given identity.
   * Note that an authenticated document loader intentionally does not cache
   * the fetched documents.
   * @param identity The identity to get the document loader for.
   *                 The actor's key pair.
   * @returns The authenticated document loader.
   * @throws {TypeError} If the key is invalid or unsupported.
   * @since 0.4.0
   */
  getDocumentLoader(
    identity: { keyId: URL; privateKey: CryptoKey },
  ): DocumentLoader;

  /**
   * Looks up an ActivityStreams object by its URI (including `acct:` URIs)
   * or a fediverse handle (e.g., `@user@server` or `user@server`).
   *
   * @example
   * ``` typescript
   * // Look up an actor by its fediverse handle:
   * await ctx.lookupObject("@hongminhee@fosstodon.org");
   * // returning a `Person` object.
   *
   * // A fediverse handle can omit the leading '@':
   * await ctx.lookupObject("hongminhee@fosstodon.org");
   * // returning a `Person` object.
   *
   * // A `acct:` URI can be used as well:
   * await ctx.lookupObject("acct:hongminhee@fosstodon.org");
   * // returning a `Person` object.
   *
   * // Look up an object by its URI:
   * await ctx.lookupObject("https://todon.eu/@hongminhee/112060633798771581");
   * // returning a `Note` object.
   *
   * // It can be a `URL` object as well:
   * await ctx.lookupObject(
   *   new URL("https://todon.eu/@hongminhee/112060633798771581")
   * );
   * // returning a `Note` object.
   * ```
   *
   * It's almost the same as the {@link lookupObject} function, but it uses
   * the context's document loader and context loader by default.
   *
   * @param identifier The URI or fediverse handle to look up.
   * @param options Lookup options.
   * @returns The object, or `null` if not found.
   * @since 0.15.0
   */
  lookupObject(
    identifier: string | URL,
    options?: LookupObjectOptions,
  ): Promise<Object | null>;

  /**
   * Traverses a collection, yielding each item in the collection.
   * If the collection is paginated, it will fetch the next page
   * automatically.
   *
   * @example
   * ``` typescript
   * const collection = await ctx.lookupObject(collectionUrl);
   * if (collection instanceof Collection) {
   *   for await (const item of ctx.traverseCollection(collection)) {
   *     console.log(item.id?.href);
   *   }
   * }
   * ```
   *
   * It's almost the same as the {@link traverseCollection} function, but it
   * uses the context's document loader and context loader by default.
   * @param collection The collection to traverse.
   * @param options Options for traversing the collection.
   * @returns An async iterable of each item in the collection.
   * @since 1.1.0
   */
  traverseCollection(
    collection: Collection,
    options?: TraverseCollectionOptions,
  ): AsyncIterable<Object | Link>;

  /**
   * Fetches the NodeInfo document from the given URL.
   * @param url The base URL of the server.  If `options.direct` is turned off
   *            (default), the NodeInfo document will be fetched from
   *            the `.well-known` location of this URL (hence the only origin
   *            of the URL is used).  If `options.direct` is turned on,
   *            the NodeInfo document will be fetched from the given URL.
   * @param options Options for fetching the NodeInfo document.
   * @returns The NodeInfo document if it could be fetched successfully.
   *          Otherwise, `undefined` is returned.
   * @since 1.4.0
   */
  lookupNodeInfo(
    url: URL | string,
    options?: GetNodeInfoOptions & { parse?: "strict" | "best-effort" },
  ): Promise<NodeInfo | undefined>;

  /**
   * Fetches the NodeInfo document from the given URL.
   * @param url The base URL of the server.  If `options.direct` is turned off
   *            (default), the NodeInfo document will be fetched from
   *            the `.well-known` location of this URL (hence the only origin
   *            of the URL is used).  If `options.direct` is turned on,
   *            the NodeInfo document will be fetched from the given URL.
   * @param options Options for fetching the NodeInfo document.
   * @returns The NodeInfo document if it could be fetched successfully.
   *          Otherwise, `undefined` is returned.
   * @since 1.4.0
   */
  lookupNodeInfo(
    url: URL | string,
    options?: GetNodeInfoOptions & { parse: "none" },
  ): Promise<JsonValue | undefined>;

  /**
   * Looks up a WebFinger resource.
   *
   * It's almost the same as the {@link lookupWebFinger} function, but it uses
   * the context's configuration by default.
   *
   * @param resource The resource URL to look up.
   * @param options Extra options for looking up the resource.
   * @returns The resource descriptor, or `null` if not found.
   * @since 1.6.0
   */
  lookupWebFinger(
    resource: URL | string,
    options?: LookupWebFingerOptions,
  ): Promise<ResourceDescriptor | null>;

  /**
   * Sends an activity to recipients' inboxes.
   * @param sender The sender's identifier or the sender's username or
   *               the sender's key pair(s).
   * @param recipients The recipients of the activity.
   * @param activity The activity to send.
   * @param options Options for sending the activity.
   */
  sendActivity(
    sender:
      | SenderKeyPair
      | SenderKeyPair[]
      | { identifier: string }
      | { username: string }
      | { handle: string },
    recipients: Recipient | Recipient[],
    activity: Activity,
    options?: SendActivityOptions,
  ): Promise<void>;

  /**
   * Sends an activity to the outboxes of the sender's followers.
   * @param sender The sender's identifier or the sender's username.
   * @param recipients In this case, it must be `"followers"`.
   * @param activity The activity to send.
   * @param options Options for sending the activity.
   * @throws {Error} If no followers collection is registered.
   * @since 0.14.0
   */
  sendActivity(
    sender: { identifier: string } | { username: string } | { handle: string },
    recipients: "followers",
    activity: Activity,
    options?: SendActivityOptionsForCollection,
  ): Promise<void>;

  /**
   * Manually routes an activity to the appropriate inbox listener.
   *
   * It is useful for routing an activity that is not received from the network,
   * or for routing an activity that is enclosed in another activity.
   *
   * Note that the activity will be verified if it has Object Integrity Proofs
   * or is equivalent to the actual remote object.  If the activity is not
   * verified, it will be rejected.
   * @param recipient The recipient of the activity.  If it is `null`,
   *                  the activity will be routed to the shared inbox.
   *                  Otherwise, the activity will be routed to the personal
   *                  inbox of the recipient with the given identifier.
   * @param activity The activity to route.  It must have a proof or
   *                 a dereferenceable `id` to verify the activity.
   * @param options Options for routing the activity.
   * @returns `true` if the activity is successfully verified and routed.
   *          Otherwise, `false`.
   * @since 1.3.0
   */
  routeActivity(
    recipient: string | null,
    activity: Activity,
    options?: RouteActivityOptions,
  ): Promise<boolean>;

  /**
   * Builds the URI of a collection of objects with the given name and values.
   * @param name The name of the collection, which can be a string or a symbol.
   * @param values The values of the URI parameters.
   * @return The URI of the collection.
   * @throws {RouteError} If no object dispatcher is available for the name.
   * @throws {TypeError} If values are invalid.
   * @since 1.8.0
   */
  getCollectionUri<TParam extends Record<string, string>>(
    name: string | symbol,
    values: TParam,
  ): URL;
}

/**
 * A context for a request.
 */
export interface RequestContext<TContextData> extends Context<TContextData> {
  /**
   * The request object.
   */
  readonly request: Request;

  /**
   * The URL of the request.
   */
  readonly url: URL;

  /**
   * Creates a new context with the same properties as this one,
   * but with the given data.
   * @param data The new data to associate with the context.
   * @returns A new context with the same properties as this one,
   *          but with the given data.
   * @since 1.6.0
   */
  clone(data: TContextData): RequestContext<TContextData>;

  /**
   * Gets an {@link Actor} object for the given identifier.
   * @param identifier The actor's identifier.
   * @returns The actor object, or `null` if the actor is not found.
   * @throws {Error} If no actor dispatcher is available.
   * @since 0.7.0
   */
  getActor(identifier: string): Promise<Actor | null>;

  /**
   * Gets an object of the given class with the given values.
   * @param cls The class to instantiate.
   * @param values The values to pass to the object dispatcher.
   * @returns The object of the given class with the given values, or `null`
   *          if the object is not found.
   * @throws {Error} If no object dispatcher is available for the class.
   * @throws {TypeError} If values are invalid.
   * @since 0.7.0
   */
  getObject<TObject extends Object>(
    cls: ConstructorWithTypeId<TObject>,
    values: Record<string, string>,
  ): Promise<TObject | null>;

  /**
   * Gets the public key of the sender, if any exists and it is verified.
   * Otherwise, `null` is returned.
   *
   * This can be used for implementing [authorized fetch] (also known as
   * secure mode) in ActivityPub.
   *
   * [authorized fetch]: https://swicg.github.io/activitypub-http-signature/#authorized-fetch
   *
   * @returns The public key of the sender, or `null` if the sender is not verified.
   * @since 0.7.0
   */
  getSignedKey(): Promise<CryptographicKey | null>;

  /**
   * Gets the public key of the sender, if any exists and it is verified.
   * Otherwise, `null` is returned.
   *
   * This can be used for implementing [authorized fetch] (also known as
   * secure mode) in ActivityPub.
   *
   * [authorized fetch]: https://swicg.github.io/activitypub-http-signature/#authorized-fetch
   *
   * @param options Options for getting the signed key. You usually may want to
   *                specify the custom `documentLoader` so that making
   *                an HTTP request to the sender's server is signed with
   *                your [instance actor].
   * @returns The public key of the sender, or `null` if the sender is not verified.
   * @since 1.5.0
   *
   * [instance actor]: https://swicg.github.io/activitypub-http-signature/#instance-actor
   */
  getSignedKey(options: GetSignedKeyOptions): Promise<CryptographicKey | null>;

  /**
   * Gets the owner of the signed key, if any exists and it is verified.
   * Otherwise, `null` is returned.
   *
   * This can be used for implementing [authorized fetch] (also known as
   * secure mode) in ActivityPub.
   *
   * [authorized fetch]: https://swicg.github.io/activitypub-http-signature/#authorized-fetch
   *
   * @returns The owner of the signed key, or `null` if the key is not verified
   *          or the owner is not found.
   * @since 0.7.0
   */
  getSignedKeyOwner(): Promise<Actor | null>;

  /**
   * Gets the owner of the signed key, if any exists and it is verified.
   * Otherwise, `null` is returned.
   *
   * This can be used for implementing [authorized fetch] (also known as
   * secure mode) in ActivityPub.
   *
   * [authorized fetch]: https://swicg.github.io/activitypub-http-signature/#authorized-fetch
   *
   * @param options Options for getting the key owner. You usually may want to
   *                specify the custom `documentLoader` so that making
   *                an HTTP request to the key owner's server is signed with
   *                your [instance actor].
   * @returns The owner of the signed key, or `null` if the key is not verified
   *          or the owner is not found.
   * @since 1.5.0
   *
   * [instance actor]: https://swicg.github.io/activitypub-http-signature/#instance-actor
   */
  getSignedKeyOwner(
    options: GetKeyOwnerOptions,
  ): Promise<Actor | null>;
}

/**
 * A context for inbox listeners.
 * @since 1.0.0
 */
export interface InboxContext<TContextData> extends Context<TContextData> {
  /**
   * The identifier of the recipient of the inbox.  If the inbox is a shared
   * inbox, it is `null`.
   * @since 1.2.0
   */
  recipient: string | null;

  /**
   * Creates a new context with the same properties as this one,
   * but with the given data.
   * @param data The new data to associate with the context.
   * @returns A new context with the same properties as this one,
   *          but with the given data.
   * @since 1.6.0
   */
  clone(data: TContextData): InboxContext<TContextData>;

  /**
   * Forwards a received activity to the recipients' inboxes.  The forwarded
   * activity will be signed in HTTP Signatures by the forwarder, but its
   * payload will not be modified, i.e., Linked Data Signatures and Object
   * Integrity Proofs will not be added.  Therefore, if the activity is not
   * signed (i.e., it has neither Linked Data Signatures nor Object Integrity
   * Proofs), the recipient probably will not trust the activity.
   * @param forwarder The forwarder's identifier or the forwarder's username
   *                  or the forwarder's key pair(s).
   * @param recipients The recipients of the activity.
   * @param options Options for forwarding the activity.
   * @since 1.0.0
   */
  forwardActivity(
    forwarder:
      | SenderKeyPair
      | SenderKeyPair[]
      | { identifier: string }
      | { username: string }
      | { handle: string },
    recipients: Recipient | Recipient[],
    options?: ForwardActivityOptions,
  ): Promise<void>;

  /**
   * Forwards a received activity to the recipients' inboxes.  The forwarded
   * activity will be signed in HTTP Signatures by the forwarder, but its
   * payload will not be modified, i.e., Linked Data Signatures and Object
   * Integrity Proofs will not be added.  Therefore, if the activity is not
   * signed (i.e., it has neither Linked Data Signatures nor Object Integrity
   * Proofs), the recipient probably will not trust the activity.
   * @param forwarder The forwarder's identifier or the forwarder's username.
   * @param recipients In this case, it must be `"followers"`.
   * @param options Options for forwarding the activity.
   * @since 1.0.0
   */
  forwardActivity(
    forwarder:
      | { identifier: string }
      | { username: string }
      | { handle: string },
    recipients: "followers",
    options?: ForwardActivityOptions,
  ): Promise<void>;
}

/**
 * A result of parsing an URI.
 */
export type ParseUriResult =
  /**
   * The case of an actor URI.
   */
  | {
    readonly type: "actor";
    readonly identifier: string;
    readonly handle: string;
  }
  /**
   * The case of an object URI.
   */
  | {
    readonly type: "object";
    readonly class: ConstructorWithTypeId<Object>;
    readonly typeId: URL;
    readonly values: Record<string, string>;
  }
  /**
   * The case of an shared inbox URI.
   */
  | {
    readonly type: "inbox";
    readonly identifier: undefined;
    readonly handle: undefined;
  }
  /**
   * The case of an personal inbox URI.
   */
  | {
    readonly type: "inbox";
    readonly identifier: string;
    readonly handle: string;
  }
  /**
   * The case of an outbox collection URI.
   */
  | {
    readonly type: "outbox";
    readonly identifier: string;
    readonly handle: string;
  }
  /**
   * The case of a following collection URI.
   */
  | {
    readonly type: "following";
    readonly identifier: string;
    readonly handle: string;
  }
  /**
   * The case of a followers collection URI.
   */
  | {
    readonly type: "followers";
    readonly identifier: string;
    readonly handle: string;
  }
  /**
   * The case of a liked collection URI.
   * @since 0.11.0
   */
  | {
    readonly type: "liked";
    readonly identifier: string;
    readonly handle: string;
  }
  /**
   * The case of a featured collection URI.
   * @since 0.11.0
   */
  | {
    readonly type: "featured";
    readonly identifier: string;
    readonly handle: string;
  }
  /**
   * The case of a featured tags collection URI.
   * @since 0.11.0
   */
  | {
    readonly type: "featuredTags";
    readonly identifier: string;
    readonly handle: string;
  }
  /**
   * The case of a custom collection URI.
   * @since 1.8.0
   */
  | {
    readonly type: "collection";
    readonly name: string | symbol;
    readonly class: ConstructorWithTypeId<Object>;
    readonly typeId: URL;
    readonly values: Record<string, string>;
  }
  /**
   * The case of a custom ordered collection URI.
   * @since 1.8.0
   */
  | {
    readonly type: "orderedCollection";
    readonly name: string | symbol;
    readonly class: ConstructorWithTypeId<Object>;
    readonly typeId: URL;
    readonly values: Record<string, string>;
  };

/**
 * Options for {@link Context.sendActivity} method.
 */
export interface SendActivityOptions {
  /**
   * Whether to prefer the shared inbox for the recipients.
   */
  preferSharedInbox?: boolean;

  /**
   * Whether to send the activity immediately, without enqueuing it.
   * If `true`, the activity will be sent immediately and the retrial
   * policy will not be applied.
   *
   * @since 0.3.0
   */
  immediate?: boolean;

  /**
   * Determines how activities are queued when sent to multiple recipients.
   *
   * - "auto" (default): Automatically chooses optimal strategy based on
   *   recipient count.
   * - "skip": Always enqueues individual messages per recipient,
   *   bypassing the fanout queue. Use when payload needs to vary per recipient.
   * - "force": Always uses fanout queue regardless of recipient count.
   *   Useful for testing or special cases.
   *
   * This option is ignored when `immediate: true` is specified, as immediate
   * delivery bypasses all queuing mechanisms.
   *
   * @default `"auto"`
   * @since 1.5.0
   */
  fanout?: "auto" | "skip" | "force";

  /**
   * The base URIs to exclude from the recipients' inboxes.  It is useful
   * for excluding the recipients having the same shared inbox with the sender.
   *
   * Note that the only `origin` parts of the `URL`s are compared.
   *
   * @since 0.9.0
   */
  excludeBaseUris?: URL[];
}

/**
 * Options for {@link Context.sendActivity} method when sending to a collection.
 * @since 1.5.0
 */
export interface SendActivityOptionsForCollection extends SendActivityOptions {
  /**
   * Whether to synchronize the collection using `Collection-Synchronization`
   * header ([FEP-8fcf]).
   *
   * [FEP-8fcf]: https://w3id.org/fep/8fcf
   */
  syncCollection?: boolean;
}

/**
 * Options for {@link InboxContext.forwardActivity} method.
 * @since 1.0.0
 */
export type ForwardActivityOptions = Omit<SendActivityOptions, "fanout"> & {
  /**
   * Whether to skip forwarding the activity if it is not signed, i.e., it has
   * neither Linked Data Signatures nor Object Integrity Proofs.
   *
   * If the activity is not signed, the recipient probably will not trust the
   * activity.  Therefore, it is recommended to skip forwarding the activity
   * if it is not signed.
   */
  skipIfUnsigned: boolean;
};

/**
 * Options for {@link Context.routeActivity} method.
 * @since 1.3.0
 */
export interface RouteActivityOptions {
  /**
   * Whether to skip enqueuing the activity and invoke the listener immediately.
   * If no inbox queue is available, this option is ignored and the activity
   * will be always invoked immediately.
   * @default false
   */
  immediate?: boolean;

  /**
   * The document loader for loading remote JSON-LD documents.
   */
  documentLoader?: DocumentLoader;

  /**
   * The context loader for loading remote JSON-LD contexts.
   */
  contextLoader?: DocumentLoader;

  /**
   * The OpenTelemetry tracer provider.  If omitted, the global tracer provider
   * is used.
   */
  tracerProvider?: TracerProvider;
}

/**
 * Options for {@link Context.getSignedKey} method.
 * @since 1.5.0
 */
export interface GetSignedKeyOptions {
  /**
   * The document loader for loading remote JSON-LD documents.
   */
  documentLoader?: DocumentLoader;

  /**
   * The context loader for loading remote JSON-LD contexts.
   */
  contextLoader?: DocumentLoader;

  /**
   * The OpenTelemetry tracer provider.  If omitted, the global tracer provider
   * is used.
   */
  tracerProvider?: TracerProvider;
}

/**
 * A pair of a public key and a private key in various formats.
 * @since 0.10.0
 */
export interface ActorKeyPair extends CryptoKeyPair {
  /**
   * The URI of the public key, which is used for verifying HTTP Signatures.
   */
  keyId: URL;

  /**
   * A {@link CryptographicKey} instance of the public key.
   */
  cryptographicKey: CryptographicKey;

  /**
   * A {@link Multikey} instance of the public key.
   */
  multikey: Multikey;
}
