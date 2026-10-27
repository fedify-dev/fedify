<!-- deno-fmt-ignore-file -->

@fedify/postgres: PostgreSQL drivers for Fedify
===============================================

[![JSR][JSR badge]][JSR]
[![npm][npm badge]][npm]

This package provides [Fedify]'s [`KvStore`] and [`MessageQueue`]
implementations for PostgreSQL:

 -  [`PostgresKvStore`]
 -  [`PostgresMessageQueue`]

~~~~ typescript
import { createFederation } from "@fedify/fedify";
import { PostgresKvStore, PostgresMessageQueue } from "@fedify/postgres";
import postgres from "postgres";

const sql = postgres("postgresql://user:password@localhost/dbname");

const federation = createFederation({
  kv: new PostgresKvStore(sql),
  queue: new PostgresMessageQueue(sql),
});
~~~~

`PostgresKvStore` uses a crash-safe logged table by default.  For transient
data where losing the table contents after a PostgreSQL crash is acceptable,
pass `{ unlogged: true }` as its second constructor argument.

When a store created by an earlier version still uses an unlogged table, its
next initialization converts that table to logged storage.  PostgreSQL rewrites
the table and takes an `ACCESS EXCLUSIVE` lock during this one-time migration,
so schedule the upgrade accordingly for a large or busy table.

Expiry cleanup can use an expression index without changing the table schema.
New empty tables receive it automatically with a pooled client.  Existing
populated tables and deployments using `initialized: true` need an explicit
index migration.  See the [expiry-index guide] for concurrent index creation,
rolling upgrades, and calendar-time semantics.

[JSR badge]: https://jsr.io/badges/@fedify/postgres
[JSR]: https://jsr.io/@fedify/postgres
[npm badge]: https://img.shields.io/npm/v/@fedify/postgres?logo=npm
[npm]: https://www.npmjs.com/package/@fedify/postgres
[Fedify]: https://fedify.dev/
[`KvStore`]: https://jsr.io/@fedify/fedify/doc/federation/~/KvStore
[`MessageQueue`]: https://jsr.io/@fedify/fedify/doc/federation/~/MessageQueue
[`PostgresKvStore`]: https://jsr.io/@fedify/postgres/doc/~/PostgresKvStore
[`PostgresMessageQueue`]: https://jsr.io/@fedify/postgres/doc/~/PostgresMessageQueue
[expiry-index guide]: https://fedify.dev/manual/kv#postgresql-expiry-index


Installation
------------

~~~~ sh
deno add jsr:@fedify/postgres  # Deno
npm  add     @fedify/postgres  # npm
pnpm add     @fedify/postgres  # pnpm
yarn add     @fedify/postgres  # Yarn
bun  add     @fedify/postgres  # Bun
~~~~
