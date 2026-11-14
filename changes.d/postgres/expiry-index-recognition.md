---
links:
  '#1309': https://github.com/fedify-dev/fedify/issues/1309
  '#1435': https://github.com/fedify-dev/fedify/pull/1435
---
 -  Fixed `PostgresKvStore.initialize()` creating a duplicate expiry index on
    PostgreSQL 18.7 when a valid, manually created `AT TIME ZONE` expiry index
    already exists.
    [[#1309], [#1435]]
