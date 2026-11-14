@fedify/cfworkers: Adapt Fedify with Cloudflare Workers
=======================================================

[![npm][npm badge]][npm]
[![JSR][JSR badge]][JSR]
[![@fedify@hackers.pub][@fedify@hackers.pub badge]][@fedify@hackers.pub]

*This package is available since Fedify 1.9.0.*

This package provides [Fedify]'s [`KvStore`] and [`MessageQueue`]
implementations for [Cloudflare Workers]:

 -  [`WorkersD1KvStore`]
 -  [`WorkersKvStore`]
 -  [`WorkersMessageQueue`]

~~~~ typescript
import { createFederation, type Message } from "@fedify/fedify";
import { WorkersD1KvStore, WorkersMessageQueue } from "@fedify/cfworkers";

export default {
  async fetch(request, env, ctx) {
    const federation = createFederation({
      kv: new WorkersD1KvStore(env.DB_BINDING, { initialized: true }),
      queue: new WorkersMessageQueue(env.QUEUE_BINDING),
      // ... other options
    });

    return federation.fetch(request, { contextData: env });
  },

  async queue(batch, env, ctx) {
    const federation = createFederation({
      kv: new WorkersD1KvStore(env.DB_BINDING, { initialized: true }),
      queue: new WorkersMessageQueue(env.QUEUE_BINDING),
      // ... other options
    });

    for (const message of batch.messages) {
      await federation.processQueuedTask(
        env,
        message.body as unknown as Message,
      );
    }
  }
} satisfies ExportedHandler<{
  DB_BINDING: D1Database;
  QUEUE_BINDING: Queue;
}>;
~~~~

[npm badge]: https://img.shields.io/npm/v/@fedify/cfworkers?logo=npm
[npm]: https://www.npmjs.com/package/@fedify/cfworkers
[JSR badge]: https://jsr.io/badges/@fedify/cfworkers
[JSR]: https://jsr.io/@fedify/cfworkers
[@fedify@hackers.pub badge]: https://fedi-badge.minhee.org/@fedify@hackers.pub/followers.svg
[@fedify@hackers.pub]: https://hackers.pub/@fedify
[Fedify]: https://fedify.dev/
[`KvStore`]: https://jsr.io/@fedify/fedify/doc/federation/~/KvStore
[`MessageQueue`]: https://jsr.io/@fedify/fedify/doc/federation/~/MessageQueue
[Cloudflare Workers]: https://workers.cloudflare.com/
[`WorkersD1KvStore`]: https://jsr.io/@fedify/cfworkers/doc/~/WorkersD1KvStore
[`WorkersKvStore`]: https://jsr.io/@fedify/cfworkers/doc/~/WorkersKvStore
[`WorkersMessageQueue`]: https://jsr.io/@fedify/cfworkers/doc/~/WorkersMessageQueue


`WorkersD1KvStore`
------------------

*This API is available since Fedify 2.5.0.*

`WorkersD1KvStore` is a key–value store implementation for
[Cloudflare Workers] that uses [Cloudflare D1].  D1 is strongly consistent,
which suits Fedify's balanced read and write workload, and
`WorkersD1KvStore` implements `AtomicKvStore`, including atomic snapshots and
conditional multi-key writes.  It is the
recommended key–value store for Cloudflare Workers applications.

Without `initialized: true`, each store instance creates and checks its schema
on first use.  The entry table is `fedify_kv` by default, configurable with
`tableName`; `<tableName>_atomic` and `idx_<tableName>_expires` are reserved
auxiliary names.  The entry table must have a single-column `key` primary
index using `BINARY` collation, so differently cased keys remain distinct.
Automatic initialization rejects incompatible primary indexes.  Key lookups,
mutations, and listing explicitly use binary comparisons even if the column
declares another collation.  Table names ending in `_atomic` are rejected.  In
production, create both tables and the index with [D1 migrations], then pass
`initialized: true` to avoid repeating schema queries per request:

~~~~ sql
CREATE TABLE IF NOT EXISTS fedify_kv (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  expires INTEGER
);
CREATE INDEX IF NOT EXISTS idx_fedify_kv_expires ON fedify_kv (expires);
CREATE TABLE IF NOT EXISTS fedify_kv_atomic (
  singleton INTEGER PRIMARY KEY,
  cutoff INTEGER NOT NULL,
  matched INTEGER NOT NULL
);
~~~~

Pass the `D1Database` binding itself for fresh primary reads.  A caller-owned
D1 session provides sequential consistency, but `get()` and `getMany()` may
read stale replicas.  `first-primary` affects only the session's first query;
it does not pin later reads to the primary.  CAS uses a write transaction
with either input.  The adapter keeps the caller's session and does not call
`withSession()` on its behalf.

