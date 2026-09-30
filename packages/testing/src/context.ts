// deno-lint-ignore-file no-explicit-any
import type {
  Context,
  Federation,
  InboxContext,
  OutboxContext,
  RequestContext,
} from "@fedify/fedify/federation";
import { RouterError } from "@fedify/fedify/federation";
import {
  type Actor,
  lookupObject as globalLookupObject,
  type Object,
  PUBLIC_COLLECTION,
  traverseCollection as globalTraverseCollection,
} from "@fedify/vocab";
import {
  arePortableUrisEqual,
  formatIri,
  fromCompatibleEf61Id,
} from "@fedify/vocab-runtime";
import { mockDocumentLoader } from "./docloader.ts";

// Create a no-op tracer provider.
// We use `any` type instead of importing TracerProvider from @opentelemetry/api
// to avoid type graph analysis issues in JSR.
//
// Root cause: JSR's type analyzer hangs when types from @opentelemetry/api
// (which are indirectly included via Context.tracerProvider) are analyzed
// alongside types from @fedify/fedify/webfinger in the same module.
//
// The specific trigger is when both of these are present:
// 1. Context/RequestContext/InboxContext types (which include TracerProvider)
// 2. Any import from @fedify/fedify/webfinger (e.g., lookupWebFinger, Link)
//
// Solution: Use inline `any` type for tracer provider instead of importing
// TracerProvider from @opentelemetry/api, and avoid importing anything from
// @fedify/fedify/webfinger.
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

// NOTE: Copied from @fedify/fedify/testing/context.ts

