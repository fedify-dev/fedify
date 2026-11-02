---
links:
  '#1234': https://github.com/fedify-dev/fedify/issues/1234
  '#1353': https://github.com/fedify-dev/fedify/pull/1353
---
 -  Added `@container` support to embedded `defaultContext` term definitions
    in the vocabulary schema.  Terms such as Mastodon's `attributionDomains`
    can now use `"@container": "@set"` or `"@container": "@list"` to match
    their published JSON-LD contexts, while existing term definitions keep
    validating as before.  [[#1234], [#1353]]
