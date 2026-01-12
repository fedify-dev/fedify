// deno-lint-ignore-file no-explicit-any
import type {
  Context,
  Federation,
  InboxContext,
  RequestContext,
} from "@fedify/fedify/federation";
import { RouterError } from "@fedify/fedify/federation";
import {
  lookupObject as globalLookupObject,
  traverseCollection as globalTraverseCollection,
} from "@fedify/vocab";
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
    tracerProvider,
    clone,
    getNodeInfoUri,
    getActorUri,
    getObjectUri,
    getCollectionUri,
    getOutboxUri,
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
  } = values;
  function throwRouteError(): URL {
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
    tracerProvider: tracerProvider ?? noopTracerProvider,
    clone: clone ?? ((data) => createContext({ ...values, data })),
    getNodeInfoUri: getNodeInfoUri ?? throwRouteError,
    getActorUri: getActorUri ?? throwRouteError,
    getObjectUri: getObjectUri ?? throwRouteError,
    getCollectionUri: getCollectionUri ?? throwRouteError,
    getOutboxUri: getOutboxUri ?? throwRouteError,
    getInboxUri: getInboxUri ?? throwRouteError,
    getFollowingUri: getFollowingUri ?? throwRouteError,
    getFollowersUri: getFollowersUri ?? throwRouteError,
    getLikedUri: getLikedUri ?? throwRouteError,
    getFeaturedUri: getFeaturedUri ?? throwRouteError,
    getFeaturedTagsUri: getFeaturedTagsUri ?? throwRouteError,
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
      });
    }),
    traverseCollection: traverseCollection ?? ((collection, options = {}) => {
      return globalTraverseCollection(collection, {
        documentLoader: options.documentLoader ?? documentLoader ??
          mockDocumentLoader,
        contextLoader: options.contextLoader ?? contextLoader ??
          mockDocumentLoader,
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
    getActor: args.getActor ?? (() => Promise.resolve(null)),
    getObject: args.getObject ?? (() => Promise.resolve(null)),
    getSignedKey: args.getSignedKey ?? (() => Promise.resolve(null)),
    getSignedKeyOwner: args.getSignedKeyOwner ?? (() => Promise.resolve(null)),
    sendActivity: args.sendActivity ?? ((_params) => {
      throw new Error("Not implemented");
    }),
  };
}

/**
 * Test-specific InboxContext type alias.
 * This indirection helps avoid JSR type analyzer issues.
 * @since 1.9.1
 */
type TestInboxContext<TContextData> = InboxContext<TContextData>;

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
  return {
    ...createContext(args),
    clone: args.clone ?? ((data) => createInboxContext({ ...args, data })),
    recipient: args.recipient ?? null,
    forwardActivity: args.forwardActivity ?? ((_params) => {
      throw new Error("Not implemented");
    }),
  };
}

// Export for internal use by mock.ts only
export { createContext, createInboxContext, createRequestContext };
