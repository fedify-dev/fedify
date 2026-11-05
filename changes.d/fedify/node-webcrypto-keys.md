---
links:
  '#1391': https://github.com/fedify-dev/fedify/pull/1391
  '#554': https://github.com/fedify-dev/fedify/issues/554
---
 -  Fixed `CryptoKey` and `CryptoKeyPair` values obtained from `node:crypto`
    being rejected by `ActorKeyPairsDispatcher`, `SharedInboxKeyDispatcher`,
    `SenderKeyPair`, `signRequest()`, `createProof()`, `signObject()`,
    `createSignature()`, `signJsonLd()`, `exportJwk()`, and the authenticated
    document loader APIs when `@types/node` 24.7.0 or later is installed.
    Those APIs now accept a structural key type that both Node.js and
    DOM/Web Worker keys satisfy, while the keys returned by Fedify keep the
    ambient `CryptoKey` types.  [[#554], [#1391]]
