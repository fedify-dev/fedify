---
links:
  '#1210': https://github.com/fedify-dev/fedify/issues/1210
  '#1215': https://github.com/fedify-dev/fedify/pull/1215
---
 -  Added non-functional `redundantProperties` support with ordered fallback
    to the first non-empty value set, preserving lists and graphs without
    merging synonyms.  Added `redundantPropertiesWrite: canonical` to write
    only the canonical property while accepting synonyms.  Fixed serialization
    of synonyms without a compact name and validation of synonym definitions.
    [[#1210], [#1215]]
