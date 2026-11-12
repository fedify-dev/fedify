import { type PlatformDatabase, SqliteDatabase } from "#sqlite";
import type {
  AtomicKvStore,
  KvKey,
  KvStoreCasEntry,
  KvStoreListEntry,
  KvStoreSetEntry,
  KvStoreSetOptions,
} from "@fedify/fedify";
import { getLogger } from "@logtape/logtape";
import { isEqual } from "es-toolkit";
import type {
  SqliteDatabaseAdapter,
  SqliteStatementAdapter,
} from "./adapter.ts";

const logger = getLogger(["fedify", "sqlite", "kv"]);

/**
 * Options for the SQLite key–value store.
 */
export interface SqliteKvStoreOptions {
  /**
   * The table name to use for the key–value store.
   * Only letters, digits, and underscores are allowed.
   * `"fedify_kv"` by default.
   * @default `"fedify_kv"`
   */
  readonly tableName?: string;

  /**
   * Whether the table has been initialized.  `false` by default.
   * @default `false`
   */
  readonly initialized?: boolean;
}

/**
 * A key–value store that uses SQLite as the underlying storage.
 *
 * Implements {@link AtomicKvStore} across all keys in the configured table
 * of one database.  Values use JSON serialization; CAS compares decoded JSON
 * structurally against the expected value, ignoring object member order.
 * Use JSON data and expectations in their decoded form.  For example, a
 * stored `Date` becomes a string, and undefined object members disappear.
 * Inputs must be immutable, passive data without reentrant accessors.
 *
 * Nonempty batch operations and ordinary mutations own an immediate
 * transaction and require a writable, normally locking connection outside
 * caller-owned transactions.  Even snapshots and mismatching CAS can reject
 * on contention, including readers in rollback-journal mode.  Configure a
 * busy timeout on the connection if needed; this store does not retry or
 * change journal settings.  Initialize outside caller transactions before
 * using ordinary {@link SqliteKvStore.get | get()} or
 * {@link SqliteKvStore.list | list()} there.
 *
 * TTLs use one millisecond-resolution cutoff per operation and preserve
 * representable fractional milliseconds.  Calendar-dependent durations and
 * nonfinite or out-of-range expiry values reject.  Nonpositive TTLs expire
 * immediately; omitting a replacement TTL clears it.  There is no fixed
 * batch-count limit; memory and SQLite limits apply, with no split commits.
 * Atomicity does not establish crash durability or external exactly-once
 * effects.  See the package README for journaling and runtime restrictions.
 *
 * @example
 * ```ts
 * import { createFederation } from "@fedify/fedify";
 * import { SqliteKvStore } from "@fedify/sqlite";
 * import { DatabaseSync } from "node:sqlite";
 *
 * const db = new DatabaseSync(":memory:");
 * const federation = createFederation({
 *   // ...
 *   kv: new SqliteKvStore(db),
 * });
 * ```
 */
export class SqliteKvStore implements AtomicKvStore {
  static readonly #defaultTableName = "fedify_kv";
  static readonly #tableNameRegex = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
  readonly #db: SqliteDatabaseAdapter;
  readonly #tableName: string;
  #initialized: boolean;

  /**
   * Creates a new SQLite key–value store.
   * @param db The SQLite database to use. Supports `node:sqlite` and `bun:sqlite`.
   * @param options The options for the key–value store.
   */
  constructor(
    readonly db: PlatformDatabase,
    readonly options: SqliteKvStoreOptions = {},
  ) {
    this.#db = new SqliteDatabase(db);
    this.#initialized = options.initialized ?? false;
    this.#tableName = options.tableName ?? SqliteKvStore.#defaultTableName;

    if (!SqliteKvStore.#tableNameRegex.test(this.#tableName)) {
      throw new Error(
        `Invalid table name for the key–value store: ${this.#tableName}`,
      );
    }
  }

  /**
   * {@inheritDoc AtomicKvStore.get}
   */
  // oxlint-disable-next-line eslint/require-await
  async get<T = unknown>(key: KvKey): Promise<T | undefined> {
    this.initialize();

    const encodedKey = this.#encodeKey(key);
    const now = Temporal.Now.instant().epochMilliseconds;

    const result = this.#db
      .prepare(`
      SELECT value
      FROM "${this.#tableName}"
      WHERE key = ? AND (expires IS NULL OR expires > ?)
    `)
      .get(encodedKey, now);

    if (!result) {
      return undefined;
    }
    return this.#decodeValue((result as { value: string }).value) as T;
  }

  /** {@inheritDoc AtomicKvStore.set} */
  set(key: KvKey, value: unknown, options?: KvStoreSetOptions): Promise<void> {
    return this.setMany([{ key, value, options }]);
  }

  /** {@inheritDoc AtomicKvStore.delete} */
  delete(key: KvKey): Promise<void> {
    return this.deleteMany([key]);
  }

  /** {@inheritDoc AtomicKvStore.cas} */
  cas(
    key: KvKey,
    expectedValue: unknown,
    newValue: unknown,
    options?: KvStoreSetOptions,
  ): Promise<boolean> {
    return this.casMany([{ key, expectedValue, newValue, options }]);
  }

