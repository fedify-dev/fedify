---
links:
  '#1207': https://github.com/fedify-dev/fedify/issues/1207
  '#1208': https://github.com/fedify-dev/fedify/pull/1208
---
 -  Fixed generated constructors and `clone()` methods to copy property
    arrays, preventing a clone's remote lookups from changing its source and
    preserving arrays supplied by callers.  [[#1207], [#1208]]
