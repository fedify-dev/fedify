---
links:
  '#1212': https://github.com/fedify-dev/fedify/issues/1212
  '#1241': https://github.com/fedify-dev/fedify/pull/1241
---
 -  Added the `fedify:absoluteIri` range for URLs written as IRI references
    that also accept string literals when read.  Unlike
    `http://www.w3.org/2001/XMLSchema#anyURI`, it never resolves a value
    against the object's ID, and skips values that are not absolute instead of
    failing the whole object.  [[#1212], [#1241]]
 -  Changed `extraContext` to add its context when the property is populated
    even if the default context defines a matching prefix, such as `dc` in
    `https://w3id.org/identity/v1`.  Previously, such a property compacted to
    a prefixed name like `dc:license` without the extra context.
    [[#1212], [#1241]]
