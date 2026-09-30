// deno-lint-ignore-file no-explicit-any
import type {
  ActorKeyPair,
  Context,
  Federation,
  FederationFetchOptions,
  FederationStartQueueOptions,
  GetObjectOptions,
  Message,
  ParseUriOptions,
  ParseUriResult,
  PortableRequest,
  RequestContext,
  RouteActivityOptions,
} from "@fedify/fedify/federation";
import { hasProofLike, hasSignatureLike } from "@fedify/fedify/sig";
import {
  Activity,
  CryptographicKey,
  lookupObject as globalLookupObject,
  Multikey,
  Tombstone,
} from "@fedify/vocab";
import type {
  Collection,
  LookupObjectOptions,
  Object,
  TraverseCollectionOptions,
} from "@fedify/vocab";
import {
  canonicalizePortableUri,
  decodeMultibase,
  type DocumentLoader,
  formatIri,
  fromCompatibleEf61Id,
  getFe34Origin,
  parseDigestMultibase,
  parseHashlink,
  parseIri,
  type PortableObjectVerifier,
} from "@fedify/vocab-runtime";
import {
  createContext,
  createInboxContext,
  createOutboxContext,
  createRequestContext,
  isSignedByAudience,
} from "./context.ts";

// Re-export for public API
export {
  createContext,
  createInboxContext,
  createOutboxContext,
  createRequestContext,
};

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

const noopMeterProvider: any = {
  getMeter: () => ({
    createCounter: () => ({ add: () => undefined }),
    createGauge: () => ({ record: () => undefined }),
    createHistogram: () => ({ record: () => undefined }),
    createObservableCounter: () => ({
      addCallback: () => undefined,
      removeCallback: () => undefined,
    }),
    createObservableGauge: () => ({
      addCallback: () => undefined,
      removeCallback: () => undefined,
    }),
    createObservableUpDownCounter: () => ({
      addCallback: () => undefined,
      removeCallback: () => undefined,
    }),
    createUpDownCounter: () => ({ add: () => undefined }),
    addBatchObservableCallback: () => undefined,
    removeBatchObservableCallback: () => undefined,
  }),
};

/**
 * Helper function to expand URI templates used by the mock.
 * Supports the RFC 6570 operators accepted by Fedify's identifier paths.
 * @param template The URI template pattern
 * @param values The values to substitute
 * @returns The expanded URI path
 */
