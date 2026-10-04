---
links:
  '#1229': https://github.com/fedify-dev/fedify/issues/1229
  '#1231': https://github.com/fedify-dev/fedify/pull/1231
---
 -  Fixed language-tagged strings and `Link.hreflang` values with extended
    language subtags being dropped or rejected.  Tags such as `zh-YUE`, which
    Mastodon uses for Cantonese posts, are now accepted and parsed into their
    canonical form (`yue`).  Unmodified objects still re-emit the original
    tag through the cached JSON-LD document, but objects serialized afresh
    use the canonical tag.  [[#1229], [#1231]]
