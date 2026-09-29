---
links:
  '#1107': https://github.com/fedify-dev/fedify/issues/1107
  '#1120': https://github.com/fedify-dev/fedify/pull/1120
  '#288': https://github.com/fedify-dev/fedify/issues/288
---
 -  Added the `Context.verifyPortableObject` property, the [FEP-ef61]
    portable object policy of the context: `verifyPortableObject()` with the
    context's document loader and context loader.  Since it has the same name
    as the `verifyPortableObject` option of property accessors, passing
    a context as their options, e.g., `await create.getObject(ctx)`, now
    verifies portable objects that they dereference.  Previously,
    `create.getObject(ctx)` on an activity whose ID is a compatible
    identifier, such as one from tootik, fetched the object it refers to as
    an ordinary HTTP(S) URL and trusted it because of its origin.  Note that
    this also applies to objects with ordinary HTTP(S) IDs: their references
    to compatible identifiers are now verified as portable objects when you
    pass a context.  [[#288], [#1107], [#1120]]

 -  Inboxes now parse received activities with `Context.verifyPortableObject`
    as their default verifier, so accessors called without options in inbox
    listeners, e.g., `await create.getObject()`, verify portable objects
    too, including for queued activities and for activities authenticated
    by Object Integrity Proofs.  The activities passed to the
    `onOutboxError` callback have the default as well.
    [[#288], [#1107], [#1120]]

 -  Changed `Context.lookupObject()` to use `Context.verifyPortableObject`
    instead of `verifyPortableObjectProof()` as the default
    `verifyPortableObject` option, so that it also accepts an unsecured
    portable collection served by a gateway that its owner lists, as
    accessors do.  Pass `verifyPortableObject: verifyPortableObjectProof` to
    accept only objects with proofs.  The returned object uses the policy by
    default for its property accessors.  `Context.traverseCollection()` also
    uses `Context.verifyPortableObject` by default.  [[#288], [#1107], [#1120]]

 -  Added the `verifyPortableObject` option to `VerifyObjectOptions`.  It is
    not used to verify the given object; the returned object uses it by
    default for its property accessors.  [[#288], [#1107], [#1120]]

[FEP-ef61]: https://w3id.org/fep/ef61
