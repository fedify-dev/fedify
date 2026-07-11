import type {
  KvKey,
  KvStore,
  KvStoreListEntry,
  KvStoreSetOptions,
} from "@fedify/fedify";
import { getLogger } from "@logtape/logtape";
import type { JSONValue, Parameter, Sql } from "postgres";
import { driverSerializesJson } from "./utils.ts";

const logger = getLogger(["fedify", "postgres", "kv"]);

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""').replaceAll(".", '"."')}"`;
}

/**
 * Options for the PostgreSQL key–value store.
 */
export interface PostgresKvStoreOptions {
  /**
   * The table name to use for the key–value store.
   * `"fedify_kv_v2"` by default.
   * @default `"fedify_kv_v2"`
   */
  readonly tableName?: string;

  /**
   * Whether the table has been initialized.  `false` by default.
   * @default `false`
   */
  readonly initialized?: boolean;

  /**
   * Whether to use an unlogged table.  Unlogged tables are faster, but are
   * truncated after a PostgreSQL crash and are not replicated.  `false` by
   * default.
   * @default `false`
   */
  readonly unlogged?: boolean;
}

/**
 * A key–value store that uses PostgreSQL as the underlying storage.
 *
 * @example
 * ```ts
 * import { createFederation } from "@fedify/fedify";
 * import { PostgresKvStore } from "@fedify/postgres";
 * import postgres from "postgres";
 *
 * const federation = createFederation({
 *   // ...
 *   kv: new PostgresKvStore(postgres("postgres://user:pass@localhost/db")),
 * });
 * ```
 */
export class PostgresKvStore implements KvStore {
  // deno-lint-ignore ban-types
  readonly #sql: Sql<{}>;
  readonly #tableName: string;
  readonly #unlogged: boolean;
  #initialized: boolean;
  #initializing?: Promise<void>;
  #driverSerializesJson = false;

  /**
   * Creates a new PostgreSQL key–value store.
   * @param sql The PostgreSQL client to use.
   * @param options The options for the key–value store.
   */
  constructor(
    // deno-lint-ignore ban-types
    sql: Sql<{}>,
    options: PostgresKvStoreOptions = {},
  ) {
    this.#sql = sql;
    this.#tableName = options.tableName ?? "fedify_kv_v2";
    this.#unlogged = options.unlogged ?? false;
    this.#initialized = options.initialized ?? false;
  }

