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
  AtomicKvStore,
  KvStoreCasEntry,
  KvStoreSetEntry,
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
  batch(
    statements: WorkersD1PreparedStatementLike[],
  ): Promise<{ readonly meta: { readonly changes: number } }[]>;
}

/**
 * Options for {@link WorkersD1KvStore}.
 * @since 2.5.0
 */
export interface WorkersD1KvStoreOptions {
  /**
   * The table name to use for the key–value store.  It must be 1 to 64
   * characters long, consist of ASCII letters, digits, and underscores, and
   * not start with a digit or end with `_atomic`.  Names starting with `sqlite_` or `_cf_`
   * (case-insensitively) are reserved by SQLite and D1, so they are rejected
   * too.  The store also creates an index named `idx_<tableName>_expires`,
   * and an auxiliary table named `<tableName>_atomic`, so no unrelated object
   * may use either name.
   * `"fedify_kv"` by default.
   * @default `"fedify_kv"`
   */
  readonly tableName?: string;

  /**
   * Whether both tables and the index have already been created, for example, by a D1
   * migration.  If `false`, each store instance creates the table on its
   * first use, then validates the schema with metadata queries.  Since a store is
   * usually constructed per request on Cloudflare Workers, create the table
   * with a D1 migration and set this to `true` in production.
   * `false` by default.
   * @default `false`
   */
  readonly initialized?: boolean;
}

interface D1PreparedMutation {
  readonly key: string;
  readonly expected: string | undefined;
  readonly value: string | undefined;
  readonly ttl: number | null;
}

/**
 * The current time in milliseconds since the Unix epoch, as seen by D1.
 * Comparing expiration against the database clock keeps each statement
 * consistent with the moment it actually runs, rather than the moment the
 * Worker sent it.
 */
const D1_NOW = "CAST(unixepoch('subsec') * 1000 AS INTEGER)";

/**
 * The maximum number of rows to fetch per query in
 * {@link WorkersD1KvStore.list}.  Large pages keep ordinary scans within
 * D1's limit on queries per Worker invocation (50 on the Free plan).
 */
const D1_LIST_PAGE_ROWS = 1000;

/**
 * The approximate maximum number of bytes of keys and values to fetch per
 * query in {@link WorkersD1KvStore.list}.  A page stops at the first row that
 * starts beyond this budget, so with D1 rows of up to 2 MB, a page stays well
 * under D1's 50 MB limit on query results.
 */
const D1_LIST_PAGE_BYTES = 8 * 1024 * 1024;

/**
 * The maximum number of expired rows to delete per write.
 */
const D1_EXPIRE_BATCH_SIZE = 100;

