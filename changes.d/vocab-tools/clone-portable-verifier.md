---
links:
  '#1399': https://github.com/fedify-dev/fedify/issues/1399
  '#1442': https://github.com/fedify-dev/fedify/pull/1442
---
 -  Generated `clone()` methods now log a warning in the
    `["fedify", "vocab", "portable"]` category when they drop the default
    [FEP-ef61] portable object verifier of the source object, i.e., when the
    source has one and the call does not pass the `verifyPortableObject`
    option.  An explicit `verifyPortableObject: undefined` drops it without
    the warning.  Their API documentation now states that `clone()` does not
    inherit the default verifier.  Regenerate custom vocabularies to get
    the warning.  [[#1399], [#1442]]

[FEP-ef61]: https://w3id.org/fep/ef61
