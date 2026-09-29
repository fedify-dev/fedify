---
links:
  '#1143': https://github.com/fedify-dev/fedify/issues/1143
  '#1145': https://github.com/fedify-dev/fedify/pull/1145
  '#288': https://github.com/fedify-dev/fedify/issues/288
---
 -  Added the `portable` option to `Context.parseUri()`, and the
    `ParseUriOptions` interface.  With `{ portable: true }`, the method also
    recognizes [FEP-ef61] portable IDs, e.g.,
    `ap+ef61://did:key:z6Mk.../users/alice`, and their compatible identifiers
    on any gateway by the same paths through which the gateway endpoint serves
    them, so that an inbox listener can tell that an activity is about one of
    its portable actors, objects, or collections.  The result then has the DID
    of the ID in its new `authority` property.  Since anyone can make
    a portable ID with the same path under another DID, check that
    `authority` is the DID that you store for the actor or object before
    acting on the result.  Without the option, `parseUri()` behaves as
    before.  [[#288], [#1143], [#1145]]

[FEP-ef61]: https://w3id.org/fep/ef61
