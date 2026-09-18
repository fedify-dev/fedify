---
links:
  '#1037': https://github.com/fedify-dev/fedify/issues/1037
  '#1038': https://github.com/fedify-dev/fedify/pull/1038
---
 -  Added vocabulary support for the [FEP-22cd] draft, associating each
    translated version with its translators, source object, and optional source
    review timestamp.  [[#1037], [#1038]]

     -  Added `Translation` class with `id`, `language`, `original`,
        `sourceUpdated`, `basis`, `url`, and `urls` properties.
     -  Added `Translation.getTranslator()`/`Translation.translatorId` and
        `Translation.getTranslators()`/`Translation.translatorIds` for
        accessing credited actors.  The constructor accepts `translator`
        and `translators` values.
     -  Added `Object.translations` property, inherited by `Article`,
        `Note`, and other object types, for per-language translation
        metadata without creating separate posts.

[FEP-22cd]: https://w3id.org/fep/22cd
