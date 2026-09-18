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
