---
links:
  '#1250': https://github.com/fedify-dev/fedify/issues/1250
  '#1396': https://github.com/fedify-dev/fedify/pull/1396
---
 -  Added a `dereference: false` option to vocabulary object accessors to read
    embedded or cached objects without fetching references. Existing trust
    checks still apply; singular accessors return `null` and plural accessors
    skip values that require fetching. [[#1250], [#1396] by Jiwon Kwon]
