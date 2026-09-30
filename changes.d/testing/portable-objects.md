---
links:
  '#1080': https://github.com/fedify-dev/fedify/pull/1080
  '#1092': https://github.com/fedify-dev/fedify/pull/1092
  '#1099': https://github.com/fedify-dev/fedify/pull/1099
  '#1107': https://github.com/fedify-dev/fedify/issues/1107
  '#1111': https://github.com/fedify-dev/fedify/issues/1111
  '#1114': https://github.com/fedify-dev/fedify/pull/1114
  '#1120': https://github.com/fedify-dev/fedify/pull/1120
  '#1142': https://github.com/fedify-dev/fedify/pull/1142
  '#1143': https://github.com/fedify-dev/fedify/issues/1143
  '#1145': https://github.com/fedify-dev/fedify/pull/1145
  '#1153': https://github.com/fedify-dev/fedify/issues/1153
  '#1161': https://github.com/fedify-dev/fedify/issues/1161
  '#1183': https://github.com/fedify-dev/fedify/pull/1183
  '#1196': https://github.com/fedify-dev/fedify/pull/1196
  '#288': https://github.com/fedify-dev/fedify/issues/288
  '#835': https://github.com/fedify-dev/fedify/issues/835
  '#838': https://github.com/fedify-dev/fedify/issues/838
  '#839': https://github.com/fedify-dev/fedify/issues/839
  '#840': https://github.com/fedify-dev/fedify/issues/840
  '#841': https://github.com/fedify-dev/fedify/issues/841
---
 -  Added support for [FEP-ef61] portable objects to the mock federation and
    contexts, following the new APIs of `@fedify/fedify`, so that tests can
    exercise portable objects without a live gateway.  [[#288]]

     -  Added the `getPortableActorUri()`, `getPortableObjectUri()`,
        `getPortableInboxUri()`, `getPortableOutboxUri()`,
        `getPortableFollowingUri()`, `getPortableFollowersUri()`,
        `getPortableLikedUri()`, `getPortableFeaturedUri()`,
        `getPortableFeaturedTagsUri()`, and `getPortableCollectionUri()`
        methods to the mock contexts.  They reject `did:key` DIDs that are
        not encoded in base58-btc.
        [[#835], [#839], [#841], [#1092], [#1111], [#1114], [#1142]]

     -  Added the `portable` option to `parseUri()` of the mock contexts.
        Without it, `parseUri()` no longer recognizes a portable ID or
        compatible identifier whose path starts with `/users/`; with it,
        the result has the DID in its `authority` property.  It also returns
        `null` for `null`.  [[#1143], [#1145]]

     -  The mock contexts that `createContext()` creates keep
        the `verifyPortableObject` property given to them, and their
        `lookupObject()` and `traverseCollection()` pass it on.
        `createFederation()` accepts a fixture `documentLoader`,
        a `contextLoader`, and `verifyPortableObject`, which mock context
        lookups use for portable IDs.  [[#1107], [#1120], [#1161], [#1196]]

     -  Added the `isSignedByAudience()` method to the mock request contexts,
        which checks the audience against the actor that
        `getSignedKeyOwner()` returns.  [[#1153], [#1183]]

     -  `federation.createContext()` accepts an explicit `portableRequest`
        for a request context, which dispatchers can inspect.
        [[#1161], [#1196]]

     -  Added the `mapPortableActorId()` method to the setters that
        `MockFederation.setActorDispatcher()` returns, the
        `mapPortableOwner()` method to the mock custom collection setters,
        and the `setHashlinkMediaDispatcher()` method to the mock federation,
        which serves hashlink media responses.
        [[#838], [#840], [#1080], [#1099], [#1111], [#1142], [#1161], [#1196]]

[FEP-ef61]: https://w3id.org/fep/ef61
