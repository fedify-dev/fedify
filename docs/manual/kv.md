Key–value store
===============

*This API is available since Fedify 0.5.0.*

The `KvStore` interface is a crucial component in Fedify, providing a flexible
key–value storage solution for caching and maintaining internal data.
This guide will help you choose the right `KvStore` implementation for
your project and even create your own custom implementation if needed.


Choosing a `KvStore` implementation
-----------------------------------

Fedify offers several `KvStore` implementations to suit different needs.

Choose the implementation that best fits your project's requirements,
considering factors like scalability, runtime environment, and distributed
nature of your system.

### `MemoryKvStore`

`MemoryKvStore` is a simple in-memory key–value store that doesn't persist data.
It's best suited for development and testing environments where data don't have
to be shared across multiple nodes.  No setup is required, making it easy to
get started.

Best for
:   Development and testing.

Pros
:   Simple, no setup required.

Cons
:   Data is not persistent, not suitable for production.

~~~~ typescript twoslash
import { createFederation, MemoryKvStore } from "@fedify/fedify";

const federation = createFederation<void>({
  kv: new MemoryKvStore(),
  // ... other options
});
~~~~

### `SqliteKvStore`

To use the [`SqliteKvStore`], you need to install the *@fedify/sqlite* package
first:

::: code-group

~~~~ bash [Deno]
deno add jsr:@fedify/sqlite
~~~~

~~~~ bash [npm]
npm add @fedify/sqlite
~~~~

~~~~ bash [pnpm]
pnpm add @fedify/sqlite
~~~~

~~~~ bash [Yarn]
yarn add @fedify/sqlite
~~~~

~~~~ bash [Bun]
bun add @fedify/sqlite
~~~~

:::

[`SqliteKvStore`] is a simple key–value store implementation that uses SQLite as
the backend storage. It provides persistent storage with minimal configuration.
It's suitable for development and testing. It uses native sqlite modules,
[`node:sqlite`] for Node.js and Deno, [`bun:sqlite`] for Bun.

Best for
:   Development and testing.

Pros
:   Simple, persistent with minimal configuration.

Cons
:   Limited scalability, not suitable for high-traffic production.


::: code-group

~~~~ typescript twoslash [Deno]
import { DatabaseSync } from "node:sqlite";
import { createFederation } from "@fedify/fedify";
import { SqliteKvStore } from "@fedify/sqlite";

const db = new DatabaseSync(":memory:");
const federation = createFederation<void>({
  // ...
  kv: new SqliteKvStore(db),
});
~~~~

~~~~ typescript twoslash [Node.js]
import { DatabaseSync } from "node:sqlite";
import { createFederation } from "@fedify/fedify";
import { SqliteKvStore } from "@fedify/sqlite";

const db = new DatabaseSync(":memory:");
const federation = createFederation<void>({
  // ...
  kv: new SqliteKvStore(db),
});
~~~~

~~~~ typescript [Bun]
import { Database } from "bun:sqlite";
import { createFederation } from "@fedify/fedify";
import { SqliteKvStore } from "@fedify/sqlite";

const db = new Database(":memory:");
const federation = createFederation<void>({
  // ...
  kv: new SqliteKvStore(db),
});
~~~~

:::

> [!TIP]
> If you are using Bun, you may encounter a type error in your IDE because
> TypeScript's language server runs on Node.js and resolves the
> `@fedify/sqlite` module using Node.js [conditional exports] instead of
> Bun's.  To fix this, add the following to your *tsconfig.json*:
>
> ~~~~ json
> {
>   "compilerOptions": {
>     "moduleResolution": "bundler",
>     "customConditions": ["bun"]
>   }
> }
> ~~~~
>
> This tells TypeScript to use Bun's module resolution when resolving
> [conditional exports].

[`SqliteKvStore`]: https://jsr.io/@fedify/sqlite/doc/kv/~/SqliteKvStore
[`node:sqlite`]: https://nodejs.org/api/sqlite.html
[`bun:sqlite`]: https://bun.com/docs/api/sqlite
[conditional exports]: https://nodejs.org/api/packages.html#conditional-exports

### `DenoKvStore` (Deno only)

To use the [`DenoKvStore`], you need to install the *@fedify/denokv* package
first:

::: code-group

~~~~ bash [Deno]
deno add jsr:@fedify/denokv
~~~~

:::

