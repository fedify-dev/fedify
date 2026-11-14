@fedify/redis: Redis drivers for Fedify
=======================================

[![npm][npm badge]][npm]
[![JSR][JSR badge]][JSR]

This package provides [Fedify]'s [`KvStore`] and [`MessageQueue`]
implementations for Redis:

 -  [`RedisKvStore`]
 -  [`RedisMessageQueue`]

~~~~ typescript
import { createFederation } from "@fedify/fedify";
import { RedisKvStore, RedisMessageQueue } from "@fedify/redis";
import { Redis, Cluster } from "ioredis";

// Using a standalone Redis instance:
const federation = createFederation({
  kv: new RedisKvStore(new Redis()),
  queue: new RedisMessageQueue(() => new Redis()),
});

// Using a Redis Cluster:
const federation = createFederation({
  kv: new RedisKvStore(new Cluster([
    { host: "127.0.0.1", port: 7000 },
    { host: "127.0.0.1", port: 7001 },
    { host: "127.0.0.1", port: 7002 },
  ])),
  queue: new RedisMessageQueue(() => new Cluster([
    { host: "127.0.0.1", port: 7000 },
    { host: "127.0.0.1", port: 7001 },
    { host: "127.0.0.1", port: 7002 },
  ])),
});
~~~~

[npm badge]: https://img.shields.io/npm/v/@fedify/redis?logo=npm
[npm]: https://www.npmjs.com/package/@fedify/redis
[JSR badge]: https://jsr.io/badges/@fedify/redis
[JSR]: https://jsr.io/@fedify/redis
[Fedify]: https://fedify.dev/
[`KvStore`]: https://jsr.io/@fedify/fedify/doc/federation/~/KvStore
[`MessageQueue`]: https://jsr.io/@fedify/fedify/doc/federation/~/MessageQueue
[`RedisKvStore`]: https://jsr.io/@fedify/redis/doc/kv/~/RedisKvStore
[`RedisMessageQueue`]: https://jsr.io/@fedify/redis/doc/mq/~/RedisMessageQueue


Installation
------------

~~~~ sh
npm  add     @fedify/redis  # npm
pnpm add     @fedify/redis  # pnpm
yarn add     @fedify/redis  # Yarn
bun  add     @fedify/redis  # Bun
deno add jsr:@fedify/redis  # Deno
~~~~


Atomic key–value operations
---------------------------

Since Fedify 2.5.0, `RedisKvStore` implements `AtomicKvStore` on official Redis
7.2.17, 7.4.12, and 8.10.3. Nonempty `getMany()`, `setMany()`, `deleteMany()`,
and `casMany()` calls reject on other releases before reading or writing.
The supported release list is deliberately exact: adding a Redis release
requires auditing its scripting and Cluster behavior and updating Fedify.
Ordinary single-key methods, including `cas()`, retain their existing Redis
version support. The version check does not authenticate the server; modified
engines, forks, script debugging, and module command hooks are outside the
atomic support scope.

On standalone Redis, an operation covers the selected database on the primary.
On Redis Cluster, all effective physical keys must share a hash slot in
database zero. Redis checks the slot after ioredis applies its client prefix.
A batch never splits into separate operations. Cross-slot calls reject even
when both slots belong to the same master.

For a new Cluster namespace, choose an explicit hash tag in the existing
`keyPrefix` option:

~~~~ typescript
import type { AtomicKvStore } from "@fedify/fedify";
import { RedisKvStore } from "@fedify/redis";
import { Cluster } from "ioredis";

const redis = new Cluster([{ host: "127.0.0.1", port: 7000 }]);
const store: AtomicKvStore = new RedisKvStore(redis, {
  keyPrefix: "{inventory}::",
});
const keys = [["available"], ["reserved"]] as const;
const [available, reserved] = await store.getMany<number>(keys);
if (available !== undefined && available > 0) {
  const committed = await store.casMany([
    { key: keys[0], expectedValue: available, newValue: available - 1 },
    { key: keys[1], expectedValue: reserved, newValue: (reserved ?? 0) + 1 },
  ]);
  // On false, an earlier attempt may have committed. Check a receipt or
  // version before re-evaluating the reservation rule (see below).
}
~~~~

The adapter preserves its key encoding and never adds a tag or relocates data.
Changing a prefix selects different keys; existing data needs an explicit
application migration. Hash tags affect routing, not key identity. Choose
prefixes whose encoded keys cannot overlap, such as `"{application}:one::"` and
`"{application}:two::"`. Redis uses the first `{` and the first following `}`:
an empty pair hashes the whole key rather than searching for a later tag. A tag
in the ioredis client's own `keyPrefix` can therefore take precedence over a
tag in the adapter's `keyPrefix`.

