---
links:
  '#1135': https://github.com/fedify-dev/fedify/issues/1135
  '#1360': https://github.com/fedify-dev/fedify/pull/1360
---
 -  Added `WorkersD1KvStore`, a `KvStore` implementation backed by
    Cloudflare D1.  Fedify writes to its key–value store about as often as it
    reads from it, and some of its records, such as idempotency records and
    signature nonces, need strong consistency, which Workers KV does not
    provide.  `WorkersD1KvStore` is strongly consistent and supports `cas()`,
    so features that need atomic updates no longer fall back to non-atomic
    code paths.  It is now the recommended `KvStore` for Cloudflare Workers;
    consider migrating from `WorkersKvStore`.
    [[#1135], [#1360] by Beiyan Yunyi]

    Pass the `D1Database` binding itself, since D1 sessions can read stale
    data from replicas.  Because the store is constructed per request, create
    its table with a D1 migration and pass `initialized: true` in production
    to avoid an extra query per request.
