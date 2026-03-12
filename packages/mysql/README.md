<!-- deno-fmt-ignore-file -->

@fedify/mysql: MySQL/MariaDB drivers for Fedify
===============================================

[![JSR][JSR badge]][JSR]
[![npm][npm badge]][npm]

This package provides [Fedify]'s [`KvStore`] and [`MessageQueue`]
implementations for MySQL/MariaDB:

 -  [`MysqlKvStore`]
 -  [`MysqlMessageQueue`]

~~~~ typescript
import { createFederation } from "@fedify/fedify";
import { MysqlKvStore, MysqlMessageQueue } from "@fedify/mysql";
import mysql from "mysql2/promise";

const pool = mysql.createPool("mysql://user:password@localhost/dbname");

const federation = createFederation({
  kv: new MysqlKvStore(pool),
  queue: new MysqlMessageQueue(pool),
});
~~~~

[JSR badge]: https://jsr.io/badges/@fedify/mysql
[JSR]: https://jsr.io/@fedify/mysql
[npm badge]: https://img.shields.io/npm/v/@fedify/mysql?logo=npm
[npm]: https://www.npmjs.com/package/@fedify/mysql
[Fedify]: https://fedify.dev/
[`KvStore`]: https://jsr.io/@fedify/fedify/doc/federation/~/KvStore
[`MessageQueue`]: https://jsr.io/@fedify/fedify/doc/federation/~/MessageQueue
[`MysqlKvStore`]: https://jsr.io/@fedify/mysql/doc/~/MysqlKvStore
[`MysqlMessageQueue`]: https://jsr.io/@fedify/mysql/doc/mq/~/MysqlMessageQueue


Installation
------------

~~~~ sh
deno add jsr:@fedify/mysql              # Deno
npm  add     @fedify/mysql mysql2       # npm
pnpm add     @fedify/mysql mysql2       # pnpm
yarn add     @fedify/mysql mysql2       # Yarn
bun  add     @fedify/mysql mysql2       # Bun
~~~~
