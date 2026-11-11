@fedify/sqlite: SQLite drivers for Fedify
=========================================

[![npm][npm badge]][npm]
[![JSR][JSR badge]][JSR]

This package provides a SQLite-based [`KvStore`] implementation for [Fedify].

[npm badge]: https://img.shields.io/npm/v/@fedify/sqlite?logo=npm
[npm]: https://www.npmjs.com/package/@fedify/sqlite
[JSR badge]: https://jsr.io/badges/@fedify/sqlite
[JSR]: https://jsr.io/@fedify/sqlite
[`KvStore`]: https://jsr.io/@fedify/fedify/doc/federation/~/KvStore
[Fedify]: https://fedify.dev/


Usage
-----

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

### Deno

~~~~ typescript
import { DatabaseSync } from 'node:sqlite';
import { SqliteKvStore } from '@fedify/sqlite';

const db = new DatabaseSync('./data.db');
const store = new SqliteKvStore(db);
~~~~
