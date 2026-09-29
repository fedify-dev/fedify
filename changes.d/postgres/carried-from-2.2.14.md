---
links:
  '#1042': https://github.com/fedify-dev/fedify/issues/1042
  '#1056': https://github.com/fedify-dev/fedify/pull/1056
  '#1081': https://github.com/fedify-dev/fedify/issues/1081
  '#1089': https://github.com/fedify-dev/fedify/pull/1089
---
 -  Fixed `PostgresKvStore` rejecting `null` values with a PostgreSQL constraint
    error.  Callers can now store JSON `null`.
    [[#1042], [#1056]]
 -  Fixed `PostgresMessageQueue.listen()` returning before `UNLISTEN` finished
    after aborting.  Awaiting the listener now waits for subscription cleanup
    before the SQL client can be closed.  Cleanup errors are logged instead of
    becoming unhandled rejections.
    [[#1081], [#1089]]
