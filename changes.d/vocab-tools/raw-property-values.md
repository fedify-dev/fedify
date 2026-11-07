---
links:
  '#1272': https://github.com/fedify-dev/fedify/issues/1272
  '#1356': https://github.com/fedify-dev/fedify/pull/1356
---
 -  Generated vocabulary modules now export `getRawPropertyValues()` and
    `getRawPropertyValue()`, which read any property of a generated object
    by its full IRI, and their root classes implement `VocabularyObject` from
    `@fedify/vocab-runtime`.  Decoding retains the properties a class does not
    know, so third-party vocabulary modules get the same access to
    unsupported properties as `@fedify/vocab`.  The functions accept objects
    from any generated module.  [[#1272], [#1356]]
