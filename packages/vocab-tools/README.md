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
