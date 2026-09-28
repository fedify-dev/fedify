---
links:
  '#1077': https://github.com/fedify-dev/fedify/pull/1077
  '#1084': https://github.com/fedify-dev/fedify/pull/1084
  '#288': https://github.com/fedify-dev/fedify/issues/288
  '#834': https://github.com/fedify-dev/fedify/issues/834
  '#836': https://github.com/fedify-dev/fedify/issues/836
---
 -  Added the `PortableObjectVerifier`, `PortableObjectVerifierOptions`,
    `PortableObjectVerification`, and `PortableObjectReferrer` types, which
    describe the `verifyPortableObject` option of property accessors for
    [FEP-ef61] portable references.  A verifier receives the fetched
    document along with its final URL, the gateways used, and the chain of
    objects that referred to it, and can accept a document without an
    integrity proof as `unsecured`.  `verifyPortableObject()` and
    `verifyPortableObjectProof()` from `@fedify/fedify` satisfy
    `PortableObjectVerifier`.  [[#288], [#834], [#836], [#1077], [#1084]]

[FEP-ef61]: https://w3id.org/fep/ef61
