---
links:
  '#1391': https://github.com/fedify-dev/fedify/pull/1391
  '#554': https://github.com/fedify-dev/fedify/issues/554
---
 -  Added the `CryptoKeyLike` and `CryptoKeyPairLike` types for the structural
    key shape that Fedify APIs accept.  They cover keys from Node.js,
    DOM/Web Workers, and Cloudflare Workers, so `exportSpki()`,
    `exportMultibaseKey()`, and `AuthenticatedDocumentLoaderFactory` no longer
    reject keys obtained from `node:crypto` with `@types/node` 24.7.0 or later.
    An implementation of `AuthenticatedDocumentLoaderFactory` that annotates
    the `identity` parameter with the ambient `CryptoKey` type now has to
    annotate it with `CryptoKeyLike` instead.  [[#554], [#1391]]
