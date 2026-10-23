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

const expiryBatchSize = 1000;
const expiryInterval = 60_000;
const expiryCatchUpInterval = 1000;

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
   *
   * This skips only the table's schema DDL.  Driver-specific runtime setup,
   * such as detecting whether the driver serializes JSON parameters on its
   * own, still runs before the first key is read or written.
   * @default `false`
   */
  readonly initialized?: boolean;
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
  readonly #skipDdl: boolean;
  #initialized = false;
  #driverSerializesJson = false;
  #expiring?: Promise<void>;
  #nextExpiry = 0;

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
    this.#skipDdl = options.initialized ?? false;
  }

  #expire(): Promise<void> | void {
    // A caller-owned connection cannot outlive its housekeeping.  Catching a
    // detached SQL error would still abort it and could hide a rollback.
    // Reserved clients may run manual transactions without savepoint().
    // Cleanup locks remain held until the caller ends the transaction.
    const callerOwned = ("savepoint" in this.#sql &&
      typeof this.#sql.savepoint === "function") ||
      ("release" in this.#sql && typeof this.#sql.release === "function");
    if (this.#expiring) return callerOwned ? this.#expiring : undefined;
    if (performance.now() < this.#nextExpiry) return;
    this.#expiring = (async () => {
      let interval = expiryInterval;
      try {
        if (await this.#sweep() === expiryBatchSize) {
          interval = expiryCatchUpInterval;
        }
      } catch (error) {
        if (callerOwned) throw error;
        logger.warn("Failed to expire keys in {tableName}: {error}", {
          tableName: this.#tableName,
          error,
        });
      } finally {
        // Back off after failures and lock misses too.  Jitter spreads work
        // across stores; the database lock prevents overlapping table scans.
        this.#nextExpiry = performance.now() + interval * (1 + Math.random());
        this.#expiring = undefined;
      }
    })();
    return callerOwned ? this.#expiring : undefined;
  }

  async #sweep(): Promise<number> {
    // Resolve the logical table through its row type so partitions and
    // inheritance children share one lock, respecting identifier transforms.
    // The bigint lock namespace is separate from the queue's two-int locks.
    // CTIDs overlap across child tables, so check tableoid too.  Keep the CTID
    // array to allow TID lookups instead of a second full-table join scan.
    const [result] = await this.#sql<{ count: number }[]>`
      WITH sweep_lock AS MATERIALIZED (
        SELECT pg_try_advisory_xact_lock(
          (hashtext('fedify.postgres.kv.expire')::bigint << 32) |
          (SELECT typrelid::bigint FROM pg_catalog.pg_type
           WHERE oid = pg_typeof(NULL::${this.#sql(this.#tableName)})::oid)
        ) AS acquired
      ), candidates AS MATERIALIZED (
        SELECT tableoid AS relation, ctid AS tid
        FROM ${this.#sql(this.#tableName)}
        WHERE (SELECT acquired FROM sweep_lock)
          AND ttl IS NOT NULL AND created + ttl < statement_timestamp()
        LIMIT ${expiryBatchSize} FOR UPDATE SKIP LOCKED
      ), deleted AS (
        DELETE FROM ${this.#sql(this.#tableName)}
        WHERE ctid = ANY(ARRAY(SELECT tid FROM candidates))
          AND (tableoid, ctid) IN (SELECT relation, tid FROM candidates)
          AND ttl IS NOT NULL AND created + ttl < statement_timestamp()
        RETURNING 1
      )
      SELECT count(*)::int AS count FROM deleted;
    `;
    return result.count;
  }

  async get<T = unknown>(key: KvKey): Promise<T | undefined> {
    await this.initialize();
    const result = await this.#sql`
      SELECT value
      FROM ${this.#sql(this.#tableName)}
      WHERE key = ${key} AND (ttl IS NULL OR created + ttl > statement_timestamp());
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
    const ttl = options?.ttl == null
      ? null
      : Temporal.Duration.from(options.ttl).toString();
    // When merging into main, apply this special case to cas() too:
    // #json(null) can produce SQL NULL.
    const jsonValue = value === null
      ? this.#sql`'null'::jsonb`
      : this.#json(value);
    await this.#sql`
      INSERT INTO ${this.#sql(this.#tableName)} (key, value, created, ttl)
      VALUES (
        ${key},
        ${jsonValue},
        statement_timestamp(),
        ${ttl}
      )
      ON CONFLICT (key)
        DO UPDATE SET
          value = EXCLUDED.value,
          created = statement_timestamp(),
          ttl = EXCLUDED.ttl;
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
  async *list(prefix?: KvKey): AsyncIterable<KvStoreListEntry> {
    await this.initialize();

    let results;
    if (prefix == null || prefix.length === 0) {
      results = await this.#sql`
        SELECT key, value
        FROM ${this.#sql(this.#tableName)}
        WHERE ttl IS NULL OR created + ttl > statement_timestamp()
        ORDER BY key
      `;
    } else {
      const prefixLength = prefix.length;
      results = await this.#sql`
        SELECT key, value
        FROM ${this.#sql(this.#tableName)}
        WHERE array_length(key, 1) >= ${prefixLength}
          AND key[1:${prefixLength}] = ${prefix}::text[]
          AND (ttl IS NULL OR created + ttl > statement_timestamp())
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
    logger.debug("Initializing the key–value store table {tableName}...", {
      tableName: this.#tableName,
    });
    if (!this.#skipDdl) await this.#initializeTable();
    this.#driverSerializesJson = await driverSerializesJson(this.#sql);
    this.#initialized = true;
    logger.debug("Initialized the key–value store table {tableName}.", {
      tableName: this.#tableName,
    });
  }

  async #initializeTable(): Promise<void> {
    await this.#sql`
      CREATE UNLOGGED TABLE IF NOT EXISTS ${this.#sql(this.#tableName)} (
        key text[] PRIMARY KEY,
        value jsonb NOT NULL,
        created timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
        ttl interval
      );
    `;
  }

  /**
   * Drops the table used by the key–value store.  Does nothing if the table
   * does not exist.
   */
  async drop(): Promise<void> {
    await this.#expiring;
    await this.#sql`DROP TABLE IF EXISTS ${this.#sql(this.#tableName)};`;
  }

  #json(value: unknown): Parameter {
    if (this.#driverSerializesJson) return this.#sql.json(value as JSONValue);
    return this.#sql.json(JSON.stringify(value));
  }
}
