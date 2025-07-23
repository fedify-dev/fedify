// deno-lint-ignore-file no-explicit-any
import type {
  ActorCallbackSetters,
  ActorDispatcher,
  ActorKeyPair,
  CollectionCallbackSetters,
  CollectionDispatcher,
  Context,
  Federation,
  FederationFetchOptions,
  FederationStartQueueOptions,
  InboxContext,
  InboxListenerSetters,
  Message,
  NodeInfoDispatcher,
  ObjectCallbackSetters,
  ObjectDispatcher,
  ParseUriResult,
  RequestContext,
  RouteActivityOptions,
  SendActivityOptions,
  SendActivityOptionsForCollection,
  SenderKeyPair,
} from "@fedify/fedify/federation";
import type { JsonValue, NodeInfo } from "@fedify/fedify/nodeinfo";
import type { DocumentLoader } from "@fedify/fedify/runtime";
import type {
  Activity,
  Actor,
  Collection,
  Hashtag,
  LookupObjectOptions,
  Object,
  Recipient,
  TraverseCollectionOptions,
} from "@fedify/fedify/vocab";
import type { ResourceDescriptor } from "@fedify/fedify/webfinger";
import { trace, type TracerProvider } from "@opentelemetry/api";
import { createInboxContext, createRequestContext } from "./context.ts";

/**
 * Helper function to expand URI templates with values.
 * Supports simple placeholders like {identifier}, {handle}, etc.
 * @param template The URI template pattern
 * @param values The values to substitute
 * @returns The expanded URI path
 */
function expandUriTemplate(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(/{([^}]+)}/g, (match, key) => {
    return values[key] || match;
  });
}

/**
 * Represents a sent activity with metadata about how it was sent.
 * @since 1.8.0
 */
export interface SentActivity {
  /** Whether the activity was queued or sent immediately. */
  queued: boolean;
  /** Which queue was used (if queued). */
  queue?: "inbox" | "outbox" | "fanout";
  /** The activity that was sent. */
  activity: Activity;
  /** The order in which the activity was sent (auto-incrementing counter). */
  sentOrder: number;
}

/**
 * A mock implementation of the {@link Federation} interface for unit testing.
 * This class provides a way to test Fedify applications without needing
 * a real federation setup.
 *
 * @example
 * ```typescript
 * import { Create } from "@fedify/fedify/vocab";
 * import { MockFederation } from "@fedify/testing";
 *
 * // Create a mock federation
 * const federation = new MockFederation<{ userId: string }>();
 *
 * // Set up inbox listeners
 * federation
 *   .setInboxListeners("/users/{identifier}/inbox")
 *   .on(Create, async (ctx, activity) => {
 *     console.log("Received:", activity);
 *   });
 *
 * // Simulate receiving an activity
 * const createActivity = new Create({
 *   id: new URL("https://example.com/create/1"),
 *   actor: new URL("https://example.com/users/alice")
 * });
 * await federation.receiveActivity(createActivity);
 * ```
 *
 * @typeParam TContextData The context data to pass to the {@link Context}.
 * @since 1.8.0
 */
