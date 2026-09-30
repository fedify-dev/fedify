---
links:
  '#1163': https://github.com/fedify-dev/fedify/issues/1163
  '#1167': https://github.com/fedify-dev/fedify/pull/1167
---
 -  Fixed outbound delivery circuit breaker transitions when a key–value
    store compares encoded values.  Existing half-open states can now recover
    after switching to a CAS-capable store.  [[#1163], [#1167]]
