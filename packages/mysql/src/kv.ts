// Transactions acquire locks and execute statements sequentially.
/* oxlint-disable eslint/no-await-in-loop */
import type {
  KvKey,
  AtomicKvStore,
  KvStoreCasEntry,
  KvStoreSetEntry,
  KvStoreListEntry,
  KvStoreSetOptions,
} from "@fedify/fedify";
import { isEqual } from "es-toolkit";
import { getLogger } from "@logtape/logtape";
import type { RowDataPacket } from "mysql2/promise";

const logger = getLogger(["fedify", "mysql", "kv"]);

interface MysqlQueryable {
  query<TRows = unknown>(
    sql: string,
    values?: unknown,
  ): Promise<[TRows, unknown]>;
}

interface MysqlPoolConnection extends MysqlQueryable {
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void;
  destroy(): void;
}

interface MysqlPool extends MysqlQueryable {
  getConnection(): Promise<MysqlPoolConnection>;
}

/**
 * Options for the MySQL key-value store.
 *
 * @since 2.1.0
 */
export interface MysqlKvStoreOptions {
  /**
   * The table name to use for the key-value store.
   * `"fedify_kv"` by default.
   * @default `"fedify_kv"`
   * @since 2.1.0
   */
  readonly tableName?: string;

  /**
   * Whether the table has been created.  `false` by default.  With `true`,
   * initialization skips DDL but still validates the InnoDB schema.
   * @default `false`
   * @since 2.1.0
   */
  readonly initialized?: boolean;

  /**
   * The probability (between 0 and 1, inclusive) that expired entries are
   * cleaned up on each mutation.  Defaults to `1` (always clean up).
   * Set to `0` to disable automatic expiry cleanup entirely.
   * @default `1`
   * @since 2.1.0
   */
  readonly expireCleanupRate?: number;
}

/**
 * An atomic key-value store backed by an InnoDB table on MySQL or MariaDB.
 *
 * All keys in one primary database/table share an atomic scope.  Batches have
 * at most 1,000 entries and serialized keys at most 768 Unicode code points;
 * server packet and resource limits also apply.  Values use JSON serialization
 * and decoded structural equality (`isEqual`); object member order is ignored.
 * Do not mutate expected values while a CAS is pending.
 *
 * TTLs are truncated to safe integer microseconds (approximately ±285 years),
 * evaluated using one server cutoff per attempt.  Calendar units use the local
 * current date for conversion.  Omitted TTL clears the previous expiry.
 *
 * Use a normal mysql2 pool with autocommit enabled, object rows, default type
 * casting, and the same fixed-offset or UTC session time zone on every client.
 * Caller-owned transactions, replica routing, concurrent schema changes,
 * `NO_BACKSLASH_ESCAPES`, and disabled InnoDB gap locking are unsupported.
 * Initialization checks the schema even with `initialized: true`.
 *
 * Deadlocks and MariaDB snapshot conflicts retry up to five total attempts.
 * Other failures reject; a failed commit response can leave its outcome
 * unknown.  Atomicity does not promise crash durability or external effects.
 *
 * @example
 * ```ts
 * import { createFederation } from "@fedify/fedify";
 * import { MysqlKvStore } from "@fedify/mysql";
 * import mysql from "mysql2/promise";
 *
 * const pool = mysql.createPool("mysql://user:pass@localhost/db");
 *
 * const federation = createFederation({
 *   // ...
 *   kv: new MysqlKvStore(pool),
 * });
 * ```
 *
 * @since 2.1.0
 */
export class MysqlKvStore implements AtomicKvStore {
  readonly #pool: MysqlPool;
  readonly #tableName: string;
  readonly #expireCleanupRate: number;
  #initialized: boolean;
  #initialization: Promise<void> | undefined;

