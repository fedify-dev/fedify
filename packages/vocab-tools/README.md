<!-- deno-fmt-ignore-file -->

@fedify/vocab-tools
===================

This package contains the utilities for working with Activity
Vocabulary objects, which are auto-generated from the IDL.


Installation
------------

~~~~ bash
deno add @fedify/vocab-tools
~~~~

~~~~ bash
npm install @fedify/vocab-tools
~~~~

~~~~ bash
pnpm add @fedify/vocab-tools
~~~~

~~~~ bash
yarn add @fedify/vocab-tools
~~~~


Development
-----------

Run development tasks from the repository root with [mise].

[mise]: https://mise.jdx.dev/

### Updating snapshots

The code generator has separate output snapshots for Deno, Node.js, and Bun.
When a change affects generated output, update all three from the repository
root:

~~~~ bash
mise run test:update_snapshots
~~~~

Review and commit every changed snapshot file.  Updating only one runtime
leaves the other test suites with stale expectations.


Conditional contexts and metadata trust
---------------------------------------

A property schema can set `extraContext` to a context URL.  The generated
serializer adds it to its default context when the property's expanded IRI
appears after compaction, including inside nested objects.  A caller-provided
context takes precedence.  When populated, such a property uses the JSON-LD
processor so context container rules, including `@set`, are respected.

A type schema can set `trustEmbeddedObjects: false` when its identifier is
metadata rather than a resource that establishes an origin.  Its own
entity-valued accessors then fetch embedded objects with identifiers instead
of trusting a matching origin.  Locally constructed values, previously fetched
values, and the explicit `crossOrigin: "trust"` option retain their usual
behavior.  This does not verify id-less embedded objects or establish publishing
authority.


Redundant properties
--------------------

Both functional and non-functional property schemas can declare synonyms in
`redundantProperties`.  On reading, the canonical property takes precedence,
followed by synonyms in declaration order.  The first non-empty raw value set
is decoded in full, preserving its order and multiplicity.  Values from other
synonyms are never merged, even when the selected values fail range validation.
List and graph containers are decoded only after choosing the property.

`redundantPropertiesWrite` defaults to `all`, which writes the canonical
property and every synonym with the same complete container representation.
Set it to `canonical` to write only the canonical property while still accepting
synonyms on reading:

~~~~ yaml
- singularName: license
  pluralName: licenses
  uri: "https://example.com/license"
  description: The licenses of the object.
  range:
    - "http://www.w3.org/2001/XMLSchema#anyURI"
  redundantProperties:
    - uri: "https://schema.org/license"
    - uri: "http://creativecommons.org/ns#license"
  redundantPropertiesWrite: canonical
~~~~

A synonym's `compactName` is optional.  Without it, serialization uses the
JSON-LD processor to select a context term or retain the full URI.  For IRI
values, context terms must declare `"@type": "@id"`; container terms must
carry the appropriate `@container`.  Writable container synonyms also use the
processor to preserve their representation.  Explicit caller contexts take
precedence over the default context.

As with other properties, an object parsed with `fromJsonLd()` retains its
original JSON-LD document for default serialization.  Pass `format: "compact"`
or `format: "expand"` to serialize its decoded values under the write policy.
