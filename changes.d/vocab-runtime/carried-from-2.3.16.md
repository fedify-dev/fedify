---
links:
  '#1339': https://github.com/fedify-dev/fedify/issues/1339
  '#1347': https://github.com/fedify-dev/fedify/pull/1347
  '#1391': https://github.com/fedify-dev/fedify/pull/1391
  '#554': https://github.com/fedify-dev/fedify/issues/554
---
 -  Added `normalizeDateTimeLiteral()` to `@fedify/vocab-runtime/temporal` so
    that generated vocabulary code and `@fedify/fedify` interpret `xsd:dateTime`
    literals the same way.  It treats a literal without a UTC offset as UTC and
    handles literals without seconds, including those with a fraction.
    [[#1339], [#1347] by ChanHaeng Lee\]
 -  Added the `CryptoKeyLike` and `CryptoKeyPairLike` types for the structural
    key shape that Fedify APIs accept.  They cover keys from Node.js,
    DOM/Web Workers, and Cloudflare Workers, so `exportSpki()`,
    `exportMultibaseKey()`, and `getAuthenticatedDocumentLoader()` no longer
    reject keys obtained from `node:crypto` with `@types/node` 24.7.0 or later.
    `AuthenticatedDocumentLoaderFactory` keeps the ambient `CryptoKey` type on
    the identity it receives, so existing implementations do not have to
    change.
    [[#554], [#1391]]
