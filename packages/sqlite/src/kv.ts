import { type PlatformDatabase, SqliteDatabase } from "#sqlite";
import type { KvKey, KvStore, KvStoreSetOptions } from "@fedify/fedify";
import { Temporal } from "@js-temporal/polyfill";
import { getLogger } from "@logtape/logtape";
import { isEqual } from "es-toolkit";
import type { SqliteDatabaseAdapter } from "./adapter.ts";

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
  tableName?: string;

  /**
   * Whether the table has been initialized.  `false` by default.
   * @default `false`
   */
  initialized?: boolean;
}

/**
 * A key–value store that uses SQLite as the underlying storage.
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
export class SqliteKvStore implements KvStore {
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
   * {@inheritDoc KvStore.get}
   */
  // deno-lint-ignore require-await
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

  /**
   * {@inheritDoc KvStore.set}
   */
  // deno-lint-ignore require-await
  async set(
    key: KvKey,
    value: unknown,
    options?: KvStoreSetOptions,
  ): Promise<void> {
    this.initialize();

    if (value === undefined) {
      return;
    }

    const encodedKey = this.#encodeKey(key);
    const encodedValue = this.#encodeValue(value);
    const now = Temporal.Now.instant().epochMilliseconds;
    const expiresAt = options?.ttl !== undefined
      ? now + options.ttl.total({ unit: "milliseconds" })
      : null;

    this.#db
      .prepare(
        `INSERT INTO "${this.#tableName}" (key, value, created, expires)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          expires = excluded.expires`,
      )
      .run(encodedKey, encodedValue, now, expiresAt);

    this.#expire();
    return;
  }

  /**
   * {@inheritDoc KvStore.delete}
   */
  // deno-lint-ignore require-await
  async delete(key: KvKey): Promise<void> {
    this.initialize();

    const encodedKey = this.#encodeKey(key);

    this.#db
      .prepare(`
      DELETE FROM "${this.#tableName}" WHERE key = ?
    `)
      .run(encodedKey);
    this.#expire();
    return Promise.resolve();
  }

  /**
   * {@inheritDoc KvStore.cas}
   */
  // deno-lint-ignore require-await
  async cas(
    key: KvKey,
    expectedValue: unknown,
    newValue: unknown,
    options?: KvStoreSetOptions,
  ): Promise<boolean> {
    this.initialize();

    const encodedKey = this.#encodeKey(key);
    const now = Temporal.Now.instant().epochMilliseconds;
    const expiresAt = options?.ttl !== undefined
      ? now + options.ttl.total({ unit: "milliseconds" })
      : null;

    try {
      this.#db.exec("BEGIN IMMEDIATE");

      const currentResult = this.#db
        .prepare(`
          SELECT value 
          FROM "${this.#tableName}" 
          WHERE key = ? AND (expires IS NULL OR expires > ?)
        `)
        .get(encodedKey, now) as { value: string } | undefined;
      const currentValue = currentResult === undefined
        ? undefined
        : this.#decodeValue(currentResult.value);

      if (!isEqual(currentValue, expectedValue)) {
        this.#db.exec("ROLLBACK");
        return false;
      }

      if (newValue === undefined) {
        this.#db
          .prepare(`
            DELETE FROM "${this.#tableName}" WHERE key = ?
          `)
          .run(encodedKey);
      } else {
        const newValueJson = this.#encodeValue(newValue);

        this.#db
          .prepare(`
          INSERT INTO "${this.#tableName}" (key, value, created, expires)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            expires = excluded.expires
          `)
          .run(encodedKey, newValueJson, now, expiresAt);
      }

      this.#db.exec("COMMIT");
      this.#expire();
      return true;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  /**
   * Creates the table used by the key–value store if it does not already exist.
   * Does nothing if the table already exists.
   */
  initialize() {
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

  #expire() {
    const now = Temporal.Now.instant().epochMilliseconds;
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
  drop() {
    this.#db.exec(`DROP TABLE IF EXISTS "${this.#tableName}"`);
    this.#initialized = false;
  }

  #encodeKey(key: KvKey): string {
    return JSON.stringify(key);
  }

  #decodeKey(key: string): KvKey {
    return JSON.parse(key);
  }

  #encodeValue(value: unknown): string {
    return JSON.stringify(value);
  }

  #decodeValue(value: string): unknown {
    return JSON.parse(value);
  }
}