  /**
   * Creates a new MySQL key-value store.
   * @param pool The MySQL connection pool to use.
   * @param options The options for the key-value store.
   * @since 2.1.0
   */
  constructor(pool: MysqlPool, options: MysqlKvStoreOptions = {}) {
    this.#pool = pool;
    const tableName = options.tableName ?? "fedify_kv";
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
      throw new RangeError(
        `Invalid table name: ${JSON.stringify(tableName)}. ` +
          "Table names must start with a letter or underscore and contain " +
          "only letters, digits, and underscores.",
      );
    }
    // MySQL identifiers are limited to 64 characters.  The derived index name
    // is "idx_<tableName>_expires" (12 extra chars), so the table name itself
    // must be at most 50 characters long.
    if (tableName.length > 50) {
      throw new RangeError(
        `Invalid table name: ${JSON.stringify(tableName)}. ` +
          "Table names must be at most 50 characters long (MySQL identifier " +
          'limit is 64 chars; the derived index "idx_<name>_expires" uses ' +
          "12 more).",
      );
    }
    this.#tableName = tableName;
    const expireCleanupRate = options.expireCleanupRate ?? 1;
    if (expireCleanupRate < 0 || expireCleanupRate > 1) {
      throw new RangeError(
        `Invalid expireCleanupRate: ${expireCleanupRate}. ` +
          "Must be a number between 0 and 1 inclusive.",
      );
    }
    this.#expireCleanupRate = expireCleanupRate;
    this.#initialized = options.initialized ?? false;
  }

  async #expire(): Promise<void> {
    if (this.#expireCleanupRate <= 0) return;
    if (
      this.#expireCleanupRate < 1 &&
      Math.random() >= this.#expireCleanupRate
    ) {
      return;
    }
    try {
      await this.#pool.query(
        `DELETE FROM \`${this.#tableName}\`
         WHERE \`expires\` IS NOT NULL AND \`expires\` < NOW(6)`,
      );
    } catch (error) {
      // Housekeeping must not turn an already committed mutation into failure.
      logger.warn("Failed to clean up expired key-value entries: {error}", {
        error,
      });
    }
  }

  /**
   * {@inheritDoc AtomicKvStore.get}
   * @since 2.1.0
   */
  async get<T = unknown>(key: KvKey): Promise<T | undefined> {
    return (await this.getMany<T>([key]))[0];
  }

  /**
   * {@inheritDoc AtomicKvStore.set}
   * @since 2.1.0
   */
  async set(
    key: KvKey,
    value: unknown,
    options?: KvStoreSetOptions,
  ): Promise<void> {
    await this.setMany([{ key, value, options }]);
  }

  /**
   * {@inheritDoc AtomicKvStore.delete}
   * @since 2.1.0
   */
  async delete(key: KvKey): Promise<void> {
    await this.deleteMany([key]);
  }

  /**
   * {@inheritDoc AtomicKvStore.cas}
   * @since 2.1.0
   */
  async cas(
    key: KvKey,
    expectedValue: unknown,
    newValue: unknown,
    options?: KvStoreSetOptions,
  ): Promise<boolean> {
    return await this.casMany([{ key, expectedValue, newValue, options }]);
  }

  /**
   * {@inheritDoc AtomicKvStore.getMany}
   * @since 2.5.0
   */
  async getMany<T = unknown>(
    keys: readonly KvKey[],
  ): Promise<(T | undefined)[]> {
    validateBatch(keys);
    const serialized = Array.from(keys, serializeKey);
    if (serialized.length === 0) return [];
    await this.initialize();
    return await this.#transaction(async (conn) => {
      const [rows] = await conn.query<KvRow[]>(
        `SELECT \`key\`, CAST(\`value\` AS CHAR CHARACTER SET utf8mb4) AS \`value\`
         FROM \`${this.#tableName}\` WHERE \`key\` IN (?)
           AND (\`expires\` IS NULL OR \`expires\` > NOW(6))`,
        [serialized],
      );
      const values = new Map(
        rows.map((row) => [row.key, JSON.parse(row.value) as T]),
      );
      return serialized.map((key) => values.get(key));
    });
  }

  /**
   * {@inheritDoc AtomicKvStore.setMany}
   * @since 2.5.0
   */
  async setMany(entries: readonly KvStoreSetEntry[]): Promise<void> {
    validateBatch(entries);
    const captured = Array.from(entries, (entry): EncodedEntry => ({
      key: serializeKey(entry.key),
      value: serializeValue(entry.value),
      ttl: encodeTtl(entry.options),
    }));
    validateDistinct(captured);
    if (captured.length === 0) return;
    await this.#mutate(captured, false);
  }

  /**
   * {@inheritDoc AtomicKvStore.deleteMany}
   * @since 2.5.0
   */
  async deleteMany(keys: readonly KvKey[]): Promise<void> {
    validateBatch(keys);
    const captured = Array.from(keys, (key): EncodedEntry => ({
      key: serializeKey(key),
      value: undefined,
      ttl: null,
    }));
    validateDistinct(captured);
    if (captured.length === 0) return;
    await this.#mutate(captured, false);
  }

  /**
   * {@inheritDoc AtomicKvStore.casMany}
   * @since 2.5.0
   */
  async casMany(entries: readonly KvStoreCasEntry[]): Promise<boolean> {
    validateBatch(entries);
    const captured = Array.from(entries, (entry): EncodedEntry => {
      const value = entry.newValue;
      const options = entry.options;
      if (value === undefined && options?.ttl != null) {
        throw new TypeError("A CAS deletion must not specify a TTL.");
      }
      return {
        key: serializeKey(entry.key),
        expectedValue: entry.expectedValue,
        value: value === undefined ? undefined : serializeValue(value),
        ttl: encodeTtl(options),
      };
    });
    validateDistinct(captured);
    if (captured.length === 0) return true;
    return await this.#mutate(captured, true);
  }

  async #mutate(
    entries: EncodedEntry[],
    conditional: boolean,
  ): Promise<boolean> {
    entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    await this.initialize();
    const matched = await this.#transaction(async (conn) => {
      // Do not add consistent table reads before these locks: MariaDB snapshot
      // isolation can reject newer records with ER_CHECKREAD (1020).
      const rows = new Map<string, KvRow>();
      if (conditional) {
        for (const entry of entries) {
          // Lock physical rows AND absent ranges, including expired rows.
          const [found] = await conn.query<KvRow[]>(
            `SELECT \`key\`, CAST(\`value\` AS CHAR CHARACTER SET utf8mb4) AS \`value\`,
                    DATE_FORMAT(\`expires\`, '%Y-%m-%d %H:%i:%s.%f') AS \`expires\`
             FROM \`${this.#tableName}\` WHERE \`key\` = ? FOR UPDATE`,
            [entry.key],
          );
          if (found.length > 0) rows.set(entry.key, found[0]);
        }
      }
      const [clock] = await conn.query<(RowDataPacket & { cutoff: string })[]>(
        "SELECT DATE_FORMAT(NOW(6), '%Y-%m-%d %H:%i:%s.%f') AS cutoff",
      );
      const cutoff = clock[0].cutoff;
      const durations = [
        ...new Set(entries.flatMap((e) => (e.ttl == null ? [] : [e.ttl]))),
      ];
      const expiries = new Map<number, string>();
      if (durations.length > 0) {
        const expressions = durations.map(
          (_, i) =>
            `DATE_FORMAT(DATE_ADD(?, INTERVAL ? MICROSECOND), '%Y-%m-%d %H:%i:%s.%f') AS e${i}`,
        );
        const [computed] = await conn.query<RowDataPacket[]>(
          `SELECT ${expressions.join(", ")}`,
          durations.flatMap((ttl) => [cutoff, ttl]),
        );
        for (let i = 0; i < durations.length; i++) {
          const expiry = computed[0][`e${i}`] as string | null;
          if (expiry == null)
            throw new RangeError("TTL exceeds the server DATETIME range.");
          expiries.set(durations[i], expiry);
        }
      }
      if (conditional) {
        for (const entry of entries) {
          const row = rows.get(entry.key);
          const value =
            row == null || (row.expires != null && row.expires <= cutoff)
              ? undefined
              : JSON.parse(row.value);
          if (!isEqual(value, entry.expectedValue)) return false;
        }
      }
      for (const entry of entries) {
        if (entry.value === undefined) {
          await conn.query(
            `DELETE FROM \`${this.#tableName}\` WHERE \`key\` = ?`,
            [entry.key],
          );
        } else {
          const expiry = entry.ttl == null ? null : expiries.get(entry.ttl)!;
          await conn.query(
            `INSERT INTO \`${this.#tableName}\` (\`key\`, \`value\`, \`expires\`)
             VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE \`value\` = ?, \`expires\` = ?`,
            [entry.key, entry.value, expiry, entry.value, expiry],
          );
        }
      }
      return true;
    });
    // #transaction has released its connection, including with a one-slot pool.
    if (matched) await this.#expire();
    return matched;
  }

  async #transaction<T>(
    run: (conn: MysqlPoolConnection) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const conn = await this.#pool.getConnection();
      let phase: "setup" | "active" | "rollback" | "commit" = "setup";
      let reusable = false;
      try {
        await conn.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
        await conn.beginTransaction();
        phase = "active";
        const result = await run(conn);
        if (result === false) {
          phase = "rollback";
          await conn.rollback();
        } else {
          phase = "commit";
          await conn.commit();
        }
        reusable = true;
        return result;
      } catch (error) {
        if (phase !== "active") throw error;
        try {
          await conn.rollback();
          reusable = true;
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            "MySQL transaction and rollback failed.",
          );
        }
        if (attempt >= 4 || !retryable(error)) throw error;
      } finally {
        if (reusable) conn.release();
        else conn.destroy();
      }
      // Release before backoff/reacquisition, even when the pool has one slot.
      await new Promise((resolve) =>
        setTimeout(resolve, 5 + Math.random() * Math.min(45, 5 * 2 ** attempt)),
      );
    }
  }

  /**
   * {@inheritDoc AtomicKvStore.list}
   * @since 2.1.0
   */
  async *list(prefix?: KvKey): AsyncIterable<KvStoreListEntry> {
    await this.initialize();

    const rows = await this.#transaction(async (conn) => {
      let rows: RowDataPacket[];
      if (prefix == null || prefix.length === 0) {
        [rows] = await conn.query<RowDataPacket[]>(
          `SELECT \`key\`, CAST(\`value\` AS CHAR CHARACTER SET utf8mb4) AS \`value\` FROM \`${this.#tableName}\`
           WHERE \`expires\` IS NULL OR \`expires\` > NOW(6)
           ORDER BY \`key\``,
        );
      } else {
        const serializedPrefix = JSON.stringify([...prefix]);
        // Escape LIKE special characters in the prefix
        const likePrefix =
          serializedPrefix.slice(0, -1).replace(/[%_\\]/g, "\\$&") + ",%";
        [rows] = await conn.query<RowDataPacket[]>(
          `SELECT \`key\`, CAST(\`value\` AS CHAR CHARACTER SET utf8mb4) AS \`value\` FROM \`${this.#tableName}\`
           WHERE (\`key\` = ? OR \`key\` LIKE ? ESCAPE '\\\\')
             AND (\`expires\` IS NULL OR \`expires\` > NOW(6))
           ORDER BY \`key\``,
          [serializedPrefix, likePrefix],
        );
      }
      return rows;
    });

    for (const row of rows) {
      yield {
        key: JSON.parse(row.key) as KvKey,
        value: JSON.parse(row.value),
      };
    }
  }

  /**
   * Creates the table used by the key-value store if it does not already exist.
   * Validates the existing schema, including when `initialized: true` was
   * supplied.  Successful initialization is cached until {@link MysqlKvStore.drop}.
   * Initialization and dropping must not overlap store operations.
   *
   * @since 2.1.0
   */
  async initialize(): Promise<void> {
    if (this.#initialization == null) {
      const pending = this.#initialize();
      this.#initialization = pending;
      // Clear only this attempt; a failed older attempt must not erase a newer one.
      pending.catch(() => {
        if (this.#initialization === pending) this.#initialization = undefined;
      });
    }
    await this.#initialization;
  }

  async #initialize(): Promise<void> {
    if (!this.#initialized) {
      await this.#pool.query(
        `CREATE TABLE IF NOT EXISTS \`${this.#tableName}\` (
          \`key\` VARCHAR(768) NOT NULL,
          \`value\` JSON NOT NULL,
          \`expires\` DATETIME(6) NULL DEFAULT NULL,
          PRIMARY KEY (\`key\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
      );
    }
    // Metadata collations can ignore case even on case-sensitive file systems.
    const predicate = `TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
      AND (@@lower_case_table_names <> 0 OR
        (CAST(TABLE_SCHEMA AS BINARY) = CAST(DATABASE() AS BINARY)
         AND CAST(TABLE_NAME AS BINARY) = CAST(? AS BINARY)))`;
    const params = [this.#tableName, this.#tableName];
    const [tables] = await this.#pool.query<RowDataPacket[]>(
      `SELECT ENGINE AS \`engine\`, TABLE_TYPE AS \`table_type\`
       FROM information_schema.TABLES WHERE ${predicate}`,
      params,
    );
    if (
      tables.length !== 1 ||
      tables[0].engine?.toLowerCase() !== "innodb" ||
      tables[0].table_type !== "BASE TABLE"
    ) {
      throw new TypeError(
        "MysqlKvStore requires an InnoDB base table in the pool's default database.",
      );
    }
    const [columns] = await this.#pool.query<RowDataPacket[]>(
      `SELECT COLUMN_NAME AS \`name\`, DATA_TYPE AS \`type\`, IS_NULLABLE AS \`nullable\`,
              CHARACTER_MAXIMUM_LENGTH AS \`length\`, CHARACTER_SET_NAME AS \`charset\`,
              COLLATION_NAME AS \`collation\`, DATETIME_PRECISION AS \`precision\`
       FROM information_schema.COLUMNS WHERE ${predicate}`,
      params,
    );
    const key = columns.find((c) => c.name === "key");
    const value = columns.find((c) => c.name === "value");
    const expires = columns.find((c) => c.name === "expires");
    if (
      key?.type !== "varchar" ||
      Number(key.length) !== 768 ||
      key.charset !== "utf8mb4" ||
      key.collation !== "utf8mb4_bin" ||
      key.nullable !== "NO" ||
      value?.nullable !== "NO" ||
      !(
        value.type === "json" ||
        (value.type === "longtext" && value.charset === "utf8mb4")
      ) ||
      expires?.type !== "datetime" ||
      Number(expires.precision) !== 6 ||
      expires.nullable !== "YES"
    ) {
      throw new TypeError(
        "Incompatible MysqlKvStore key, JSON value, or nullable DATETIME(6) expiry columns.",
      );
    }
    const [indexes] = await this.#pool.query<RowDataPacket[]>(
      `SELECT INDEX_NAME AS \`name\`, COLUMN_NAME AS \`column_name\`,
              SEQ_IN_INDEX AS \`position\`, SUB_PART AS \`prefix\`, INDEX_TYPE AS \`type\`
       FROM information_schema.STATISTICS WHERE ${predicate} AND NON_UNIQUE = 0`,
      params,
    );
    if (
      indexes.length !== 1 ||
      indexes[0].name !== "PRIMARY" ||
      indexes[0].column_name !== "key" ||
      Number(indexes[0].position) !== 1 ||
      indexes[0].prefix != null ||
      indexes[0].type !== "BTREE"
    ) {
      throw new TypeError(
        "MysqlKvStore requires a full key BTREE primary index and no other unique indexes.",
      );
    }
    const [unsafe] = await this.#pool.query<RowDataPacket[]>(
      "SHOW VARIABLES WHERE Variable_name = 'innodb_locks_unsafe_for_binlog'",
    );
    if (
      unsafe.some(
        (row) => !["off", "0"].includes(String(row.Value).toLowerCase()),
      )
    ) {
      throw new TypeError(
        "MysqlKvStore requires InnoDB gap locking to be enabled.",
      );
    }
    if (!this.#initialized) {
      try {
        await this.#pool.query(
          `CREATE INDEX \`idx_${this.#tableName}_expires\`
           ON \`${this.#tableName}\` (\`expires\`)`,
        );
      } catch (error) {
        if ((error as { code?: string }).code !== "ER_DUP_KEYNAME") throw error;
      }
    }
  }

  /**
   * Drops the table used by the key-value store.  Does nothing if the table
   * does not exist.  Resets the initialized flag so that
   * {@link MysqlKvStore.initialize} can recreate the table on the next call.
   *
   * @since 2.1.0
   */
  async drop(): Promise<void> {
    try {
      await this.#pool.query(`DROP TABLE IF EXISTS \`${this.#tableName}\``);
    } finally {
      this.#initialization = undefined;
      this.#initialized = false;
    }
  }
}

