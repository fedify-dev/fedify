---
links:
  '#1041': https://github.com/fedify-dev/fedify/pull/1041
  '#1044': https://github.com/fedify-dev/fedify/issues/1044
  '#1051': https://github.com/fedify-dev/fedify/pull/1051
  '#288': https://github.com/fedify-dev/fedify/issues/288
---
 -  Fixed `signObject()` so that a signed object keeps verifying after it is
    assigned to a typed parent and the parent is serialized.  `signObject()`
    now captures the secured JSON document its proof covers, and nested
    serialization embeds that document verbatim instead of rebuilding the
    child under the parent's JSON-LD context.  Producing a [FEP-ef61] compound
    document with `signObject()` no longer requires assembling the JSON by
    hand.  [[#288], [#1041], [#1044], [#1051]]

     -  The captured document is a snapshot: `clone()` does not carry it, and
        mutating a signed object in place does not change it.  Sign a clone
        again when it has to be embedded as a secured child.
     -  An object parsed with `fromJsonLd()`, an object that already carried a
        proof, and a `toJsonLd()` `context` option that could hide the
        internal placeholder all fall back to the previous behavior.
     -  Outgoing JSON-LD compatibility normalization now leaves a nested
        self-contained secured document untouched while signing and sending,
        so it cannot rewrite bytes that the child's own proof covers.
        Inbound verification is unaffected.
     -  Fanout delivery now reuses the document the activity was already
        serialized into instead of reparsing and reserializing it, which
        previously invalidated an embedded signed child and the outer proof
        that covered it.

[FEP-ef61]: https://w3id.org/fep/ef61
