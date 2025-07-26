@fedify/sqlite: SQLite drivers for Fedify
==============

This package provides a SQLite-based key-value store implementation.

## Usage

### Node.js

```typescript
import { DatabaseSync } from 'node:sqlite';
import { SqliteKvStore } from '@fedify/sqlite';

const db = new DatabaseSync('./data.db');
const store = new SqliteKvStore(db);
```

### Bun

```typescript
import { Database } from 'bun:sqlite';
import { SqliteKvStore } from '@fedify/sqlite';

const db = new Database('./data.db');
const store = new SqliteKvStore(db);
```

### Deno

For Deno, you can directly import from `@fedify/sqlite` when using the import map in `deno.json`:

```typescript
import { DB } from 'https://deno.land/x/sqlite@v3.7.0/mod.ts';
import { SqliteKvStore } from '@fedify/sqlite';

const db = new DB('./data.db');
const store = new SqliteKvStore(db);
```
