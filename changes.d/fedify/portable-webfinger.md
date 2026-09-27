---
links:
  '#1082': https://github.com/fedify-dev/fedify/pull/1082
  '#288': https://github.com/fedify-dev/fedify/issues/288
  '#837': https://github.com/fedify-dev/fedify/issues/837
---
 -  Added WebFinger support for [FEP-ef61] portable actors.  When an actor
    dispatcher returns an actor whose ID is an `ap:` or `ap+ef61:` URI, the
    WebFinger response takes the domain of the actor's `acct:` URI from the
    first gateway in its `gateways`, as FEP-ef61 requires, and its `self`
    link is the actor's compatible identifier based on that gateway, e.g.,
    `https://example.com/.well-known/apgateway/did:key:z6Mk.../actor`, so
    that software without portable ID support can fetch it.  A portable
    actor without a valid first gateway is not found.  Existing
    `mapHandle()` and `mapAlias()` callbacks work as before, and WebFinger
    resources can now be `ap:` or `ap+ef61:` URIs, which are passed to
    `mapAlias()`.  To serve the actor itself at its compatible identifier,
    register an object dispatcher for it.  [[#288], [#837], [#1082]]

 -  `Context.lookupObject()` now uses `verifyPortableObjectProof()` as its
    new `verifyPortableObject` option by default, so it looks up
    [FEP-ef61] portable objects, including portable actors found through
    WebFinger, through their gateways and returns them only if they have
    valid Object Integrity Proofs made by the DIDs in their IDs.
    [[#288], [#837], [#1082]]

 -  Actor dispatchers no longer log warnings that a portable actor's ID or
    collection URIs do not match the URIs that `Context` builds, such as
    `Context.getActorUri()`.  [[#288], [#837], [#1082]]

[FEP-ef61]: https://w3id.org/fep/ef61
