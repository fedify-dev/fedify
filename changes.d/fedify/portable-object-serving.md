---
links:
  '#1076': https://github.com/fedify-dev/fedify/pull/1076
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
    an Object Integrity Proof made with a key of the DID.  Applications that
    do not serve portable objects are unaffected, except that their object
    dispatchers may be called for such requests.  [[#288], [#835], [#1076]]

 -  Added the `Context.getPortableObjectUri()` method, which builds the
    portable ID of an object from its object dispatcher's path and a DID,
    and the `RequestContext.portableRequest` property, which tells an object
    dispatcher the DID and ID of the requested portable object.  Custom
    implementations of the `Context` interface need to implement the new
    method.  [[#288], [#835], [#1076]]

[FEP-ef61]: https://w3id.org/fep/ef61
