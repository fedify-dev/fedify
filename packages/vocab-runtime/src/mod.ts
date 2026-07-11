/**
 * This package contains the runtime facilities for working with Activity
 * Vocabulary objects, which are auto-generated from the IDL.
 *
 * @module
 */
export { default as preloadedContexts } from "./contexts.ts";
export {
  type AuthenticatedDocumentLoaderFactory,
  type DocumentLoader,
  type DocumentLoaderFactory,
  type DocumentLoaderFactoryOptions,
  type DocumentLoaderOptions,
  getDocumentLoader,
  type GetDocumentLoaderOptions,
  getRemoteDocument,
  type RemoteDocument,
} from "./docloader.ts";
export {
  type DidKeyVerificationMethod,
  exportDidKey,
  exportMultibaseKey,
  exportSpki,
  importDidKey,
  importMultibaseKey,
  importPem,
  importPkcs1,
  importSpki,
  parseDidKeyVerificationMethod,
} from "./key.ts";
export {
  canParseDecimal,
  type Decimal,
  isDecimal,
  parseDecimal,
} from "./decimal.ts";
export {
  computeDigestMultibase,
  createHashlink,
  type ParsedDigestMultibase,
  type ParsedHashlink,
  parseDigestMultibase,
  parseHashlink,
  verifyDigestMultibase,
  verifyHashlink,
} from "./digest.ts";
export { LanguageString } from "./langstr.ts";
export {
  decodeMultibase,
  encodeMultibase,
  encodingFromBaseData,
} from "./multibase/mod.ts";
export {
  createActivityPubRequest,
  type CreateRequestOptions,
  FetchError,
  getUserAgent,
  type GetUserAgentOptions,
  logRequest,
} from "./request.ts";
export {
  type Json,
  type PropertyPreprocessor,
  type PropertyPreprocessorContext,
} from "./preprocessor.ts";
export {
  arePortableUrisEqual,
  canonicalizePortableUri,
  expandIPv6Address,
  formatIri,
  getFe34Origin,
  haveSameFe34Origin,
  haveSameIriOrigin,
  isGatewayUrl,
  isValidPublicIPv4Address,
  isValidPublicIPv6Address,
  parseGatewayUrl,
  parseIri,
  parseJsonLdId,
  UrlError,
  validatePublicUrl,
} from "./url.ts";
