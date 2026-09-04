<!-- deno-fmt-ignore-file -->

@fedify/pglite: PGlite driver for Fedify
========================================

[![JSR][JSR badge]][JSR]
[![npm][npm badge]][npm]

This package provides [`PgliteKvStore`], a PGlite-backed implementation of
Fedify's [`KvStore`]:

~~~~ typescript
import { PGlite } from "@electric-sql/pglite";
import { createFederation } from "@fedify/fedify";
import { PgliteKvStore } from "@fedify/pglite";

const pg = new PGlite("./data/fedify");
const federation = createFederation({
  kv: new PgliteKvStore(pg),
});
~~~~

The caller owns the `PGlite` instance.  Close it during application shutdown,
after every pending store operation has completed.  `PgliteKvStore` neither
creates nor closes the instance.

Use one PGlite instance per data directory and runtime isolate.  PGlite does
not make writes visible to other processes, so the same data directory cannot
back horizontally scaled workers.  This package does not provide a message
queue because those constraints cannot preserve ordering or delivery during a
rolling restart.  See [PGlite issue #489] and [PGlite pull request #892].

[JSR badge]: https://jsr.io/badges/@fedify/pglite
[JSR]: https://jsr.io/@fedify/pglite
[npm badge]: https://img.shields.io/npm/v/@fedify/pglite?logo=npm
[npm]: https://www.npmjs.com/package/@fedify/pglite
[`PgliteKvStore`]: https://jsr.io/@fedify/pglite/doc/~/PgliteKvStore
[`KvStore`]: https://jsr.io/@fedify/fedify/doc/federation/~/KvStore
[PGlite issue #489]: https://github.com/electric-sql/pglite/issues/489#issuecomment-2587892190
[PGlite pull request #892]: https://github.com/electric-sql/pglite/pull/892


Installation
------------

~~~~ sh
deno add jsr:@fedify/pglite npm:@electric-sql/pglite  # Deno
npm  add     @fedify/pglite @electric-sql/pglite      # npm
pnpm add     @fedify/pglite @electric-sql/pglite      # pnpm
yarn add     @fedify/pglite @electric-sql/pglite      # Yarn
bun  add     @fedify/pglite @electric-sql/pglite      # Bun
~~~~