// Not exported - used internally only. Public API is in mock.ts
function createContext<TContextData>(
  values: Partial<Context<TContextData>> & {
    url?: URL;
    data: TContextData;
    federation: Federation<TContextData>;
  },
): Context<TContextData> {
  const {
    federation,
    url = new URL("http://example.com/"),
    canonicalOrigin,
    data,
    documentLoader,
    contextLoader,
    verifyPortableObject,
    meterProvider,
    tracerProvider,
    clone,
    getNodeInfoUri,
    getActorUri,
    getPortableActorUri,
    getObjectUri,
    getPortableObjectUri,
    getPortableInboxUri,
    getPortableOutboxUri,
    getPortableFollowingUri,
    getPortableFollowersUri,
    getPortableLikedUri,
    getPortableFeaturedUri,
    getPortableFeaturedTagsUri,
    getPortableCollectionUri,
    getCollectionUri,
    getOutboxUri,
    getMediaUploaderUri,
    getInboxUri,
    getFollowingUri,
    getFollowersUri,
    getLikedUri,
    getFeaturedUri,
    getFeaturedTagsUri,
    parseUri,
    getActorKeyPairs,
    getDocumentLoader,
    lookupObject,
    traverseCollection,
    lookupNodeInfo,
    lookupWebFinger,
    sendActivity,
    routeActivity,
    enqueueTask,
    enqueueTaskMany,
  } = values;
  function throwRouterError(): URL {
    throw new RouterError("Not implemented");
  }
  return {
    federation,
    data,
    origin: url.origin,
    canonicalOrigin: canonicalOrigin ?? url.origin,
    host: url.host,
    hostname: url.hostname,
    documentLoader: documentLoader ?? mockDocumentLoader,
    contextLoader: contextLoader ?? mockDocumentLoader,
    ...(verifyPortableObject == null ? {} : { verifyPortableObject }),
    meterProvider: meterProvider ?? noopMeterProvider,
    tracerProvider: tracerProvider ?? noopTracerProvider,
    clone: clone ?? ((data) => createContext({ ...values, data })),
    getNodeInfoUri: getNodeInfoUri ?? throwRouterError,
    getActorUri: getActorUri ?? throwRouterError,
    getPortableActorUri: getPortableActorUri ?? throwRouterError,
    getObjectUri: getObjectUri ?? throwRouterError,
    getPortableObjectUri: getPortableObjectUri ?? throwRouterError,
    getPortableInboxUri: getPortableInboxUri ?? throwRouterError,
    getPortableOutboxUri: getPortableOutboxUri ?? throwRouterError,
    getPortableFollowingUri: getPortableFollowingUri ?? throwRouterError,
    getPortableFollowersUri: getPortableFollowersUri ?? throwRouterError,
    getPortableLikedUri: getPortableLikedUri ?? throwRouterError,
    getPortableFeaturedUri: getPortableFeaturedUri ?? throwRouterError,
    getPortableFeaturedTagsUri: getPortableFeaturedTagsUri ?? throwRouterError,
    getPortableCollectionUri: getPortableCollectionUri ?? throwRouterError,
    getCollectionUri: getCollectionUri ?? throwRouterError,
    getOutboxUri: getOutboxUri ?? throwRouterError,
    getMediaUploaderUri: getMediaUploaderUri ?? throwRouterError,
    getInboxUri: getInboxUri ?? throwRouterError,
    getFollowingUri: getFollowingUri ?? throwRouterError,
    getFollowersUri: getFollowersUri ?? throwRouterError,
    getLikedUri: getLikedUri ?? throwRouterError,
    getFeaturedUri: getFeaturedUri ?? throwRouterError,
    getFeaturedTagsUri: getFeaturedTagsUri ?? throwRouterError,
    parseUri: parseUri ?? ((_uri) => {
      throw new Error("Not implemented");
    }),
    getDocumentLoader: getDocumentLoader ?? ((_params) => {
      throw new Error("Not implemented");
    }),
    getActorKeyPairs: getActorKeyPairs ?? ((_handle) => Promise.resolve([])),
    lookupObject: lookupObject ?? ((uri, options = {}) => {
      return globalLookupObject(uri, {
        documentLoader: options.documentLoader ?? documentLoader ??
          mockDocumentLoader,
        contextLoader: options.contextLoader ?? contextLoader ??
          mockDocumentLoader,
        verifyPortableObject: options.verifyPortableObject ??
          verifyPortableObject,
      });
    }),
    traverseCollection: traverseCollection ?? ((collection, options = {}) => {
      return globalTraverseCollection(collection, {
        documentLoader: options.documentLoader ?? documentLoader ??
          mockDocumentLoader,
        contextLoader: options.contextLoader ?? contextLoader ??
          mockDocumentLoader,
        verifyPortableObject: options.verifyPortableObject ??
          verifyPortableObject,
      });
    }),
    lookupNodeInfo: lookupNodeInfo ?? ((_params) => {
      throw new Error("Not implemented");
    }),
    // Note: Cannot use globalLookupWebFinger from @fedify/fedify/webfinger here
    // because importing from webfinger module causes JSR type analyzer to hang
    // when combined with @opentelemetry/api types (issue #468).
    lookupWebFinger: lookupWebFinger ?? ((_resource, _options = {}) => {
      return Promise.resolve(null);
    }),
    sendActivity: sendActivity ?? ((_params) => {
      throw new Error("Not implemented");
    }),
    routeActivity: routeActivity ?? ((_params) => {
      throw new Error("Not implemented");
    }),
    enqueueTask: enqueueTask ?? ((_task, _data, _options) => {
      throw new Error("Not implemented");
    }),
    enqueueTaskMany: enqueueTaskMany ?? ((_task, _payloads, _options) => {
      throw new Error("Not implemented");
    }),
  };
}

/**
 * Creates a RequestContext for testing purposes.
 * Not exported - used internally only. Public API is in mock.ts
 * @param args Partial RequestContext properties
 * @returns A RequestContext instance
 * @since 1.8.0
 */
function createRequestContext<TContextData>(
  args: Partial<RequestContext<TContextData>> & {
    url: URL;
    data: TContextData;
    federation: Federation<TContextData>;
  },
): RequestContext<TContextData> {
  return {
    ...createContext(args),
    clone: args.clone ?? ((data) => createRequestContext({ ...args, data })),
    request: args.request ?? new Request(args.url),
    url: args.url,
    portableRequest: args.portableRequest,
    getActor: args.getActor ?? (() => Promise.resolve(null)),
    getObject: args.getObject ?? (() => Promise.resolve(null)),
    getSignedKey: args.getSignedKey ?? (() => Promise.resolve(null)),
    getSignedKeyOwner: args.getSignedKeyOwner ?? (() => Promise.resolve(null)),
    isSignedByAudience: args.isSignedByAudience ??
      ((object, options) =>
        isSignedByAudience(
          () =>
            args.getSignedKeyOwner == null
              ? Promise.resolve(null)
              : args.getSignedKeyOwner(options ?? {}),
          object,
          options?.isMember,
        )),
    sendActivity: args.sendActivity ?? ((_params) => {
      throw new Error("Not implemented");
    }),
  };
}

