---
links:
  '#1044': https://github.com/fedify-dev/fedify/issues/1044
  '#1051': https://github.com/fedify-dev/fedify/pull/1051
  '#288': https://github.com/fedify-dev/fedify/issues/288
---
 -  Changed nested serialization so that an object carrying a signed JSON-LD
    representation retained by `signObject()` is embedded with that exact
    representation, including its own `@context`, rather than being rebuilt
    under the parent's context.  `clone()` never carries the retained
    representation, because a clone may differ from the document the proof
    covers.  [[#288], [#1044], [#1051]]