Each batch request is limited to 128 entries and 1 MiB of data, counting
effective physical key bytes, encoded expectations and replacements, and
argument strings. The fixed script and protocol framing are excluded. Oversized
calls reject without chunking. Keys in a mutating batch must be distinct; two
keys that encode to the same bytes count as duplicates. Repeated keys in
`getMany()` repeat the same snapshot value. Empty arrays are local no-ops;
`casMany([])` returns `true`. The bounds and the fixed scripts are part of the
atomicity guarantee, not throughput settings.

All values must round-trip through the selected codec. `JsonCodec` supports
JSON-representable values; it rejects top-level values that JSON cannot encode.
`undefined` is never stored, while `null` is a value. Single and batch CAS
compare encoded bytes, so JSON object property order matters. Custom codecs
must encode equal values deterministically; binary values and empty encoded
buffers are supported. A CAS `newValue` of `undefined` deletes the key, and a
non-null TTL on deletion rejects even when the comparison would mismatch.

TTLs round up to whole seconds with a minimum of one second, so zero and
negative durations keep a value for one second. A batch TTL must not exceed
2,147,483,647 seconds; this additional cap does not apply to single-key calls.
Replacing a value without a TTL clears its previous expiry. Redis checks expiry
against one server time throughout each batch. A mismatch leaves values and
their TTLs unchanged.

Scripts require `EVAL`, read access through `GET` or `EXISTS`, and the relevant
`SET`, `SETEX`, or `DEL` permissions for every key. Redis checks `EVAL`'s
read/write key access before entering the script, even for snapshots: key
patterns must grant both read and write access to every batch key. Inputs and
all command permissions are checked before application writes; Redis script
isolation is not rollback for a later command error. During Cluster resharding,
missing or expired keys can cause the whole call to reject with a routing
error. Under configured memory pressure, batch writes and deletes can reject
before any mutation; ordinary `delete()` remains available to free space.

Snapshots use primary routing even when the Cluster client's `scaleReads`
option selects replicas for ordinary reads. Prefix listing retains the
existing Cluster `SCAN` limitation: it can visit only part of the Cluster, and
its cursors have no slot affinity. `getMany()` snapshots only the requested
keys; it does not establish a snapshot of `list()`.

Separate calls do not form a transaction. The adapter adds no retry loop and
does not alter the supplied client's options. Batch scripts dispatch directly
and do not join ioredis's automatic pipelines. ioredis redirects and connection
replays can retry a request: a later CAS `false` reply does not establish that
an earlier transport attempt never committed. Re-read and re-evaluate after a
mismatch or uncertain response; use non-reused versions or receipts when the
application needs them. Atomicity does not imply crash or failover durability.
Configure Redis persistence, replication, and eviction for authoritative state;
a successful call alone does not make an external effect exactly once.

### Adapter verification

Set `REDIS_URL` to a standalone server URL and, for a disposable three-master
Cluster, `REDIS_CLUSTER_NODES` to comma-separated `host:port` addresses, then
run the package suites:

~~~~ sh
mise run test-each redis
~~~~

Conformance runs only on the supported releases. Node.js marks other releases
as skipped; Bun and Deno log the reason and return without running conformance.
A separate case still checks that every batch method rejects without changing
values or TTLs. Administrative tests require a dedicated Redis server at
`REDIS_ATOMIC_ADMIN_URL`, distinct from the server at `REDIS_URL`: they change
server-wide configuration. Cluster
administrative and migration tests additionally opt in through
`REDIS_ATOMIC_CLUSTER_ADMIN_NODES` and `REDIS_ATOMIC_MIGRATION_NODES`.
Run *src/kv.atomic-admin.test.ts* and the migration case in
*src/kv.atomic-cluster.test.ts* separately against an otherwise idle disposable
server or Cluster: they change ACLs, memory settings, or slot ownership, and
restore their state in cleanup. These tests do not establish replica-lag or
failover durability.

The `test-redis-atomic` CI matrix pins Redis 7.2.17, 7.4.12, and 8.10.3 and
uses dedicated standalone, administrative, and three-primary Cluster fixtures.
Each job runs Deno, Node.js, and Bun in sequence. It sets
`FEDIFY_REDIS_REQUIRE_ATOMIC_TESTS=true` so missing fixtures and unsupported
Redis versions fail instead of skipping the conformance tests. The isolated
configuration probes clear this flag while checking absent and blank fixture
settings. Under Node.js, the package's test files run sequentially so the
administrative and migration tests cannot interfere with each other.