[`DenoKvStore`] is a key–value store implementation for [Deno] runtime that uses
Deno's built-in [`Deno.openKv()`] API. It provides persistent storage and good
performance for Deno environments.  It's suitable for production use in Deno
applications.

Best for
:   Production use in Deno environments.

Pros
:   Persistent storage, good performance, easy to set up.

Cons
:   Only available in Deno runtime.

~~~~ typescript
import { createFederation } from "@fedify/fedify";
import { DenoKvStore } from "@fedify/denokv";

const kv = await Deno.openKv();
const federation = createFederation<void>({
  kv: new DenoKvStore(kv),
  // ... other options
});
~~~~

[`@fedify/denokv`]: https://jsr.io/@fedify/denokv
[`DenoKvStore`]: https://jsr.io/@fedify/denokv/doc/mq/~/DenoKvStore
[Deno]: https://deno.com/
[`Deno.openKv()`]: https://docs.deno.com/api/deno/~/Deno.openKv

### [`RedisKvStore`]

To use the [`RedisKvStore`], you need to install the *@fedify/redis* package
first:

::: code-group

~~~~ bash [Deno]
deno add jsr:@fedify/redis
~~~~

~~~~ bash [npm]
npm add @fedify/redis
~~~~

~~~~ bash [pnpm]
pnpm add @fedify/redis
~~~~

~~~~ bash [Yarn]
yarn add @fedify/redis
~~~~

~~~~ bash [Bun]
bun add @fedify/redis
~~~~

:::

[`RedisKvStore`] is a key–value store implementation that uses Redis as
the backend storage. It provides scalability and high performance, making it
suitable for production use in distributed systems. It requires a Redis
server setup and maintenance.

Best for
:   Production use, distributed systems.

Pros
:   Scalable, supports clustering.

Cons
:   Requires Redis setup and maintenance.

~~~~ typescript twoslash
import { createFederation } from "@fedify/fedify";
import { RedisKvStore } from "@fedify/redis";
import Redis from "ioredis";

const redis = new Redis(); // Configure as needed
const federation = createFederation<void>({
  kv: new RedisKvStore(redis),
  // ... other options
});
~~~~

[`RedisKvStore`]: https://jsr.io/@fedify/redis/doc/kv/~/RedisKvStore

### [`PostgresKvStore`]

To use the [`PostgresKvStore`], you need to install the *@fedify/postgres*
package first:

::: code-group

~~~~ bash [Deno]
deno add jsr:@fedify/postgres
~~~~

~~~~ bash [npm]
npm add @fedify/postgres
~~~~

~~~~ bash [pnpm]
pnpm add @fedify/postgres
~~~~

~~~~ bash [Yarn]
yarn add @fedify/postgres
~~~~

~~~~ bash [Bun]
bun add @fedify/postgres
~~~~

:::

[`PostgresKvStore`] is a key–value store implementation that uses PostgreSQL as
the backend storage. It provides scalability and high performance, making it
suitable for production use in distributed systems.  It requires a PostgreSQL
server setup and maintenance.

Best for
:   Production use, a system that already uses PostgreSQL.

Pros
:   Scalable, no additional setup required if already using PostgreSQL.

Cons
:   Requires PostgreSQL setup and maintenance.

~~~~ typescript{6-8} twoslash
import { createFederation } from "@fedify/fedify";
import { PostgresKvStore } from "@fedify/postgres";
import postgres from "postgres";

const federation = createFederation<void>({
  kv: new PostgresKvStore(
    postgres("postgresql://user:pass@localhost/db"),
  ),
  // ... other options
});
~~~~

[`PostgresKvStore`]: https://jsr.io/@fedify/postgres/doc/kv/~/PostgresKvStore

### `WorkersKvStore` (Cloudflare Workers only)

*This API is available since Fedify 1.6.0.*

To use the [`WorkersKvStore`], you need to install the *@fedify/cfworkers*
package first:

::: code-group

~~~~ bash [Deno]
deno add jsr:@fedify/cfworkers
~~~~

~~~~ bash [npm]
npm add @fedify/cfworkers
~~~~

~~~~ bash [pnpm]
pnpm add @fedify/cfworkers
~~~~

~~~~ bash [Yarn]
yarn add @fedify/cfworkers
~~~~

~~~~ bash [Bun]
bun add @fedify/cfworkers
~~~~

:::

[`WorkersKvStore`] is a key–value store implementation for [Cloudflare Workers]
that uses Cloudflare's built-in [Cloudflare Workers KV] API.  It provides
persistent storage and good performance for Cloudflare Workers environments.
It's suitable for production use in Cloudflare Workers applications.

