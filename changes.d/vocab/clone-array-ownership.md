---
links:
  '#1207': https://github.com/fedify-dev/fedify/issues/1207
  '#1208': https://github.com/fedify-dev/fedify/pull/1208
---
 -  Fixed shared property arrays in vocabulary objects so dereferencing a
    clone no longer changes its source's properties or serialization.
    Constructors and `clone()` also copy supplied plural-value arrays,
    allowing frozen arrays and preventing changes to the caller's arrays.
    Nested objects and URLs retain their identity.  [[#1207], [#1208]]
