---
links:
  '#1159': https://github.com/fedify-dev/fedify/issues/1159
  '#1189': https://github.com/fedify-dev/fedify/pull/1189
  '#288': https://github.com/fedify-dev/fedify/issues/288
---
 -  Added `withGatewayHints()`, `withoutGatewayHints()`, and
    `getGatewayHints()` to add, remove, and read the [FEP-ef61] `@gateway`
    location hints of portable IDs, which tell consumers where to retrieve
    a referenced portable actor.  Use `withGatewayHints()` when referring to
    a portable actor, e.g., in `attributedTo` or `to`, instead of editing
    the query by hand; it writes each gateway's URI-encoded origin as
    FEP-ef61 requires, replaces existing hints, and keeps the other query
    parameters.  Do not add hints to an object's own `id`.
    [[#288], [#1159], [#1189]]

[FEP-ef61]: https://w3id.org/fep/ef61
