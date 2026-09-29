---
links:
  '#1107': https://github.com/fedify-dev/fedify/issues/1107
  '#1120': https://github.com/fedify-dev/fedify/pull/1120
  '#288': https://github.com/fedify-dev/fedify/issues/288
---
 -  Property accessors of objects whose IDs are [FEP-ef61] compatible
    identifiers, e.g.,
    `https://gw.example/.well-known/apgateway/did:key:z6Mk.../activities/1`,
    now dereference their references as portable objects, as those of objects
    with `ap:` IDs do.  Previously, such an accessor fetched a compatible
    identifier as an ordinary HTTP(S) URL and trusted the result because of
    its origin, so anyone could serve an unsigned object at the reference.
    Without the `verifyPortableObject` option, such an accessor now throws
    a `TypeError` (or returns `null` with `suppressError: true`) for
    a portable reference or a compatible identifier; pass a `Context` from
    `@fedify/fedify`, which carries a verifier, or use a default verifier
    (see below).  An object whose ID is a malformed compatible identifier is
    handled the same way.  Having such an ID does not make an object
    verified.  [[#288], [#1107], [#1120]]

 -  Added the `verifyPortableObject` option to the constructors, the
    `fromJsonLd()` methods, and the `clone()` methods of vocabulary
    classes.  The object uses it by default when its property accessors are
    called without the option.  Objects that it fetches, and objects
    embedded in the JSON-LD document it was parsed from, inherit it, but
    a verifier given to a single accessor call is not passed on to the
    returned object.  `lookupObject()` passes its `verifyPortableObject`
    option to the object it returns.  [[#288], [#1107], [#1120]]

[FEP-ef61]: https://w3id.org/fep/ef61
