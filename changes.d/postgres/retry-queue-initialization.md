---
links:
  '#1268': https://github.com/fedify-dev/fedify/issues/1268
---
 -  Fixed `PostgresMessageQueue` so it retries initialization after a
    transient failure.  Later enqueue and listen calls work on the same
    instance.  [[#1268]]
