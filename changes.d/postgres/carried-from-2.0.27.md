---
links:
  '#1014': https://github.com/fedify-dev/fedify/issues/1014
  '#1031': https://github.com/fedify-dev/fedify/issues/1031
  '#1032': https://github.com/fedify-dev/fedify/issues/1032
  '#1033': https://github.com/fedify-dev/fedify/issues/1033
---
 -  Fixed `PostgresKvStore` storing values as JSONB strings rather than JSONB
    objects when it was constructed with the `initialized: true` option.  The
    option skipped the driver's JSON serialization probe along with the table's
    schema DDL, so every value was serialized twice and every later read of the
    row returned a string, including reads from a store that never passed the
    option.  The option now skips only the DDL.
    [[#1031], [#1033] by Heewon Chae\]
 -  Fixed `PostgresMessageQueue` storing messages as JSONB strings rather than
    JSONB objects when it was constructed with the `initialized: true` option.
    The option skipped the driver's JSON serialization probe along with the
    table's schema DDL, so every message was serialized twice and a listener
    received a string with no recognizable task type, silently dropping the
    queued work.  The option now skips only the DDL.
    [[#1014], [#1032] by Heewon Chae\]
