---
links:
  '#1114': https://github.com/fedify-dev/fedify/pull/1114
  '#288': https://github.com/fedify-dev/fedify/issues/288
  '#841': https://github.com/fedify-dev/fedify/issues/841
---
 -  Added the `getPortableActorUri()` method to the mock contexts that
    `createFederation()`, `createContext()`, `createRequestContext()`,
    `createInboxContext()`, and `createOutboxContext()` create, following
    the new `Context.getPortableActorUri()` method of `@fedify/fedify`.
    The mock contexts' portable ID methods now also reject `did:key` DIDs
    that are not encoded in base58-btc.  [[#288], [#841], [#1114]]
