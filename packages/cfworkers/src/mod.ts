/**
 * `KvStore` & `MessageQueue` adapters for Cloudflare Workers
 * ==========================================================
 *
 * This package provides `KvStore` implementations that use Cloudflare Workers'
 * KV and D1 bindings, and a `MessageQueue` implementation that uses
 * Cloudflare Queues binding.
 *
 * @module
 * @since 1.9.0
 */
import type { MessageSendRequest, Queue } from "@cloudflare/workers-types";
import type {
  KvKey,
  KvStore,
  KvStoreListEntry,
  KvStoreSetOptions,
  MessageQueue,
  MessageQueueEnqueueOptions,
  MessageQueueListenOptions,
} from "@fedify/fedify/federation";

interface KvMetadata {
  expires?: number;
}

interface WorkersKvNamespaceGetWithMetadataResult<Value, Metadata> {
  readonly value: Value | null;
  readonly metadata: Metadata | null;
}

interface WorkersKvNamespaceListKey<Metadata, Key extends string = string> {
  readonly name: Key;
  readonly expiration?: number;
  readonly metadata?: Metadata;
}

interface WorkersKvNamespaceListResult<Metadata, Key extends string = string> {
  readonly list_complete: boolean;
  readonly keys: readonly WorkersKvNamespaceListKey<Metadata, Key>[];
  readonly cursor?: string;
}

interface WorkersKvNamespaceListOptions {
  readonly limit?: number;
  readonly prefix?: string | null;
  readonly cursor?: string | null;
}

interface WorkersKvNamespacePutOptions {
  readonly expiration?: number;
  readonly expirationTtl?: number;
  readonly metadata?: unknown;
}

/**
 * Minimal Cloudflare Workers KV binding shape used by this package.
 * Compatible with both `@cloudflare/workers-types` and `wrangler types`
 * generated declarations.
 * @since 2.0.12
 */
export interface WorkersKvNamespaceLike<Key extends string = string> {
  get(key: Key): Promise<string | null>;
  get<ExpectedValue = unknown>(
    key: Key,
    type: "json",
  ): Promise<ExpectedValue | null>;
  getWithMetadata<Metadata = unknown>(
    key: Key,
  ): Promise<WorkersKvNamespaceGetWithMetadataResult<string, Metadata>>;
  getWithMetadata<ExpectedValue = unknown, Metadata = unknown>(
    key: Key,
    type: "json",
  ): Promise<WorkersKvNamespaceGetWithMetadataResult<ExpectedValue, Metadata>>;
  put(
    key: Key,
    value: string,
    options?: WorkersKvNamespacePutOptions,
  ): Promise<void>;
  delete(key: Key): Promise<void>;
  list<Metadata = unknown>(
    options?: WorkersKvNamespaceListOptions,
  ): Promise<WorkersKvNamespaceListResult<Metadata, Key>>;
}

/**
 * Internal message wrapper that includes ordering key metadata.
 */
interface WrappedMessage {
  readonly __fedify_ordering_key__?: string;
  // oxlint-disable-next-line typescript/no-explicit-any
  readonly __fedify_payload__: any;
}

/**
 * enqueueMany Limit settings.
 */
const MAX_BATCH_MESSAGES = 100;
const MAX_ESTIMATED_BATCH_BYTES = 240_000;
const ESTIMATED_METADATA_BYTES_PER_MESSAGE = 128;

/**
 * Result from {@link WorkersMessageQueue.processMessage}.
 * @since 2.0.0
 */
export interface ProcessMessageResult {
  /**
   * Whether the message should be processed.  If `false`, the message has not
   * been processed (for example, because an ordering key lock is still held)
   * and the caller is responsible for re-enqueuing or retrying it when
   * appropriate.
   */
  readonly shouldProcess: boolean;
  /**
   * The unwrapped message payload to process.
   * Only present when `shouldProcess` is `true`.
   */
  // oxlint-disable-next-line typescript/no-explicit-any
  readonly message?: any;
  /**
   * A cleanup function that must be called after processing the message.
   * This releases the ordering key lock.  Only present when `shouldProcess`
   * is `true` and the message had an ordering key.
   */
  readonly release?: () => Promise<void>;
}