  async #expire(): Promise<void> {
    await this.#sql`
      DELETE FROM ${this.#sql(this.#tableName)}
      WHERE ttl IS NOT NULL AND created + ttl < CURRENT_TIMESTAMP;
    `;
  }

  async get<T = unknown>(key: KvKey): Promise<T | undefined> {
    await this.initialize();
    const result = await this.#sql`
      SELECT value
      FROM ${this.#sql(this.#tableName)}
      WHERE key = ${key} AND (ttl IS NULL OR created + ttl > CURRENT_TIMESTAMP);
    `;
    if (result.length < 1) return undefined;
    return result[0].value as T;
  }

  async set(
    key: KvKey,
    value: unknown,
    options?: KvStoreSetOptions | undefined,
  ): Promise<void> {
    await this.initialize();
    const ttl = options?.ttl == null ? null : options.ttl.toString();
    await this.#sql`
      INSERT INTO ${this.#sql(this.#tableName)} (key, value, ttl)
      VALUES (
        ${key},
        ${this.#json(value)},
        ${ttl}
      )
      ON CONFLICT (key)
        DO UPDATE SET value = EXCLUDED.value, ttl = EXCLUDED.ttl;
    `;
    await this.#expire();
  }

  async delete(key: KvKey): Promise<void> {
    await this.initialize();
    await this.#sql`
      DELETE FROM ${this.#sql(this.#tableName)}
      WHERE key = ${key};
    `;
    await this.#expire();
  }

  /**
   * {@inheritDoc KvStore.cas}
   * @since 2.4.0
   */
  async cas(
    key: KvKey,
    expectedValue: unknown,
    newValue: unknown,
    options?: KvStoreSetOptions,
  ): Promise<boolean> {
    await this.initialize();
    const ttl = options?.ttl == null ? null : options.ttl.toString();

    if (expectedValue === undefined && newValue === undefined) {
      return await this.get(key) === undefined;
    }

    let result;
    if (expectedValue === undefined) {
      result = await this.#sql`
        INSERT INTO ${this.#sql(this.#tableName)} AS existing
          (key, value, created, ttl)
        VALUES (
          ${key},
          ${this.#json(newValue)},
          CURRENT_TIMESTAMP,
          ${ttl}
        )
        ON CONFLICT (key)
          DO UPDATE SET
            value = EXCLUDED.value,
            created = EXCLUDED.created,
            ttl = EXCLUDED.ttl
          WHERE existing.ttl IS NOT NULL
            AND existing.created + existing.ttl <= CURRENT_TIMESTAMP
        RETURNING key;
      `;
    } else if (newValue === undefined) {
      result = await this.#sql`
        DELETE FROM ${this.#sql(this.#tableName)}
        WHERE key = ${key}
          AND (ttl IS NULL OR created + ttl > CURRENT_TIMESTAMP)
          AND value = ${this.#json(expectedValue)}
        RETURNING key;
      `;
    } else {
      result = await this.#sql`
        UPDATE ${this.#sql(this.#tableName)}
        SET
          value = ${this.#json(newValue)},
          created = CURRENT_TIMESTAMP,
          ttl = ${ttl}
        WHERE key = ${key}
          AND (ttl IS NULL OR created + ttl > CURRENT_TIMESTAMP)
          AND value = ${this.#json(expectedValue)}
        RETURNING key;
      `;
    }

    await this.#expire();
    return result.length > 0;
  }

  /**
   * {@inheritDoc KvStore.list}
   * @since 1.10.0
   */
  async *list(prefix?: KvKey): AsyncIterable<KvStoreListEntry> {
    await this.initialize();

    let results;
    if (prefix == null || prefix.length === 0) {
      results = await this.#sql`
        SELECT key, value
        FROM ${this.#sql(this.#tableName)}
        WHERE ttl IS NULL OR created + ttl > CURRENT_TIMESTAMP
        ORDER BY key
      `;
    } else {
      const prefixLength = prefix.length;
      results = await this.#sql`
        SELECT key, value
        FROM ${this.#sql(this.#tableName)}
        WHERE array_length(key, 1) >= ${prefixLength}
          AND key[1:${prefixLength}] = ${prefix}::text[]
          AND (ttl IS NULL OR created + ttl > CURRENT_TIMESTAMP)
        ORDER BY key
      `;
    }

    for (const row of results) {
      yield {
        key: row.key as KvKey,
        value: row.value,
      };
    }
  }

  /**
   * Creates the table used by the key–value store if it does not already exist.
   * Does nothing if the table already exists.
   */
  async initialize(): Promise<void> {
    if (this.#initialized) return;
    this.#initializing ??= (async () => {
      logger.debug("Initializing the key–value store table {tableName}...", {
        tableName: this.#tableName,
      });
      if (this.#unlogged) {
        await this.#sql`
          CREATE UNLOGGED TABLE IF NOT EXISTS ${this.#sql(this.#tableName)} (
            key text[] PRIMARY KEY,
            value jsonb NOT NULL,
            created timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
            ttl interval
          );
        `;
      } else {
        await this.#sql`
          CREATE TABLE IF NOT EXISTS ${this.#sql(this.#tableName)} (
            key text[] PRIMARY KEY,
            value jsonb NOT NULL,
            created timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
            ttl interval
          );
        `;
        const persistence = await this.#sql`
          SELECT relpersistence
          FROM pg_class
          WHERE oid = to_regclass(${quoteIdentifier(this.#tableName)});
        `;
        if (persistence[0]?.relpersistence === "u") {
          await this.#sql`
            ALTER TABLE ${this.#sql(this.#tableName)} SET LOGGED;
          `;
        }
      }
      this.#driverSerializesJson = await driverSerializesJson(this.#sql);
      this.#initialized = true;
      logger.debug("Initialized the key–value store table {tableName}.", {
        tableName: this.#tableName,
      });
    })();
    try {
      await this.#initializing;
    } catch (error) {
      this.#initializing = undefined;
      throw error;
    }
  }

  /**
   * Drops the table used by the key–value store.  Does nothing if the table
   * does not exist.
   */
  async drop(): Promise<void> {
    await this.#sql`DROP TABLE IF EXISTS ${this.#sql(this.#tableName)};`;
  }

  #json(value: unknown): Parameter {
    if (this.#driverSerializesJson) return this.#sql.json(value as JSONValue);
    return this.#sql.json(JSON.stringify(value));
  }
}
