---
links:
  '#1268': https://github.com/fedify-dev/fedify/issues/1268
  '#1271': https://github.com/fedify-dev/fedify/pull/1271
---
 -  Fixed `PostgresMessageQueue` remaining unusable after a transient
    initialization failure.  Later calls now retry initialization, so the same
    queue instance can recover when the database becomes available again.
    [[#1268], [#1271]]