/**
 * An {@link AtomicKvStore} backed by Cloudflare D1.  All keys in one configured
 * table share an atomic scope.  Each nonempty set or CAS uses one transactional
 * batch and a private guard row to freeze its decision and database-clock
 * expiry cutoff.  This also routes absence-only CAS through a write.
 *
 * Pass the `D1Database` binding for fresh primary reads.  Caller-owned
 * `D1DatabaseSession` objects are also accepted: their reads, including the
 * single-statement snapshot from {@link getMany}, may use stale replicas.
 * Sessions retain their own bookmark and sequential-consistency behavior;
 * the adapter never replaces them or calls `withSession()`.
 *
 * Values round-trip through `JSON.stringify()` and `JSON.parse()`, including
 * JSON coercions such as nonfinite numbers becoming `null` and omitted
 * undefined object members.  Values without a JSON serialization reject.
 * CAS compares persisted JSON structurally, ignoring object member order but
 * preserving array order and types.  Beyond SQLite's 1,000-level JSON depth
 * limit, comparison falls back to exact serialized equality.  Include a
 * non-reused version in values when ABA changes must be detected.
 *
 * TTLs are truncated to integer milliseconds, with an absolute maximum of
 * 8.64e15 milliseconds.  Calendar durations requiring a reference date reject.
 * Nonpositive TTLs expire immediately; omitting a TTL clears previous expiry.
 * Successful sets and CAS purge at most 100 rows expired at the same cutoff.
 * Mismatch leaves all user rows and their TTLs unchanged.
 *
 * Snapshots accept at most 256 input keys, including duplicates, and return at
 * most 8 MiB of encoded keys and values.  Mutations accept at most 128 entries
 * and 16 MiB of encoded keys, expectations and replacements combined.  Each
 * encoded key/value row, bound string, aggregate snapshot/deletion key input,
 * and final JSON key payload is limited to 1,999,000 UTF-8 bytes.  These are
 * conservative adapter limits; backend/runtime limits may reject smaller
 * calls.  Operations are never split.  Errors propagate without write retry;
 * a lost response may leave commit status unknown.  `false` means only a
 * proven CAS mismatch, not a backend failure or a durable operation receipt.
 *
 * Automatic initialization creates and checks the following schema.  Use a
 * D1 migration with both tables and the index, and `initialized: true`, to
 * avoid repeating schema queries in each request.  Derived object names are
 * reserved; external guard writes, triggers and custom constraints that alter
 * this protocol are unsupported.  The guard table must normally be empty.
 *
 * ```sql
 * CREATE TABLE IF NOT EXISTS fedify_kv (
 *   key TEXT PRIMARY KEY NOT NULL,
 *   value TEXT NOT NULL,
 *   expires INTEGER
 * );
 * CREATE INDEX IF NOT EXISTS idx_fedify_kv_expires ON fedify_kv (expires);
 * CREATE TABLE IF NOT EXISTS fedify_kv_atomic (
 *   singleton INTEGER PRIMARY KEY,
 *   cutoff INTEGER NOT NULL,
 *   matched INTEGER NOT NULL
 * );
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
 *       // The table is created by a D1 migration:
 *       kv: new WorkersD1KvStore(env.DB, { initialized: true }),
 *       // ... other options
 *     });
 *     return federation.fetch(request, { contextData: env });
 *   },
 * } satisfies ExportedHandler<{ DB: D1Database }>;
 * ```
 * @since 2.5.0
 */
export class WorkersD1KvStore implements AtomicKvStore {
  static readonly #defaultTableName = "fedify_kv";
  static readonly #tableNameRegex = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
  static readonly #reservedTableNameRegex = /^(sqlite_|_cf_)/i;
  readonly #db: WorkersD1DatabaseLike;
  readonly #tableName: string;
  #initialized: Promise<void> | null;

