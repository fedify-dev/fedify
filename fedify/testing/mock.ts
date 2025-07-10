import type { TracerProvider } from "@opentelemetry/api";
import type { Activity, Hashtag, Object } from "../vocab/vocab.ts";
import type { Actor, Recipient } from "../vocab/actor.ts";
import type {
  ActorCallbackSetters,
  CollectionCallbackSetters,
  Federation,
  FederationFetchOptions,
  FederationStartQueueOptions,
  InboxListenerSetters,
  ObjectCallbackSetters,
} from "../federation/federation.ts";
import type {
  ActorDispatcher,
  CollectionDispatcher,
  NodeInfoDispatcher,
  ObjectDispatcher,
} from "../federation/callback.ts";
import type {
  Context,
  InboxContext,
  RequestContext,
} from "../federation/context.ts";
import type { Message } from "../federation/queue.ts";
import {
  createContext,
  createInboxContext,
  createRequestContext,
} from "./context.ts";

/**
 * A mock implementation of the {@link Federation} interface for unit testing.
 * This class provides a way to test Fedify applications without needing
 * a real federation setup.
 *
 * @typeParam TContextData The context data to pass to the {@link Context}.
 * @since 1.8.0
 */
export class MockFederation<TContextData> implements Federation<TContextData> {
  private sentActivities: Activity[] = [];
  private nodeInfoDispatcher?: NodeInfoDispatcher<TContextData>;
  private actorDispatchers: Map<string, ActorDispatcher<TContextData>> =
    new Map();
  private objectDispatchers: Map<
    string,
    ObjectDispatcher<TContextData, any, any>
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
  private inboxListeners: Map<string, InboxListener<TContextData, any>[]> =
    new Map();
  private contextData?: TContextData;
  private receivedActivities: Activity[] = [];

  constructor(
    private options: {
      contextData?: TContextData;
      origin?: string;
      tracerProvider?: TracerProvider;
    } = {},
  ) {}

  setNodeInfoDispatcher(
    path: string,
    dispatcher: NodeInfoDispatcher<TContextData>,
  ): void {
    this.nodeInfoDispatcher = dispatcher;
  }

  setActorDispatcher(
    path: `${string}{identifier}${string}` | `${string}{handle}${string}`,
    dispatcher: ActorDispatcher<TContextData>,
  ): ActorCallbackSetters<TContextData> {
    this.actorDispatchers.set(path, dispatcher);
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
    return {
      authorize: () => this as any,
    };
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
    this.inboxDispatcher = dispatcher;
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
        self.inboxListeners.get(typeName)!.push(listener);
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

  async startQueue(
    contextData: TContextData,
    options?: FederationStartQueueOptions,
  ): Promise<void> {
    this.contextData = contextData;
    // Mock implementation - no actual queue to start
  }

  async processQueuedTask(
    contextData: TContextData,
    message: Message,
  ): Promise<void> {
    this.contextData = contextData;
    // Mock implementation - process immediately
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
    const mockFederation = this;

    if (baseUrlOrRequest instanceof Request) {
      return createRequestContext({
        url: new URL(baseUrlOrRequest.url),
        request: baseUrlOrRequest,
        data: contextData,
        federation: mockFederation as any,
        sendActivity: async (_sender, _recipients, activity) => {
          mockFederation.sentActivities.push(activity);
        },
      });
    } else {
      return createContext({
        url: baseUrlOrRequest,
        data: contextData,
        federation: mockFederation as any,
        sendActivity: async (_sender, _recipients, activity) => {
          mockFederation.sentActivities.push(activity);
        },
      });
    }
  }

  async fetch(
    request: Request,
    options: FederationFetchOptions<TContextData>,
  ): Promise<Response> {
    // Mock implementation - return 404 by default
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
   */
  async receiveActivity(activity: Activity): Promise<void> {
    this.receivedActivities.push(activity);

    // Find and execute appropriate inbox listeners
    const typeName = activity.constructor.name;
    const listeners = this.inboxListeners.get(typeName) || [];

    for (const listener of listeners) {
      const context = createInboxContext({
        data: this.contextData!,
        federation: this as any,
      });
      await listener(context, activity);
    }
  }

  /**
   * Gets all activities that have been sent through this mock federation.
   * This method is specific to the mock implementation and is used for
   * testing purposes.
   *
   * @returns An array of sent activities.
   */
  getSentActivities(): Activity[] {
    return [...this.sentActivities];
  }

  /**
   * Clears all sent activities from the mock federation.
   * This method is specific to the mock implementation and is used for
   * testing purposes.
   */
  clearSentActivities(): void {
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
