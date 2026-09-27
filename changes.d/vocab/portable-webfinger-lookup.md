---
links:
  '#1082': https://github.com/fedify-dev/fedify/pull/1082
  '#288': https://github.com/fedify-dev/fedify/issues/288
  '#837': https://github.com/fedify-dev/fedify/issues/837
---
 -  Added the `verifyPortableObject` option to `LookupObjectOptions`.  With
    it, `lookupObject()` looks up [FEP-ef61] portable objects: `ap:` and
    `ap+ef61:` URIs through their `@gateway` location hints, compatible
    identifiers through the gateways they name, and portable actors'
    handles through the `self` links of their WebFinger responses, which
    can be either of them.  A fetched object is returned only if its `@id`
    identifies the requested portable object and the option accepts it;
    otherwise, the next candidate is tried, at most five gateways per
    lookup.  `crossOrigin: "throw"` makes a rejected object throw an error,
    and `crossOrigin: "trust"` does not skip the checks.
    [[#288], [#837], [#1082]]

 -  `crossOrigin: "trust"` no longer makes `lookupObject()` return an object
    whose `@id` is an `ap:` or `ap+ef61:` URI from a document URL of another
    origin, such as a compatible identifier fetched as an ordinary HTTP(S)
    URL, since a portable object is authenticated by its proofs, not by the
    server that serves it.  Look such objects up with the
    `verifyPortableObject` option instead.  [[#288], [#837], [#1082]]

 -  `getActorHandle()` now supports [FEP-ef61] portable actors.  It takes the
    domain of a portable actor's handle from the first gateway in its
    `gateways` instead of its ID, and returns the handle only if its
    WebFinger response links back to the actor, either by its portable ID
    or by a compatible identifier, since the gateways are claimed by the
    actor itself.  It throws a `TypeError` otherwise, including when the
    WebFinger lookup fails, and for a portable actor without `gateways` or
    `preferredUsername` or a portable actor URI.  [[#288], [#837], [#1082]]

[FEP-ef61]: https://w3id.org/fep/ef61
