---
links:
  '#1335': https://github.com/fedify-dev/fedify/issues/1335
  '#1340': https://github.com/fedify-dev/fedify/pull/1340
---
 -  Deprecated `@fedify/denokv`, `DenoKvStore`, `DenoKvMessageQueue`, and
    `DenoKvMessageQueueOptions`.  Deno KV was built primarily for Deno Deploy,
    which is shutting down, and its local implementation is an unstable SQLite
    wrapper with a 64 KiB value limit.  The package keeps working throughout
    the 2.x series but will be removed in Fedify 3.0.0.  `@fedify/sqlite`
    covers local and single-node deployments, while `@fedify/postgres`,
    `@fedify/redis`, `@fedify/mysql`, and `@fedify/cfworkers` cover production
    deployments.  Instantiating `DenoKvStore` or `DenoKvMessageQueue` now logs
    a deprecation warning.  [[#1335], [#1340]]
