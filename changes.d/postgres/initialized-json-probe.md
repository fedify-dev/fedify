 -  Fixed `PostgresMessageQueue` storing messages as JSONB strings rather than
    JSONB objects when it was constructed with the `initialized: true` option.
    The option skipped the driver's JSON serialization probe along with the
    table's schema DDL, so every message was serialized twice and a listener
    received a string with no recognizable task type, silently dropping the
    queued work.  The option now skips only the DDL.
    [[#1014], [#1032] by Heewon Chae]