  /**
   * {@inheritDoc AtomicKvStore.getMany}
   * @since 2.5.0
   */
  // oxlint-disable-next-line eslint/require-await
  async getMany<T = unknown>(
    keys: readonly KvKey[],
  ): Promise<(T | undefined)[]> {
    const encoded = this.#encodeKeys(keys);
    if (encoded.length === 0) return [];
    return this.#transaction((now) => {
      const read = this.#prepareRead();
      return encoded.map((key) => this.#read(read, key, now) as T | undefined);
    });
  }

  /**
   * {@inheritDoc AtomicKvStore.setMany}
   * @since 2.5.0
   */
  // oxlint-disable-next-line eslint/require-await
  async setMany(entries: readonly KvStoreSetEntry[]): Promise<void> {
    const prepared = this.#capture(entries).map((entry) => {
      const key = entry.key;
      const value = entry.value;
      const ttl = entry.options?.ttl;
      return {
        key: this.#encodeKey(key),
        value: this.#encodeValue(value),
        ttl: this.#ttlMilliseconds(ttl),
      };
    });
    this.#assertUnique(prepared.map((entry) => entry.key));
    if (prepared.length === 0) return;
    this.#transaction((now) => {
      const writes = prepared.map((entry) => ({
        ...entry,
        expires: this.#expiresAt(entry.ttl, now),
      }));
      const write = this.#prepareWrite();
      for (const entry of writes) {
        write.run(entry.key, entry.value, now, entry.expires);
      }
      this.#expire(now);
    });
  }

  /**
   * {@inheritDoc AtomicKvStore.deleteMany}
   * @since 2.5.0
   */
  // oxlint-disable-next-line eslint/require-await
  async deleteMany(keys: readonly KvKey[]): Promise<void> {
    const encoded = this.#encodeKeys(keys);
    this.#assertUnique(encoded);
    if (encoded.length === 0) return;
    this.#transaction((now) => {
      const remove = this.#prepareDelete();
      for (const key of encoded) remove.run(key);
      this.#expire(now);
    });
  }

  /**
   * {@inheritDoc AtomicKvStore.casMany}
   * @since 2.5.0
   */
  // oxlint-disable-next-line eslint/require-await
  async casMany(entries: readonly KvStoreCasEntry[]): Promise<boolean> {
    const prepared = this.#capture(entries).map((entry) => {
      const key = entry.key;
      const expectedValue = entry.expectedValue;
      const newValue = entry.newValue;
      const ttl = entry.options?.ttl;
      if (newValue === undefined && ttl != null) {
        throw new TypeError("A CAS deletion must not specify a TTL.");
      }
      return {
        key: this.#encodeKey(key),
        expectedValue,
        value: newValue === undefined ? undefined : this.#encodeValue(newValue),
        ttl: this.#ttlMilliseconds(ttl),
      };
    });
    this.#assertUnique(prepared.map((entry) => entry.key));
    if (prepared.length === 0) return true;
    return this.#transaction((now) => {
      // Validate every expiry before any comparison or mutation, even on mismatch.
      const writes = prepared.map((entry) => ({
        ...entry,
        expires: this.#expiresAt(entry.ttl, now),
      }));
      const read = this.#prepareRead();
      for (const entry of writes) {
        if (!isEqual(this.#read(read, entry.key, now), entry.expectedValue)) {
          return false;
        }
      }
      const write = this.#prepareWrite();
      const remove = this.#prepareDelete();
      for (const entry of writes) {
        if (entry.value === undefined) remove.run(entry.key);
        else write.run(entry.key, entry.value, now, entry.expires);
      }
      this.#expire(now);
      return true;
    });
  }

  /**
   * {@inheritDoc AtomicKvStore.list}
   * @since 1.10.0
   */
  async *list(prefix?: KvKey): AsyncIterable<KvStoreListEntry> {
    this.initialize();

    const now = Temporal.Now.instant().epochMilliseconds;

    let results: { key: string; value: string }[];

    if (prefix == null || prefix.length === 0) {
      // Empty prefix: return all entries
      results = this.#db
        .prepare(`
          SELECT key, value
          FROM "${this.#tableName}"
          WHERE expires IS NULL OR expires > ?
          ORDER BY key
        `)
        .all(now) as { key: string; value: string }[];
    } else {
      // JSON pattern: '["prefix","' matches keys starting with prefix
      const pattern = JSON.stringify(prefix).slice(0, -1) + ",%";
      const exactKey = JSON.stringify(prefix);

      results = this.#db
        .prepare(`
          SELECT key, value
          FROM "${this.#tableName}"
          WHERE (key LIKE ? ESCAPE '\\' OR key = ?)
            AND (expires IS NULL OR expires > ?)
          ORDER BY key
        `)
        .all(pattern, exactKey, now) as { key: string; value: string }[];
    }

    for (const row of results) {
      yield {
        key: this.#decodeKey(row.key),
        value: this.#decodeValue(row.value),
      };
    }
  }

  /**
   * Creates the table used by the key–value store if it does not already exist.
   * Does nothing if the table already exists.
   */
  initialize(): void {
    if (this.#initialized) {
      return;
    }

    logger.debug("Initializing the key–value store table {tableName}...", {
      tableName: this.#tableName,
    });

    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS "${this.#tableName}" (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        created INTEGER NOT NULL,
        expires INTEGER
      )
    `);

    this.#db.exec(`
      CREATE INDEX IF NOT EXISTS "idx_${this.#tableName}_expires"
      ON "${this.#tableName}" (expires)
    `);

    this.#initialized = true;
    logger.debug("Initialized the key–value store table {tableName}.", {
      tableName: this.#tableName,
    });
  }

  #expire(now: number): void {
    this.#db
      .prepare(`
      DELETE FROM "${this.#tableName}"
      WHERE expires IS NOT NULL AND expires <= ?
    `)
      .run(now);
  }

  /**
   * Drops the table used by the key–value store.  Does nothing if the table
   * does not exist.
   */
  drop(): void {
    this.#db.exec(`DROP TABLE IF EXISTS "${this.#tableName}"`);
    this.#initialized = false;
  }

  #capture<T>(values: readonly T[]): T[] {
    if (!Array.isArray(values))
      throw new TypeError("A KV batch must be an array.");
    for (let index = 0; index < values.length; index++) {
      if (!Object.hasOwn(values, index)) {
        throw new TypeError("A KV batch must not be sparse.");
      }
    }
    return Array.from(values);
  }

  #encodeKey(key: KvKey): string {
    const parts = this.#capture(key);
    if (parts.length === 0 || parts.some((part) => typeof part !== "string")) {
      throw new TypeError("A KV key must be a nonempty array of strings.");
    }
    return JSON.stringify(parts);
  }

  #encodeKeys(keys: readonly KvKey[]): string[] {
    return this.#capture(keys).map((key) => this.#encodeKey(key));
  }

  #assertUnique(keys: readonly string[]): void {
    if (new Set(keys).size !== keys.length) {
      throw new TypeError("Duplicate keys in an atomic mutation.");
    }
  }

  #ttlMilliseconds(ttl: Temporal.Duration | undefined): number | null {
    if (ttl == null) return null;
    const milliseconds = ttl.total({ unit: "milliseconds" });
    if (!Number.isFinite(milliseconds) || Math.abs(milliseconds) > 8.64e15) {
      throw new RangeError(
        "KV TTL must be finite and within ±8.64e15 milliseconds.",
      );
    }
    return milliseconds;
  }

  #expiresAt(ttl: number | null, now: number): number | null {
    if (ttl === null) return null;
    const expires = now + ttl;
    if (
      !Number.isFinite(expires) ||
      Math.abs(expires) > Number.MAX_SAFE_INTEGER
    ) {
      throw new RangeError("KV expiry is outside the safe numeric range.");
    }
    return expires;
  }

  #transaction<T>(operation: (now: number) => T): T {
    const initialized = this.#initialized;
    // BEGIN must not be caught: it may fail because the caller owns a transaction.
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.initialize();
      // Read-only SQLite handles can silently downgrade BEGIN IMMEDIATE.  This
      // fixed zero-row write enforces the writable scope without touching rows.
      this.#db.exec(`DELETE FROM "${this.#tableName}" WHERE 0`);
      const now = Temporal.Now.instant().epochMilliseconds;
      const result = operation(now);
      this.#db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.#db.exec("ROLLBACK");
      } catch {
        // SQLite may already have aborted the transaction.  Keep the original
        // error, even if rollback itself failed; no fallible diagnostics here.
      }
      this.#initialized = initialized;
      throw error;
    }
  }

  #prepareRead(): SqliteStatementAdapter {
    return this.#db.prepare(`
      SELECT value FROM "${this.#tableName}"
      WHERE key = ? AND (expires IS NULL OR expires > ?)
    `);
  }

  #read(statement: SqliteStatementAdapter, key: string, now: number): unknown {
    const row = statement.get(key, now) as { value: string } | undefined;
    return row === undefined ? undefined : this.#decodeValue(row.value);
  }

  #prepareWrite(): SqliteStatementAdapter {
    return this.#db.prepare(`
      INSERT INTO "${this.#tableName}" (key, value, created, expires)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        expires = excluded.expires
    `);
  }

  #prepareDelete(): SqliteStatementAdapter {
    return this.#db.prepare(`DELETE FROM "${this.#tableName}" WHERE key = ?`);
  }

  #decodeKey(key: string): KvKey {
    return JSON.parse(key);
  }

  #encodeValue(value: unknown): string {
    const encoded = JSON.stringify(value);
    if (typeof encoded !== "string") {
      throw new TypeError(
        "A KV value must have a JSON representation; undefined is not storable.",
      );
    }
    return encoded;
  }

  #decodeValue(value: string): unknown {
    return JSON.parse(value);
  }
}
