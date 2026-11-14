@fedify/postgres: PostgreSQL drivers for Fedify
===============================================

[![npm][npm badge]][npm]
[![JSR][JSR badge]][JSR]

This package provides [Fedify]'s [`KvStore`] and [`MessageQueue`]
implementations for PostgreSQL:

 -  [`PostgresKvStore`]
 -  [`PostgresMessageQueue`]

~~~~ typescript
import { createFederation } from "@fedify/fedify";
import { PostgresKvStore, PostgresMessageQueue } from "@fedify/postgres";
import postgres from "postgres";

const sql = postgres("postgresql://user:password@localhost/dbname");

const federation = createFederation({
  kv: new PostgresKvStore(sql),
  queue: new PostgresMessageQueue(sql),
});
~~~~

`PostgresKvStore` uses a crash-safe logged table by default.  For transient
data where losing the table contents after a PostgreSQL crash is acceptable,
pass `{ unlogged: true }` as its second constructor argument.

When a store created by an earlier version still uses an unlogged table, its
next initialization converts that table to logged storage.  PostgreSQL rewrites
the table and takes an `ACCESS EXCLUSIVE` lock during this one-time migration,
so schedule the upgrade accordingly for a large or busy table.

Expiry cleanup can use an expression index without changing the table schema.
New empty tables receive it automatically with a pooled client.  Existing
populated tables and deployments using `initialized: true` need an explicit
index migration.  See the [expiry-index guide] for concurrent index creation,
rolling upgrades, and calendar-time semantics.

[npm badge]: https://img.shields.io/npm/v/@fedify/postgres?logo=npm
[npm]: https://www.npmjs.com/package/@fedify/postgres
[JSR badge]: https://jsr.io/badges/@fedify/postgres
[JSR]: https://jsr.io/@fedify/postgres
[Fedify]: https://fedify.dev/
[`KvStore`]: https://jsr.io/@fedify/fedify/doc/federation/~/KvStore
[`MessageQueue`]: https://jsr.io/@fedify/fedify/doc/federation/~/MessageQueue
[`PostgresKvStore`]: https://jsr.io/@fedify/postgres/doc/~/PostgresKvStore
[`PostgresMessageQueue`]: https://jsr.io/@fedify/postgres/doc/~/PostgresMessageQueue
[expiry-index guide]: https://fedify.dev/manual/kv#postgresql-expiry-index


Installation
------------

~~~~ sh
npm  add     @fedify/postgres  # npm
pnpm add     @fedify/postgres  # pnpm
yarn add     @fedify/postgres  # Yarn
bun  add     @fedify/postgres  # Bun
deno add jsr:@fedify/postgres  # Deno
~~~~


Atomic key–value operations
---------------------------

Since Fedify 2.5.0, `PostgresKvStore` implements `AtomicKvStore`.  Keys in one
configured ordinary table or declarative partition form its atomic scope.
Ordinary inheritance parents and children are unsupported for nonempty batches.
Nonempty batches also reject tables where row-level security is active for the
current role, since policies can filter individual mutations.
The table must retain the adapter's `text[]` primary key and compatible schema;
concurrent incompatible schema changes are outside this scope.

~~~~ typescript
const store = new PostgresKvStore(sql);
const keys = [["notice"], ["budget"]] as const;
const [notice, budget] = await store.getMany(keys);
const committed = await store.casMany([
  { key: keys[0], expectedValue: notice, newValue: { version: 1 } },
  { key: keys[1], expectedValue: budget, newValue: 10 },
]);
// On false, read again and re-evaluate the application rule.
~~~~

`getMany()` reads one input-ordered snapshot, including repeated keys.  Missing
and logically expired keys return `undefined`; stored JSON `null` stays `null`.
`setMany()` and `deleteMany()` change the entire batch.  `casMany()` changes
all entries only when every expectation matches.  Mutation keys must be
distinct; batch arrays and nonempty string-array keys must not contain holes.
Key strings must be representable as PostgreSQL Unicode text. `set()` and
`setMany()` reject `undefined`; in CAS, it means absence or deletion. A
deletion cannot specify a non-null TTL, even when another comparison mismatches.

### Clients and transactions

