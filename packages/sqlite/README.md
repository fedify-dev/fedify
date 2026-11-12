@fedify/sqlite: SQLite drivers for Fedify
=========================================

[![npm][npm badge]][npm]
[![JSR][JSR badge]][JSR]

This package provides a SQLite-based [`AtomicKvStore`] implementation for
[Fedify], with a message queue for the same database backend.

[npm badge]: https://img.shields.io/npm/v/@fedify/sqlite?logo=npm
[npm]: https://www.npmjs.com/package/@fedify/sqlite
[JSR badge]: https://jsr.io/badges/@fedify/sqlite
[JSR]: https://jsr.io/@fedify/sqlite
[`AtomicKvStore`]: https://jsr.io/@fedify/fedify/doc/federation/~/AtomicKvStore
[Fedify]: https://fedify.dev/


Usage
-----

### Node.js

~~~~ typescript
import { DatabaseSync } from 'node:sqlite';
import { SqliteKvStore } from '@fedify/sqlite';

const db = new DatabaseSync('./data.db');
const store = new SqliteKvStore(db);
~~~~

### Bun

~~~~ typescript
import { Database } from 'bun:sqlite';
import { SqliteKvStore } from '@fedify/sqlite';

const db = new Database('./data.db');
const store = new SqliteKvStore(db);
~~~~

### Deno

~~~~ typescript
import { DatabaseSync } from 'node:sqlite';
import { SqliteKvStore } from '@fedify/sqlite';

const db = new DatabaseSync('./data.db');
const store = new SqliteKvStore(db);
~~~~


Atomic operations
-----------------

Since Fedify 2.5.0, `SqliteKvStore` supports consistent `getMany()` snapshots,
`setMany()` writes, `deleteMany()` deletions, and conditional `casMany()`
batches. For example, two counters can advance together only if neither has
changed since the snapshot:

~~~~ typescript
const keys = [["example", "first"], ["example", "second"]] as const;
const before = await store.getMany<number>(keys);
const committed = await store.casMany(keys.map((key, index) => ({
  key,
  expectedValue: before[index],
  newValue: (before[index] ?? 0) + 1,
})));
~~~~

On `false`, read another snapshot and re-evaluate the application rule.
`undefined` means absence when expected and deletion when supplied as a new CAS
value.  `set(key, undefined)` now rejects; use `delete()` or `deleteMany()`
instead.  A CAS deletion with a non-null TTL also rejects, even on mismatch.
Mutation batches reject duplicate keys, and all batches reject sparse arrays.
Empty batches return immediately without accessing the database.

### Scope and contention

An atomic call covers all its keys in the configured table of one SQLite
database, including competing handles to that database.  It does not span
files or separate calls.  Each nonempty batch and ordinary mutation owns one
[immediate transaction], with no independently committed chunks.  These calls
require a writable connection with normal SQLite locking and journaling.
Read-only and `query_only` connections reject, including on a CAS mismatch.
Ordinary `get()` and `list()` retain their single-statement behavior.

Do not wrap batch or mutation methods in a caller-owned transaction; they
reject without rolling it back.  Run `initialize()` outside caller transactions
before using ordinary reads there, so a caller rollback cannot undo lazy schema
initialization.  Inputs must be immutable, passive data without getters,
proxies, or serialization hooks that reenter the store during an operation.

Snapshots and mismatching CAS calls also reserve the writer slot.  They can
reject with `SQLITE_BUSY` due to writers or, in rollback-journal mode, readers
preventing transaction completion.  The store performs no retries and does not
change connection settings.  Configure a [busy timeout] for deployments with
multiple connections; a timeout can still expire.  A backend error rejects;
`false` means a comparison mismatch whose transaction completed successfully.

There is no fixed entry-count limit.  Each statement binds a constant number
of parameters, but SQLite's configured string/row limits and available memory
and disk still apply.  Exceeded limits and backend failures reject the complete
operation rather than split it into smaller commits.

[immediate transaction]: https://sqlite.org/lang_transaction.html#deferred_immediate_and_exclusive_transactions
[busy timeout]: https://sqlite.org/c3ref/busy_timeout.html

### Values and expiry

Values use `JSON.stringify()` and `JSON.parse()`.  Use JSON data: top-level
`undefined`, functions, symbols, cycles and BigInt cannot be stored.  Other JSON
conversions still apply, such as dates becoming strings, nonfinite numbers
becoming `null`, and undefined object members disappearing.  CAS compares the
decoded stored value structurally against the raw expectation, ignoring object
member order.  Use the decoded shape, for example a value returned by
`getMany()`: a `Date` is different from its stored string, and
`{ omitted: undefined }` is different from `{}`.

One millisecond-resolution clock cutoff determines all reads, comparisons,
expiries and cleanup in an operation.  TTLs preserve representable fractional
milliseconds; zero and negative TTLs expire immediately.  Expiry at the cutoff
counts as absence.  A replacement without a TTL clears its previous expiry.
Calendar durations requiring a reference date reject, as do nonfinite TTLs,
TTL magnitudes above `8.64e15` milliseconds, and expiry timestamps outside the
safe numeric range.  A mismatch preserves all existing values and TTLs.

### Journaling and durability

Atomicity does not promise survival of power loss or exactly-once external
effects.  Durability depends on the application's journal and `synchronous`
settings, filesystem and hardware.  Disabled journaling, shared-cache dirty
reads, immutable or `nolock` configurations, and broken filesystem locking
are outside the supported atomic scope.

For concurrent WAL use, choose a SQLite build with the [WAL-reset fix]
(3.51.3, or the 3.50.7/3.44.6 backports, or a verified equivalent fix).
Bun 1.2.22 bundles SQLite 3.50.4, so use a patched runtime for WAL writes or
checkpoints from multiple threads/processes.  This matters even if only the
queue configures WAL: `SqliteMessageQueue` enables WAL by default on its
database file, including a file shared with the KV store.  The queue has its
own busy-retry policy; the KV store has none.

[WAL-reset fix]: https://sqlite.org/wal.html#walresetbug