export class MockFederation<TContextData> implements Federation<TContextData> {
  public sentActivities: SentActivity[] = [];
  public queueStarted = false;
  private activeQueues: Set<"inbox" | "outbox" | "fanout"> = new Set();
  public sentCounter = 0;
  private nodeInfoDispatcher?: NodeInfoDispatcher<TContextData>;
  private actorDispatchers: Map<string, ActorDispatcher<TContextData>> =
    new Map();
  public actorPath?: string;
  public inboxPath?: string;
  public outboxPath?: string;
  public followingPath?: string;
  public followersPath?: string;
  public likedPath?: string;
  public featuredPath?: string;
  public featuredTagsPath?: string;
  public nodeInfoPath?: string;
  public sharedInboxPath?: string;
  public objectPaths: Map<string, string> = new Map();
  private objectDispatchers: Map<
    string,
    ObjectDispatcher<TContextData, Object, string>
  > = new Map();
  private inboxDispatcher?: CollectionDispatcher<
    Activity,
    RequestContext<TContextData>,
    TContextData,
    void
  >;
  private outboxDispatcher?: CollectionDispatcher<
    Activity,
    RequestContext<TContextData>,
    TContextData,
    void
  >;
  private followingDispatcher?: CollectionDispatcher<
    Actor | URL,
    RequestContext<TContextData>,
    TContextData,
    void
  >;
  private followersDispatcher?: CollectionDispatcher<
    Recipient,
    Context<TContextData>,
    TContextData,
    URL
  >;
  private likedDispatcher?: CollectionDispatcher<
    Object | URL,
    RequestContext<TContextData>,
    TContextData,
    void
  >;
  private featuredDispatcher?: CollectionDispatcher<
    Object,
    RequestContext<TContextData>,
    TContextData,
    void
  >;
  private featuredTagsDispatcher?: CollectionDispatcher<
    Hashtag,
    RequestContext<TContextData>,
    TContextData,
    void
  >;
  private inboxListeners: Map<string, InboxListener<TContextData, Activity>[]> =
    new Map();
  private contextData?: TContextData;
  private receivedActivities: Activity[] = [];

  constructor(
    private options: {
      contextData?: TContextData;
      origin?: string;
      tracerProvider?: TracerProvider;
    } = {},
  ) {
    this.contextData = options.contextData;
  }

  setNodeInfoDispatcher(
    path: string,
    dispatcher: NodeInfoDispatcher<TContextData>,
  ): void {
    this.nodeInfoDispatcher = dispatcher;
    this.nodeInfoPath = path;
  }

  setActorDispatcher(
    path: `${string}{identifier}${string}` | `${string}{handle}${string}`,
    dispatcher: ActorDispatcher<TContextData>,
  ): ActorCallbackSetters<TContextData> {
    this.actorDispatchers.set(path, dispatcher);
    this.actorPath = path;
    return {
      setKeyPairsDispatcher: () => this as any,
      mapHandle: () => this as any,
      mapAlias: () => this as any,
      authorize: () => this as any,
    };
  }

  setObjectDispatcher<TObject extends Object, TParam extends string>(
    cls: (new (...args: any[]) => TObject) & { typeId: URL },
    path: string,
    dispatcher: ObjectDispatcher<TContextData, TObject, TParam>,
  ): ObjectCallbackSetters<TContextData, TObject, TParam> {
    this.objectDispatchers.set(path, dispatcher);
    this.objectPaths.set(cls.typeId.href, path);
    return {
      authorize: () => this as any,
    };
  }

  setInboxDispatcher(
    _path: `${string}{identifier}${string}` | `${string}{handle}${string}`,
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
    this.inboxDispatcher = dispatcher;
    // Note: inboxPath is set in setInboxListeners
    return {
      setCounter: () => this as any,
      setFirstCursor: () => this as any,
      setLastCursor: () => this as any,
      authorize: () => this as any,
    };
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
    this.outboxDispatcher = dispatcher;
    this.outboxPath = path;
    return {
      setCounter: () => this as any,
      setFirstCursor: () => this as any,
      setLastCursor: () => this as any,
      authorize: () => this as any,
    };
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
    this.followingDispatcher = dispatcher;
    this.followingPath = path;
    return {
      setCounter: () => this as any,
      setFirstCursor: () => this as any,
      setLastCursor: () => this as any,
      authorize: () => this as any,
    };
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
    this.followersDispatcher = dispatcher;
    this.followersPath = path;
    return {
      setCounter: () => this as any,
      setFirstCursor: () => this as any,
      setLastCursor: () => this as any,
      authorize: () => this as any,
    };
  }

