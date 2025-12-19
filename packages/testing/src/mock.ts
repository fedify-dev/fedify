// deno-lint-ignore-file no-explicit-any
import type {
  ActorKeyPair,
  Context,
  Federation,
  FederationFetchOptions,
  FederationStartQueueOptions,
  Message,
  ParseUriResult,
  RequestContext,
  RouteActivityOptions,
} from "@fedify/fedify/federation";
import type {
  Activity,
  Collection,
  LookupObjectOptions,
  Object,
  TraverseCollectionOptions,
} from "@fedify/vocab";
import type { DocumentLoader } from "@fedify/vocab-runtime";
import {
  createContext,
  createInboxContext,
  createRequestContext,
} from "./context.ts";

// Re-export for public API
export { createContext, createInboxContext, createRequestContext };

// Create a no-op tracer provider.
// We use `any` type instead of importing TracerProvider from @opentelemetry/api
// to avoid type graph analysis issues in JSR.
//
// Root cause: JSR's type analyzer hangs when types from @opentelemetry/api
// (which are indirectly included via Context.tracerProvider) are analyzed
// alongside types from @fedify/fedify/webfinger in the same module.
//
// The specific trigger is when both of these are present:
// 1. Types from @fedify/fedify/federation that reference TracerProvider
// 2. WebFingerLinksDispatcher type (which references Link from webfinger)
//
// Solution: Avoid importing WebFingerLinksDispatcher and use `any` instead.
//
// See: https://github.com/fedify-dev/fedify/issues/468
const noopTracerProvider: any = {
  getTracer: () => ({
    startActiveSpan: () => undefined as any,
    startSpan: () => undefined as any,
  }),
};

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
interface SentActivity {
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
 * A mock Context interface for testing purposes.
 * Extends the standard Context interface with additional testing utilities.
 * @since 1.9.1
 */
interface TestContext<TContextData>
  extends
    Omit<Context<TContextData>, "clone">,
    Pick<
      RequestContext<TContextData>,
      | "request"
      | "url"
      | "getActor"
      | "getObject"
      | "getSignedKey"
      | "getSignedKeyOwner"
      | "sendActivity"
      | "routeActivity"
    > {
  // Override clone to return TestContext
  clone(data: TContextData): TestContext<TContextData>;

  // Test-specific methods
  getSentActivities(): Array<{
    sender: any;
    recipients: any;
    activity: Activity;
  }>;
  reset(): void;
}

/**
 * A mock Federation interface for testing purposes.
 * Extends the standard Federation interface with additional testing utilities.
 * @since 1.9.1
 */
interface TestFederation<TContextData>
  extends Omit<Federation<TContextData>, "createContext"> {
  // Test-specific properties
  sentActivities: SentActivity[];
  queueStarted: boolean;
  sentCounter: number;

  // Test-specific methods
  receiveActivity(activity: Activity): Promise<void>;
  reset(): void;

  // Override createContext to return TestContext
  createContext(
    baseUrlOrRequest: URL | Request,
    contextData: TContextData,
  ): TestContext<TContextData>;
}

/**
 * A mock implementation of the {@link Federation} interface for unit testing.
 * This class provides a way to test Fedify applications without needing
 * a real federation setup.
 *
 * @example
 * ```typescript
 * import { Create } from "@fedify/vocab";
 * import { createFederation } from "@fedify/testing";
 *
 * // Create a mock federation with contextData
 * const federation = createFederation<{ userId: string }>({
 *   contextData: { userId: "test-user" }
 * });
 *
 * // Set up inbox listeners
 * federation
 *   .setInboxListeners("/users/{identifier}/inbox")
 *   .on(Create, async (ctx: any, activity: any) => {
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
 * @template TContextData The context data to pass to the {@link Context}.
 * @since 1.8.0
 */
class MockFederation<TContextData> implements Federation<TContextData> {
  public sentActivities: SentActivity[] = [];
  public queueStarted = false;
  private activeQueues: Set<"inbox" | "outbox" | "fanout"> = new Set();
  public sentCounter = 0;
  private nodeInfoDispatcher?: any;
  // Note: Using `any` instead of WebFingerLinksDispatcher to avoid JSR hang.
  // WebFingerLinksDispatcher references Link type from @fedify/fedify/webfinger,
  // which causes JSR type analyzer to hang when combined with @opentelemetry/api
  // types present in Context.tracerProvider (issue #468).
  private webFingerDispatcher?: any;
  private actorDispatchers: Map<string, any> = new Map();
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
  private objectDispatchers: Map<string, any> = new Map();
  private inboxDispatcher?: any;
  private outboxDispatcher?: any;
  private followingDispatcher?: any;
  private followersDispatcher?: any;
  private likedDispatcher?: any;
  private featuredDispatcher?: any;
  private featuredTagsDispatcher?: any;
  private inboxListeners: Map<string, any[]> = new Map();
  private contextData?: TContextData;
  private receivedActivities: Activity[] = [];

