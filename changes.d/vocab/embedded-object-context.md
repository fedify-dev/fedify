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
    return the object decoded with the whole document, which keeps the JSON-LD
    it was received as for `toJsonLd()`.  As a result, they return the same
    object on each call, and an embedded object no longer takes the document
    loaders passed to the accessor.  The received JSON-LD can rely on the
    enclosing document's contexts and base IRI, so a parent that is encoded
    anew, such as a clone, encodes such an object from its values rather
    than embedding its received JSON-LD.  [[#1272], [#1356]]