  setLikedDispatcher(
    path: `${string}{identifier}${string}` | `${string}{handle}${string}`,
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
  > {
    this.likedDispatcher = dispatcher;
    this.likedPath = path;
    return {
      setCounter: () => this as any,
      setFirstCursor: () => this as any,
      setLastCursor: () => this as any,
      authorize: () => this as any,
    };
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
    this.featuredDispatcher = dispatcher;
    this.featuredPath = path;
    return {
      setCounter: () => this as any,
      setFirstCursor: () => this as any,
      setLastCursor: () => this as any,
      authorize: () => this as any,
    };
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
    this.featuredTagsDispatcher = dispatcher;
    this.featuredTagsPath = path;
    return {
      setCounter: () => this as any,
      setFirstCursor: () => this as any,
      setLastCursor: () => this as any,
      authorize: () => this as any,
    };
  }

  setInboxListeners(
    inboxPath: `${string}{identifier}${string}` | `${string}{handle}${string}`,
    sharedInboxPath?: string,
  ): InboxListenerSetters<TContextData> {
    this.inboxPath = inboxPath;
    this.sharedInboxPath = sharedInboxPath;
    // deno-lint-ignore no-this-alias
    const self = this;
    return {
      on<TActivity extends Activity>(
        type: new (...args: any[]) => TActivity,
        listener: InboxListener<TContextData, TActivity>,
      ): InboxListenerSetters<TContextData> {
        const typeName = type.name;
        if (!self.inboxListeners.has(typeName)) {
          self.inboxListeners.set(typeName, []);
        }
        self.inboxListeners.get(typeName)!.push(
          listener as InboxListener<TContextData, Activity>,
        );
        return this;
      },
      onError(): InboxListenerSetters<TContextData> {
        return this;
      },
      setSharedKeyDispatcher(): InboxListenerSetters<TContextData> {
        return this;
      },
    };
  }

  // deno-lint-ignore require-await
  async startQueue(
    contextData: TContextData,
    options?: FederationStartQueueOptions,
  ): Promise<void> {
    this.contextData = contextData;
    this.queueStarted = true;

    // If a specific queue is specified, only activate that one
    if (options?.queue) {
      this.activeQueues.add(options.queue);
    } else {
      // If no specific queue, activate all three
      this.activeQueues.add("inbox");
      this.activeQueues.add("outbox");
      this.activeQueues.add("fanout");
    }
  }

  // deno-lint-ignore require-await
  async processQueuedTask(
    contextData: TContextData,
    _message: Message,
  ): Promise<void> {
    this.contextData = contextData;
    // no queue in mock type. process immediately
  }

  createContext(baseUrl: URL, contextData: TContextData): Context<TContextData>;
  createContext(
    request: Request,
    contextData: TContextData,
  ): RequestContext<TContextData>;
  createContext(
    baseUrlOrRequest: URL | Request,
    contextData: TContextData,
  ): Context<TContextData> | RequestContext<TContextData> {
    // deno-lint-ignore no-this-alias
    const mockFederation = this;

    if (baseUrlOrRequest instanceof Request) {
      // For now, we'll use createRequestContext since MockContext doesn't support Request
      // But we need to ensure the sendActivity behavior is consistent
      return createRequestContext({
        url: new URL(baseUrlOrRequest.url),
        request: baseUrlOrRequest,
        data: contextData,
        federation: mockFederation as any,
        sendActivity: (async (
          sender: any,
          recipients: any,
          activity: any,
          options: any,
        ) => {
          // Create a temporary MockContext to use its sendActivity logic
          const tempContext = new MockContext({
            url: new URL(baseUrlOrRequest.url),
            data: contextData,
            federation: mockFederation as any,
          });
          await tempContext.sendActivity(
            sender,
            recipients,
            activity,
            options,
          );
        }) as any,
      });
    } else {
      return new MockContext({
        url: baseUrlOrRequest,
        data: contextData,
        federation: mockFederation as any,
      });
    }
  }

  // deno-lint-ignore require-await
  async fetch(
    request: Request,
    options: FederationFetchOptions<TContextData>,
  ): Promise<Response> {
    // returning 404 by default
    if (options.onNotFound) {
      return options.onNotFound(request);
    }
    return new Response("Not Found", { status: 404 });
  }

  /**
   * Simulates receiving an activity. This method is specific to the mock
   * implementation and is used for testing purposes.
   *
   * @param activity The activity to receive.
   * @returns A promise that resolves when the activity has been processed.
   * @since 1.8.0
   */
  async receiveActivity(activity: Activity): Promise<void> {
    this.receivedActivities.push(activity);

    // Find and execute appropriate inbox listeners
    const typeName = activity.constructor.name;
    const listeners = this.inboxListeners.get(typeName) || [];

    // Check if we have listeners but no context data
    if (listeners.length > 0 && this.contextData === undefined) {
      throw new Error(
        "MockFederation.receiveActivity(): contextData is not initialized. " +
          "Please provide contextData through the constructor or call startQueue() before receiving activities.",
      );
    }

    for (const listener of listeners) {
      const context = createInboxContext({
        data: this.contextData as TContextData,
        federation: this as any,
      });
      await listener(context, activity);
    }
  }

  /**
   * Clears all sent activities from the mock federation.
   * This method is specific to the mock implementation and is used for
   * testing purposes.
   *
   * @since 1.8.0
   */
  reset(): void {
    this.sentActivities = [];
  }
}

// Type definitions for inbox listeners
interface InboxListener<TContextData, TActivity extends Activity> {
  (
    context: InboxContext<TContextData>,
    activity: TActivity,
  ): void | Promise<void>;
}

/**
 * A mock implementation of the {@link Context} interface for unit testing.
 * This class provides a way to test Fedify applications without needing
 * a real federation context.
 *
 * @example
 * ```typescript
 * import { Person, Create } from "@fedify/fedify/vocab";
 * import { MockContext, MockFederation } from "@fedify/testing";
 *
 * // Create a mock context
 * const mockFederation = new MockFederation<{ userId: string }>();
 * const context = new MockContext({
 *   url: new URL("https://example.com"),
 *   data: { userId: "test-user" },
 *   federation: mockFederation
 * });
 *
 * // Send an activity
 * const recipient = new Person({ id: new URL("https://example.com/users/bob") });
 * const activity = new Create({
 *   id: new URL("https://example.com/create/1"),
 *   actor: new URL("https://example.com/users/alice")
 * });
 * await context.sendActivity(
 *   { identifier: "alice" },
 *   recipient,
 *   activity
 * );
 *
 * // Check sent activities
 * const sent = context.getSentActivities();
 * console.log(sent[0].activity);
 * ```
 *
 * @typeParam TContextData The context data to pass to the {@link Context}.
 * @since 1.8.0
 */
export class MockContext<TContextData> implements Context<TContextData> {
  readonly origin: string;
  readonly canonicalOrigin: string;
  readonly host: string;
  readonly hostname: string;
  readonly data: TContextData;
  readonly federation: Federation<TContextData>;
  readonly documentLoader: DocumentLoader;
  readonly contextLoader: DocumentLoader;
  readonly tracerProvider: TracerProvider;

