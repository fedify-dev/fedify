import type {
  KvKey,
  KvStore,
  KvStoreListEntry,
  KvStoreSetOptions,
} from "@fedify/fedify";
import { isEqual } from "es-toolkit";
import { getLogger } from "@logtape/logtape";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

const logger = getLogger(["fedify", "mysql", "kv"]);

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
   * Whether the table has been initialized.  `false` by default.
   * @default `false`
   * @since 2.1.0
   */
  readonly initialized?: boolean;
}

/**
 * A key-value store that uses MySQL (or MariaDB) as the underlying storage.
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
export class MysqlKvStore implements KvStore {
  readonly #pool: Pool;
  readonly #tableName: string;
  #initialized: boolean;

  /**
   * Creates a new MySQL key-value store.
   * @param pool The MySQL connection pool to use.
   * @param options The options for the key-value store.
   * @since 2.1.0
   */
  constructor(pool: Pool, options: MysqlKvStoreOptions = {}) {
    this.#pool = pool;
    const tableName = options.tableName ?? "fedify_kv";
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
      throw new RangeError(
        `Invalid table name: ${JSON.stringify(tableName)}. ` +
          "Table names must start with a letter or underscore and contain " +
          "only letters, digits, and underscores.",
      );
    }
    this.#tableName = tableName;
    this.#initialized = options.initialized ?? false;
  }

  async #expire(): Promise<void> {
    await this.#pool.query(
      `DELETE FROM \`${this.#tableName}\`
       WHERE \`expires\` IS NOT NULL AND \`expires\` < NOW(6)`,
    );
  }

  /**
   * {@inheritDoc KvStore.get}
   * @since 2.1.0
   */
  async get<T = unknown>(key: KvKey): Promise<T | undefined> {
    await this.initialize();
    const serializedKey = JSON.stringify([...key]);
    const [rows] = await this.#pool.query<RowDataPacket[]>(
      `SELECT \`value\` FROM \`${this.#tableName}\`
       WHERE \`key\` = ?
         AND (\`expires\` IS NULL OR \`expires\` > NOW(6))`,
      [serializedKey],
    );
    if (rows.length < 1) return undefined;
    return rows[0].value as T;
  }

  /**
   * {@inheritDoc KvStore.set}
   * @since 2.1.0
   */
  async set(
    key: KvKey,
    value: unknown,
    options?: KvStoreSetOptions | undefined,
  ): Promise<void> {
    if (value === undefined) return;
    await this.initialize();
    const serializedKey = JSON.stringify([...key]);
    const jsonValue = JSON.stringify(value);
    if (options?.ttl != null) {
      const ttlSeconds = durationToSeconds(options.ttl);
      await this.#pool.query(
        `INSERT INTO \`${this.#tableName}\` (\`key\`, \`value\`, \`expires\`)
         VALUES (?, CAST(? AS JSON),
                 DATE_ADD(NOW(6), INTERVAL ? SECOND))
         ON DUPLICATE KEY UPDATE
           \`value\` = VALUES(\`value\`),
           \`expires\` = VALUES(\`expires\`)`,
        [serializedKey, jsonValue, ttlSeconds],
      );
    } else {
      await this.#pool.query(
        `INSERT INTO \`${this.#tableName}\` (\`key\`, \`value\`, \`expires\`)
         VALUES (?, CAST(? AS JSON), NULL)
         ON DUPLICATE KEY UPDATE
           \`value\` = VALUES(\`value\`),
           \`expires\` = NULL`,
        [serializedKey, jsonValue],
      );
    }
    await this.#expire();
  }

  /**
   * {@inheritDoc KvStore.delete}
   * @since 2.1.0
   */
  async delete(key: KvKey): Promise<void> {
    await this.initialize();
    const serializedKey = JSON.stringify([...key]);
    await this.#pool.query(
      `DELETE FROM \`${this.#tableName}\` WHERE \`key\` = ?`,
      [serializedKey],
    );
    await this.#expire();
  }

  /**
   * {@inheritDoc KvStore.cas}
   * @since 2.1.0
   */
  async cas(
    key: KvKey,
    expectedValue: unknown,
    newValue: unknown,
    options?: KvStoreSetOptions,
  ): Promise<boolean> {
    await this.initialize();
    const serializedKey = JSON.stringify([...key]);
    let conn: PoolConnection | undefined;
    try {
      conn = await this.#pool.getConnection();
      await conn.beginTransaction();

      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT \`value\` FROM \`${this.#tableName}\`
         WHERE \`key\` = ?
           AND (\`expires\` IS NULL OR \`expires\` > NOW(6))
         FOR UPDATE`,
        [serializedKey],
      );

      const currentValue = rows.length > 0 ? rows[0].value : undefined;

      if (!isEqual(currentValue, expectedValue)) {
        await conn.rollback();
        return false;
      }

      if (newValue === undefined) {
        await conn.query(
          `DELETE FROM \`${this.#tableName}\` WHERE \`key\` = ?`,
          [serializedKey],
        );
      } else {
        const jsonValue = JSON.stringify(newValue);
        if (options?.ttl != null) {
          const ttlSeconds = durationToSeconds(options.ttl);
          await conn.query(
            `INSERT INTO \`${this.#tableName}\`
               (\`key\`, \`value\`, \`expires\`)
             VALUES (?, CAST(? AS JSON),
                     DATE_ADD(NOW(6), INTERVAL ? SECOND))
             ON DUPLICATE KEY UPDATE
               \`value\` = VALUES(\`value\`),
               \`expires\` = VALUES(\`expires\`)`,
            [serializedKey, jsonValue, ttlSeconds],
          );
        } else {
          await conn.query(
            `INSERT INTO \`${this.#tableName}\`
               (\`key\`, \`value\`, \`expires\`)
             VALUES (?, CAST(? AS JSON), NULL)
             ON DUPLICATE KEY UPDATE
               \`value\` = VALUES(\`value\`),
               \`expires\` = NULL`,
            [serializedKey, jsonValue],
          );
        }
      }

      await conn.commit();
      await this.#expire();
      return true;
    } catch (e) {
      if (conn) await conn.rollback();
      throw e;
    } finally {
      if (conn) conn.release();
    }
  }

  /**
   * {@inheritDoc KvStore.list}
   * @since 2.1.0
   */
  async *list(prefix?: KvKey): AsyncIterable<KvStoreListEntry> {
    await this.initialize();

    let rows: RowDataPacket[];
    if (prefix == null || prefix.length === 0) {
      [rows] = await this.#pool.query<RowDataPacket[]>(
        `SELECT \`key\`, \`value\` FROM \`${this.#tableName}\`
         WHERE \`expires\` IS NULL OR \`expires\` > NOW(6)
         ORDER BY \`key\``,
      );
    } else {
      const serializedPrefix = JSON.stringify([...prefix]);
      // Escape LIKE special characters in the prefix
      const likePrefix =
        serializedPrefix.slice(0, -1).replace(/[%_\\]/g, "\\$&") + ",%";
      [rows] = await this.#pool.query<RowDataPacket[]>(
        `SELECT \`key\`, \`value\` FROM \`${this.#tableName}\`
         WHERE (\`key\` = ? OR \`key\` LIKE ? ESCAPE '\\\\')
           AND (\`expires\` IS NULL OR \`expires\` > NOW(6))
         ORDER BY \`key\``,
        [serializedPrefix, likePrefix],
      );
    }

    for (const row of rows) {
      yield {
        key: JSON.parse(row.key) as KvKey,
        value: row.value,
      };
    }
  }

  /**
   * Creates the table used by the key-value store if it does not already exist.
   * Does nothing if the table already exists.
   *
   * @since 2.1.0
   */
  async initialize(): Promise<void> {
    if (this.#initialized) return;
    logger.debug("Initializing the key-value store table {tableName}...", {
      tableName: this.#tableName,
    });
    await this.#pool.query(
      `CREATE TABLE IF NOT EXISTS \`${this.#tableName}\` (
        \`key\` VARCHAR(768) NOT NULL,
        \`value\` JSON NOT NULL,
        \`expires\` DATETIME(6) NULL DEFAULT NULL,
        PRIMARY KEY (\`key\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
    );
    try {
      await this.#pool.query(
        `CREATE INDEX \`idx_${this.#tableName}_expires\`
         ON \`${this.#tableName}\` (\`expires\`)`,
      );
    } catch (e) {
      // Ignore if the index already exists (ER_DUP_KEYNAME)
      if ((e as { code?: string }).code !== "ER_DUP_KEYNAME") throw e;
    }
    this.#initialized = true;
    logger.debug("Initialized the key-value store table {tableName}.", {
      tableName: this.#tableName,
    });
  }

  /**
   * Drops the table used by the key-value store.  Does nothing if the table
   * does not exist.
   *
   * @since 2.1.0
   */
  async drop(): Promise<void> {
    await this.#pool.query(
      `DROP TABLE IF EXISTS \`${this.#tableName}\``,
    );
  }
}

function durationToSeconds(duration: Temporal.Duration): number {
  const rounded = duration.round({
    largestUnit: "hour",
    relativeTo: Temporal.Now.plainDateTimeISO(),
  });
  return (
    rounded.hours * 3600 +
    rounded.minutes * 60 +
    rounded.seconds +
    rounded.milliseconds / 1000 +
    rounded.microseconds / 1_000_000 +
    rounded.nanoseconds / 1_000_000_000
  );
}
