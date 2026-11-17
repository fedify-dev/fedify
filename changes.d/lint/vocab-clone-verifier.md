---
links:
  '#1401': https://github.com/fedify-dev/fedify/issues/1401
  '#1443': https://github.com/fedify-dev/fedify/pull/1443
---
 -  Added the `vocab-clone-verifier` rule, which warns when a `clone()` of
    a vocabulary object is dereferenced through a `get*()` accessor without
    a `verifyPortableObject` verifier.  `clone()` does not inherit the default
    verifier of the object it copies, so such a call may accept portable
    objects without verifying them.  Pass a verifier, such as a `Context`, to
    `clone()`, or use `deepClone()` when the copy is used for dereferencing.
    The rule is available in ESLint, where the recommended configuration
    enables it as a warning, so projects that fail on warnings may see new
    failures, and in Oxlint, where it has to be enabled by name.  It is not
    registered in Deno Lint, which reports every plugin rule as an error.
    [[#1401], [#1443]]
