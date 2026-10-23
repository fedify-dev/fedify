---
links:
  '#1302': https://github.com/fedify-dev/fedify/issues/1302
  '#1305': https://github.com/fedify-dev/fedify/issues/1305
  '#1306': https://github.com/fedify-dev/fedify/pull/1306
  '#1307': https://github.com/fedify-dev/fedify/pull/1307
---
 -  Fixed `createFederation()` ignoring `allowPrivateAddress: true`.  Received
    activities and federation-created contexts now use document loaders that
    allow local servers, so calls such as `follow.getActor()` can resolve
    localhost actors in inbox listeners.
    [[#1302], [#1306]]
 -  Fixed missing runtime dependencies in the npm package.  `@fedify/vocab`
    and `@js-temporal/polyfill` are now installed automatically so importing
    `@fedify/testing` works even when dependency hoisting is disabled on
    Node.js and Bun.
    [[#1305], [#1307]]
