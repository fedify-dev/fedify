---
links:
  '#1391': https://github.com/fedify-dev/fedify/pull/1391
  '#554': https://github.com/fedify-dev/fedify/issues/554
---
 -  Added the `CryptoKeyLike` and `CryptoKeyPairLike` types for the structural
    key shape that Fedify APIs accept.  They cover keys from Node.js,
    DOM/Web Workers, and Cloudflare Workers, so `exportSpki()`,
    `exportMultibaseKey()`, and `getAuthenticatedDocumentLoader()` no longer
    reject keys obtained from `node:crypto` with `@types/node` 24.7.0 or later.
    `AuthenticatedDocumentLoaderFactory` keeps the ambient `CryptoKey` type on
    the identity it receives, so existing implementations do not have to
    change.  [[#554], [#1391]]
