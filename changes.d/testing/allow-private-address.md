---
links:
  '#1302': https://github.com/fedify-dev/fedify/issues/1302
  '#1306': https://github.com/fedify-dev/fedify/pull/1306
---
 -  Fixed `createFederation()` ignoring `allowPrivateAddress: true`.  Received
    activities and federation-created contexts now use document loaders that
    allow local servers, so calls such as `follow.getActor()` can resolve
    localhost actors in inbox listeners.  [[#1302], [#1306]]
