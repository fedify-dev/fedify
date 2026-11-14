---
links:
  '#1399': https://github.com/fedify-dev/fedify/issues/1399
  '#1442': https://github.com/fedify-dev/fedify/pull/1442
---
 -  Added a warning when `clone()` drops the default [FEP-ef61] portable object
    verifier of a vocabulary object, and documented that `clone()` does not
    inherit it.  Objects that Fedify parses for you, such as activities that
    inboxes receive and the results of `Context.lookupObject()`, have
    `Context.verifyPortableObject` as their default, so an existing
    application that clones them now logs a warning in the
    `["fedify", "vocab", "portable"]` category.  A clone without a verifier
    does not verify the portable objects embedded in it, and refuses to
    dereference portable references.  Pass
    `verifyPortableObject: ctx.verifyPortableObject` to `clone()` to keep
    verifying them, or `verifyPortableObject: undefined` to drop the verifier
    deliberately without the warning.  The `verifyPortableObject` option of
    `clone()` now explicitly accepts `undefined`, so that the opt-out also
    type-checks with `exactOptionalPropertyTypes`.  [[#1399], [#1442]]

[FEP-ef61]: https://w3id.org/fep/ef61