  private sentActivities: Array<{
    sender: any;
    recipients: Recipient | Recipient[] | "followers";
    activity: Activity;
  }> = [];

  constructor(
    options: {
      url?: URL;
      data: TContextData;
      federation: Federation<TContextData>;
      documentLoader?: DocumentLoader;
      contextLoader?: DocumentLoader;
      tracerProvider?: TracerProvider;
    },
  ) {
    const url = options.url ?? new URL("https://example.com");
    this.origin = url.origin;
    this.canonicalOrigin = url.origin;
    this.host = url.host;
    this.hostname = url.hostname;
    this.data = options.data;
    this.federation = options.federation;
    // deno-lint-ignore require-await
    this.documentLoader = options.documentLoader ?? (async (url: string) => ({
      contextUrl: null,
      document: {},
      documentUrl: url,
    }));
    this.contextLoader = options.contextLoader ?? this.documentLoader;
    this.tracerProvider = options.tracerProvider ?? trace.getTracerProvider();
  }

  clone(data: TContextData): Context<TContextData> {
    return new MockContext({
      url: new URL(this.origin),
      data,
      federation: this.federation,
      documentLoader: this.documentLoader,
      contextLoader: this.contextLoader,
      tracerProvider: this.tracerProvider,
    });
  }

  getNodeInfoUri(): URL {
    if (
      this.federation instanceof MockFederation && this.federation.nodeInfoPath
    ) {
      return new URL(this.federation.nodeInfoPath, this.origin);
    }
    return new URL("/nodeinfo/2.0", this.origin);
  }