/**
 * Implementation of the {@link KvStore} interface for Cloudflare Workers KV
 * binding.  This class provides a wrapper around Cloudflare's KV namespace to
 * store and retrieve JSON-serializable values using structured keys.
 *
 * Note that this implementation does not support the {@link KvStore.cas}
 * operation, as Cloudflare Workers KV does not support atomic compare-and-swap
 * operations.  If you need this functionality, consider using a different
 * key–value store that supports atomic operations.
 * @since 1.9.0
 */
export class WorkersKvStore implements KvStore {
  #namespace: WorkersKvNamespaceLike<string>;

  constructor(namespace: WorkersKvNamespaceLike<string>) {
    this.#namespace = namespace;
  }

  #encodeKey(key: KvKey): string {
    return JSON.stringify(key);
  }

  async get<T = unknown>(key: KvKey): Promise<T | undefined> {
    const encodedKey = this.#encodeKey(key);
    const { value, metadata } =
      await this.#namespace.getWithMetadata<KvMetadata>(encodedKey);
    if (value == null) return undefined;
    if (metadata?.expires != null && metadata.expires < Date.now()) {
      return undefined;
    }
    return JSON.parse(value) as T;
  }

  async set(
    key: KvKey,
    value: unknown,
    options?: KvStoreSetOptions,
  ): Promise<void> {
    const encodedKey = this.#encodeKey(key);
    const metadata: KvMetadata =
      options?.ttl == null
        ? {}
        : {
            expires: Date.now() + options.ttl.total("milliseconds"),
          };
    await this.#namespace.put(
      encodedKey,
      JSON.stringify(value),
      options?.ttl == null
        ? { metadata }
        : {
            // According to Cloudflare Workers KV documentation,
            // the minimum TTL is 60 seconds:
            expirationTtl: Math.max(options.ttl.total("seconds"), 60),
            metadata,
          },
    );
  }

  delete(key: KvKey): Promise<void> {
    return this.#namespace.delete(this.#encodeKey(key));
  }

  /**
   * {@inheritDoc KvStore.list}
   * @since 1.10.0
   */
  async *list(prefix?: KvKey): AsyncIterable<KvStoreListEntry> {
    let pattern: string;
    let exactKey: string | null = null;

    if (prefix == null || prefix.length === 0) {
      // Empty prefix: list all entries
      // JSON encoded keys start with '[', so prefix with '[' to match all arrays
      pattern = "[";
    } else {
      // Keys are JSON encoded: '["prefix","a"]'
      // Pattern to match keys starting with prefix: '["prefix",' matches children
      exactKey = this.#encodeKey(prefix);
      pattern = JSON.stringify(prefix).slice(0, -1) + ",";
    }

    // First, check if the exact prefix key exists
    if (exactKey != null) {
      const { value, metadata } =
        await this.#namespace.getWithMetadata(exactKey);
      if (
        value != null &&
        (metadata == null ||
          (metadata as KvMetadata).expires == null ||
          (metadata as KvMetadata).expires! >= Date.now())
      ) {
        yield {
          key: prefix!,
          value: JSON.parse(value),
        };
      }
    }

    // List all keys matching the pattern
    let cursor: string | undefined;
    do {
      const result = await this.#namespace.list<KvMetadata>({
        prefix: pattern,
        cursor,
      });
      cursor = result.list_complete ? undefined : result.cursor;

      for (const keyInfo of result.keys) {
        const metadata = keyInfo.metadata as KvMetadata | undefined;
        if (metadata?.expires != null && metadata.expires < Date.now()) {
          continue;
        }

        const value = await this.#namespace.get(keyInfo.name);
        if (value == null) continue;

        yield {
          key: JSON.parse(keyInfo.name) as KvKey,
          value: JSON.parse(value),
        };
      }
    } while (cursor != null);
  }
}

/**
 * Minimal Cloudflare D1 prepared statement shape used by this package.
 * Compatible with both `@cloudflare/workers-types` and `wrangler types`
 * generated declarations.
 * @since 2.5.0
 */
export interface WorkersD1PreparedStatementLike {
  bind(...values: unknown[]): WorkersD1PreparedStatementLike;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ readonly results: T[] }>;
  run(): Promise<{ readonly meta: { readonly changes: number } }>;
}

/**
 * Minimal Cloudflare D1 binding shape used by this package.  Compatible with
 * both `D1Database` and `D1DatabaseSession`, as declared by
 * `@cloudflare/workers-types` and `wrangler types`.
 * @since 2.5.0
 */
