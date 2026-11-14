---
links:
  '#1361': https://github.com/fedify-dev/fedify/issues/1361
  '#1368': https://github.com/fedify-dev/fedify/issues/1368
  '#1433': https://github.com/fedify-dev/fedify/pull/1433
---
 -  Added `AtomicKvStore` support to `MysqlKvStore`: `getMany()`, `setMany()`,
    `deleteMany()`, and `casMany()` read or change related keys together on
    MySQL and MariaDB InnoDB tables.  [[#1361], [#1368], [#1433]]

    Single-key operations use the same transactions and JSON codec, so reads
    include transaction setup and commit round trips.  `set(key, undefined)`
    now rejects; use deletion instead.  Initialization validates the schema
    even with `initialized: true`, and custom pool connections need
    `destroy()`.  Use `autocommit`, default mysql2 decoding and one fixed-offset
    or UTC session time zone; `NO_BACKSLASH_ESCAPES` is unsupported.  Batches
    accept up to 1,000 entries and serialized keys up to 768 Unicode code
    points.  TTLs are truncated to safe integer microseconds, approximately
    ±285 years.  See the package README for schema and server restrictions.
