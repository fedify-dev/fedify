---
links:
  '#1355': https://github.com/fedify-dev/fedify/issues/1355
  '#1420': https://github.com/fedify-dev/fedify/pull/1420
---
 -  Extended `raw-property-iri-invalid` to check `withRawProperty()` and
    static record and tuple keys passed to `withRawProperties()`.  The rule
    reports invalid property IRIs and compact prefixes such as `as:content`
    across Deno Lint, ESLint, and Oxlint.  [[#1355], [#1420]]
