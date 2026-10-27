---
links:
  '#1309': https://github.com/fedify-dev/fedify/issues/1309
  '#1334': https://github.com/fedify-dev/fedify/pull/1334
---
 -  Added an expression index for `PostgresKvStore` expiry cleanup, avoiding a
    full-table scan when few or no entries have expired.  Empty tables receive
    the index automatically with pooled clients.  For existing populated tables
    or `initialized: true`, follow the [index migration guide].  Old and new
    versions can share the indexed table.  Logical TTL behavior is unchanged;
    calendar intervals can delay physical deletion in non-UTC sessions.  Once
    the index exists, writes whose expiration overflows PostgreSQL's timestamp
    range fail atomically, including writes from older versions.
    [[#1309], [#1334]]

[index migration guide]: https://fedify.dev/manual/kv#postgresql-expiry-index