interface KvRow extends RowDataPacket {
  key: string;
  value: string;
  expires?: string | null;
}

interface EncodedEntry {
  readonly key: string;
  readonly value: string | undefined;
  readonly ttl: number | null;
  readonly expectedValue?: unknown;
}

function validateBatch(entries: readonly unknown[]): void {
  if (!Array.isArray(entries))
    throw new TypeError("An atomic batch must be an array.");
  if (entries.length > 1000)
    throw new RangeError("An atomic batch has at most 1,000 entries.");
  for (let i = 0; i < entries.length; i++) {
    if (!Object.hasOwn(entries, i))
      throw new TypeError("Atomic batches must not be sparse.");
  }
}

function serializeKey(key: KvKey): string {
  if (!Array.isArray(key) || key.length === 0)
    throw new TypeError("A key must be a nonempty array of strings.");
  for (let i = 0; i < key.length; i++) {
    if (!Object.hasOwn(key, i) || typeof key[i] !== "string")
      throw new TypeError("Key parts must be strings.");
  }
  const encoded = JSON.stringify([...key]);
  if ([...encoded].length > 768)
    throw new RangeError(
      "A serialized key has at most 768 Unicode code points.",
    );
  return encoded;
}

function serializeValue(value: unknown): string {
  const encoded = JSON.stringify(value);
  if (encoded === undefined)
    throw new TypeError(
      "The value must have a JSON representation; undefined cannot be stored.",
    );
  return encoded;
}

function encodeTtl(options?: KvStoreSetOptions): number | null {
  if (options?.ttl == null) return null;
  const micros = Math.trunc(
    options.ttl.total({
      unit: "microsecond",
      relativeTo: Temporal.Now.plainDateTimeISO(),
    }),
  );
  if (!Number.isSafeInteger(micros))
    throw new RangeError("TTL must fit in safe integer microseconds.");
  return micros;
}

function validateDistinct(entries: readonly EncodedEntry[]): void {
  if (new Set(entries.map((entry) => entry.key)).size !== entries.length) {
    throw new TypeError("Duplicate keys in an atomic mutation.");
  }
}

function retryable(error: unknown): boolean {
  const e = error as { errno?: number; code?: string } | null;
  return (
    e?.errno === 1213 ||
    e?.errno === 1020 ||
    e?.code === "ER_LOCK_DEADLOCK" ||
    e?.code === "ER_CHECKREAD"
  );
}