Atomic operations cover all keys in one configured table in one D1 database.
`getMany()` reads one snapshot and preserves input order, missing values and
duplicate keys.  `setMany()`, `deleteMany()` and `casMany()` commit each batch
as a unit; `casMany()` compares every expectation before changing any entry.
Single-key `set()` and `cas()` use the same guard protocol.  Each nonempty
set or CAS writes and removes a private guard row, including absence-only
CAS.  A mismatch leaves all user values and TTLs unchanged.  Backend errors
reject, and a lost response can leave commit status unknown.  Re-read and
re-evaluate the application rule after a mismatch; include a non-reused
version in values if ABA changes must be detected.

Values use `JSON.stringify()`/`JSON.parse()`, including their coercions:
nonfinite numbers become `null`, and undefined object members are omitted.
Top-level `undefined` is only an absence/deletion sentinel in CAS; it cannot
be stored.  Functions, symbols, cycles and `BigInt` values without a JSON
serialization reject.  CAS compares the persisted JSON structurally, ignoring
object member order while retaining array order and types.  Values deeper
than SQLite's 1,000-level JSON limit use exact serialized comparison instead.
External guard writes, triggers and custom constraints that alter the
protocol, and raw JSON rows with duplicate object members, are unsupported.

TTLs use one database-clock cutoff per operation and are truncated to integer
milliseconds.  Nonpositive durations, including positive durations shorter
than one millisecond after truncation, expire immediately.  Durations whose
absolute total exceeds `8.64e15` milliseconds, nonfinite totals, and calendar
durations requiring a reference date reject.  Replacing without a TTL clears
the previous expiry.  Successful sets and CAS also purge up to 100 entries
expired at the same cutoff; a mismatch does not run that cleanup.

Snapshots accept up to 256 input keys, counting duplicates.  Their separate
8 MiB byte budget counts encoded keys and values once per unique, live row;
missing and expired keys contribute no bytes to that budget.  For maximum-size
values, the byte budget usually binds first.  Mutations accept up to 128
entries and 16 MiB of encoded keys, expectations and replacements combined.
Each encoded key/value row and each bound string is limited to 1,999,000 UTF-8
bytes.  `getMany()` and `deleteMany()` keys also have a 1,999,000-byte
aggregate encoded-key limit, and the final escaped JSON key payload must fit
the same limit.  Oversized operations reject without splitting; backend or
runtime limits can also reject smaller calls.

[Cloudflare D1]: https://developers.cloudflare.com/d1/
[D1 migrations]: https://developers.cloudflare.com/d1/reference/migrations/


`WorkersKvStore`
----------------

`WorkersKvStore` is a key–value store implementation for [Cloudflare Workers]
that uses Cloudflare's built-in [Cloudflare Workers KV] API.  It provides
persistent storage with fast reads.  However, Workers KV is tuned for
read-heavy workloads and is eventually consistent, and `WorkersKvStore` does
not support `cas()`.  Prefer `WorkersD1KvStore` for new applications.

[Cloudflare Workers KV]: https://developers.cloudflare.com/kv/


`WorkersMessageQueue`
---------------------

`WorkersMessageQueue` is a message queue implementation for [Cloudflare Workers]
that uses Cloudflare's built-in [Cloudflare Queues] API.  It provides
scalability and high performance, making it suitable for production use in
Cloudflare Workers environments.  It requires a Cloudflare Queues setup and
management.

> [!NOTE]
> Since your `D1Database` and `Queue` are not bound to global variables, but
> rather passed as arguments to the `fetch()` and `queue()` methods, you need
> to instantiate your `Federation` object inside these methods, rather than at
> the top level.
>
> For better organization, you probably want to use a builder pattern to
> register your dispatchers and listeners before instantiating the `Federation`
> object.

> [!NOTE]
> The [Cloudflare Queues] API does not provide a way to poll messages from
> the queue, so `WorkersMessageQueue.listen()` method always throws
> a `TypeError` when invoked.  Instead, you should define a `queue()` method
> in your Cloudflare worker, which will be called by the Cloudflare Queues
> API when new messages are available in the queue.  Inside the `queue()`
> method, you need to call `Federation.processQueuedTask()` method to manually
> process the messages.  The `queue()` method is the only way to consume
> messages from the queue in Cloudflare Workers.

> [!NOTE]
> If you use `orderingKey` when enqueueing messages, construct
> `WorkersMessageQueue` with an `orderingKv` namespace and pass each raw queue
> message through `WorkersMessageQueue.processMessage()` before calling
> `Federation.processQueuedTask()`.  This acquires and releases the best-effort
> ordering lock for that key.  You can also customize the lock behavior with
> the `orderingKeyPrefix` and `orderingLockTtl` options.

[Cloudflare Queues]: https://developers.cloudflare.com/queues/


Installation
------------

~~~~ sh
npm  add     @fedify/cfworkers  # npm
pnpm add     @fedify/cfworkers  # pnpm
yarn add     @fedify/cfworkers  # Yarn
bun  add     @fedify/cfworkers  # Bun
deno add jsr:@fedify/cfworkers  # Deno
~~~~