export interface WorkersD1DatabaseLike {
  prepare(query: string): WorkersD1PreparedStatementLike;
  batch(statements: WorkersD1PreparedStatementLike[]): Promise<unknown[]>;
}

/**
 * Options for {@link WorkersD1KvStore}.
 * @since 2.5.0
 */
export interface WorkersD1KvStoreOptions {
  /**
   * The table name to use for the key–value store.
   * Only letters, digits, and underscores are allowed.
   * `"fedify_kv"` by default.
   * @default `"fedify_kv"`
   */
  readonly tableName?: string;

  /**
   * Whether the table has already been created, for example, by a D1
   * migration.  If `false`, the store creates the table on its first use.
   * `false` by default.
   * @default `false`
   */
  readonly initialized?: boolean;
}

/**
 * Implementation of the {@link KvStore} interface for Cloudflare D1 binding.
 *
 * Unlike {@link WorkersKvStore}, this store is strongly consistent and is
 * priced for balanced read and write workloads, which suits Fedify's usage
 * of the key–value store.  It also supports the {@link KvStore.cas}
 * operation: since D1 has no interactive transactions, each compare-and-swap
 * is performed by a single conditional SQL statement.
 *
 * The store uses a table with the following schema, which it creates on
 * its first use unless the `initialized` option is set:
 *
 * ```sql
 * CREATE TABLE IF NOT EXISTS fedify_kv (
 *   key TEXT PRIMARY KEY NOT NULL,
 *   value TEXT NOT NULL,
 *   expires INTEGER
 * );
 * CREATE INDEX IF NOT EXISTS fedify_kv_expires ON fedify_kv (expires);
 * ```
 *
 * @example
 * ```typescript ignore
 * import { createFederation } from "@fedify/fedify";
 * import { WorkersD1KvStore } from "@fedify/cfworkers";
 *
 * export default {
 *   async fetch(request, env, ctx) {
 *     const federation = createFederation({
 *       kv: new WorkersD1KvStore(env.DB),
 *       // ... other options
 *     });
 *     return federation.fetch(request, { contextData: env });
 *   },
 * } satisfies ExportedHandler<{ DB: D1Database }>;
 * ```
 * @since 2.5.0
 */
export class WorkersD1KvStore implements KvStore {
  static readonly #defaultTableName = "fedify_kv";
  static readonly #tableNameRegex = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
  readonly #db: WorkersD1DatabaseLike;
  readonly #tableName: string;
  #initialized: Promise<void> | null;

  /**
   * Constructs a new {@link WorkersD1KvStore} with the given D1 binding.
   * @param db The Cloudflare D1 binding (or a D1 session).
   * @param options Options for the key–value store.
   * @throws {TypeError} If the table name is invalid.
   */
  constructor(
    db: WorkersD1DatabaseLike,
    options: WorkersD1KvStoreOptions = {},
  ) {
    this.#db = db;
    this.#tableName = options.tableName ??
      WorkersD1KvStore.#defaultTableName;
    if (!WorkersD1KvStore.#tableNameRegex.test(this.#tableName)) {
      throw new TypeError(
        `Invalid table name for the key–value store: ${this.#tableName}`,
      );
    }
    this.#initialized = options.initialized ? Promise.resolve() : null;
  }

