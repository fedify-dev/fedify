---
links:
  '#1391': https://github.com/fedify-dev/fedify/pull/1391
  '#554': https://github.com/fedify-dev/fedify/issues/554
---
 -  Fixed `CryptographicKey` and `Multikey` rejecting a `publicKey` obtained
    from `node:crypto` in their constructors and `clone()` when `@types/node`
    24.7.0 or later is installed.  The property accepts a structural key type
    now, while the getters still return the ambient `CryptoKey` type.
    [[#554], [#1391]]
