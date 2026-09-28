---
links:
  '#1090': https://github.com/fedify-dev/fedify/issues/1090
  '#1091': https://github.com/fedify-dev/fedify/pull/1091
  '#288': https://github.com/fedify-dev/fedify/issues/288
---
 -  Property accessors such as `Create.getObject()` now dereference
    [FEP-ef61] compatible identifiers, i.e., HTTP(S) URLs under a gateway's
    */.well-known/apgateway/* path, as the portable objects they stand for
    when the `verifyPortableObject` option is given or the parent object is
    portable.  Previously, they fetched such a reference as an ordinary
    HTTP(S) URL and trusted the result because of its origin, so anyone could
    serve an unsigned object that claimed to be someone else's portable
    object.  Now the accessor asks the gateway that the identifier names
    first, and then the gateways in the `gateways` option, and returns the
    object only if its `@id` identifies the same portable object and
    `verifyPortableObject` accepts it, including the gateway trust policy for
    unsecured collections.  Malformed compatible identifiers are rejected
    without a request.  [[#288], [#1090], [#1091]]

 -  Property accessors and `lookupObject()` with the `verifyPortableObject`
    option now verify a document fetched from an ordinary HTTP(S) URL as
    a portable object if its final URL is a compatible identifier or its
    `@id` is an `ap:`/`ap+ef61:` URI, instead of trusting it because of its
    origin.  Likewise, accessors no longer trust an embedded object whose
    `@id` is a compatible identifier, or a portable ID with a DID other than
    its parent's, even with `crossOrigin: "trust"`; they dereference and
    verify it on its own.  [[#288], [#1090], [#1091]]

 -  Without the `verifyPortableObject` option, property accessors keep
    fetching compatible identifiers from ordinary objects as HTTP(S) URLs,
    but no longer cache the results in the parent objects, so that a later
    call with the option verifies them.  [[#288], [#1090], [#1091]]

 -  The gateways that `lookupObject()` infers from compatible identifiers,
    WebFinger responses, and location hints are now passed to the
    `verifyPortableObject` function as `gatewayHints` instead of `gateways`,
    which are reserved for gateways that the caller gives explicitly.
    [[#288], [#1090], [#1091]]

[FEP-ef61]: https://w3id.org/fep/ef61
