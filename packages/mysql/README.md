@fedify/mysql: MySQL/MariaDB drivers for Fedify
===============================================

[![npm][npm badge]][npm]
[![JSR][JSR badge]][JSR]

This package provides [Fedify]'s [`KvStore`] and [`MessageQueue`]
implementations for MySQL/MariaDB:

 -  [`MysqlKvStore`]
 -  [`MysqlMessageQueue`]

~~~~ typescript
import { createFederation } from "@fedify/fedify";
import { MysqlKvStore, MysqlMessageQueue } from "@fedify/mysql";
import mysql from "mysql2/promise";

const pool = mysql.createPool("mysql://user:password@localhost/dbname");

const federation = createFederation({
  kv: new MysqlKvStore(pool),
  queue: new MysqlMessageQueue(pool),
});
~~~~

[npm badge]: https://img.shields.io/npm/v/@fedify/mysql?logo=npm
[npm]: https://www.npmjs.com/package/@fedify/mysql
[JSR badge]: https://jsr.io/badges/@fedify/mysql
[JSR]: https://jsr.io/@fedify/mysql
[Fedify]: https://fedify.dev/
[`KvStore`]: https://jsr.io/@fedify/fedify/doc/federation/~/KvStore
[`MessageQueue`]: https://jsr.io/@fedify/fedify/doc/federation/~/MessageQueue
[`MysqlKvStore`]: https://jsr.io/@fedify/mysql/doc/~/MysqlKvStore
[`MysqlMessageQueue`]: https://jsr.io/@fedify/mysql/doc/mq/~/MysqlMessageQueue


Installation
------------

~~~~ sh
npm  add     @fedify/mysql mysql2       # npm
pnpm add     @fedify/mysql mysql2       # pnpm
yarn add     @fedify/mysql mysql2       # Yarn
bun  add     @fedify/mysql mysql2       # Bun
deno add jsr:@fedify/mysql              # Deno
~~~~


Atomic key-value operations
---------------------------

Since Fedify 2.5.0, `MysqlKvStore` implements `AtomicKvStore`.  Use `getMany()`
to read related keys from one snapshot, `setMany()` or `deleteMany()` to change
them together, and `casMany()` to commit only when every expectation matches.
Single-key `cas()` follows the same rules as `casMany()`.  After a `false`
result, read again and re-evaluate the application rule before retrying.

~~~~ typescript
const store = new MysqlKvStore(pool);
await store.setMany([
  { key: ["cursor"], value: 0 },
  { key: ["budget"], value: 10 },
]);
const [cursor, budget] = await store.getMany<number>([["cursor"], ["budget"]]);
const committed = await store.casMany([
  { key: ["cursor"], expectedValue: cursor, newValue: (cursor ?? 0) + 1 },
  { key: ["budget"], expectedValue: budget, newValue: (budget ?? 0) - 1 },
]);
~~~~

### Scope and configuration

All keys in the same primary database and table share an atomic scope across
independent pools and processes.  Each operation runs in its own transaction on
one pooled connection, with explicit `REPEATABLE READ` isolation. `get()` uses
the same snapshot transaction as `getMany()`, so reads now require transaction
setup and commit round trips.  Successive calls do not form one transaction.  A
failed commit response can leave its outcome unknown; use a non-reused version
or an application receipt before repeating external effects. Crash durability
depends on the server and storage configuration.

Use a normal mysql2 pool with `autocommit` enabled, object rows and default type
casting.  The `jsonStrings` option is supported.  Do not supply connections
already in caller-owned transactions, share borrowed connections with raw SQL,
or route reads to replicas.  All cooperating clients must use the same
fixed-offset or UTC session `time_zone`; `DATETIME` expiry values do not carry
a time zone.  `NO_BACKSLASH_ESCAPES`, custom `typeCast`, and `rowsAsArray` are
unsupported.  Keep server settings and the table schema stable while stores
are in use.  `initialize()` and `drop()` must not overlap other operations.

Initialization requires an InnoDB base table with the adapter's schema: a
`VARCHAR(768)` key in `utf8mb4_bin`, a full-column primary `BTREE` index with
no other unique indexes, a non-null native JSON or `utf8mb4` `LONGTEXT` value,
and a nullable `DATETIME(6)` expiry.  It rejects incompatible existing tables
instead of migrating them.  `initialized: true` skips DDL, but still requires
metadata visibility for schema validation.  Custom pool-like objects must
provide mysql2's connection `destroy()` method.  The legacy
`innodb_locks_unsafe_for_binlog` setting must be disabled if present.

### Values, TTLs and limits

Values use `JSON.stringify()` on write and `JSON.parse()` on every read path,
including `list()`.  JSON primitives, arrays and objects round-trip; dates and
`toJSON()` values follow normal JSON conversion.  Unsupported object members
are omitted, unsupported array members and non-finite numbers become `null`,
and cycles, `BigInt` and values without a root JSON representation reject.
`set(key, undefined)` now rejects; use `delete()` instead.  CAS compares decoded
values with `isEqual()`, ignoring object member order and preserving array
order and type distinctions.  Expectations are not JSON-normalized: use the ISO
string returned by `get()` as the expected value for a stored date, rather than
a `Date`. Do not mutate expected values while an operation is pending.

Each batch accepts at most 1,000 input entries, including repeated keys in a
read.  Mutation keys must be distinct.  A JSON-serialized key, including its
punctuation and escapes, has at most 768 Unicode code points.  Server packet,
JSON nesting, transaction and runtime resource limits also apply.  Operations
reject rather than split a batch to fit a limit.

A stored `null` is distinct from absence.  Expired entries count as absent;
`expectedValue: undefined` checks absence and `newValue: undefined` deletes.
Deletion rejects a non-null TTL, even when an expectation would mismatch.
Each replacement has its own TTL; omitting it clears previous expiry.  TTLs
are truncated to safe integer microseconds, approximately ±285 years; larger
or server-unrepresentable durations reject.  Calendar units use the current
local date for conversion.  Non-positive TTLs expire immediately.  One
server cutoff applies to each attempt: CAS captures it after acquiring all
locks, and unconditional writes capture it before any write-side lock waits, so
a short TTL can already have elapsed at commit.

### Conflicts and cleanup

CAS locks physical rows and absent key ranges before comparing.  Expired rows
remain locked, and all expectations match before the first mutation.  Deadlocks
(`1213`) and MariaDB snapshot conflicts (`1020`) retry the whole transaction,
with fresh comparisons and cutoff, for at most five total attempts.  Other
backend errors reject.  Lock timeout `1205` rejects after rollback; disabling
`innodb_deadlock_detect` can turn contention into such timeouts.  A comparison
mismatch alone returns `false` and preserves values and TTLs.

Expiry cleanup runs after commit and after releasing the transaction's
connection.  It is awaited and may wait for the server's lock timeout, but its
failures are logged without changing the committed result.  The existing
`expireCleanupRate` option controls this housekeeping cost; `0` disables it.
Logical expiry works regardless of physical cleanup.
