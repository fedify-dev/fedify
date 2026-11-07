---
links:
  '#1272': https://github.com/fedify-dev/fedify/issues/1272
  '#1356': https://github.com/fedify-dev/fedify/pull/1356
---
 -  Added `getRawPropertyValues()` and `getRawPropertyValue()` functions,
    which read a property of a vocabulary object by its full IRI and return
    its values in expanded JSON-LD.  They let applications read properties
    that Fedify has no accessor for, such as an extension used by only a few
    peers, without depending on the JSON-LD serialization cache: unknown
    properties are now retained when an object is decoded, including embedded
    objects, and survive `clone()` and `deepClone()`.  For properties Fedify
    does support, the functions return the current typed values encoded back
    into JSON-LD.  The values are not verified, so validate them before use.
    [[#1272], [#1356]]
