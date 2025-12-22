import type {
  KvKey,
  KvStore,
  KvStoreListEntry,
  KvStoreListOptions,
  KvStoreSetOptions,
} from "@fedify/fedify";
import { getLogger } from "@logtape/logtape";
import type { JSONValue, Parameter, Sql } from "postgres";
import { driverSerializesJson } from "./utils.ts";

const logger = getLogger(["fedify", "postgres", "kv"]);

/**
 * Options for the PostgreSQL key–value store.
 */
export interface PostgresKvStoreOptions {
  /**
   * The table name to use for the key–value store.
   * `"fedify_kv_v2"` by default.
   * @default `"fedify_kv_v2"`
   */
  tableName?: string;

  /**
   * Whether the table has been initialized.  `false` by default.
   * @default `false`
   */
  initialized?: boolean;
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
  #initialized: boolean;
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
   * {@inheritDoc KvStore.list}
   * @since 1.10.0
   */
  async *list(
    options: KvStoreListOptions,
  ): AsyncIterable<KvStoreListEntry> {
    await this.initialize();

    const prefix = options.prefix;
    const prefixLength = prefix.length;

    const results = await this.#sql`
      SELECT key, value
      FROM ${this.#sql(this.#tableName)}
      WHERE array_length(key, 1) >= ${prefixLength}
        AND key[1:${prefixLength}] = ${prefix}::text[]
        AND (ttl IS NULL OR created + ttl > CURRENT_TIMESTAMP)
      ORDER BY key
    `;

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
    logger.debug("Initializing the key–value store table {tableName}...", {
      tableName: this.#tableName,
    });
    await this.#sql`
      CREATE UNLOGGED TABLE IF NOT EXISTS ${this.#sql(this.#tableName)} (
        key text[] PRIMARY KEY,
        value jsonb NOT NULL,
        created timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
        ttl interval
      );
    `;
    this.#driverSerializesJson = await driverSerializesJson(this.#sql);
    this.#initialized = true;
    logger.debug("Initialized the key–value store table {tableName}.", {
      tableName: this.#tableName,
    });
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