  constructor(
    private options: {
      contextData?: TContextData;
      origin?: string;
      tracerProvider?: any;
    } = {},
  ) {
    this.contextData = options.contextData;
  }

  setNodeInfoDispatcher(path: string, dispatcher: any): void {
    this.nodeInfoDispatcher = dispatcher;
    this.nodeInfoPath = path;
  }

  // Note: Parameter type is `any` instead of WebFingerLinksDispatcher to avoid
  // JSR type analyzer hang (issue #468). See comment on webFingerDispatcher field.
  setWebFingerLinksDispatcher(
    dispatcher: any,
  ): void {
    this.webFingerDispatcher = dispatcher;
  }

  setActorDispatcher(path: any, dispatcher: any): any {
    this.actorDispatchers.set(path, dispatcher);
    this.actorPath = path;
    return {
      setKeyPairsDispatcher: () => this as any,
      mapHandle: () => this as any,
      mapAlias: () => this as any,
      authorize: () => this as any,
    };
  }

  setObjectDispatcher(cls: any, path: string, dispatcher: any): any {
    this.objectDispatchers.set(path, dispatcher);
    this.objectPaths.set(cls.typeId.href, path);
    return {
      authorize: () => this as any,
    };
  }

  setInboxDispatcher(_path: any, dispatcher: any): any {
    this.inboxDispatcher = dispatcher;
    // Note: inboxPath is set in setInboxListeners
    return {
      setCounter: () => this as any,
      setFirstCursor: () => this as any,
      setLastCursor: () => this as any,
      authorize: () => this as any,
    };
  }

  setOutboxDispatcher(path: any, dispatcher: any): any {
    this.outboxDispatcher = dispatcher;
    this.outboxPath = path;
    return {
      setCounter: () => this as any,
      setFirstCursor: () => this as any,
      setLastCursor: () => this as any,
      authorize: () => this as any,
    };
  }

  setFollowingDispatcher(path: any, dispatcher: any): any {
    this.followingDispatcher = dispatcher;
    this.followingPath = path;
    return {
      setCounter: () => this as any,
      setFirstCursor: () => this as any,
      setLastCursor: () => this as any,
      authorize: () => this as any,
    };
  }

  setFollowersDispatcher(path: any, dispatcher: any): any {
    this.followersDispatcher = dispatcher;
    this.followersPath = path;
    return {
      setCounter: () => this as any,
      setFirstCursor: () => this as any,
      setLastCursor: () => this as any,
      authorize: () => this as any,
    };
  }

  setLikedDispatcher(path: any, dispatcher: any): any {
    this.likedDispatcher = dispatcher;
    this.likedPath = path;
    return {
      setCounter: () => this as any,
      setFirstCursor: () => this as any,
      setLastCursor: () => this as any,
      authorize: () => this as any,
    };
  }

  setFeaturedDispatcher(path: any, dispatcher: any): any {
    this.featuredDispatcher = dispatcher;
    this.featuredPath = path;
    return {
      setCounter: () => this as any,
      setFirstCursor: () => this as any,
      setLastCursor: () => this as any,
      authorize: () => this as any,
    };
  }

  setFeaturedTagsDispatcher(path: any, dispatcher: any): any {
    this.featuredTagsDispatcher = dispatcher;
    this.featuredTagsPath = path;
    return {
      setCounter: () => this as any,
      setFirstCursor: () => this as any,
      setLastCursor: () => this as any,
      authorize: () => this as any,
    };
  }

