---
links:
  '#1077': https://github.com/fedify-dev/fedify/pull/1077
  '#288': https://github.com/fedify-dev/fedify/issues/288
  '#834': https://github.com/fedify-dev/fedify/issues/834
---
 -  Added [FEP-ef61] gateway dereferencing to property accessors such as
    `Create.getObject()`.  Accessors now fetch `ap:` and `ap+ef61:`
    references through the gateways given by the new `gateways` option, or
    through the `@gateway` location hints in the reference when the option is
    omitted, trying each gateway in order until one serves a valid object.
    A fetched object is returned only if its `@id` canonically matches the
    reference and the new `verifyPortableObject` option, typically
    `verifyPortableObjectProof()` from `@fedify/fedify`, accepts it.  Portable
    references can no longer be dereferenced without `verifyPortableObject`,
    and the `crossOrigin: "trust"` option does not skip these checks.
    HTTP(S) references are fetched as before.  [[#288], [#834], [#1077]]

[FEP-ef61]: https://w3id.org/fep/ef61
