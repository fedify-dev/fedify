@fedify/mysql: MySQL/MariaDB drivers for Fedify
===============================================

[![npm][npm badge]][npm]
[![JSR][JSR badge]][JSR]

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

[npm badge]: https://img.shields.io/npm/v/@fedify/mysql?logo=npm
[npm]: https://www.npmjs.com/package/@fedify/mysql
[JSR badge]: https://jsr.io/badges/@fedify/mysql
[JSR]: https://jsr.io/@fedify/mysql
[Fedify]: https://fedify.dev/
[`KvStore`]: https://jsr.io/@fedify/fedify/doc/federation/~/KvStore
[`MessageQueue`]: https://jsr.io/@fedify/fedify/doc/federation/~/MessageQueue
[`MysqlKvStore`]: https://jsr.io/@fedify/mysql/doc/~/MysqlKvStore
[`MysqlMessageQueue`]: https://jsr.io/@fedify/mysql/doc/mq/~/MysqlMessageQueue


Installation
------------

~~~~ sh
npm  add     @fedify/mysql mysql2       # npm
pnpm add     @fedify/mysql mysql2       # pnpm
yarn add     @fedify/mysql mysql2       # Yarn
bun  add     @fedify/mysql mysql2       # Bun
deno add jsr:@fedify/mysql              # Deno
~~~~