  /**
   * Constructs a new {@link WorkersD1KvStore} with the given D1 binding.
   * @param db The Cloudflare D1 binding.  A D1 session is also accepted, but
   *           it only provides sequential consistency.
   * @param options Options for the key–value store.
   * @throws {TypeError} If the table name does not follow the rules
   *                     described in {@link WorkersD1KvStoreOptions.tableName}.
   */
  constructor(
    db: WorkersD1DatabaseLike,
    options: WorkersD1KvStoreOptions = {},
  ) {
    this.#db = db;
    this.#tableName = options.tableName ?? WorkersD1KvStore.#defaultTableName;
    if (
      !WorkersD1KvStore.#tableNameRegex.test(this.#tableName) ||
      WorkersD1KvStore.#reservedTableNameRegex.test(this.#tableName) ||
      /_atomic$/i.test(this.#tableName)
    ) {
      throw new TypeError(
        `Invalid table name for the key–value store: ${this.#tableName}`,
      );
    }
    this.#initialized = options.initialized ? Promise.resolve() : null;
  }

  /**
   * Creates both tables and the expiry index if absent, and verifies the
   * binary key primary index, auxiliary table, and expiry index metadata.
   * It is called
   * automatically on the first use of the store instance unless
   * the `initialized` option is set.
   */
  initialize(): Promise<void> {
    this.#initialized ??= this.#db
      .batch([
        this.#db.prepare(`CREATE TABLE IF NOT EXISTS "${this.#tableName}" (
        key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, expires INTEGER
      )`),
        this.#db
          .prepare(`CREATE INDEX IF NOT EXISTS "idx_${this.#tableName}_expires"
        ON "${this.#tableName}" (expires)`),
        this.#db
          .prepare(`CREATE TABLE IF NOT EXISTS "${this.#tableName}_atomic" (
        singleton INTEGER PRIMARY KEY, cutoff INTEGER NOT NULL, matched INTEGER NOT NULL
      )`),
      ])
      .then(async () => {
        const [
          { results: columns },
          owner,
          { results: index },
          { results: indexes },
          object,
        ] = await Promise.all([
          this.#db
            .prepare(`PRAGMA table_xinfo("${this.#tableName}_atomic")`)
            .all<{
              name: string;
              type: string;
              notnull: number;
              pk: number;
              hidden: number;
            }>(),
          this.#db
            .prepare(
              "SELECT tbl_name FROM sqlite_master WHERE type = 'index' AND name = ?1 COLLATE NOCASE",
            )
            .bind(`idx_${this.#tableName}_expires`)
            .first<{ tbl_name: string }>(),
          this.#db
            .prepare(`PRAGMA index_info("idx_${this.#tableName}_expires")`)
            .all<{ name: string | null }>(),
          this.#db.prepare(`PRAGMA index_list("${this.#tableName}")`).all<{
            name: string;
            unique: number;
            partial: number;
            origin: string;
          }>(),
          this.#db
            .prepare(
              "SELECT type FROM sqlite_master WHERE name = ?1 COLLATE NOCASE",
            )
            .bind(`${this.#tableName}_atomic`)
            .first<{ type: string }>(),
        ]);
        const primaryIndex = indexes.find((entry) => entry.origin === "pk");
        const primaryColumns =
          primaryIndex == null
            ? []
            : (
                await this.#db
                  .prepare(
                    `PRAGMA index_xinfo("${primaryIndex.name.replaceAll('"', '""')}")`,
                  )
                  .all<{ name: string | null; coll: string; key: number }>()
              ).results;
        const keyColumns = primaryColumns.filter((column) => column.key === 1);
        const shape = new Map(
          columns.map((column) => [column.name.toLowerCase(), column]),
        );
        const expiryIndex = indexes.find(
          (entry) =>
            entry.name.toLowerCase() ===
            `idx_${this.#tableName}_expires`.toLowerCase(),
        );
        if (
          primaryIndex?.unique !== 1 ||
          primaryIndex?.partial !== 0 ||
          keyColumns.length !== 1 ||
          keyColumns[0].name?.toLowerCase() !== "key" ||
          keyColumns[0].coll.toUpperCase() !== "BINARY" ||
          object?.type !== "table" ||
          columns.length !== 3 ||
          columns.some((column) => column.hidden !== 0) ||
          shape.get("singleton")?.type.toUpperCase() !== "INTEGER" ||
          shape.get("singleton")?.pk !== 1 ||
          shape.get("cutoff")?.type.toUpperCase() !== "INTEGER" ||
          shape.get("cutoff")?.notnull !== 1 ||
          shape.get("cutoff")?.pk !== 0 ||
          shape.get("matched")?.type.toUpperCase() !== "INTEGER" ||
          shape.get("matched")?.notnull !== 1 ||
          shape.get("matched")?.pk !== 0 ||
          owner?.tbl_name.toLowerCase() !== this.#tableName.toLowerCase() ||
          index.length !== 1 ||
          index[0].name?.toLowerCase() !== "expires" ||
          expiryIndex?.unique !== 0 ||
          expiryIndex?.partial !== 0
        ) {
          throw new TypeError(
            `Incompatible D1 KV schema for "${this.#tableName}" or its atomic table/expiry index.`,
          );
        }
      })
      .catch((error) => {
        this.#initialized = null;
        throw error;
      });
    return this.#initialized;
  }

  /**
   * Drops both tables reserved by this store.  Mostly useful for tests.
   * No unrelated object may use either table name.
   */
  async drop(): Promise<void> {
    await this.#db.batch([
      this.#db.prepare(`DROP TABLE IF EXISTS "${this.#tableName}_atomic"`),
      this.#db.prepare(`DROP TABLE IF EXISTS "${this.#tableName}"`),
    ]);
    this.#initialized = null;
  }

  #encodeKey(key: KvKey): string {
    if (!Array.isArray(key)) {
      throw new TypeError("A KV key must be a non-empty array of strings.");
    }
    const length = key.length;
    if (!Number.isSafeInteger(length) || length < 1) {
      throw new TypeError("A KV key must be a non-empty array of strings.");
    }
    const parts: string[] = [];
    for (let index = 0; index < length; index++) {
      if (!Object.hasOwn(key, index))
        throw new TypeError("A KV key must not be sparse.");
      const part = key[index];
      if (typeof part !== "string")
        throw new TypeError("A KV key must contain only strings.");
      parts.push(part);
    }
    const encoded = JSON.stringify(parts);
    this.#checkBytes(encoded);
    return encoded;
  }

  #checkBytes(value: string): number {
    const bytes = new TextEncoder().encode(value).byteLength;
    if (bytes > 1_999_000)
      throw new RangeError("D1 KV string/row size limit exceeded.");
    return bytes;
  }

  #array<T>(items: readonly T[], limit: number): T[] {
    if (!Array.isArray(items))
      throw new TypeError("A KV batch must be an array.");
    const length = items.length;
    if (!Number.isSafeInteger(length) || length < 0)
      throw new TypeError("Invalid KV batch length.");
    if (length > limit)
      throw new RangeError(`D1 KV batch exceeds ${limit} entries.`);
    const captured: T[] = [];
    for (let index = 0; index < length; index++) {
      if (!Object.hasOwn(items, index))
        throw new TypeError("A KV batch must not be sparse.");
      captured.push(items[index]);
    }
    return captured;
  }

  #encodeValue(value: unknown): string {
    const encoded = JSON.stringify(value);
    if (encoded === undefined)
      throw new TypeError("Value has no JSON serialization.");
    this.#checkBytes(encoded);
    return encoded;
  }

  #prepare(
    entries: readonly KvStoreCasEntry[],
    compare: boolean,
  ): D1PreparedMutation[] {
    const captured = this.#array(entries, 128).map((entry) => ({
      key: entry.key,
      expected: entry.expectedValue,
      value: entry.newValue,
      ttl: entry.options?.ttl,
    }));
    if (captured.length > 128)
      throw new RangeError("D1 KV mutation exceeds 128 entries.");
    const seen = new Set<string>();
    let bytes = 0;
    return captured.map((entry) => {
      const key = this.#encodeKey(entry.key);
      if (seen.has(key))
        throw new TypeError("Duplicate keys in an atomic mutation.");
      seen.add(key);
      if (!compare && entry.value === undefined) {
        throw new TypeError("undefined is not a storable KV value.");
      }
      if (entry.value === undefined && entry.ttl != null) {
        throw new TypeError("A CAS deletion must not specify a TTL.");
      }
      const expected =
        entry.expected === undefined
          ? undefined
          : this.#encodeValue(entry.expected);
      const value =
        entry.value === undefined ? undefined : this.#encodeValue(entry.value);
      let ttl: number | null = null;
      if (entry.ttl != null) {
        const total = entry.ttl.total("milliseconds");
        if (!Number.isFinite(total) || Math.abs(total) > 8.64e15) {
          throw new RangeError(
            "D1 KV TTL exceeds the supported millisecond range.",
          );
        }
        ttl = Math.trunc(total);
      }
      this.#checkBytes(key + (value ?? ""));
      bytes +=
        this.#checkBytes(key) +
        (expected == null ? 0 : this.#checkBytes(expected)) +
        (value == null ? 0 : this.#checkBytes(value));
      if (bytes > 16 * 1024 * 1024)
        throw new RangeError("D1 KV mutation exceeds 16 MiB.");
      return { key, expected, value, ttl };
    });
  }

  // Resolve JSON virtual tables outside main so application tables cannot shadow them.
  #matches(current: string, expected: string): string {
    return `CASE WHEN json_valid(${current}) AND json_valid(${expected}) THEN
      NOT EXISTS (
        SELECT fullkey, type, atom FROM temp.json_tree(${current})
        EXCEPT SELECT fullkey, type, atom FROM temp.json_tree(${expected})
      ) AND NOT EXISTS (
        SELECT fullkey, type, atom FROM temp.json_tree(${expected})
        EXCEPT SELECT fullkey, type, atom FROM temp.json_tree(${current})
      ) ELSE ${current} = ${expected} END`;
  }

  async #mutate(
    entries: readonly D1PreparedMutation[],
    compare: boolean,
  ): Promise<boolean> {
    if (entries.length === 0) return true;
    await this.initialize();
    const guard = `"${this.#tableName}_atomic"`;
    const cutoff = `(SELECT cutoff FROM ${guard} WHERE singleton = 1)`;
    const permitted = `(SELECT matched FROM ${guard} WHERE singleton = 1) = 1`;
    // The first write captures one cutoff and forces a primary transaction.
    const statements: WorkersD1PreparedStatementLike[] = [
      this.#db.prepare(`
      INSERT INTO ${guard} (singleton, cutoff, matched) VALUES (1, ${D1_NOW}, 1)
    `),
    ];
    // Freeze every comparison before changing any user row.
    if (compare) {
      for (const entry of entries) {
        const live = `SELECT 1 FROM "${this.#tableName}" AS current
          WHERE current.key COLLATE BINARY = ?1 AND (current.expires IS NULL OR current.expires > ${cutoff})`;
        const predicate =
          entry.expected === undefined
            ? `NOT EXISTS (${live})`
            : `EXISTS (${live} AND ${this.#matches("current.value", "?2")})`;
        const statement = this.#db.prepare(`UPDATE ${guard} SET matched = 0
          WHERE singleton = 1 AND matched = 1 AND NOT (${predicate})`);
        statements.push(
          entry.expected === undefined
            ? statement.bind(entry.key)
            : statement.bind(entry.key, entry.expected),
        );
      }
    }
    for (const entry of entries) {
      statements.push(
        entry.value === undefined
          ? this.#db
              .prepare(`
        DELETE FROM "${this.#tableName}" WHERE key COLLATE BINARY = ?1 AND ${permitted}
      `)
              .bind(entry.key)
          : this.#db
              .prepare(`
        INSERT INTO "${this.#tableName}" (key, value, expires)
        SELECT ?1, ?2, ${cutoff} + ?3 WHERE ${permitted}
        ON CONFLICT (key COLLATE BINARY) DO UPDATE SET value = excluded.value, expires = excluded.expires
      `)
              .bind(entry.key, entry.value, entry.ttl),
      );
    }
    statements.push(
      this.#db.prepare(`DELETE FROM "${this.#tableName}"
      WHERE ${permitted} AND key COLLATE BINARY IN (SELECT key FROM "${this.#tableName}"
        WHERE expires <= ${cutoff} LIMIT ${D1_EXPIRE_BATCH_SIZE})`),
    );
    // These two result counts distinguish mismatch from a missing guard.
    const resultIndex = statements.length;
    statements.push(
      this.#db.prepare(
        `DELETE FROM ${guard} WHERE singleton = 1 AND matched = 1`,
      ),
    );
    statements.push(
      this.#db.prepare(`DELETE FROM ${guard} WHERE singleton = 1`),
    );
    const results = await this.#db.batch(statements);
    const matched = results[resultIndex].meta.changes;
    const cleaned = results[resultIndex + 1].meta.changes;
    if (matched === 1 && cleaned === 0) return true;
    if (matched === 0 && cleaned === 1) return false;
    throw new Error(
      `D1 KV atomic guard integrity failure for "${this.#tableName}_atomic".`,
    );
  }

  /** {@inheritDoc KvStore.get} */
  async get<T = unknown>(key: KvKey): Promise<T | undefined> {
    const encoded = this.#encodeKey(key);
    await this.initialize();
    const row = await this.#db
      .prepare(`
      SELECT value FROM "${this.#tableName}"
      WHERE key COLLATE BINARY = ?1 AND (expires IS NULL OR expires > ${D1_NOW})
    `)
      .bind(encoded)
      .first<{ value: string }>();
    return row == null ? undefined : (JSON.parse(row.value) as T);
  }

  /** {@inheritDoc AtomicKvStore.getMany} */
  async getMany<T = unknown>(
    keys: readonly KvKey[],
  ): Promise<(T | undefined)[]> {
    const captured = this.#array(keys, 256);
    if (captured.length > 256)
      throw new RangeError("D1 KV snapshot exceeds 256 input keys.");
    let keyBytes = 0;
    const encoded = captured.map((key) => {
      const value = this.#encodeKey(key);
      keyBytes += this.#checkBytes(value);
      if (keyBytes > 1_999_000)
        throw new RangeError("D1 KV snapshot key size limit exceeded.");
      return value;
    });
    const unique = [...new Set(encoded)];
    if (unique.length > 256)
      throw new RangeError("D1 KV snapshot exceeds 256 unique keys.");
    const payload = JSON.stringify(unique);
    this.#checkBytes(payload);
    if (unique.length === 0) return [];
    await this.initialize();
    const { results } = await this.#db
      .prepare(`
      WITH cutoff(now) AS MATERIALIZED (SELECT ${D1_NOW}),
      live AS MATERIALIZED (
        SELECT current.key, octet_length(current.key) + octet_length(current.value) AS size FROM temp.json_each(?1) AS input
        JOIN main."${this.#tableName}" AS current ON current.key COLLATE BINARY = input.value
        CROSS JOIN cutoff
        WHERE current.expires IS NULL OR current.expires > cutoff.now
      ), budget AS (SELECT COALESCE(SUM(size), 0) AS bytes FROM live)
      SELECT live.key, CASE WHEN bytes <= 8388608 THEN current.value ELSE NULL END AS value, bytes
      FROM live CROSS JOIN budget JOIN main."${this.#tableName}" AS current ON current.key COLLATE BINARY = live.key
    `)
      .bind(payload)
      .all<{ key: string; value: string | null; bytes: number }>();
    if (results.some((row) => row.bytes > 8 * 1024 * 1024)) {
      throw new RangeError("D1 KV snapshot exceeds 8 MiB.");
    }
    const values = new Map(
      results.map((row) => [row.key, JSON.parse(row.value!) as T] as const),
    );
    return encoded.map((key) => values.get(key));
  }

  /** {@inheritDoc AtomicKvStore.set} */
  async set(
    key: KvKey,
    value: unknown,
    options?: KvStoreSetOptions,
  ): Promise<void> {
    await this.setMany([{ key, value, options }]);
  }

  /** {@inheritDoc AtomicKvStore.setMany} */
  async setMany(entries: readonly KvStoreSetEntry[]): Promise<void> {
    const captured = this.#array(entries, 128).map((entry) => ({
      key: entry.key,
      newValue: entry.value,
      expectedValue: undefined,
      options: entry.options,
    }));
    if (!(await this.#mutate(this.#prepare(captured, false), false))) {
      throw new Error("D1 KV mutation lost its atomic guard.");
    }
  }

  /** {@inheritDoc KvStore.delete} */
  async delete(key: KvKey): Promise<void> {
    const encoded = this.#encodeKey(key);
    await this.initialize();
    await this.#db
      .prepare(`DELETE FROM "${this.#tableName}" WHERE key COLLATE BINARY = ?1`)
      .bind(encoded)
      .run();
  }

  /** {@inheritDoc AtomicKvStore.deleteMany} */
  async deleteMany(keys: readonly KvKey[]): Promise<void> {
    if (!Array.isArray(keys))
      throw new TypeError("A KV batch must be an array.");
    const length = keys.length;
    if (!Number.isSafeInteger(length) || length < 0)
      throw new TypeError("Invalid KV batch length.");
    if (length > 128)
      throw new RangeError("D1 KV mutation exceeds 128 entries.");
    let bytes = 0;
    const seen = new Set<string>();
    const encoded: string[] = [];
    for (let index = 0; index < length; index++) {
      if (!Object.hasOwn(keys, index))
        throw new TypeError("A KV batch must not be sparse.");
      const value = this.#encodeKey(keys[index]);
      if (seen.has(value))
        throw new TypeError("Duplicate keys in an atomic mutation.");
      bytes += this.#checkBytes(value);
      if (bytes > 1_999_000)
        throw new RangeError("D1 KV deletion key size limit exceeded.");
      seen.add(value);
      encoded.push(value);
    }
    const payload = JSON.stringify(encoded);
    this.#checkBytes(payload);
    if (encoded.length === 0) return;
    await this.initialize();
    await this.#db.batch([
      this.#db
        .prepare(`DELETE FROM "${this.#tableName}"
      WHERE key COLLATE BINARY IN (SELECT value FROM temp.json_each(?1))`)
        .bind(payload),
    ]);
  }

  /** {@inheritDoc AtomicKvStore.cas} */
  async cas(
    key: KvKey,
    expectedValue: unknown,
    newValue: unknown,
    options?: KvStoreSetOptions,
  ): Promise<boolean> {
    return await this.casMany([{ key, expectedValue, newValue, options }]);
  }

  /** {@inheritDoc AtomicKvStore.casMany} */
  async casMany(entries: readonly KvStoreCasEntry[]): Promise<boolean> {
    return await this.#mutate(this.#prepare(entries, true), true);
  }

  /**
   * {@inheritDoc KvStore.list}
   */
  async *list(prefix?: KvKey): AsyncIterable<KvStoreListEntry> {
    await this.initialize();
    // Keys are JSON-encoded arrays of strings, so they all fall in the range
    // ('[', '\\').  Keys with a prefix such as ["a"] start with '["a"', and
    // since a closing quote is followed by ',' or ']', they all sort below
    // '["a#'.  Neither bound is a valid key itself:
    let cursor: string;
    let upperBound: string;
    if (prefix == null || prefix.length === 0) {
      cursor = "[";
      upperBound = "\\";
    } else {
      cursor = JSON.stringify(prefix).slice(0, -1);
      upperBound = cursor.slice(0, -1) + "#";
    }
    // Each page takes up to D1_LIST_PAGE_ROWS rows, but stops at the first
    // row that starts beyond D1_LIST_PAGE_BYTES.  The sizes are computed
    // without buffering the values, which are then fetched by key.  Every row
    // carries the number of rows the page would have had without the byte
    // budget, which tells whether the range is exhausted:
    const statement = this.#db.prepare(`
      WITH page AS (
        SELECT key, octet_length(key) + octet_length(value) AS size
        FROM main."${this.#tableName}"
        WHERE key COLLATE BINARY > ?1 AND key COLLATE BINARY < ?2
          AND (expires IS NULL OR expires > ${D1_NOW})
        ORDER BY key COLLATE BINARY
        LIMIT ${D1_LIST_PAGE_ROWS}
      ), sized AS (
        SELECT
          key,
          size,
          SUM(size) OVER (ORDER BY key COLLATE BINARY ROWS UNBOUNDED PRECEDING) AS total,
          COUNT(*) OVER () AS page_rows
        FROM page
      )
      SELECT t.key, t.value, sized.page_rows
      FROM sized JOIN main."${this.#tableName}" AS t ON t.key COLLATE BINARY = sized.key
      WHERE sized.total - sized.size < ${D1_LIST_PAGE_BYTES}
      ORDER BY t.key COLLATE BINARY
    `);
    while (true) {
      const { results } = await statement
        .bind(cursor, upperBound)
        .all<{ key: string; value: string; page_rows: number }>();
      for (const row of results) {
        yield {
          key: JSON.parse(row.key) as KvKey,
          value: JSON.parse(row.value),
        };
      }
      if (
        results.length < 1 ||
        (results[0].page_rows < D1_LIST_PAGE_ROWS &&
          results.length >= results[0].page_rows)
      ) {
        break;
      }
      cursor = results[results.length - 1].key;
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
