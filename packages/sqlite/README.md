@fedify/sqlite: SQLite drivers for Fedify
=========================================

[![JSR][JSR badge]][JSR]
[![npm][npm badge]][npm]

This package provides a SQLite-based [`KvStore`] implementation for [Fedify].

[JSR badge]: https://jsr.io/badges/@fedify/sqlite
[JSR]: https://jsr.io/@fedify/sqlite
[npm badge]: https://img.shields.io/npm/v/@fedify/sqlite?logo=npm
[npm]: https://www.npmjs.com/package/@fedify/sqlite
[`KvStore`]: https://jsr.io/@fedify/fedify/doc/federation/~/KvStore
[Fedify]: https://fedify.dev/


Usage
-----

### Deno

~~~~ typescript
import { DatabaseSync } from 'node:sqlite';
import { SqliteKvStore } from '@fedify/sqlite';

const db = new DatabaseSync('./data.db');
const store = new SqliteKvStore(db);
~~~~

### Node.js

~~~~ typescript
import { DatabaseSync } from 'node:sqlite';
import { SqliteKvStore } from '@fedify/sqlite';

const db = new DatabaseSync('./data.db');
const store = new SqliteKvStore(db);
~~~~

### Bun

~~~~ typescript
import { Database } from 'bun:sqlite';
import { SqliteKvStore } from '@fedify/sqlite';

const db = new Database('./data.db');
const store = new SqliteKvStore(db);
~~~~
