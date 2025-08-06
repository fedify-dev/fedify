/**
 * This module contains the runtime facilities for working with Activity
 * Vocabulary objects, which are auto-generated from the IDL.
 *
 * @module
 */
export * from "./authdocloader.ts";
export {
  type AuthenticatedDocumentLoaderFactory,
  type DocumentLoader,
  type DocumentLoaderFactory,
  type DocumentLoaderFactoryOptions,
  fetchDocumentLoader,
  FetchError,
  getDocumentLoader,
  type GetDocumentLoaderOptions,
  getUserAgent,
  type GetUserAgentOptions,
  kvCache,
  type KvCacheParameters,
  type RemoteDocument,
} from "./docloader.ts";
export * from "./key.ts";
export * from "./langstr.ts";
