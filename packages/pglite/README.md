@fedify/pglite: PGlite driver for Fedify
========================================

[![npm][npm badge]][npm]
[![JSR][JSR badge]][JSR]

This package provides [`PgliteKvStore`], a PGlite-backed implementation of
Fedify's [`AtomicKvStore`]:

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

[npm badge]: https://img.shields.io/npm/v/@fedify/pglite?logo=npm
[npm]: https://www.npmjs.com/package/@fedify/pglite
[JSR badge]: https://jsr.io/badges/@fedify/pglite
[JSR]: https://jsr.io/@fedify/pglite
[`PgliteKvStore`]: https://jsr.io/@fedify/pglite/doc/~/PgliteKvStore
[`AtomicKvStore`]: https://jsr.io/@fedify/fedify/doc/federation/~/AtomicKvStore
[PGlite issue #489]: https://github.com/electric-sql/pglite/issues/489#issuecomment-2587892190
[PGlite pull request #892]: https://github.com/electric-sql/pglite/pull/892


Installation
------------

~~~~ sh
npm  add     @fedify/pglite @electric-sql/pglite      # npm
pnpm add     @fedify/pglite @electric-sql/pglite      # pnpm
yarn add     @fedify/pglite @electric-sql/pglite      # Yarn
bun  add     @fedify/pglite @electric-sql/pglite      # Bun
deno add jsr:@fedify/pglite npm:@electric-sql/pglite  # Deno
~~~~


Atomic operations
-----------------

Since Fedify 2.5.0, `PgliteKvStore` implements `AtomicKvStore`.  Use
`getMany()` for an ordered snapshot and `casMany()` to compare and change
related keys together.  A comparison mismatch returns `false` without changing
values or TTLs; reread and re-evaluate the application rule before retrying.
`setMany()` and `deleteMany()` also commit as complete batches.

For example, compare a generation and its associated state before replacing
both.  The application computes the replacement from its own rule:

~~~~ typescript
const store = new PgliteKvStore(pg);
const keys = [["example", "generation"], ["example", "state"]] as const;
const [generation, state] = await store.getMany(keys);
const committed = await store.casMany([
  { key: keys[0], expectedValue: generation, newValue: crypto.randomUUID() },
  { key: keys[1], expectedValue: state, newValue: { status: "ready" } },
]);
~~~~

All wrappers for a table must share one caller-owned PGlite instance.  Each
batch uses PGlite's transaction callback, which excludes other normal queries
and transactions on that instance, including when a compared key is absent.
Do not call store methods from inside the owner's transaction callback, issue
manual transaction commands, or use concurrent raw protocol operations.
Independent PGlite owners and processes must not open the same data directory.
The standard text-array and JSONB codecs are required; custom parser or
serializer overrides are outside this guarantee.

Values use `JSON.stringify()` followed by PostgreSQL JSONB input, and CAS uses
JSONB equality.  Object member order is ignored and array order matters.
JSON `null` remains a value; `undefined` checks absence or deletes in CAS and
cannot be stored.  JSON serialization can omit unsupported object properties
or convert nonfinite numbers to `null`; cyclic values and `bigint` reject.
JSONB also rejects U+0000 and invalid surrogate sequences.  Keys must contain
one or more well-formed Unicode strings without U+0000.  Mutation batches
reject duplicate keys and sparse inputs before writing.

Each entry has its own TTL, and every operation uses one transaction-start
expiry cutoff.  Omitting a replacement TTL clears the previous expiry.  Zero
TTL expires immediately; negative durations reject, as do durations whose
addition exceeds the timestamp range.  TTL uses PostgreSQL calendar intervals
with microsecond rounding and the session time zone; the host clock may have
only millisecond resolution.  CAS deletion must not specify a non-null TTL.

There is no fixed adapter batch-entry limit.  Statements run sequentially in
one transaction, so a large batch occupies the shared instance and consumes
memory proportional to its input and results.  New keys are subject to the
engine's B-tree entry limit, about 2700 bytes after compression with its default
8 KiB pages; this is a storage constraint rather than an adapter input cap.
A mismatching CAS batch can return `false` without attempting an insertion or
proving that insertion would fit.  An insertion error that actually occurs
rejects and rolls back the complete batch.  Deterministically invalid keys,
JSONB values and TTLs still reject even on a comparison mismatch.

Atomic execution does not promise crash durability or exactly-once effects.
The supported scope is a normal PGlite instance on Node.js, Bun, or Deno,
using memory or the host filesystem.  Worker proxies and browser persistence
are outside this scope.  Host-filesystem storage supports clean close/reopen;
memory-only instances remain ephemeral.  After a mutation transaction completes,
the adapter awaits the owner's `syncToFs()` outside the transaction, preserving
the synchronization policy previously used by `set()`, `delete()`, and `cas()`.
PGlite 0.5.8 does not perform that post-commit synchronization itself.
The owner's filesystem and `relaxedDurability` setting determine what this
call guarantees.  A synchronization failure rejects after the changes have
committed; it cannot roll them back.  A lost response or commit failure can
also leave commit status unknown.  Do not
automatically replay an uncertain change; use a non-reused version or an
operation receipt when the application needs it.

Mutation housekeeping is part of the same transaction.  A legacy row with an
overflowing TTL can make expiry cleanup fail; other mutations then roll back
until all offending keys are removed together with `deleteMany()` or direct
SQL.  Inspect the raw key, creation time, and TTL columns through direct SQL
without adding the TTL.  Malformed legacy keys, such as empty arrays or SQL
null segments, require direct SQL remediation.