  setInboxListeners(inboxPath: any, sharedInboxPath?: string): any {
    this.inboxPath = inboxPath;
    this.sharedInboxPath = sharedInboxPath;
    // deno-lint-ignore no-this-alias
    const self = this;
    return {
      on(type: any, listener: any): any {
        const typeName = type.name;
        if (!self.inboxListeners.has(typeName)) {
          self.inboxListeners.set(typeName, []);
        }
        self.inboxListeners.get(typeName)!.push(listener);
        return this;
      },
      onError(): any {
        return this;
      },
      setSharedKeyDispatcher(): any {
        return this;
      },
      withIdempotency(): any {
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

  createContext(
    baseUrlOrRequest: any,
    contextData: TContextData,
  ): any {
    // deno-lint-ignore no-this-alias
    const mockFederation = this;

    const url = baseUrlOrRequest instanceof Request
      ? new URL(baseUrlOrRequest.url)
      : baseUrlOrRequest;

    return new MockContext({
      url,
      data: contextData,
      federation: mockFederation as any,
    });
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

  setCollectionDispatcher<
    TObject extends Object,
    TParams extends Record<string, string>,
  >(
    _name: string | symbol,
    _itemType: any,
    _path: any,
    _dispatcher: any,
  ): any {
    // Mock implementation - just return a mock callback setters object
    return {
      setCounter: () => this as any,
      setFirstCursor: () => this as any,
      setLastCursor: () => this as any,
      authorize: () => this as any,
    };
  }

  setOrderedCollectionDispatcher<
    TObject extends Object,
    TParams extends Record<string, string>,
  >(
    _name: string | symbol,
    _itemType: any,
    _path: any,
    _dispatcher: any,
  ): any {
    // Mock implementation - just return a mock callback setters object
    return {
      setCounter: () => this as any,
      setFirstCursor: () => this as any,
      setLastCursor: () => this as any,
      authorize: () => this as any,
    };
  }
}

/**
 * Creates a mock Federation instance for testing purposes.
 *
 * @template TContextData The type of context data to use
 * @param options Optional configuration for the mock federation
 * @returns A Federation instance that can be used for testing
 * @since 1.9.1
 *
 * @example
 * ```typescript
 * import { Create } from "@fedify/vocab";
 * import { createFederation } from "@fedify/testing";
 *
 * // Create a mock federation with contextData
 * const federation = createFederation<{ userId: string }>({
 *   contextData: { userId: "test-user" }
 * });
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
 *
 * // Check sent activities
 * console.log(federation.sentActivities);
 * ```
 */
export function createFederation<TContextData>(
  options: {
    contextData?: TContextData;
    origin?: string;
    tracerProvider?: any;
  } = {},
): TestFederation<TContextData> {
  return new MockFederation<TContextData>(options);
}

/**
 * A mock implementation of the {@link Context} interface for unit testing.
 * This class provides a way to test Fedify applications without needing
 * a real federation context.
 *
 * Note: This class is not exported from the public API to avoid JSR type
 * analyzer issues. The MockContext class has complex type dependencies that
 * can cause JSR's type analyzer to hang during processing (issue #468).
 * Use {@link MockFederation.createContext}, {@link createContext},
 * {@link createRequestContext}, or {@link createInboxContext} instead.
 *
 * @example
 * ```typescript
 * import { Person, Create } from "@fedify/vocab";
 * import { createFederation } from "@fedify/testing";
 *
 * // Create a mock federation and context
 * const federation = createFederation<{ userId: string }>();
 * const context = federation.createContext(
 *   new URL("https://example.com"),
 *   { userId: "test-user" }
 * );
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
 * // Check sent activities from the federation
 * const sent = federation.sentActivities;
 * console.log(sent[0].activity);
 * ```
 *
 * @template TContextData The context data to pass to the {@link Context}.
 * @since 1.8.0
 */
class MockContext<TContextData> implements Context<TContextData> {
  readonly origin: string;
  readonly canonicalOrigin: string;
  readonly host: string;
  readonly hostname: string;
  readonly data: TContextData;
  readonly federation: Federation<TContextData>;
  readonly documentLoader: DocumentLoader;
  readonly contextLoader: DocumentLoader;
  readonly tracerProvider: any;
  readonly request: Request;
  readonly url: URL;

  private sentActivities: Array<{
    sender: any;
    recipients: any;
    activity: Activity;
  }> = [];

  constructor(
    options: {
      url?: URL;
      data: TContextData;
      federation: Federation<TContextData>;
      documentLoader?: DocumentLoader;
      contextLoader?: DocumentLoader;
      tracerProvider?: any;
    },
  ) {
    const url = options.url ?? new URL("https://example.com");
    this.origin = url.origin;
    this.canonicalOrigin = url.origin;
    this.host = url.host;
    this.hostname = url.hostname;
    this.url = url;
    this.request = new Request(url);
    this.data = options.data;
    this.federation = options.federation;
    // deno-lint-ignore require-await
    this.documentLoader = options.documentLoader ?? (async (url: string) => ({
      contextUrl: null,
      document: {},
      documentUrl: url,
    }));
    this.contextLoader = options.contextLoader ?? this.documentLoader;
    this.tracerProvider = options.tracerProvider ?? noopTracerProvider;
  }

  getActor(_handle: string): Promise<any> {
    return Promise.resolve(null);
  }

  getObject(_cls: any, _values: any): Promise<any> {
    return Promise.resolve(null);
  }

  getSignedKey(): Promise<any> {
    return Promise.resolve(null);
  }

  getSignedKeyOwner(): Promise<any> {
    return Promise.resolve(null);
  }

  clone(data: TContextData): TestContext<TContextData> {
    return new MockContext({
      url: this.url,
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

  getInboxUri(identifier?: any): URL {
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

  getCollectionUri<TParam extends Record<string, string>>(
    _name: string | symbol,
    values: TParam,
  ): URL {
    // Mock implementation - construct a generic collection URI
    const path = globalThis.Object.entries(values)
      .map(([key, value]) => `${key}/${value}`)
      .join("/");
    return new URL(`/collections/${String(_name)}/${path}`, this.origin);
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

  getDocumentLoader(params: any): any {
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
    _url: any,
    _options?: any,
  ): Promise<any> {
    return Promise.resolve(undefined);
  }

  lookupWebFinger(
    _resource: URL | `acct:${string}@${string}` | string,
    _options?: any,
  ): Promise<any> {
    return Promise.resolve(null);
  }

  sendActivity(
    sender: any,
    recipients: any,
    activity: Activity,
    _options?: any,
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
    sender: any;
    recipients: any;
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
