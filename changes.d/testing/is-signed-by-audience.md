---
links:
  '#1153': https://github.com/fedify-dev/fedify/issues/1153
  '#1183': https://github.com/fedify-dev/fedify/pull/1183
  '#288': https://github.com/fedify-dev/fedify/issues/288
---
 -  Added the `isSignedByAudience()` method to the mock contexts that
    `createFederation()` and `createRequestContext()` create, following
    the new `RequestContext.isSignedByAudience()` method of `@fedify/fedify`.
    It checks the audience against the actor that `getSignedKeyOwner()`
    returns.  [[#288], [#1153], [#1183]]
