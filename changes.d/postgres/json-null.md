---
links:
  '#1042': https://github.com/fedify-dev/fedify/issues/1042
  '#1056': https://github.com/fedify-dev/fedify/pull/1056
---
 -  Fixed `PostgresKvStore` rejecting `null` values with a PostgreSQL constraint
    error.  Callers can now store JSON `null`.  [[#1042], [#1056]]