  /**
   * Creates the table used by the key–value store if it does not already
   * exist.  Does nothing if the table already exists.  It is called
   * automatically on the first use of the store unless the `initialized`
   * option is set.
   */
  initialize(): Promise<void> {
    this.#initialized ??= this.#db.batch([
      this.#db.prepare(`
        CREATE TABLE IF NOT EXISTS "${this.#tableName}" (
          key TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL,
          expires INTEGER
        )
      `),
      this.#db.prepare(`
        CREATE INDEX IF NOT EXISTS "${this.#tableName}_expires"
        ON "${this.#tableName}" (expires)
      `),
    ]).then(() => undefined, (error) => {
      // Let a later call retry the initialization:
      this.#initialized = null;
      throw error;
    });
    return this.#initialized;
  }

  #encodeKey(key: KvKey): string {
    return JSON.stringify(key);
  }

  #getExpires(now: number, options?: KvStoreSetOptions): number | null {
    return options?.ttl == null
      ? null
      : now + options.ttl.total("milliseconds");
  }

  /**
   * {@inheritDoc KvStore.get}
   */
  async get<T = unknown>(key: KvKey): Promise<T | undefined> {
    await this.initialize();
    const row = await this.#db.prepare(`
      SELECT value FROM "${this.#tableName}"
      WHERE key = ? AND (expires IS NULL OR expires > ?)
    `).bind(this.#encodeKey(key), Date.now()).first<{ value: string }>();
    return row == null ? undefined : JSON.parse(row.value) as T;
  }

  /**
   * {@inheritDoc KvStore.set}
   */
  async set(
    key: KvKey,
    value: unknown,
    options?: KvStoreSetOptions,
  ): Promise<void> {
    await this.initialize();
    const now = Date.now();
    // Purge expired entries in the same round trip:
    await this.#db.batch([
      this.#db.prepare(`
        DELETE FROM "${this.#tableName}"
        WHERE expires IS NOT NULL AND expires <= ?
      `).bind(now),
      this.#db.prepare(`
        INSERT INTO "${this.#tableName}" (key, value, expires)
        VALUES (?, ?, ?)
        ON CONFLICT (key) DO UPDATE SET
          value = excluded.value,
          expires = excluded.expires
      `).bind(
        this.#encodeKey(key),
        JSON.stringify(value),
        this.#getExpires(now, options),
      ),
    ]);
  }

  /**
   * {@inheritDoc KvStore.delete}
   */
  async delete(key: KvKey): Promise<void> {
    await this.initialize();
    await this.#db.prepare(`DELETE FROM "${this.#tableName}" WHERE key = ?`)
      .bind(this.#encodeKey(key))
      .run();
  }

  /**
   * {@inheritDoc KvStore.cas}
   */
  async cas(
    key: KvKey,
    expectedValue: unknown,
    newValue: unknown,
    options?: KvStoreSetOptions,
  ): Promise<boolean> {
    await this.initialize();
    const encodedKey = this.#encodeKey(key);
    const now = Date.now();

    if (expectedValue === undefined) {
      // No mutation is needed; this read is the operation's atomic point:
      if (newValue === undefined) return await this.get(key) === undefined;
      // Insert the entry unless an unexpired entry already exists:
      const { meta } = await this.#db.prepare(`
        INSERT INTO "${this.#tableName}" (key, value, expires)
        VALUES (?, ?, ?)
        ON CONFLICT (key) DO UPDATE SET
          value = excluded.value,
          expires = excluded.expires
        WHERE "${this.#tableName}".expires IS NOT NULL
          AND "${this.#tableName}".expires <= ?
      `).bind(
        encodedKey,
        JSON.stringify(newValue),
        this.#getExpires(now, options),
        now,
      ).run();
      return meta.changes > 0;
    }

    // Compares the JSON trees in both directions so that the order of object
    // members is ignored, while the order of array elements, container types,
    // and scalar types matter.  The predicate runs inside the mutation itself,
    // so neither a read–write race nor an interactive transaction is involved:
    const expectedJson = JSON.stringify(expectedValue);
    // The column must be qualified, since json_tree() has a value column too:
    const current = `"${this.#tableName}".value`;
    const matches = `
      key = ?1 AND (expires IS NULL OR expires > ?2)
      AND NOT EXISTS (
        SELECT fullkey, type, atom FROM json_tree(${current})
        EXCEPT SELECT fullkey, type, atom FROM json_tree(?3)
      )
      AND NOT EXISTS (
        SELECT fullkey, type, atom FROM json_tree(?3)
        EXCEPT SELECT fullkey, type, atom FROM json_tree(${current})
      )
    `;
    const statement = newValue === undefined
      ? this.#db.prepare(`DELETE FROM "${this.#tableName}" WHERE ${matches}`)
        .bind(encodedKey, now, expectedJson)
      : this.#db.prepare(`
        UPDATE "${this.#tableName}" SET value = ?4, expires = ?5
        WHERE ${matches}
      `).bind(
        encodedKey,
        now,
        expectedJson,
        JSON.stringify(newValue),
        this.#getExpires(now, options),
      );
    const { meta } = await statement.run();
    return meta.changes > 0;
  }

  /**
   * {@inheritDoc KvStore.list}
   */
  async *list(prefix?: KvKey): AsyncIterable<KvStoreListEntry> {
    await this.initialize();
    const now = Date.now();
    let statement: WorkersD1PreparedStatementLike;
    if (prefix == null || prefix.length === 0) {
      statement = this.#db.prepare(`
        SELECT key, value FROM "${this.#tableName}"
        WHERE expires IS NULL OR expires > ?
        ORDER BY key
      `).bind(now);
    } else {
      // Keys are JSON encoded, so '["prefix","a"]' and '["prefix"]' both
      // start with '["prefix"', while '["prefixed"]' does not:
      const encodedPrefix = JSON.stringify(prefix).slice(0, -1);
      statement = this.#db.prepare(`
        SELECT key, value FROM "${this.#tableName}"
        WHERE substr(key, 1, length(?1)) = ?1
          AND (expires IS NULL OR expires > ?2)
        ORDER BY key
      `).bind(encodedPrefix, now);
    }
    const { results } = await statement.all<{ key: string; value: string }>();
    for (const row of results) {
      yield {
        key: JSON.parse(row.key) as KvKey,
        value: JSON.parse(row.value),
      };
    }
  }
}

/**
 * Options for {@link WorkersMessageQueue}.
 * @since 2.0.0
 */
export interface WorkersMessageQueueOptions {
  /**
   * The KV namespace to use for ordering key locks.  If not provided, ordering
   * keys will not be supported.
   *
   * Note: Cloudflare Workers KV has eventual consistency, so ordering key
   * guarantees are best-effort.  For strict ordering requirements, consider
   * using Durable Objects.
   */
  readonly orderingKv?: WorkersKvNamespaceLike<string>;

  /**
   * The prefix for ordering key lock keys.  Defaults to `"__fedify_ordering_"`.
   * @default `"__fedify_ordering_"`
   */
  readonly orderingKeyPrefix?: string;

  /**
   * The TTL (time-to-live) for ordering key locks in seconds.
   * Defaults to 60 seconds.  Must be at least 60 seconds due to
   * Cloudflare KV minimum TTL requirement.
   * @default 60
   */
  readonly orderingLockTtl?: number;
}

/**
 * Implementation of the {@link MessageQueue} interface for Cloudflare
 * Workers Queues binding.  This class provides a wrapper around Cloudflare's
 * Queues to send messages to a queue.
 *
 * Note that this implementation does not support the `listen()` method,
 * as Cloudflare Workers Queues do not support message consumption in the same
 * way as other message queue systems.  Instead, you should use
 * the {@link WorkersMessageQueue.processMessage} method to handle ordering key
 * locks before calling {@link Federation.processQueuedTask}.
 * @since 1.9.0
 */
export class WorkersMessageQueue implements MessageQueue {
  #queue: Queue;
  #orderingKv?: WorkersKvNamespaceLike<string>;
  #orderingKeyPrefix: string;
  #orderingLockTtl: number;

  /**
   * Cloudflare Queues provide automatic retry with exponential backoff
   * and Dead Letter Queues.
   * @since 1.7.0
   */
  readonly nativeRetrial = true;

  /**
   * Constructs a new {@link WorkersMessageQueue} with the given queue and
   * optional ordering key configuration.
   * @param queue The Cloudflare Queue binding.
   * @param options Options for ordering key support.
   */
  constructor(queue: Queue, options: WorkersMessageQueueOptions = {}) {
    this.#queue = queue;
    this.#orderingKv = options.orderingKv;
    this.#orderingKeyPrefix = options.orderingKeyPrefix ?? "__fedify_ordering_";
    this.#orderingLockTtl = Math.max(options.orderingLockTtl ?? 60, 60);
  }

  #getOrderingLockKey(orderingKey: string): string {
    return `${this.#orderingKeyPrefix}${orderingKey}`;
  }

  async enqueue(
    // oxlint-disable-next-line typescript/no-explicit-any
    message: any,
    options?: MessageQueueEnqueueOptions,
  ): Promise<void> {
    // Wrap message with ordering key if present and KV is configured
    const wrapped: WrappedMessage = {
      __fedify_ordering_key__: options?.orderingKey,
      __fedify_payload__: message,
    };
    await this.#queue.send(wrapped, {
      contentType: "json",
      delaySeconds: options?.delay?.total("seconds") ?? 0,
    });
  }

  async enqueueMany(
    // oxlint-disable-next-line typescript/no-explicit-any
    messages: readonly any[],
    options?: MessageQueueEnqueueOptions,
  ): Promise<void> {
    const utf8Encoder = new TextEncoder();

    const estimateMessageBytes = (body: WrappedMessage): number => {
      const serialized = JSON.stringify(body);

      if (serialized === undefined) {
        throw new TypeError("Queue message must be JSON-serializable.");
      }

      return (
        utf8Encoder.encode(serialized).byteLength +
        ESTIMATED_METADATA_BYTES_PER_MESSAGE
      );
    };

    const delaySeconds = options?.delay?.total("seconds") ?? 0;

    let batch: MessageSendRequest[] = [];
    let estimatedBatchBytes = 0;

    const flush = async (): Promise<void> => {
      if (batch.length === 0) return;

      await this.#queue.sendBatch(batch, { delaySeconds });

      batch = [];
      estimatedBatchBytes = 0;
    };

    for (const message of messages) {
      const body = {
        __fedify_ordering_key__: options?.orderingKey,
        __fedify_payload__: message,
      } satisfies WrappedMessage;

      const request = {
        body,
        contentType: "json",
      } satisfies MessageSendRequest;

      const messageBytes = estimateMessageBytes(body);
      const exceedsBatchLimit =
        batch.length >= MAX_BATCH_MESSAGES ||
        estimatedBatchBytes + messageBytes > MAX_ESTIMATED_BATCH_BYTES;

      if (batch.length > 0 && exceedsBatchLimit) {
        await flush();
      }

      batch.push(request);
      estimatedBatchBytes += messageBytes;
    }

    await flush();
  }

  /**
   * Processes a message from the queue, handling ordering key locks.
   * Call this method before {@link Federation.processQueuedTask} to ensure
   * ordering key semantics are respected.
   *
   * Example usage in a Cloudflare Worker queue handler:
   *
   * ```typescript ignore
   * export default {
   *   async queue(batch, env, ctx) {
   *     const queue = new WorkersMessageQueue(env.QUEUE, {
   *       orderingKv: env.ORDERING_KV,
   *     });
   *     for (const msg of batch.messages) {
   *       const result = await queue.processMessage(msg.body);
   *       if (!result.shouldProcess) {
   *         msg.retry();  // Re-enqueue to wait for lock
   *         continue;
   *       }
   *       try {
   *         await federation.processQueuedTask(ctx, result.message);
   *         msg.ack();
   *       } catch (e) {
   *         msg.retry();
   *       } finally {
   *         await result.release?.();
   *       }
   *     }
   *   }
   * };
   * ```
   *
   * @param rawMessage The raw message body from the queue.
   * @returns A result object indicating whether to process the message.
   * @since 2.0.0
   */
  // oxlint-disable-next-line typescript/no-explicit-any
  async processMessage(rawMessage: any): Promise<ProcessMessageResult> {
    // Handle both wrapped and unwrapped messages for backwards compatibility
    const wrapped = rawMessage as WrappedMessage;
    const orderingKey = wrapped.__fedify_ordering_key__;
    const message =
      "__fedify_payload__" in wrapped ? wrapped.__fedify_payload__ : rawMessage;

    // If no ordering key or no KV configured, process immediately
    if (orderingKey == null || this.#orderingKv == null) {
      return { shouldProcess: true, message };
    }

    const lockKey = this.#getOrderingLockKey(orderingKey);

    // Check if lock exists
    const existing = await this.#orderingKv.get(lockKey);
    if (existing != null) {
      // Lock exists, message should be retried later
      return { shouldProcess: false };
    }

    // Try to acquire lock
    // Note: Workers KV doesn't support atomic CAS, so there's a race condition
    // window.  This is best-effort ordering.
    await this.#orderingKv.put(lockKey, Date.now().toString(), {
      expirationTtl: this.#orderingLockTtl,
    });

    const release = async (): Promise<void> => {
      await this.#orderingKv!.delete(lockKey);
    };

    return { shouldProcess: true, message, release };
  }

  listen(
    // oxlint-disable-next-line typescript/no-explicit-any
    _handler: (message: any) => Promise<void> | void,
    _options?: MessageQueueListenOptions,
  ): Promise<void> {
    throw new TypeError(
      "WorkersMessageQueue does not support listen().  " +
        "Use Federation.processQueuedTask() method instead.",
    );
  }
}