const PUBLIC_IDS: ReadonlySet<string> = new Set([
  PUBLIC_COLLECTION.href,
  "as:Public",
  "Public",
]);

function getPortableIri(id: URL): string | null {
  try {
    if (id.protocol === "ap:" || id.protocol === "ap+ef61:") {
      return formatIri(id);
    }
    const portable = fromCompatibleEf61Id(id);
    return portable == null ? null : formatIri(portable);
  } catch (error) {
    // A malformed portable ID or compatible identifier identifies no portable
    // object:
    if (error instanceof TypeError) return null;
    throw error;
  }
}

function isSameActorId(a: URL, b: URL): boolean {
  const portableA = getPortableIri(a);
  const portableB = getPortableIri(b);
  if (portableA != null || portableB != null) {
    return portableA != null && portableB != null &&
      arePortableUrisEqual(portableA, portableB);
  }
  return a.href === b.href;
}

/**
 * The default implementation of `RequestContext.isSignedByAudience()` for
 * testing, which checks the audience against `getSignedKeyOwner()`.
 */
async function isSignedByAudience(
  getSignedKeyOwner: () => Promise<Actor | null>,
  object: Object,
  isMember?: (addressee: URL, actor: Actor) => boolean | Promise<boolean>,
): Promise<boolean> {
  const addressees = [
    ...object.toIds,
    ...object.ccIds,
    ...object.btoIds,
    ...object.bccIds,
    ...object.audienceIds,
  ];
  if (addressees.some((id) => PUBLIC_IDS.has(id.href))) return true;
  const actor = await getSignedKeyOwner();
  const actorId = actor?.id;
  if (actor == null || actorId == null) return false;
  if (addressees.some((id) => isSameActorId(id, actorId))) return true;
  if (isMember == null) return false;
  for (const addressee of addressees) {
    if (await isMember(addressee, actor)) return true;
  }
  return false;
}

/**
 * Test-specific InboxContext type alias.
 * This indirection helps avoid JSR type analyzer issues.
 * @since 1.9.1
 */
type TestInboxContext<TContextData> = InboxContext<TContextData>;

/**
 * Test-specific OutboxContext type alias.
 * This indirection helps avoid JSR type analyzer issues.
 * @since 2.2.0
 */
type TestOutboxContext<TContextData> = OutboxContext<TContextData>;

/**
 * Creates an InboxContext for testing purposes.
 * Not exported - used internally only. Public API is in mock.ts
 * @param args Partial InboxContext properties
 * @returns An InboxContext instance
 * @since 1.8.0
 */
function createInboxContext<TContextData>(
  args: Partial<InboxContext<TContextData>> & {
    url?: URL;
    data: TContextData;
    recipient?: string | null;
    federation: Federation<TContextData>;
  },
): TestInboxContext<TContextData> {
  const forwardActivity = args.forwardActivity ??
    (((_forwarder: unknown, _recipients: unknown, _options?: unknown) => {
      throw new Error("Not implemented");
    }) as TestInboxContext<TContextData>["forwardActivity"]);
  return {
    ...createContext(args),
    clone: args.clone ?? ((data) => createInboxContext({ ...args, data })),
    recipient: args.recipient ?? null,
    forwardActivity,
  };
}

/**
 * Creates an OutboxContext for testing purposes.
 * Not exported - used internally only. Public API is in mock.ts
 * @param args Partial OutboxContext properties
 * @returns An OutboxContext instance
 * @since 2.2.0
 */
function createOutboxContext<TContextData>(
  args: Partial<OutboxContext<TContextData>> & {
    url?: URL;
    data: TContextData;
    identifier: string;
    federation: Federation<TContextData>;
  },
): TestOutboxContext<TContextData> {
  const forwardActivity = args.forwardActivity ??
    (((_forwarder: unknown, _recipients: unknown, _options?: unknown) => {
      throw new Error("Not implemented");
    }) as TestOutboxContext<TContextData>["forwardActivity"]);
  return {
    ...createContext(args),
    clone: args.clone ??
      ((data: TContextData) => createOutboxContext({ ...args, data })),
    identifier: args.identifier,
    hasDeliveredActivity: args.hasDeliveredActivity ?? (() => false),
    forwardActivity,
  };
}

// Export for internal use by mock.ts only
export {
  createContext,
  createInboxContext,
  createOutboxContext,
  createRequestContext,
  isSignedByAudience,
};
