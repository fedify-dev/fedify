---
links:
  '#1076': https://github.com/fedify-dev/fedify/pull/1076
  '#1113': https://github.com/fedify-dev/fedify/issues/1113
  '#1124': https://github.com/fedify-dev/fedify/pull/1124
  '#1153': https://github.com/fedify-dev/fedify/issues/1153
  '#1183': https://github.com/fedify-dev/fedify/pull/1183
  '#288': https://github.com/fedify-dev/fedify/issues/288
  '#835': https://github.com/fedify-dev/fedify/issues/835
---
 -  Added serving of [FEP-ef61] portable objects through the gateway endpoint,
    e.g., `GET /.well-known/apgateway/did:key:z6Mk.../notes/123`.  Existing
    object dispatchers serve such a request with the path after the DID, so
    the object dispatcher registered for `/notes/{id}` serves the portable
    object `ap+ef61://did:key:z6Mk.../notes/123`.  Fedify responds with
    `404 Not Found` unless the dispatcher returns an object with that ID, and
    refuses to serve a portable actor, activity, or object that does not have
    an Object Integrity Proof made with a key of the DID.  As FEP-ef61
    forbids gateways to serve a non-public object to anyone but its intended
    audience, and a gateway may store objects that it did not create, Fedify
    also responds with `404 Not Found` unless the object is publicly
    addressed, i.e., its `to`, `cc`, `bto`, `bcc`, or `audience` has
    the public collection, or is an actor.  To serve non-public portable
    objects to their audience, set an authorization predicate on the object
    dispatcher, e.g., one that checks the request with the new
    `RequestContext.isSignedByAudience()` method; the predicate then decides
    who may retrieve the dispatcher's portable objects, and Fedify responds to
    the requests that it allows with `Cache-Control: private`.  Applications
    that do not serve portable objects are unaffected, except that their
    object dispatchers may be called for such requests.
    [[#288], [#835], [#1076], [#1153], [#1183]]

 -  Added the `RequestContext.isSignedByAudience()` method, which checks
    whether the request is signed by an actor in the audience of an object,
    comparing [FEP-ef61] portable IDs canonically, and the
    `IsSignedByAudienceOptions` interface.  Its `isMember` option checks
    the members of collections such as followers, which Fedify cannot tell
    by itself.  Custom implementations of the `RequestContext` interface need
    to implement the new method.  [[#288], [#1153], [#1183]]

 -  Added the `Context.getPortableObjectUri()` method, which builds the
    portable ID of an object from its object dispatcher's path and a DID,
    and the `RequestContext.portableRequest` property, which tells an object
    dispatcher the DID and ID of the requested portable object.  Custom
    implementations of the `Context` interface need to implement the new
    method.  [[#288], [#835], [#1076]]

 -  Added serving of tombstones of [FEP-ef61] portable objects and actors
    through the gateway endpoint with `410 Gone`, as for ordinary objects,
    so that other gateways and consumers can tell a deleted portable object
    from one that the gateway never stored.  A `Tombstone` that an object
    dispatcher or the actor dispatcher returns for such a request is served
    with `410 Gone` if its ID is the requested portable ID and it has
    an Object Integrity Proof made with a key of the DID, and with
    `404 Not Found` if it has no proof.  Like other portable objects,
    a tombstone from an object dispatcher without an authorization predicate
    needs public addressing to be served.
    [[#288], [#1113], [#1124], [#1153], [#1183]]

[FEP-ef61]: https://w3id.org/fep/ef61