function expandUriTemplate(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(/{([+#./;?&]?)([A-Za-z_][A-Za-z0-9_]*)}/g, (
    match,
    operator,
    key,
  ) => {
    const value = values[key];
    if (value == null) return match;
    switch (operator) {
      case "":
        return encodeURIComponent(value);
      case "+":
        return encodeURI(value);
      case "#":
        return `#${encodeURI(value)}`;
      case ".":
        return `.${encodeURIComponent(value)}`;
      case "/":
        return `/${encodeURIComponent(value)}`;
      case ";":
        return `;${key}=${encodeURIComponent(value)}`;
      case "?":
        return `?${key}=${encodeURIComponent(value)}`;
      case "&":
        return `&${key}=${encodeURIComponent(value)}`;
      default:
        return match;
    }
  });
}

/**
 * Builds an FEP-ef61 portable ID from a DID authority and a path, validating
 * the authority the same way as `@fedify/fedify` does.
 */
function buildPortableUri(authority: string, path: string): URL {
  if (
    typeof authority !== "string" ||
    !/^did:[a-z0-9]+:[^/?#]+$/i.test(authority)
  ) {
    throw new TypeError(
      "The authority of a portable ID must be a DID without a path, " +
        "query, or fragment.",
    );
  }
  const did = getFe34Origin(authority);
  if (!isBase58BtcDidKey(did)) {
    throw new TypeError(
      "The did:key authority of a portable ID must be encoded in base58-btc, " +
        "i.e., start with z.",
    );
  }
  return parseIri(`ap+ef61://${did}${path}`);
}

/**
 * Checks that a normalized DID, if it is a `did:key` DID, is encoded in
 * base58-btc, as `@fedify/fedify` requires of portable IDs.
 */
function isBase58BtcDidKey(did: string): boolean {
  return !did.startsWith("did:key:") ||
    /^z[1-9A-HJ-NP-Za-km-z]+$/.test(did.slice("did:key:".length));
}

/**
 * Recognizes an FEP-ef61 portable ID, i.e., an `ap:` or `ap+ef61:` URI, or
 * a compatible identifier on any gateway, validating it the same way as
 * `Context.parseUri()` of `@fedify/fedify` does.
 * @returns The DID and the path of the portable ID, `null` if it is
 *          malformed, or `undefined` if the URI is not a portable ID.
 */
function parseMockPortableId(
  uri: URL,
): { authority: string; path: string } | null | undefined {
  const portable = uri.protocol === "ap:" || uri.protocol === "ap+ef61:";
  if (
    !portable &&
    !((uri.protocol === "http:" || uri.protocol === "https:") &&
      /^\/\.well-known\/apgateway\/did(?::|%3A)/i.test(uri.pathname))
  ) {
    return undefined;
  }
  if (uri.username !== "" || uri.password !== "") return null;
  try {
    // The query of a compatible identifier is ignored, as the gateway
    // endpoint does:
    const id = portable
      ? parseIri(uri)
      : fromCompatibleEf61Id(uri.origin + uri.pathname);
    if (id == null) return null;
    canonicalizePortableUri(formatIri(id));
    const authority = getFe34Origin(id);
    if (!isBase58BtcDidKey(authority)) return null;
    return { authority, path: id.pathname };
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
}

/**
 * Parses a path in the way {@link MockContext.parseUri} does, i.e., only
 * `/users/{identifier}` and its subpaths are recognized, as actors.
 */
function parseMockPath(path: string): ParseUriResult | null {
  if (path.startsWith("/users/")) {
    const parts = path.split("/");
    if (parts.length >= 3) {
      return {
        type: "actor",
        identifier: parts[2],
      };
    }
  }
  return null;
}

function validateOutboxListenerPath(
  path: string,
  dispatcherPath?: string,
): void {
  if (!path.startsWith("/")) {
    throw new TypeError("Path must start with a slash.");
  }
  if (dispatcherPath != null && dispatcherPath !== path) {
    throw new TypeError(
      "Outbox listener path and outbox dispatcher path must match.",
    );
  }
  const operatorMatches = globalThis.Array.from(
    path.matchAll(/{([+#./;?&]?)([A-Za-z_][A-Za-z0-9_]*)}/g),
  );
  if (
    operatorMatches.some((match) =>
      ["?", "&", "#"].includes(match[1]) && match[2] === "identifier"
    )
  ) {
    throw new TypeError(
      "Path for outbox cannot use query or fragment expansion for identifier.",
    );
  }
  const variables = operatorMatches.map((match) => match[2]);
  if (variables.length !== 1 || variables[0] !== "identifier") {
    throw new TypeError(
      "Path for outbox must have exactly one variable named identifier.",
    );
  }
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
  /** The raw forwarded payload, if preserved by the caller. */
  rawActivity?: unknown;
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
      | "portableRequest"
      | "getActor"
      | "getObject"
      | "getSignedKey"
      | "getSignedKeyOwner"
      | "isSignedByAudience"
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
    rawActivity?: unknown;
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
  postOutboxActivity(identifier: string, activity: Activity): Promise<void>;
  reset(): void;

  // Override createContext to return TestContext
  createContext(
    baseUrl: URL,
    contextData: TContextData,
  ): TestContext<TContextData>;
  createContext(
    request: Request,
    contextData: TContextData,
    options?: { portableRequest?: PortableRequest },
  ): TestContext<TContextData>;
  createContext(
    baseUrlOrRequest: URL | Request,
    contextData: TContextData,
    options?: { portableRequest?: PortableRequest },
  ): TestContext<TContextData>;
}

type ActivityConstructor = new (...args: any[]) => Activity;

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
  private activeQueues: Set<"inbox" | "outbox" | "fanout" | "task"> = new Set();
  public sentCounter = 0;
  private nodeInfoDispatcher?: any;
  // Note: Using `any` instead of WebFingerLinksDispatcher to avoid JSR hang.
  // WebFingerLinksDispatcher references Link type from @fedify/fedify/webfinger,
  // which causes JSR type analyzer to hang when combined with @opentelemetry/api
  // types present in Context.tracerProvider (issue #468).
  private webFingerDispatcher?: any;
  public actorDispatchers: Map<string, any> = new Map();
  public actorKeyPairsDispatcher?: any;
  public actorPath?: string;
  public inboxPath?: string;
  public outboxPath?: string;
  public mediaUploaderPath?: string;
  public followingPath?: string;
  public followersPath?: string;
  public likedPath?: string;
  public featuredPath?: string;
  public featuredTagsPath?: string;
  public nodeInfoPath?: string;
  public sharedInboxPath?: string;
  public objectPaths: Map<string, string> = new Map();
  public objectDispatchers: Map<string, any> = new Map();
  public taskDefinitions: Map<string, any> = new Map();
  private inboxDispatcher?: any;
  private outboxDispatcher?: any;
  private outboxAuthorizePredicate?: any;
  private outboxDispatcherAuthorizePredicate?: any;
  private outboxListenerErrorHandler?: any;
  private mediaUploaderCallback?: any;
  private mediaUploaderAuthorizePredicate?: any;
  private hashlinkMediaDispatcher?: any;
  private followingDispatcher?: any;
  private followersDispatcher?: any;
  private likedDispatcher?: any;
  private featuredDispatcher?: any;
  private featuredTagsDispatcher?: any;
  private inboxListeners: Map<string, any[]> = new Map();
  private outboxListeners: Map<ActivityConstructor, any> = new Map();
  private outboxListenersInitialized = false;
  private contextData?: TContextData;
  private receivedActivities: Activity[] = [];

  constructor(
    private options: {
      contextData?: TContextData;
      origin?: string;
      meterProvider?: any;
      tracerProvider?: any;
      documentLoader?: DocumentLoader;
      contextLoader?: DocumentLoader;
      verifyPortableObject?: PortableObjectVerifier;
    } = {},
  ) {
    this.contextData = options.contextData;
  }

  setNodeInfoDispatcher(path: string, dispatcher: any): void {
    this.nodeInfoDispatcher = dispatcher;
    this.nodeInfoPath = path;
  }

  // Note: Parameter and return types are `any` like the other mock methods;
  // the structural shape follows TaskRegistry.defineTask().
  defineTask(name: string, options: any): any {
    if (this.taskDefinitions.has(name)) {
      throw new TypeError(`Task ${JSON.stringify(name)} is already defined.`);
    }
    // Keep the returned handle with the definition: enqueue compares the
    // handle by identity, as production does, so a same-named handle from
    // another federation instance is rejected rather than looked up by name.
    const handle = { name, schema: options.schema };
    this.taskDefinitions.set(name, { name, ...options, handle });
    return handle;
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
    const setters: any = {
      setKeyPairsDispatcher: (keyPairsDispatcher: any) => {
        this.actorKeyPairsDispatcher = keyPairsDispatcher;
        return setters;
      },
      mapHandle: () => setters,
      mapAlias: () => setters,
      mapPortableActorId: () => setters,
      authorize: () => setters,
    };
    return setters;
  }

  setObjectDispatcher(cls: any, path: string, dispatcher: any): any {
    this.objectDispatchers.set(path, dispatcher);
    this.objectPaths.set(cls.typeId.href, path);
    const setters = {
      authorize: () => setters,
    };
    return setters;
  }

  setInboxDispatcher(_path: any, dispatcher: any): any {
    this.inboxDispatcher = dispatcher;
    // Note: inboxPath is set in setInboxListeners
    const setters = {
      setCounter: () => setters,
      setFirstCursor: () => setters,
      setLastCursor: () => setters,
      authorize: () => setters,
    };
    return setters;
  }

  setOutboxDispatcher(path: any, dispatcher: any): any {
    validateOutboxListenerPath(
      path,
      this.outboxListenersInitialized ? this.outboxPath : undefined,
    );
    this.outboxDispatcher = dispatcher;
    this.outboxPath = path;
    const setters = {
      setCounter: () => setters,
      setFirstCursor: () => setters,
      setLastCursor: () => setters,
      authorize: (predicate: any) => {
        this.outboxDispatcherAuthorizePredicate = predicate;
        return setters;
      },
    };
    return setters;
  }

  setFollowingDispatcher(path: any, dispatcher: any): any {
    this.followingDispatcher = dispatcher;
    this.followingPath = path;
    const setters = {
      setCounter: () => setters,
      setFirstCursor: () => setters,
      setLastCursor: () => setters,
      authorize: () => setters,
    };
    return setters;
  }

  setFollowersDispatcher(path: any, dispatcher: any): any {
    this.followersDispatcher = dispatcher;
    this.followersPath = path;
    const setters = {
      setCounter: () => setters,
      setFirstCursor: () => setters,
      setLastCursor: () => setters,
      authorize: () => setters,
    };
    return setters;
  }

  setLikedDispatcher(path: any, dispatcher: any): any {
    this.likedDispatcher = dispatcher;
    this.likedPath = path;
    const setters = {
      setCounter: () => setters,
      setFirstCursor: () => setters,
      setLastCursor: () => setters,
      authorize: () => setters,
    };
    return setters;
  }

  setFeaturedDispatcher(path: any, dispatcher: any): any {
    this.featuredDispatcher = dispatcher;
    this.featuredPath = path;
    const setters = {
      setCounter: () => setters,
      setFirstCursor: () => setters,
      setLastCursor: () => setters,
      authorize: () => setters,
    };
    return setters;
  }

  setFeaturedTagsDispatcher(path: any, dispatcher: any): any {
    this.featuredTagsDispatcher = dispatcher;
    this.featuredTagsPath = path;
    const setters = {
      setCounter: () => setters,
      setFirstCursor: () => setters,
      setLastCursor: () => setters,
      authorize: () => setters,
    };
    return setters;
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
      onUnverifiedActivity(): any {
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

  setOutboxListeners(outboxPath: any): any {
    if (this.outboxListenersInitialized) {
      throw new TypeError("Outbox listeners already set.");
    }
    validateOutboxListenerPath(outboxPath, this.outboxPath);
    this.outboxListenersInitialized = true;
    this.outboxPath = outboxPath;
    // deno-lint-ignore no-this-alias
    const self = this;
    return {
      on(type: any, listener: any): any {
        if (self.outboxListeners.has(type)) {
          throw new TypeError("Listener already set for this type.");
        }
        self.outboxListeners.set(type, listener);
        return this;
      },
      onError(handler: any): any {
        self.outboxListenerErrorHandler = handler;
        return this;
      },
      authorize(predicate: any): any {
        self.outboxAuthorizePredicate = predicate;
        return this;
      },
    };
  }

  setMediaUploader(path: any, callback: any): any {
    if (this.mediaUploaderCallback != null) {
      throw new TypeError("Media uploader already set.");
    }
    this.mediaUploaderPath = path;
    this.mediaUploaderCallback = callback;
    // deno-lint-ignore no-this-alias
    const self = this;
    return {
      authorize(predicate: any): any {
        self.mediaUploaderAuthorizePredicate = predicate;
        return this;
      },
    };
  }

  setHashlinkMediaDispatcher(dispatcher: any): void {
    if (this.hashlinkMediaDispatcher != null) {
      throw new TypeError("Hashlink media dispatcher already set.");
    }
    this.hashlinkMediaDispatcher = dispatcher;
  }

  setOutboxPermanentFailureHandler(_handler: any): void {
    // Mock implementation - no-op
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
      // If no specific queue, activate all four
      this.activeQueues.add("inbox");
      this.activeQueues.add("outbox");
      this.activeQueues.add("fanout");
      this.activeQueues.add("task");
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
    baseUrl: URL,
    contextData: TContextData,
  ): TestContext<TContextData>;
  createContext(
    request: Request,
    contextData: TContextData,
    options?: { portableRequest?: PortableRequest },
  ): TestContext<TContextData>;
  createContext(
    baseUrlOrRequest: URL | Request,
    contextData: TContextData,
    options?: { portableRequest?: PortableRequest },
  ): TestContext<TContextData>;
  createContext(
    baseUrlOrRequest: URL | Request,
    contextData: TContextData,
    options: { portableRequest?: PortableRequest } = {},
  ): TestContext<TContextData> {
    // deno-lint-ignore no-this-alias
    const mockFederation = this;

    const request = baseUrlOrRequest instanceof Request
      ? baseUrlOrRequest
      : null;
    const url = request == null
      ? baseUrlOrRequest as URL
      : new URL(request.url);

    return new MockContext({
      url,
      request,
      data: contextData,
      federation: mockFederation as any,
      meterProvider: this.options.meterProvider,
      tracerProvider: this.options.tracerProvider,
      documentLoader: this.options.documentLoader,
      contextLoader: this.options.contextLoader,
      verifyPortableObject: this.options.verifyPortableObject,
      portableRequest: options.portableRequest,
    });
  }

  async fetch(
    request: Request,
    options: FederationFetchOptions<TContextData>,
  ): Promise<Response> {
    if (this.hashlinkMediaDispatcher != null) {
      const url = new URL(request.url);
      const prefix = "/.well-known/apgateway/";
      if (
        (url.protocol === "http:" || url.protocol === "https:") &&
        url.pathname.startsWith(prefix)
      ) {
        const encoded = url.pathname.slice(prefix.length);
        if (/^hl(?::|%3A)/i.test(encoded)) {
          if (request.method !== "GET" && request.method !== "HEAD") {
            return new Response("Method not allowed.", {
              status: 405,
              headers: {
                Allow: "GET, HEAD",
                "Content-Type": "text/plain; charset=utf-8",
              },
            });
          }
          let media;
          try {
            let hashlink: string;
            try {
              hashlink = decodeURIComponent(encoded);
            } catch (error) {
              throw new TypeError("Invalid percent-encoding in the hashlink.", {
                cause: error,
              });
            }
            const { digestMultibase } = parseHashlink(hashlink);
            const { digest } = parseDigestMultibase(digestMultibase);
            media = globalThis.Object.freeze({
              hashlink: `hl:${digestMultibase}`,
              digestMultibase,
              algorithm: "sha2-256",
              digest,
              multihash: decodeMultibase(digestMultibase),
            });
          } catch (error) {
            if (!(error instanceof TypeError)) throw error;
            return new Response(
              request.method === "HEAD" ? null : "Malformed hashlink.",
              {
                status: 400,
                headers: { "Content-Type": "text/plain; charset=utf-8" },
              },
            );
          }
          const context = this.createContext(request, options.contextData);
          const response = await this.hashlinkMediaDispatcher(context, media);
          if (response == null) {
            return options.onNotFound == null
              ? new Response("Not Found", { status: 404 })
              : await options.onNotFound(request);
          }
          if (request.method !== "HEAD" || response.body == null) {
            return response;
          }
          response.body.cancel().catch(() => {});
          return new Response(null, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        }
      }
    }
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
   * Simulates posting an activity to a local actor outbox.
   * This method is specific to the mock implementation and is used for
   * testing purposes.
   *
   * @param identifier The identifier of the outbox owner.
   * @param activity The activity to post.
   * @returns A promise that resolves when the activity has been processed.
   * @since 2.2.0
   */
  async postOutboxActivity(
    identifier: string,
    activity: Activity,
  ): Promise<void> {
    if (!this.outboxListenersInitialized) {
      throw new Error(
        "MockFederation.postOutboxActivity(): setOutboxListeners() is not initialized.",
      );
    }

    let ctor = activity.constructor as ActivityConstructor;
    let listener = this.outboxListeners.get(ctor);
    while (listener == null && ctor !== Activity) {
      ctor = globalThis.Object.getPrototypeOf(ctor);
      listener = this.outboxListeners.get(ctor);
    }

    if (listener != null && this.contextData === undefined) {
      throw new Error(
        "MockFederation.postOutboxActivity(): contextData is not initialized. " +
          "Please provide contextData through the constructor or call startQueue() before posting activities.",
      );
    }

    const origin = new URL(this.options.origin ?? "https://example.com");
    const routingContext = this.createContext(
      origin,
      this.contextData as TContextData,
    );
    const postedJson = await activity.toJsonLd({
      contextLoader: routingContext.contextLoader,
    });
    const request = new Request(routingContext.getOutboxUri(identifier), {
      method: "POST",
      body: JSON.stringify(postedJson),
      headers: { "content-type": "application/activity+json" },
    });
    const baseContext = this.createContext(
      request,
      this.contextData as TContextData,
    );
    const rawActivity = postedJson;
    const deliveryState = { delivered: false };
    const createMockOutboxContext = () =>
      createOutboxContext({
        ...baseContext,
        clone: undefined,
        federation: this as any,
        identifier,
        hasDeliveredActivity: () => deliveryState.delivered,
        sendActivity: async (
          sender: any,
          recipients: any,
          outboundActivity: Activity,
          options?: any,
        ) => {
          await baseContext.sendActivity(
            sender,
            recipients,
            outboundActivity,
            options,
          );
          deliveryState.delivered = true;
        },
        forwardActivity: async (
          forwarder: any,
          recipients: any,
          options?: any,
        ) => {
          const hasProof = hasProofLike(rawActivity);
          const hasLds = hasSignatureLike(rawActivity);
          if (options?.skipIfUnsigned && !hasProof && !hasLds) {
            return;
          }
          await baseContext.sendActivity(
            forwarder,
            recipients,
            activity,
            { ...options, rawActivity },
          );
          deliveryState.delivered = true;
        },
      });

    const actor = await baseContext.getActor(identifier);
    if (actor == null) {
      throw new Error(`Actor ${JSON.stringify(identifier)} not found.`);
    }
    const authorizePredicate = this.outboxAuthorizePredicate ??
      this.outboxDispatcherAuthorizePredicate;
    if (
      authorizePredicate != null &&
      !await authorizePredicate(baseContext, identifier)
    ) {
      throw new Error("Unauthorized.");
    }

    const expectedActorId = actor.id ?? baseContext.getActorUri(identifier);
    if (activity.actorIds.length < 1) {
      const error = new Error("The posted activity has no actor.");
      await this.outboxListenerErrorHandler?.(createMockOutboxContext(), error);
      throw error;
    }
    if (
      !activity.actorIds.every((actorId) =>
        actorId.href === expectedActorId.href
      )
    ) {
      const error = new Error(
        "The activity actor does not match the outbox owner.",
      );
      await this.outboxListenerErrorHandler?.(createMockOutboxContext(), error);
      throw error;
    }

    if (listener == null) return;

    const context = createMockOutboxContext();
    try {
      await listener(context, activity);
    } catch (error) {
      await this.outboxListenerErrorHandler?.(context, error);
      throw error;
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
    const setters = {
      setCounter: () => setters,
      setFirstCursor: () => setters,
      setLastCursor: () => setters,
      authorize: () => setters,
      mapPortableOwner: () => setters,
    };
    return setters;
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
    const setters = {
      setCounter: () => setters,
      setFirstCursor: () => setters,
      setLastCursor: () => setters,
      authorize: () => setters,
      mapPortableOwner: () => setters,
    };
    return setters;
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
    /**
     * The OpenTelemetry meter provider to expose from mock contexts.
     * @since 2.3.0
     */
    meterProvider?: any;
    tracerProvider?: any;
    /** The document loader used by mock context lookups. @since 2.4.0 */
    documentLoader?: DocumentLoader;
    /** The JSON-LD context loader used by mock context lookups. @since 2.4.0 */
    contextLoader?: DocumentLoader;
    /**
     * The portable object verifier used by mock context lookups when a
     * document loader is provided.  Mock collection traversal remains empty.
     * @since 2.4.0
     */
    verifyPortableObject?: PortableObjectVerifier;
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
  readonly meterProvider: any;
  readonly tracerProvider: any;
  readonly request: Request;
  readonly url: URL;
  readonly portableRequest?: PortableRequest;
  readonly verifyPortableObject?: PortableObjectVerifier;
  private readonly hasDocumentLoader: boolean;
  private readonly hasContextLoader: boolean;

  private sentActivities: Array<{
    sender: any;
    recipients: any;
    activity: Activity;
    rawActivity?: unknown;
  }> = [];

  constructor(
    options: {
      url?: URL;
      request?: Request | null;
      data: TContextData;
      federation: Federation<TContextData>;
      documentLoader?: DocumentLoader;
      contextLoader?: DocumentLoader;
      verifyPortableObject?: PortableObjectVerifier;
      portableRequest?: PortableRequest;
      hasDocumentLoader?: boolean;
      hasContextLoader?: boolean;
      meterProvider?: any;
      tracerProvider?: any;
    },
  ) {
    const url = options.url ?? new URL("https://example.com");
    this.origin = url.origin;
    this.canonicalOrigin = url.origin;
    this.host = url.host;
    this.hostname = url.hostname;
    this.url = url;
    this.request = options.request ?? new Request(url);
    this.portableRequest = options.portableRequest;
    this.verifyPortableObject = options.verifyPortableObject;
    this.hasDocumentLoader = options.hasDocumentLoader ??
      options.documentLoader != null;
    this.hasContextLoader = options.hasContextLoader ??
      options.contextLoader != null;
    this.data = options.data;
    this.federation = options.federation;
    // deno-lint-ignore require-await
    this.documentLoader = options.documentLoader ?? (async (url: string) => ({
      contextUrl: null,
      document: {},
      documentUrl: url,
    }));
    this.contextLoader = options.contextLoader ?? this.documentLoader;
    this.meterProvider = options.meterProvider ?? noopMeterProvider;
    this.tracerProvider = options.tracerProvider ?? noopTracerProvider;
  }

  async getActor(handle: string): Promise<any> {
    if (
      this.federation instanceof MockFederation && this.federation.actorPath
    ) {
      const dispatcher = this.federation.actorDispatchers.get(
        this.federation.actorPath,
      );
      if (dispatcher) {
        return await dispatcher(this, handle);
      }
    }
    return null;
  }

  getObject<TObject extends Object>(
    cls: (new (...args: any[]) => TObject) & { typeId: URL },
    values: Record<string, string>,
  ): Promise<TObject | null>;
  getObject<TObject extends Object>(
    cls: (new (...args: any[]) => TObject) & { typeId: URL },
    values: Record<string, string>,
    options: GetObjectOptions & { readonly tombstone: "passthrough" },
  ): Promise<TObject | Tombstone | null>;
  getObject<TObject extends Object>(
    cls: (new (...args: any[]) => TObject) & { typeId: URL },
    values: Record<string, string>,
    options: GetObjectOptions & { readonly tombstone?: "suppress" | undefined },
  ): Promise<TObject | null>;
  getObject<TObject extends Object>(
    cls: (new (...args: any[]) => TObject) & { typeId: URL },
    values: Record<string, string>,
    options: GetObjectOptions,
  ): Promise<TObject | Tombstone | null>;
  async getObject<TObject extends Object>(
    cls: (new (...args: any[]) => TObject) & { typeId: URL },
    values: Record<string, string>,
    options?: GetObjectOptions,
  ): Promise<TObject | Tombstone | null> {
    if (this.federation instanceof MockFederation) {
      const path = this.federation.objectPaths.get(cls.typeId.href);
      if (path) {
        const dispatcher = this.federation.objectDispatchers.get(path);
        if (dispatcher) {
          const object = await dispatcher(this, values);
          // Same as RequestContext.getObject(), a tombstone that is not
          // an instance of the requested class is suppressed by default:
          if (
            object instanceof Tombstone && !(object instanceof cls) &&
            options?.tombstone !== "passthrough"
          ) {
            return null;
          }
          return object;
        }
      }
    }
    return null;
  }

  getSignedKey(): Promise<any> {
    return Promise.resolve(null);
  }

  getSignedKeyOwner(): Promise<any> {
    return Promise.resolve(null);
  }

  isSignedByAudience(object: any, options?: any): Promise<boolean> {
    return isSignedByAudience(
      () => this.getSignedKeyOwner(),
      object,
      options?.isMember,
    );
  }

  #resolveTaskDefinition(task: any): any {
    if (!(this.federation instanceof MockFederation)) {
      throw new TypeError("No task definitions are available.");
    }
    const def = this.federation.taskDefinitions.get(task.name);
    if (def == null || def.handle !== task) {
      throw new TypeError(
        `Task ${
          JSON.stringify(task.name)
        } is not defined on this federation; ` +
          "pass a handle returned by its defineTask().",
      );
    }
    return def;
  }

  // Mirror production: validate against the schema and hand the *validated*
  // output to the handler.  Without this, the mock would accept payloads
  // that production rejects at enqueue, and a normalizing schema's output
  // (defaults, coercions) would differ between tests and production.
  async #validateTaskPayload(def: any, data: any): Promise<any> {
    const result = await def.schema["~standard"].validate(data);
    if (result.issues != null && result.issues.length > 0) {
      throw new TypeError(
        `Task data failed schema validation: ${JSON.stringify(result.issues)}`,
      );
    }
    return result.value;
  }

  // No queue in mock type: the task handler is invoked immediately,
  // mirroring how processQueuedTask() processes immediately.
  async enqueueTask(task: any, data: any, _options?: any): Promise<void> {
    const def = this.#resolveTaskDefinition(task);
    await def.handler(this, await this.#validateTaskPayload(def, data));
  }

  async enqueueTaskMany(
    task: any,
    payloads: readonly any[],
    _options?: any,
  ): Promise<void> {
    const def = this.#resolveTaskDefinition(task);
    // Mirror production: the whole batch validates before anything runs, so
    // a failing payload rejects the batch with no partial processing.
    const values = await Promise.all(
      payloads.map((data) => this.#validateTaskPayload(def, data)),
    );
    for (const value of values) await def.handler(this, value);
  }

  clone(data: TContextData): TestContext<TContextData> {
    return new MockContext({
      url: this.url,
      request: this.request,
      data,
      federation: this.federation,
      documentLoader: this.documentLoader,
      contextLoader: this.contextLoader,
      verifyPortableObject: this.verifyPortableObject,
      portableRequest: this.portableRequest,
      hasDocumentLoader: this.hasDocumentLoader,
      hasContextLoader: this.hasContextLoader,
      meterProvider: this.meterProvider,
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

  getPortableActorUri(identifier: string, authority: string): URL {
    const { pathname } = this.getActorUri(identifier);
    return buildPortableUri(authority, pathname);
  }

  getPortableObjectUri<TObject extends Object>(
    cls: (new (...args: any[]) => TObject) & { typeId: URL },
    values: Record<string, string>,
    authority: string,
  ): URL {
    const { pathname } = this.getObjectUri(cls, values);
    return buildPortableUri(authority, pathname);
  }

  getPortableInboxUri(identifier: string, authority: string): URL {
    const { pathname } = this.getInboxUri(identifier);
    return buildPortableUri(authority, pathname);
  }

  getPortableOutboxUri(identifier: string, authority: string): URL {
    const { pathname } = this.getOutboxUri(identifier);
    return buildPortableUri(authority, pathname);
  }

  getPortableFollowingUri(identifier: string, authority: string): URL {
    const { pathname } = this.getFollowingUri(identifier);
    return buildPortableUri(authority, pathname);
  }

  getPortableFollowersUri(identifier: string, authority: string): URL {
    const { pathname } = this.getFollowersUri(identifier);
    return buildPortableUri(authority, pathname);
  }

  getPortableLikedUri(identifier: string, authority: string): URL {
    const { pathname } = this.getLikedUri(identifier);
    return buildPortableUri(authority, pathname);
  }

  getPortableFeaturedUri(identifier: string, authority: string): URL {
    const { pathname } = this.getFeaturedUri(identifier);
    return buildPortableUri(authority, pathname);
  }

  getPortableFeaturedTagsUri(identifier: string, authority: string): URL {
    const { pathname } = this.getFeaturedTagsUri(identifier);
    return buildPortableUri(authority, pathname);
  }

  getPortableCollectionUri<TParam extends Record<string, string>>(
    name: string | symbol,
    values: TParam,
    authority: string,
  ): URL {
    const { pathname } = this.getCollectionUri(name, values);
    return buildPortableUri(authority, pathname);
  }

  getOutboxUri(identifier: string): URL {
    if (
      this.federation instanceof MockFederation && this.federation.outboxPath
    ) {
      const path = expandUriTemplate(this.federation.outboxPath, {
        identifier,
      });
      return new URL(path, this.origin);
    }
    return new URL(`/users/${identifier}/outbox`, this.origin);
  }

  getMediaUploaderUri(identifier: string): URL {
    if (
      this.federation instanceof MockFederation &&
      this.federation.mediaUploaderPath
    ) {
      const path = expandUriTemplate(this.federation.mediaUploaderPath, {
        identifier,
      });
      return new URL(path, this.origin);
    }
    return new URL(`/users/${identifier}/media`, this.origin);
  }

  getInboxUri(identifier?: any): URL {
    if (identifier) {
      if (
        this.federation instanceof MockFederation && this.federation.inboxPath
      ) {
        const path = expandUriTemplate(this.federation.inboxPath, {
          identifier,
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

  parseUri(
    uri: URL | null,
    options: ParseUriOptions = {},
  ): ParseUriResult | null {
    if (uri == null) return null;
    const portable = parseMockPortableId(uri);
    if (portable === undefined) return parseMockPath(uri.pathname);
    if (portable === null || !options.portable) return null;
    const result = parseMockPath(portable.path);
    return result == null
      ? null
      : { ...result, authority: portable.authority } as ParseUriResult;
  }

  async getActorKeyPairs(identifier: string): Promise<ActorKeyPair[]> {
    if (
      this.federation instanceof MockFederation &&
      this.federation.actorKeyPairsDispatcher
    ) {
      const keyPairs = await this.federation.actorKeyPairsDispatcher(
        this,
        identifier,
      );
      // Wrap with CryptographicKey and Multikey objects like real implementation
      const owner = this.getActorUri(identifier);
      return keyPairs.map((kp: any) => ({
        ...kp,
        cryptographicKey: new CryptographicKey({
          id: kp.keyId,
          owner,
          publicKey: kp.publicKey,
        }),
        multikey: new Multikey({
          id: kp.keyId,
          controller: owner,
          publicKey: kp.publicKey,
        }),
      }));
    }
    return [];
  }

  getDocumentLoader(params: any): any {
    // return the same document loader
    if ("keyId" in params) {
      return this.documentLoader;
    }
    return Promise.resolve(this.documentLoader);
  }

  lookupObject(
    uri: URL | string,
    options: LookupObjectOptions = {},
  ): Promise<Object | null> {
    if (
      (!this.hasDocumentLoader && options.documentLoader == null) ||
      (options.verifyPortableObject ?? this.verifyPortableObject) == null
    ) {
      return Promise.resolve(null);
    }
    // The mock only supports portable lookups.  The global helper falls back
    // to live WebFinger for ordinary URLs and handles when a fixture misses.
    const value = typeof uri === "string" ? uri : formatIri(uri);
    if (!/^ap(?:\+ef61)?:\/\//i.test(value)) {
      try {
        if (fromCompatibleEf61Id(value) == null) {
          return Promise.resolve(null);
        }
      } catch (error) {
        if (error instanceof TypeError) return Promise.resolve(null);
        throw error;
      }
    }
    return globalLookupObject(uri, {
      ...options,
      documentLoader: options.documentLoader ?? this.documentLoader,
      contextLoader: options.contextLoader ??
        (this.hasContextLoader
          ? this.contextLoader
          : options.documentLoader ?? this.contextLoader),
      verifyPortableObject: options.verifyPortableObject ??
        this.verifyPortableObject,
    });
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
    options?: any,
  ): Promise<void> {
    this.sentActivities.push({
      sender,
      recipients,
      activity,
      rawActivity: options?.rawActivity,
    });

    // If this is a MockFederation, also record it there
    if (this.federation instanceof MockFederation) {
      const queued = this.federation.queueStarted;
      this.federation.sentActivities.push({
        queued,
        queue: queued ? "outbox" : undefined,
        activity,
        rawActivity: options?.rawActivity,
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
    rawActivity?: unknown;
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
