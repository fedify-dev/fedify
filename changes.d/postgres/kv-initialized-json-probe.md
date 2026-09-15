 -  Fixed `PostgresKvStore` storing values as JSONB strings rather than JSONB
    objects when it was constructed with the `initialized: true` option.  The
    option skipped the driver's JSON serialization probe along with the table's
    schema DDL, so every value was serialized twice and every later read of the
    row returned a string, including reads from a store that never passed the
    option.  The option now skips only the DDL.  [[#1031] by Heewon Chae]
