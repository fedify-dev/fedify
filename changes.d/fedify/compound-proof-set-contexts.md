---
links:
  '#1234': https://github.com/fedify-dev/fedify/issues/1234
  '#1353': https://github.com/fedify-dev/fedify/pull/1353
---
 -  Changed compound proof verification to accept `"@container": "@set"` term
    definitions in actor contexts when deciding whether embedded portable keys
    are covered by the actor's proof.  A `@set` container only forces expanded
    values into arrays, so it does not make key expansion ambiguous; `@list`
    and other containers remain rejected.  This keeps portable actors that
    publish container terms such as Mastodon's `attributionDomains`
    verifiable.  [[#1234], [#1353]]
