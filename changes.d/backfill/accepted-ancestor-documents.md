---
links:
  '#1423': https://github.com/fedify-dev/fedify/issues/1423
  '#1445': https://github.com/fedify-dev/fedify/pull/1445
---
 -  Fixed ancestor discovery losing a loaded object's loader and verifier
    defaults when its parsed target serializes differently from the loader
    document.  Rejected loads cannot transfer their defaults to embedded
    targets with matching serialization.  [[#1423], [#1445] by Jiwon Kwon]
