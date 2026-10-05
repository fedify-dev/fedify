---
links:
  '#1229': https://github.com/fedify-dev/fedify/issues/1229
  '#1231': https://github.com/fedify-dev/fedify/pull/1231
---
 -  Added `normalizeLanguageTag()` function, which replaces a language tag
    that has an extended language subtag (extlang) with its canonical form,
    e.g., `zh-YUE` with `yue`.  `Intl.Locale` rejects extlang tags, so
    applications can normalize such tags before passing them to it.
    [[#1229], [#1231]]