  getActorUri(identifier: string): URL {
    if (
      this.federation instanceof MockFederation && this.federation.actorPath
    ) {
      const path = expandUriTemplate(this.federation.actorPath, {
        identifier,
        handle: identifier,
      });
      return new URL(path, this.origin);
    }
    return new URL(`/users/${identifier}`, this.origin);
  }

  getObjectUri<TObject extends Object>(
    cls: (new (...args: any[]) => TObject) & { typeId: URL },
    values: Record<string, string>,
  ): URL {
    if (this.federation instanceof MockFederation) {
      const pathTemplate = this.federation.objectPaths.get(cls.typeId.href);
      if (pathTemplate) {
        const path = expandUriTemplate(pathTemplate, values);
        return new URL(path, this.origin);
      }
    }
    const path = globalThis.Object.entries(values)
      .map(([key, value]) => `${key}/${value}`)
      .join("/");
    return new URL(`/objects/${cls.name.toLowerCase()}/${path}`, this.origin);
  }

  getOutboxUri(identifier: string): URL {
    if (
      this.federation instanceof MockFederation && this.federation.outboxPath
    ) {
      const path = expandUriTemplate(this.federation.outboxPath, {
        identifier,
        handle: identifier,
      });
      return new URL(path, this.origin);
    }
    return new URL(`/users/${identifier}/outbox`, this.origin);
  }

  getInboxUri(identifier: string): URL;
  getInboxUri(): URL;
  getInboxUri(identifier?: string): URL {
    if (identifier) {
      if (
        this.federation instanceof MockFederation && this.federation.inboxPath
      ) {
        const path = expandUriTemplate(this.federation.inboxPath, {
          identifier,
          handle: identifier,
        });
        return new URL(path, this.origin);
      }
      return new URL(`/users/${identifier}/inbox`, this.origin);
    }
    if (
      this.federation instanceof MockFederation &&
      this.federation.sharedInboxPath
    ) {
      return new URL(this.federation.sharedInboxPath, this.origin);
    }
    return new URL("/inbox", this.origin);
  }

  getFollowingUri(identifier: string): URL {
    if (
      this.federation instanceof MockFederation && this.federation.followingPath
    ) {
      const path = expandUriTemplate(this.federation.followingPath, {
        identifier,
        handle: identifier,
      });
      return new URL(path, this.origin);
    }
    return new URL(`/users/${identifier}/following`, this.origin);
  }

  getFollowersUri(identifier: string): URL {
    if (
      this.federation instanceof MockFederation && this.federation.followersPath
    ) {
      const path = expandUriTemplate(this.federation.followersPath, {
        identifier,
        handle: identifier,
      });
      return new URL(path, this.origin);
    }
    return new URL(`/users/${identifier}/followers`, this.origin);
  }

  getLikedUri(identifier: string): URL {
    if (
      this.federation instanceof MockFederation && this.federation.likedPath
    ) {
      const path = expandUriTemplate(this.federation.likedPath, {
        identifier,
        handle: identifier,
      });
      return new URL(path, this.origin);
    }
    return new URL(`/users/${identifier}/liked`, this.origin);
  }

  getFeaturedUri(identifier: string): URL {
    if (
      this.federation instanceof MockFederation && this.federation.featuredPath
    ) {
      const path = expandUriTemplate(this.federation.featuredPath, {
        identifier,
        handle: identifier,
      });
      return new URL(path, this.origin);
    }
    return new URL(`/users/${identifier}/featured`, this.origin);
  }

  getFeaturedTagsUri(identifier: string): URL {
    if (
      this.federation instanceof MockFederation &&
      this.federation.featuredTagsPath
    ) {
      const path = expandUriTemplate(this.federation.featuredTagsPath, {
        identifier,
        handle: identifier,
      });
      return new URL(path, this.origin);
    }
    return new URL(`/users/${identifier}/tags`, this.origin);
  }