Best for
:   Production use in Cloudflare Workers environments.

Pros
:   Persistent storage, good performance, easy to set up.

Cons
:   Only available in Cloudflare Workers runtime.

~~~~ typescript twoslash
// @noErrors: 2345
import type { FederationBuilder } from "@fedify/fedify";
const builder = undefined as unknown as FederationBuilder<void>;
// ---cut-before---
import type { Federation } from "@fedify/fedify";
import { WorkersKvStore } from "@fedify/cfworkers";

export default {
  async fetch(request, env, ctx) {
    const federation: Federation<void> = await builder.build({
      kv: new WorkersKvStore(env.KV_BINDING),
    });
    return await federation.fetch(request, { contextData: undefined });
  }
} satisfies ExportedHandler<{ KV_BINDING: KVNamespace<string> }>;
~~~~

> [!NOTE]
> Since your `KVNamespace` is not bound to a global variable, but rather
> passed as an argument to the `fetch()` method, you need to instantiate
> your `Federation` object inside the `fetch()` method, rather than the top
> level.
>
> For better organization, you probably want to use a builder pattern to
> register your dispatchers and listeners before instantiating the `Federation`
> object.  See the [*Builder pattern for structuring*
> section](./federation.md#builder-pattern-for-structuring) for details.

[`@fedify/cfworkers`]: https://github.com/fedify-dev/fedify/tree/main/packages/cfworkers
[`WorkersKvStore`]: https://jsr.io/@fedify/cfworkers/doc/kv/~/WorkersKvStore
[Cloudflare Workers]: https://workers.cloudflare.com/
[Cloudflare Workers KV]: https://developers.cloudflare.com/kv/


Implementing a custom `KvStore`
-------------------------------

> [!TIP]
> We are always looking to improve Fedify and add more `KvStore`
> implementations.  If you've created a custom implementation that you think
> would be useful to others, consider contributing it to the community by
> packaging it as a standalone module and sharing it on JSR and npm.

If the provided implementations don't meet your needs, you can create a custom
`KvStore`.  Here's a step-by-step guide:

### Implement the `KvStore` interface

Create a class that implements the `KvStore` interface.  The interface defines
three methods: `~KvStore.get()`, `~KvStore.set()`, `~KvStore.delete()`, and
optionally `~KvStore.cas()` and `~KvStore.list()`.

~~~~ typescript twoslash
import type {
  KvStore,
  KvKey,
  KvStoreSetOptions,
  KvStoreListEntry,
} from "@fedify/fedify";

class MyCustomKvStore implements KvStore {
  async get<T = unknown>(key: KvKey): Promise<T | undefined> {
    // Implement get logic
    // ---cut-start---
    return undefined;
    // ---cut-end---
  }

  async set(
    key: KvKey,
    value: unknown,
    options?: KvStoreSetOptions
  ): Promise<void> {
    // Implement set logic
  }

  async delete(key: KvKey): Promise<void> {
    // Implement delete logic
  }

  async cas(
    key: KvKey,
    expectedValue: unknown,
    newValue: unknown
  ): Promise<boolean> {
    // Implement compare-and-swap logic if needed
    // ---cut-start---
    return false;
    // ---cut-end---
  }

  async *list(prefix?: KvKey): AsyncIterable<KvStoreListEntry> {
    // Implement list logic if needed
  }
}
~~~~

### Handle `KvKey`

The `KvKey` is an array of strings. You'll need to convert it into a format
suitable for your storage backend. For example:

~~~~ typescript twoslash
import type { KvKey } from "@fedify/fedify";
class MyCustomKvStore {
// ---cut-before---
private serializeKey(key: KvKey): string {
  return key.join(':');
}
// ---cut-after---
}
~~~~

> [!NOTE]
> The above example uses a simple colon-separated string as the serialized key,
> but in practice, it probably needs to be more sophisticated to handle complex
> keys and avoid conflicts.

### Implement `~KvStore.get()` method

Retrieve the value associated with the key. Remember to handle cases where
the key doesn't exist:

~~~~ typescript twoslash
import type { KvStore, KvKey, KvStoreSetOptions } from "@fedify/fedify";
/**
 * A hypothetical storage interface.
 */
interface HypotheticalStorage {
  /**
   * A hypothetical method to retrieve a value by key.
   * @param key The key to retrieve.
   * @returns The value associated with the key.
   */
  retrieve(key: string): Promise<unknown>;
}
class MyCustomKvStore implements KvStore {
  /**
   * A hypothetical storage backend.
   */
  storage: HypotheticalStorage = {
   async retrieve(key: string): Promise<unknown> {
     return undefined;
   }
  };
  private serializeKey(key: KvKey): string { return ""; }
  async set(
    key: KvKey,
    value: unknown,
    options?: KvStoreSetOptions
  ): Promise<void> { }
  async delete(key: KvKey): Promise<void> { }
// ---cut-before---
async get<T = unknown>(key: KvKey): Promise<T | undefined> {
  const serializedKey = this.serializeKey(key);
  // Retrieve value from your storage backend
  const value = await this.storage.retrieve(serializedKey);
  return value as T | undefined;
}
// ---cut-after---
}
~~~~

### Implement `~KvStore.set()` method

Store the value with the given key. Handle the optional TTL if your backend
supports it:

~~~~ typescript twoslash
import type { KvStore, KvKey, KvStoreSetOptions } from "@fedify/fedify";
/**
 * A hypothetical storage interface.
 */
interface HypotheticalStorage {
  /**
   * A hypothetical method to set a value by key.
   * @param key The key to set.
   * @param value The value to set.
   */
  set(key: string, value: unknown): Promise<unknown>;
  /**
   * A hypothetical method to set a value by key with a time-to-live.
   * @param key The key to set.
   * @param value The value to set.
   * @param ttl The time-to-live in milliseconds.
   */
  setWithTtl(key: string, value: unknown, ttl: number): Promise<unknown>;
}
class MyCustomKvStore implements KvStore {
  /**
   * A hypothetical storage backend.
   */
  storage: HypotheticalStorage = {
   async set(key: string, value: unknown): Promise<void> { },
   async setWithTtl(key: string, value: unknown, ttl: number): Promise<void> { }
  };
  private serializeKey(key: KvKey): string { return ""; }
  async get<T = unknown>(key: KvKey): Promise<T | undefined> {
    return undefined;
  }
  async delete(key: KvKey): Promise<void> { }
// ---cut-before---
async set(
  key: KvKey,
  value: unknown,
  options?: KvStoreSetOptions,
): Promise<void> {
  const serializedKey = this.serializeKey(key);
  if (options?.ttl == null) {
    await this.storage.set(serializedKey, value);
  } else {
    // Set with TTL if supported
    await this.storage.setWithTtl(
      serializedKey,
      value,
      options.ttl.total('millisecond'),
    );
  }
}
// ---cut-after---
}
~~~~

*[TTL]: time-to-live

### Implement `~KvStore.delete()` method

Remove the value associated with the key:

~~~~ typescript twoslash
import type { KvStore, KvKey, KvStoreSetOptions } from "@fedify/fedify";
/**
 * A hypothetical storage interface.
 */
interface HypotheticalStorage {
  /**
   * A hypothetical method to remove a value by key.
   * @param key The key to remove.
   */
  remove(key: string): Promise<void>;
}
class MyCustomKvStore implements KvStore {
  /**
   * A hypothetical storage backend.
   */
  storage: HypotheticalStorage = {
   async remove(key: string): Promise<void> { }
  };
  private serializeKey(key: KvKey): string { return ""; }
  async get<T = unknown>(key: KvKey): Promise<T | undefined> {
    return undefined;
  }
  async set(
    key: KvKey,
    value: unknown,
    options?: KvStoreSetOptions
  ): Promise<void> { }
// ---cut-before---
async delete(key: KvKey): Promise<void> {
  const serializedKey = this.serializeKey(key);
  await this.storage.remove(serializedKey);
}
// ---cut-after---
}
~~~~

### Implement `~KvStore.cas()` method (optional)

If your storage backend supports compare-and-swap (CAS) operations, you can
implement the `~KvStore.cas()` method. This method allows you to atomically
update a value only if it matches the expected value. This is useful for
implementing optimistic concurrency control.

~~~~ typescript twoslash
import type { KvStore, KvKey, KvStoreSetOptions } from "@fedify/fedify";
/**
 * A hypothetical storage interface.
 */
interface HypotheticalStorage {
  /**
   * A hypothetical method to compare and swap a value by key.
   * @param key The key to compare and swap.
   * @param expectedValue The expected value to match.
   * @param newValue The new value to set if the expected value matches.
   * @returns True if the operation was successful, false otherwise.
   */
  compareAndSwap(
    key: string,
    expectedValue: unknown,
    newValue: unknown
  ): Promise<boolean>;
}
class MyCustomKvStore implements KvStore {
  /**
   * A hypothetical storage backend.
   */
  storage: HypotheticalStorage = {
   async compareAndSwap(
     key: string,
     expectedValue: unknown,
     newValue: unknown
   ): Promise<boolean> { return false; }
  };
  private serializeKey(key: KvKey): string { return ""; }
  async get<T = unknown>(key: KvKey): Promise<T | undefined> {
    return undefined;
  }
  async set(
    key: KvKey,
    value: unknown,
    options?: KvStoreSetOptions
  ): Promise<void> { }
  async delete(key: KvKey): Promise<void> { }
// ---cut-before---
async cas(
  key: KvKey,
  expectedValue: unknown,
  newValue: unknown
): Promise<boolean> {
  const serializedKey = this.serializeKey(key);
  return await this.storage.compareAndSwap(
    serializedKey,
    expectedValue,
    newValue
  );
}
// ---cut-after---
}
~~~~

### Implement `~KvStore.list()` method (optional)

*This API is available since Fedify 1.10.0.*

If your storage backend supports prefix scanning, you can implement the
`~KvStore.list()` method.  This method allows you to enumerate all entries
whose keys start with a given prefix.  This is useful for implementing
batch operations or iterating over related entries.

~~~~ typescript twoslash
import type {
  KvKey,
  KvStore,
  KvStoreListEntry,
  KvStoreSetOptions,
} from "@fedify/fedify";

/**
 * A hypothetical storage interface.
 */
interface HypotheticalStorage {
  /**
   * A hypothetical method to list entries by prefix.
   * @param prefix The prefix to filter by.
   * @returns An async iterable of key-value pairs.
   */
  scan(prefix: string): AsyncIterable<{ key: string; value: unknown }>;
}
class MyCustomKvStore implements KvStore {
  /**
   * A hypothetical storage backend.
   */
  storage: HypotheticalStorage = {
   async *scan(prefix: string): AsyncIterable<{ key: string; value: unknown }> {
   }
  };
  private serializeKey(key: KvKey): string { return ""; }
  private deserializeKey(key: string): KvKey {
    return key.split(":") as unknown as KvKey;
  }
  async get<T = unknown>(key: KvKey): Promise<T | undefined> {
    return undefined;
  }
  async set(
    key: KvKey,
    value: unknown,
    options?: KvStoreSetOptions
  ): Promise<void> { }
  async delete(key: KvKey): Promise<void> { }
// ---cut-before---
async *list(prefix?: KvKey): AsyncIterable<KvStoreListEntry> {
  const serializedPrefix = prefix ? this.serializeKey(prefix) : "";
  for await (const { key, value } of this.storage.scan(serializedPrefix)) {
    yield {
      key: this.deserializeKey(key),
      value,
    };
  }
}
// ---cut-after---
}
~~~~

The `~KvStore.list()` method takes an optional `prefix` parameter specifying
the key prefix to filter by.  If omitted or empty, it returns all entries.
It returns an `AsyncIterable` of `KvStoreListEntry` objects, each containing
a `~KvStoreListEntry.key` and a `~KvStoreListEntry.value`.

> [!TIP]
> When implementing `~KvStore.list()`, make sure to:
>
>  -  Include the exact prefix key itself if it exists (not just keys that
>     have additional components after the prefix)
>  -  Filter out expired entries if your storage backend supports TTL
>  -  Handle pagination efficiently for large datasets

### Use your custom `KvStore`

That's it! You can now use your custom `KvStore` implementation with Fedify:

~~~~ typescript twoslash
import { KvStore, KvKey, KvStoreSetOptions } from "@fedify/fedify";
class MyCustomKvStore implements KvStore {
  async get<T = unknown>(key: KvKey): Promise<T | undefined> {
    return undefined;
  }
  async set(
    key: KvKey,
    value: unknown,
    options?: KvStoreSetOptions
  ): Promise<void> {
  }
  async delete(key: KvKey): Promise<void> {
  }
}
// ---cut-before---
import { createFederation } from "@fedify/fedify";

const customKvStore = new MyCustomKvStore();
const federation = createFederation<void>({
  kv: customKvStore,
  // ... other options
});
~~~~
