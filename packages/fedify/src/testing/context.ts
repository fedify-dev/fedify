import { mockDocumentLoader } from "@fedify/fixture";
import {
  lookupObject as globalLookupObject,
  traverseCollection as globalTraverseCollection,
} from "@fedify/vocab";
import { lookupWebFinger as globalLookupWebFinger } from "@fedify/webfinger";
import { trace } from "@opentelemetry/api";
import type {
  Context,
  InboxContext,
  RequestContext,
} from "../federation/context.ts";
import type { Federation } from "../federation/federation.ts";
import { RouterError } from "../federation/router.ts";

export function createContext<TContextData>(
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
    getActorKeysByUsage,
    getActorFirstKeyByUsage,
    getDocumentLoader,
    lookupObject,
    traverseCollection,
    lookupNodeInfo,
    lookupWebFinger,
    sendActivity,
    routeActivity,
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
    tracerProvider: tracerProvider ?? trace.getTracerProvider(),
    clone: clone ?? ((data) => createContext({ ...values, data })),
    getNodeInfoUri: getNodeInfoUri ?? throwRouterError,
    getActorUri: getActorUri ?? throwRouterError,
    getObjectUri: getObjectUri ?? throwRouterError,
    getCollectionUri: getCollectionUri ?? throwRouterError,
    getOutboxUri: getOutboxUri ?? throwRouterError,
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
    getActorKeyPairs: getActorKeyPairs ??
      ((_identifier) => Promise.resolve([])),
    getActorKeysByUsage: getActorKeysByUsage ??
      ((_identifier) =>
        Promise.resolve({
          publicKeys: [],
          assertionMethods: [],
        })),
    getActorFirstKeyByUsage: getActorFirstKeyByUsage ??
      ((_identifier) => {
        throw new Error("No actor keys available");
      }),
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
    lookupWebFinger: lookupWebFinger ?? ((resource, options = {}) => {
      return globalLookupWebFinger(resource, options);
    }),
    sendActivity: sendActivity ?? ((_params) => {
      throw new Error("Not implemented");
    }),
    routeActivity: routeActivity ?? ((_params) => {
      throw new Error("Not implemented");
    }),
  };
}

export function createRequestContext<TContextData>(
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

export function createInboxContext<TContextData>(
  args: Partial<InboxContext<TContextData>> & {
    url?: URL;
    data: TContextData;
    recipient?: string | null;
    federation: Federation<TContextData>;
  },
): InboxContext<TContextData> {
  return {
    ...createContext(args),
    clone: args.clone ?? ((data) => createInboxContext({ ...args, data })),
    recipient: args.recipient ?? null,
    forwardActivity: args.forwardActivity ?? ((_params) => {
      throw new Error("Not implemented");
    }),
  };
}