Nonempty `casMany()` and `deleteMany()` with more than one key require a pool
or a transaction-scoped Postgres.js client at `READ COMMITTED` isolation
(`READ UNCOMMITTED` has the same PostgreSQL behavior).  Reserved connections
reject these calls before issuing SQL, whether or not a manual transaction is
open.  Reserved clients still support ordinary methods, `getMany()`,
`setMany()`, single-key `deleteMany()`, and all empty batches.  Method presence
alone does not establish support for every client scope.

Caller-owned transactions require exclusive, sequential use for the duration
of each atomic call, including initialization, other store wrappers, and raw
SQL.  Await one call before issuing another command on that transaction.
Nested savepoints do not isolate overlapping operations in one outer
transaction. Successful calls remain provisional until the outer commit.  The
adapter does not commit, roll back, or release that outer transaction.

Mutating forms of `cas()` acquire the table write lock and use one server
timestamp for comparison and the replacement's TTL origin.  A `cas()` from
`undefined` to `undefined` stays read-only.  If a trigger skips a matching
write, the call rejects and rolls back its database effects; `false` means only
a comparison mismatch.  `cas()` owns a transaction on pooled clients and uses a
savepoint on transaction-scoped clients.  Reserved clients use a savepoint
inside an existing manual transaction or a transaction owned by the call.
Caller transaction isolation is unchanged.  Use reserved clients exclusively
and sequentially during the call.  CAS locks in caller-owned transactions
remain until the outer commit, including after a mismatch.

Conditional batches and multi-key deletions acquire a [table write lock] before
a fresh comparison/deletion snapshot.  This protects absent keys against
ordinary and direct SQL writers, but serializes all writes to the table and its
descendants.  Successful caller batches retain locks until the outer transaction
ends.  A mismatch rolls back locks acquired in its savepoint; earlier writes
or setup can still retain locks.  Prior caller writes can cause lock-upgrade
deadlocks; roll back the outer transaction before retrying the deciding work.
Database errors and configured lock timeouts reject; the adapter does not retry.
Frequent conflicting locks can also interrupt [ordinary autovacuum].

With `initialized: false`, caller-owned batches repeat idempotent table setup
and driver probing because an outer rollback can undo earlier DDL.  Setup runs
before the batch savepoint, so a setup error can abort the caller transaction.
With `initialized: true`, providing the schema remains the caller's
responsibility. Pooled batch mutations and mutating forms of `cas()` on pooled
clients start best-effort expiry cleanup after commit.  Caller-owned batches
and caller-owned `cas()` calls do not sweep expired rows.  Logical expiry is
independent of cleanup.

[table write lock]: https://www.postgresql.org/docs/18/sql-lock.html
[ordinary autovacuum]: https://www.postgresql.org/docs/18/routine-vacuuming.html#AUTOVACUUM

### Values, expiry, and limits

Values use JavaScript JSON encoding and PostgreSQL [`jsonb` equality].  Object
member order is ignored; array order matters.  Dates and `toJSON()` values are
normalized, and nonfinite numbers become JSON `null`.  Big integers, circular
values, unencodable top-level values, NUL characters, and malformed Unicode
reject.  Use passive inputs and the default value codec; irreversible JSON/value
transforms, including property-name changes in nested JSON, are outside the
atomic codec scope.  Table identifier transforms remain supported.  Raw SQL
values must round-trip through the JavaScript JSON codec to be usable as CAS
expectations.

TTLs use the server clock, PostgreSQL intervals, and microsecond precision.
Calendar days/months follow the session timezone.  Each operation uses one
expiry cutoff; a replacement without a TTL clears the old expiry.  Zero
durations expire immediately; negative Temporal durations reject.  A write
waiting on another transaction can have a TTL origin earlier than its commit.
Unrepresentable JSON or TTLs reject even on comparison mismatch.

There is no fixed adapter batch-count or key-length maximum.  PostgreSQL field,
index, protocol, and available-memory constraints still apply; calls are never
split to fit them.  A physical index-size error can arise only when a write is
attempted: a mismatch performs no insertion and returns `false`, while an
attempted write that fails rolls back the complete batch.  Explicit invalid
input and unsupported scopes always reject.

Atomicity does not change durability.  Unlogged tables are crash-truncated and
not replicated; logged tables still depend on server WAL, `synchronous_commit`,
storage, and replica settings.  A lost commit response can leave the outcome
unknown.  Use application versions for ABA detection and receipts for external
effects.

[`jsonb` equality]: https://www.postgresql.org/docs/18/datatype-json.html
