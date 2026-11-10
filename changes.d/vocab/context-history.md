---
links:
  '#1250': https://github.com/fedify-dev/fedify/issues/1250
  '#1396': https://github.com/fedify-dev/fedify/pull/1396
---
 -  Added `contextHistory` and `contextHistories` to `Object` subclasses for
    referencing conversation activity histories as collections, including
    ordered collections and pages, with ID accessors and singular and plural
    dereferencing methods. The default `@context` of every `Object` subclass
    includes the `contextHistory` mapping even when the property is absent.
    This changes compact serialization and can change newly generated proofs
    and signatures.
    [[#1250], [#1396] by Jiwon Kwon]
