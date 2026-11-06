---
links:
  '#1272': https://github.com/fedify-dev/fedify/issues/1272
  '#1356': https://github.com/fedify-dev/fedify/pull/1356
---
 -  Fixed accessors of objects decoded by `fromJsonLd()` returning wrong
    values for embedded objects that have their own `@context`.  Such an
    object was decoded again from its cached JSON-LD without the enclosing
    document's context, so a type or property term that only the enclosing
    context defined could yield an object of another class or drop
    property values.  It could also pick embedded objects under a term that
    the enclosing context mapped to another property.  The accessors now
    apply the enclosing context and fall back to the object decoded with the
    whole document when the cached JSON-LD cannot be matched with it.
    [[#1272], [#1356]]
