---
links:
  '#1369': https://github.com/fedify-dev/fedify/issues/1369
  '#1435': https://github.com/fedify-dev/fedify/pull/1435
---
 -  Added raw [FEP-f799] shape tools in
    `@fedify/fedify/delivery-suspension`.  The asynchronous notice, activity,
    actor metadata, and inbox metadata parsers preserve expanded IRI spelling,
    literal values, and multiplicity, and return detached evidence and
    diagnostics.  Diagnostic `path` values refer to original expanded evidence;
    dropped occurrences retain their original JSON pointer in `rawPath`.
    Unrelated embedded objects are classified before requiring control-activity
    fields.  The default loader resolves preloaded contexts locally;
    applications can explicitly supply a context loader. Strict HTTPS origin
    helpers validate origin spelling before URL normalization, including
    IDNA2008 validation against a pinned Unicode 12.0 repertoire. These tools
    expose unverified claims; they do not authenticate notices, establish
    controller authority, or suspend delivery. [[#1369], [#1435]]

[FEP-f799]: https://w3id.org/fep/f799
