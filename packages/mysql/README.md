<!-- deno-fmt-ignore-file -->

@fedify/MySQL: MySQL/MariaDB drivers for Fedify
===============================================

[![JSR][JSR badge]][JSR]
[![npm][npm badge]][npm]

This package provides [Fedify]'s [`KvStore`] implementation for
MySQL/MariaDB:

 -  [`MysqlKvStore`]

~~~~ typescript
import { createFederation } from "@fedify/fedify";
import { MysqlKvStore } from "@fedify/mysql";
import mysql from "mysql2/promise";

const pool = mysql.createPool("mysql://user:password@localhost/dbname");

const federation = createFederation({
  kv: new MysqlKvStore(pool),
});
~~~~

[JSR badge]: https://jsr.io/badges/@fedify/mysql
[JSR]: https://jsr.io/@fedify/mysql
[npm badge]: https://img.shields.io/npm/v/@fedify/mysql?logo=npm
[npm]: https://www.npmjs.com/package/@fedify/mysql
[Fedify]: https://fedify.dev/
[`KvStore`]: https://jsr.io/@fedify/fedify/doc/federation/~/KvStore
[`MysqlKvStore`]: https://jsr.io/@fedify/mysql/doc/~/MysqlKvStore


Installation
------------

~~~~ sh
deno add jsr:@fedify/mysql  # Deno
npm  add     @fedify/mysql  # npm
pnpm add     @fedify/mysql  # pnpm
yarn add     @fedify/mysql  # Yarn
bun  add     @fedify/mysql  # Bun
~~~~
