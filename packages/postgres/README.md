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

[JSR]: https://jsr.io/@fedify/postgres
[JSR badge]: https://jsr.io/badges/@fedify/postgres
[npm]: https://www.npmjs.com/package/@fedify/postgres
[npm badge]: https://img.shields.io/npm/v/@fedify/postgres?logo=npm
[Fedify]: https://fedify.dev/
[`KvStore`]: https://jsr.io/@fedify/fedify/doc/federation/~/KvStore
[`MessageQueue`]: https://jsr.io/@fedify/fedify/doc/federation/~/MessageQueue
[`PostgresKvStore`]: https://jsr.io/@fedify/postgres/doc/~/PostgresKvStore
[`PostgresMessageQueue`]: https://jsr.io/@fedify/postgres/doc/~/PostgresMessageQueue


Installation
------------

~~~~ sh
deno add jsr:@fedify/postgres  # Deno
npm  add     @fedify/postgres  # npm
pnpm add     @fedify/postgres  # pnpm
yarn add     @fedify/postgres  # Yarn
bun  add     @fedify/postgres  # Bun
~~~~