  parseUri(uri: URL): ParseUriResult | null {
    if (uri.pathname.startsWith("/users/")) {
      const parts = uri.pathname.split("/");
      if (parts.length >= 3) {
        return {
          type: "actor",
          identifier: parts[2],
          handle: parts[2],
        };
      }
    }
    return null;
  }

  getActorKeyPairs(_identifier: string): Promise<ActorKeyPair[]> {
    return Promise.resolve([]);
  }

  getDocumentLoader(
    params: { handle: string } | { identifier: string },
  ): Promise<DocumentLoader>;
  getDocumentLoader(
    params: { keyId: URL; privateKey: CryptoKey },
  ): DocumentLoader;
  getDocumentLoader(params: any): DocumentLoader | Promise<DocumentLoader> {
    // return the same document loader
    if ("keyId" in params) {
      return this.documentLoader;
    }
    return Promise.resolve(this.documentLoader);
  }

  lookupObject(
    _uri: URL | string,
    _options?: LookupObjectOptions,
  ): Promise<Object | null> {
    return Promise.resolve(null);
  }

  traverseCollection<TItem, TContext extends Context<TContextData>>(
    _collection: Collection | URL | null,
    _options?: TraverseCollectionOptions,
  ): AsyncIterable<TItem> {
    // just returning empty async iterable
    return {
      async *[Symbol.asyncIterator]() {
        // yield nothing
      },
    };
  }

  lookupNodeInfo(
    url: URL | string,
    options?: { parse?: "strict" | "best-effort" } & any,
  ): Promise<NodeInfo | undefined>;
  lookupNodeInfo(
    url: URL | string,
    options?: { parse: "none" } & any,
  ): Promise<JsonValue | undefined>;
  lookupNodeInfo(
    _url: URL | string,
    _options?: any,
  ): Promise<NodeInfo | JsonValue | undefined> {
    return Promise.resolve(undefined);
  }

  lookupWebFinger(
    _resource: URL | `acct:${string}@${string}` | string,
    _options?: any,
  ): Promise<ResourceDescriptor | null> {
    return Promise.resolve(null);
  }

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
  sendActivity(
    sender: { identifier: string } | { username: string } | { handle: string },
    recipients: "followers",
    activity: Activity,
    options?: SendActivityOptionsForCollection,
  ): Promise<void>;
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
  sendActivity(
    sender: { identifier: string } | { username: string } | { handle: string },
    recipients: "followers",
    activity: Activity,
    options?: SendActivityOptionsForCollection,
  ): Promise<void>;
  sendActivity(
    sender:
      | SenderKeyPair
      | SenderKeyPair[]
      | { identifier: string }
      | { username: string }
      | { handle: string },
    recipients: Recipient | Recipient[] | "followers",
    activity: Activity,
    _options?: SendActivityOptions | SendActivityOptionsForCollection,
  ): Promise<void> {
    this.sentActivities.push({ sender, recipients, activity });

    // If this is a MockFederation, also record it there
    if (this.federation instanceof MockFederation) {
      const queued = this.federation.queueStarted;
      this.federation.sentActivities.push({
        queued,
        queue: queued ? "outbox" : undefined,
        activity,
        sentOrder: ++this.federation.sentCounter,
      });
    }

    return Promise.resolve();
  }

  routeActivity(
    _recipient: string | null,
    _activity: Activity,
    _options?: RouteActivityOptions,
  ): Promise<boolean> {
    return Promise.resolve(true);
  }

  /**
   * Gets all activities that have been sent through this mock context.
   * This method is specific to the mock implementation and is used for
   * testing purposes.
   *
   * @returns An array of sent activity records.
   */
  getSentActivities(): Array<{
    sender:
      | SenderKeyPair
      | SenderKeyPair[]
      | { identifier: string }
      | { username: string }
      | { handle: string };
    recipients: Recipient | Recipient[] | "followers";
    activity: Activity;
  }> {
    return [...this.sentActivities];
  }

  /**
   * Clears all sent activities from the mock context.
   * This method is specific to the mock implementation and is used for
   * testing purposes.
   */
  reset(): void {
    this.sentActivities = [];
  }
}
