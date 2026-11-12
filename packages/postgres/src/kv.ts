import type {
  AtomicKvStore,
  KvKey,
  KvStoreCasEntry,
  KvStoreListEntry,
  KvStoreSetEntry,
  KvStoreSetOptions,
} from "@fedify/fedify";
import { getLogger } from "@logtape/logtape";
import type { JSONValue, Sql, TransactionSql } from "postgres";
import { driverSerializesJson } from "./utils.ts";

const logger = getLogger(["fedify", "postgres", "kv"]);

const expiryBatchSize = 1000;
const expiryInterval = 60_000;
const expiryCatchUpInterval = 1000;

function snapshotKey(key: KvKey): KvKey {
  if (!Array.isArray(key) || key.length === 0) {
    throw new TypeError("A key must be a nonempty array of strings.");
  }
  for (const part of key) {
    if (typeof part !== "string") {
      throw new TypeError("A key must be a dense array of strings.");
    }
  }
  return [...key] as [string, ...string[]];
}

function snapshotValue(value: unknown): JSONValue {
  const encoded = JSON.stringify(value);
  if (encoded === undefined)
    throw new TypeError("The value is not JSON encodable.");
  return JSON.parse(encoded) as JSONValue;
}

function snapshotTtl(options?: KvStoreSetOptions): string | null {
  return options?.ttl == null
    ? null
    : Temporal.Duration.from(options.ttl).toString();
}

function snapshotBatch<T, U>(
  entries: readonly T[],
  prepare: (entry: T) => U,
): U[] {
  if (!Array.isArray(entries)) throw new TypeError("A batch must be an array.");
  // Array.from visits holes, unlike map(), so sparse batches reject too.
  return Array.from(entries, prepare);
}

function uniqueKeys(entries: readonly { readonly key: KvKey }[]): void {
  const seen = new Set<string>();
  for (const { key } of entries) {
    const encoded = JSON.stringify(key);
    if (seen.has(encoded))
      throw new TypeError("Duplicate keys in an atomic mutation.");
    seen.add(encoded);
  }
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
   *
   * This skips only the table's schema DDL.  Driver-specific runtime setup,
   * such as detecting whether the driver serializes JSON parameters on its
   * own, still runs before the first key is read or written.
   * It also skips automatic expiry-index provisioning.  See the PostgreSQL
   * key–value store migration guide for the index to add to your own DDL.
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
 * Implements {@link AtomicKvStore} within one ordinary table or declarative
 * partitioned table, using the default JSON codec and PostgreSQL `jsonb`
 * equality. Object member order is ignored; array order is significant.
 * TTLs use server time and PostgreSQL intervals at microsecond precision.
 * Zero durations expire immediately; negative Temporal durations reject.
 * Ordinary inheritance and irreversible value/JSON transforms are unsupported
 * for batches. Batches are never split; backend field, index and memory limits
 * apply, with index-storage failures arising only on attempted writes.
 *
 * Nonempty {@link casMany} and multi-key {@link deleteMany} require a pool or
 * a READ COMMITTED transaction client; reserved clients reject those scopes.
 * They serialize writes to the entire table. Caller transactions must be used
 * exclusively and sequentially during each atomic call, across all wrappers
 * and raw SQL. Nested savepoints do not isolate concurrent calls on one outer
 * transaction. Successful calls remain provisional and retain locks until the
 * caller commits. See the package README for scope and durability details.
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
export class PostgresKvStore implements AtomicKvStore {
  readonly #sql: Sql | TransactionSql;
  readonly #tableName: string;
  readonly #unlogged: boolean;
  readonly #skipDdl: boolean;
  #initialized = false;
  #initializing?: Promise<void>;
  #batchInitializing?: Promise<void>;
  #driverSerializesJson = false;
  #expiring?: Promise<void>;
  #nextExpiry = 0;

  /**
   * Creates a new PostgreSQL key–value store.
   * @param sql The PostgreSQL client to use.
   * @param options The options for the key–value store.
   */
  constructor(sql: Sql | TransactionSql, options: PostgresKvStoreOptions = {}) {
    this.#sql = sql;
    this.#tableName = options.tableName ?? "fedify_kv_v2";
    this.#unlogged = options.unlogged ?? false;
    this.#skipDdl = options.initialized ?? false;
  }

  #expire(): Promise<void> | void {
    // A caller-owned connection cannot outlive its housekeeping.  Catching a
    // detached SQL error would still abort it and could hide a rollback.
    // Reserved clients may run manual transactions without savepoint().
    // Cleanup locks remain held until the caller ends the transaction.
    const callerOwned = this.#callerOwned();
    if (this.#expiring) return callerOwned ? this.#expiring : undefined;
    if (performance.now() < this.#nextExpiry) return;
    this.#expiring = (async () => {
      let interval = expiryInterval;
      try {
        if ((await this.#sweep()) === expiryBatchSize) {
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
    // The immutable UTC expression is only an index search key.  Recheck the
    // original session-calendar predicate before LIMIT and again on deletion;
    // calendar/DST differences may delay reclamation, never logical expiry.
    // Keep UTC literal so generic plans can match the expression index.
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
          AND ttl IS NOT NULL
          AND timezone('UTC', timezone('UTC', created) + ttl)
            < statement_timestamp()
          AND created + ttl < statement_timestamp()
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
    key = snapshotKey(key);
    value = snapshotValue(value);
    const ttl = snapshotTtl(options);
    await this.initialize();
    await this.#sql`
      INSERT INTO ${this.#sql(this.#tableName)} (key, value, created, ttl)
      SELECT
        ${key},
        ${this.#json(value)},
        statement_timestamp(),
        ${ttl}::interval
      WHERE ${ttl}::interval IS NULL
        OR statement_timestamp() + ${ttl}::interval IS NOT NULL
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
   * {@inheritDoc AtomicKvStore.cas}
   * @since 2.4.0
   */
  async cas(
    key: KvKey,
    expectedValue: unknown,
    newValue: unknown,
    options?: KvStoreSetOptions,
  ): Promise<boolean> {
    key = snapshotKey(key);
    expectedValue =
      expectedValue === undefined ? undefined : snapshotValue(expectedValue);
    newValue = newValue === undefined ? undefined : snapshotValue(newValue);
    if (newValue === undefined && options?.ttl != null) {
      throw new TypeError("A CAS deletion must not specify a TTL.");
    }
    const ttl = snapshotTtl(options);
    const payload = JSON.stringify([
      { key, expected: expectedValue, value: newValue, ttl },
    ]);
    await this.initialize();
    // Range validation is not an expiry decision. The final CAS statement
    // alone supplies its liveness cutoff and replacement's TTL origin.
    await this.#validatePayload(this.#sql, payload, ttl === null ? 0 : 1);

    if (expectedValue === undefined && newValue === undefined) {
      return (await this.get(key)) === undefined;
    }

    let result;
    if (expectedValue === undefined) {
      result = await this.#sql`
        INSERT INTO ${this.#sql(this.#tableName)} AS existing
          (key, value, created, ttl)
        VALUES (
          ${key},
          ${this.#json(newValue)},
          statement_timestamp(),
          ${ttl}
        )
        ON CONFLICT (key)
          DO UPDATE SET
            value = EXCLUDED.value,
            created = EXCLUDED.created,
            ttl = EXCLUDED.ttl
          WHERE NOT coalesce(existing.ttl IS NULL
            OR existing.created + existing.ttl > statement_timestamp(), false)
        RETURNING key;
      `;
    } else if (newValue === undefined) {
      result = await this.#sql`
        DELETE FROM ${this.#sql(this.#tableName)}
        WHERE key = ${key}
          AND (ttl IS NULL OR created + ttl > statement_timestamp())
          AND value = ${this.#json(expectedValue)}
        RETURNING key;
      `;
    } else {
      result = await this.#sql`
        UPDATE ${this.#sql(this.#tableName)}
        SET
          value = ${this.#json(newValue)},
          created = statement_timestamp(),
          ttl = ${ttl}
        WHERE key = ${key}
          AND (ttl IS NULL OR created + ttl > statement_timestamp())
          AND value = ${this.#json(expectedValue)}
        RETURNING key;
      `;
    }

    await this.#expire();
    return result.length > 0;
  }

  /**
   * {@inheritDoc AtomicKvStore.getMany}
   * @since 2.5.0
   */
  async getMany<T = unknown>(
    keys: readonly KvKey[],
  ): Promise<(T | undefined)[]> {
    const entries = snapshotBatch(keys, (key) => ({ key: snapshotKey(key) }));
    if (entries.length === 0) return [];
    const payload = JSON.stringify(entries);
    await this.#initializeBatch();
    const sql = this.#sql;
    const table = sql.unsafe(await this.#resolvedTable(sql));
    const rows = await sql`
      WITH support AS (${this.#support(sql)}), input AS (${this.#input(sql, payload)})
      SELECT support.supported, input.ord, existing.value,
        coalesce(existing.key IS NOT NULL AND
          (existing.ttl IS NULL OR existing.created + existing.ttl > statement_timestamp()), false)
          AS present
      FROM support CROSS JOIN input
      LEFT JOIN ${table} AS existing ON existing.key = input.key
      ORDER BY input.ord
    `;
    this.#assertSupport(rows[0]?.supported);
    if (rows.length !== entries.length)
      throw new TypeError("Nonunique backing keys.");
    return rows.map((row) => (row.present ? (row.value as T) : undefined));
  }

  /**
   * {@inheritDoc AtomicKvStore.setMany}
   * @since 2.5.0
   */
  async setMany(entries: readonly KvStoreSetEntry[]): Promise<void> {
    const prepared = snapshotBatch(entries, (entry) => ({
      key: snapshotKey(entry.key),
      value: snapshotValue(entry.value),
      ttl: snapshotTtl(entry.options),
    }));
    uniqueKeys(prepared);
    if (prepared.length === 0) return;
    const payload = JSON.stringify(prepared);
    await this.#initializeBatch();
    await this.#writeBatch(this.#sql, payload);
    if (!this.#callerOwned()) await this.#expire();
  }

  /**
   * {@inheritDoc AtomicKvStore.deleteMany}
   * More than one key requires a pool or a sequentially used READ COMMITTED
   * transaction client; reserved clients reject that scope before SQL.
   * @since 2.5.0
   */
  async deleteMany(keys: readonly KvKey[]): Promise<void> {
    const entries = snapshotBatch(keys, (key) => ({ key: snapshotKey(key) }));
    uniqueKeys(entries);
    if (entries.length === 0) return;
    const payload = JSON.stringify(entries);
    if (entries.length > 1) {
      await this.#locked(async (sql) => {
        await this.#deleteBatch(sql, payload);
        return true;
      });
    } else {
      await this.#initializeBatch();
      await this.#deleteBatch(this.#sql, payload);
    }
    if (!this.#callerOwned()) await this.#expire();
  }

  /**
   * {@inheritDoc AtomicKvStore.casMany}
   * Nonempty batches require a pool or an exclusively, sequentially used
   * READ COMMITTED transaction client. Reserved clients reject before SQL.
   * The table-wide write lock survives success until the outer commit.
   * @since 2.5.0
   */
  async casMany(entries: readonly KvStoreCasEntry[]): Promise<boolean> {
    const prepared = snapshotBatch(entries, (entry) => {
      const expected = entry.expectedValue;
      const value = entry.newValue;
      const ttl = snapshotTtl(entry.options);
      if (value === undefined && ttl !== null) {
        throw new TypeError("A CAS deletion must not specify a TTL.");
      }
      return {
        key: snapshotKey(entry.key),
        absent: expected === undefined,
        expected: expected === undefined ? undefined : snapshotValue(expected),
        remove: value === undefined,
        value: value === undefined ? undefined : snapshotValue(value),
        ttl,
      };
    });
    uniqueKeys(prepared);
    if (prepared.length === 0) return true;
    const payload = JSON.stringify(prepared);
    const deletions = JSON.stringify(prepared.filter((entry) => entry.remove));
    const writes = JSON.stringify(prepared.filter((entry) => !entry.remove));
    const ttls = prepared.filter((entry) => entry.ttl !== null).length;
    const mismatch = new Error("Atomic comparison mismatch.");
    try {
      await this.#locked(async (sql) => {
        const table = sql.unsafe(await this.#resolvedTable(sql));
        const [result] = await sql`
          WITH input AS (${this.#input(sql, payload)})
          SELECT bool_and(CASE WHEN (input.item->>'absent')::boolean THEN
              NOT coalesce(existing.key IS NOT NULL AND
                (existing.ttl IS NULL OR existing.created + existing.ttl > statement_timestamp()), false)
            ELSE coalesce(existing.key IS NOT NULL AND
                (existing.ttl IS NULL OR existing.created + existing.ttl > statement_timestamp()), false)
              AND existing.value = input.item->'expected' END) AS matches,
            count(*)::int AS size,
            count((input.item->>'ttl')::interval)::int AS ttls,
            count(statement_timestamp() + (input.item->>'ttl')::interval)::int AS expiry,
            to_char(statement_timestamp() AT TIME ZONE 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cutoff
          FROM input
          LEFT JOIN ${table} AS existing ON existing.key = input.key
        `;
        if (result.size !== prepared.length)
          throw new TypeError("Nonunique backing keys.");
        if (result.ttls !== ttls || result.expiry !== ttls) {
          throw new TypeError("Invalid TTL representation.");
        }
        if (!result.matches) throw mismatch;
        if (deletions !== "[]") await this.#deleteBatch(sql, deletions);
        if (writes !== "[]") await this.#writeBatch(sql, writes, result.cutoff);
        return true;
      });
    } catch (error) {
      // The driver has rolled back before this private sentinel is translated.
      // Never hide rollback failures or any backend error as a mismatch.
      if (error === mismatch) return false;
      throw error;
    }
    if (!this.#callerOwned()) await this.#expire();
    return true;
  }

  #input(sql: Sql | TransactionSql, payload: string) {
    return sql`
      SELECT item, ord,
        ARRAY(SELECT part FROM jsonb_array_elements_text(item->'key')
          WITH ORDINALITY AS parts(part, position) ORDER BY position) AS key
      FROM jsonb_array_elements(${payload}::text::jsonb)
        WITH ORDINALITY AS items(item, ord)
    `;
  }

  async #resolvedTable(sql: Sql | TransactionSql): Promise<string> {
    // Qualify the actual relation so internal CTE names cannot shadow it.
    // PostgreSQL formats both components; do not transform them a second time.
    const [relation] = await sql`
      SELECT pg_catalog.format('%I.%I', n.nspname, c.relname) AS name
      FROM pg_catalog.pg_class AS c
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
      WHERE c.oid = (SELECT typrelid FROM pg_catalog.pg_type
        WHERE oid = pg_typeof(NULL::${sql(this.#tableName)})::oid)
    `;
    if (typeof relation?.name !== "string") {
      throw new TypeError("The backing table could not be resolved.");
    }
    return relation.name;
  }

  #support(sql: Sql | TransactionSql) {
    // Ordinary inheritance does not extend the parent's primary-key constraint.
    // Declarative partitions are different: their unique key includes the
    // partition key. Resolve through the driver's identifier transforms once.
    return sql`
      SELECT c.relkind IN ('r', 'p')
        AND (c.relispartition OR NOT EXISTS (
          SELECT 1 FROM pg_catalog.pg_inherits WHERE inhrelid = c.oid
        ))
        AND NOT EXISTS (
          SELECT 1 FROM pg_catalog.pg_inherits AS i
          JOIN pg_catalog.pg_class AS child ON child.oid = i.inhrelid
          WHERE i.inhparent = c.oid AND NOT child.relispartition
        ) AS supported
      FROM pg_catalog.pg_class AS c
      WHERE c.oid = (SELECT typrelid FROM pg_catalog.pg_type
        WHERE oid = pg_typeof(NULL::${sql(this.#tableName)})::oid)
    `;
  }

  #assertSupport(supported: unknown): void {
    if (supported !== true) {
      throw new TypeError(
        "Atomic batches require an ordinary table or declarative partition without ordinary inheritance.",
      );
    }
  }

  async #validatePayload(
    sql: Sql | TransactionSql,
    payload: string,
    ttls: number,
  ): Promise<void> {
    const [result] = await sql`
      SELECT count((item->>'ttl')::interval)::int AS ttls,
        count(statement_timestamp() + (item->>'ttl')::interval)::int AS expiry
      FROM jsonb_array_elements(${payload}::text::jsonb) AS items(item)
    `;
    if (result.ttls !== ttls || result.expiry !== ttls) {
      throw new TypeError("Invalid TTL representation.");
    }
  }

  async #writeBatch(
    sql: Sql | TransactionSql,
    payload: string,
    cutoff?: string,
  ): Promise<void> {
    const origin =
      cutoff === undefined
        ? sql`statement_timestamp()`
        : sql`${cutoff}::text::timestamptz`;
    const [result] = await sql`
      WITH support AS (${this.#support(sql)}), input AS (${this.#input(sql, payload)}),
      written AS (
        INSERT INTO ${sql(this.#tableName)} (key, value, created, ttl)
        SELECT input.key, input.item->'value', ${origin}, (input.item->>'ttl')::interval
        FROM input CROSS JOIN support
        WHERE support.supported AND ((input.item->>'ttl')::interval IS NULL
          OR ${origin} + (input.item->>'ttl')::interval IS NOT NULL)
        ORDER BY input.key
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value,
          created = EXCLUDED.created, ttl = EXCLUDED.ttl
        RETURNING 1
      )
      SELECT supported, (SELECT count(*) FROM written) AS size FROM support
    `;
    this.#assertSupport(result?.supported);
  }

  async #deleteBatch(
    sql: Sql | TransactionSql,
    payload: string,
  ): Promise<void> {
    const [result] = await sql`
      WITH support AS (${this.#support(sql)}), input AS (${this.#input(sql, payload)}),
      deleted AS (
        DELETE FROM ${sql(this.#tableName)} AS existing
        WHERE (SELECT supported FROM support)
          AND existing.key IN (SELECT key FROM input)
        RETURNING 1
      )
      SELECT supported, (SELECT count(*) FROM deleted) AS size FROM support
    `;
    this.#assertSupport(result?.supported);
  }

  async #initializeBatch(): Promise<void> {
    if (!this.#callerOwned() || this.#skipDdl) return await this.initialize();
    // Caller rollback can undo DDL while this object and a fulfilled ordinary
    // initialization promise survive. Retain only concurrent in-flight setup.
    const pending = (this.#batchInitializing ??= (async () => {
      await this.#initializeTable();
      this.#driverSerializesJson = await driverSerializesJson(this.#sql);
    })());
    try {
      await pending;
    } finally {
      if (this.#batchInitializing === pending)
        this.#batchInitializing = undefined;
    }
  }

  async #locked(
    operation: (sql: Sql | TransactionSql) => Promise<boolean>,
  ): Promise<boolean> {
    const transaction =
      "savepoint" in this.#sql && typeof this.#sql.savepoint === "function";
    if (
      !transaction &&
      ("release" in this.#sql ||
        !("begin" in this.#sql) ||
        typeof this.#sql.begin !== "function")
    ) {
      throw new TypeError(
        "This atomic scope requires a pool or READ COMMITTED transaction client.",
      );
    }
    if (transaction) {
      const [settings] =
        await this.#sql`SELECT current_setting('transaction_isolation') AS isolation`;
      if (
        settings.isolation !== "read committed" &&
        settings.isolation !== "read uncommitted"
      ) {
        throw new TypeError(
          "This atomic scope requires READ COMMITTED isolation.",
        );
      }
    }
    await this.#initializeBatch();
    const run = async (sql: Sql | TransactionSql): Promise<boolean> => {
      await sql`LOCK TABLE ${sql(this.#tableName)} IN SHARE ROW EXCLUSIVE MODE`;
      const [support] = await this.#support(sql);
      this.#assertSupport(support?.supported);
      return await operation(sql);
    };
    return transaction
      ? await (this.#sql as TransactionSql).savepoint(run)
      : await (this.#sql as Sql).begin("isolation level read committed", run);
  }

  /**
   * {@inheritDoc AtomicKvStore.list}
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
    this.#initializing ??= (async () => {
      logger.debug("Initializing the key–value store table {tableName}...", {
        tableName: this.#tableName,
      });
      if (!this.#skipDdl) await this.#initializeTable();
      if (!this.#skipDdl && !this.#callerOwned()) {
        await this.#initializeExpiryIndex();
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

  async #initializeTable(): Promise<void> {
    // Caller rollback can remove a previously created table. Check each time,
    // but avoid write-class DDL when reads reuse a table in READ ONLY scope.
    // Scoped clients do not expose options. The driver's identifier helper
    // contains the exact escaped SQL name, including its column.to transform.
    const identifier = this.#sql(this.#tableName);
    if (!("value" in identifier) || typeof identifier.value !== "string") {
      throw new TypeError(
        "The PostgreSQL client must expose its escaped identifier.",
      );
    }
    const table = identifier.value;
    const [existing] = await this.#sql`
      SELECT to_regclass(${table}) IS NOT NULL AS present
    `;
    if (this.#unlogged) {
      if (!existing.present)
        await this.#sql`
        CREATE UNLOGGED TABLE IF NOT EXISTS ${this.#sql(this.#tableName)} (
          key text[] PRIMARY KEY,
          value jsonb NOT NULL,
          created timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
          ttl interval
        );
      `;
    } else {
      if (!existing.present)
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
        WHERE oid = to_regclass(${table});
      `;
      if (persistence[0]?.relpersistence === "u") {
        await this.#sql`
          ALTER TABLE ${this.#sql(this.#tableName)} SET LOGGED;
        `;
      }
    }
  }

  #callerOwned(): boolean {
    return (
      ("savepoint" in this.#sql && typeof this.#sql.savepoint === "function") ||
      ("release" in this.#sql && typeof this.#sql.release === "function")
    );
  }

  async #initializeExpiryIndex(): Promise<void> {
    try {
      await (this.#sql as Sql).begin(
        "isolation level read committed",
        async (sql) => {
          await sql`SET LOCAL lock_timeout = '250ms'`;
          await sql`SET LOCAL statement_timeout = '2s'`;
          // Resolve identifiers through the driver once.  DDL below is quoted
          // by PostgreSQL, without applying identifier transforms a second time.
          const [table] = await sql`
          SELECT c.oid, c.relkind, c.relrowsecurity,
            pg_has_role(current_user, c.relowner, 'USAGE') AS owner,
            EXISTS (SELECT 1 FROM pg_inherits WHERE inhparent = c.oid) AS children,
            format('%I.%I', n.nspname, c.relname) AS name,
            'idx_fedify_kv_expiry_' || substr(md5(
              format('%I.%I', n.nspname, c.relname)
            ), 1, 16) AS idx
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.oid = (SELECT typrelid FROM pg_type
            WHERE oid = pg_typeof(NULL::${sql(this.#tableName)})::oid)
        `;
          const indexed = async () => {
            const [result] = await sql`
            SELECT EXISTS (
              SELECT 1 FROM pg_index i
              JOIN pg_class c ON c.oid = i.indexrelid
              JOIN pg_am a ON a.oid = c.relam
              JOIN pg_opclass o ON o.oid = i.indclass[0]
              WHERE i.indrelid = ${table.oid}::oid
                AND i.indisvalid AND i.indisready AND i.indislive
                AND NOT i.indisunique AND i.indnatts = 1
                AND a.amname = 'btree' AND i.indkey[0] = 0
                AND o.opcdefault AND o.opcintype = 'timestamptz'::regtype
                AND pg_get_indexdef(i.indexrelid, 1, false) IN (
                  ${"timezone('UTC'::text, (timezone('UTC'::text, created) + ttl))"},
                  ${"(((created AT TIME ZONE 'UTC'::text) + ttl) AT TIME ZONE 'UTC'::text)"}
                )
                AND (i.indpred IS NULL OR
                  pg_get_expr(i.indpred, i.indrelid) = '(ttl IS NOT NULL)')
            ) AS present
          `;
            return result.present;
          };
          if (await indexed()) return;
          const manual = () =>
            logger.warn(
              "Provision the expiry index for {tableName} manually; see {guide}.",
              {
                tableName: table.name,
                guide: "https://fedify.dev/manual/kv#postgresql-expiry-index",
              },
            );
          if (
            !table.owner ||
            table.relrowsecurity ||
            (table.relkind !== "r" && table.relkind !== "p") ||
            (table.relkind === "r" && table.children)
          ) {
            manual();
            return;
          }
          const empty = async () => {
            const [result] = await sql.unsafe(
              `SELECT NOT EXISTS (SELECT 1 FROM ${table.name} LIMIT 1) AS empty`,
            );
            return result.empty;
          };
          // Never queue a write-blocking lock against a populated legacy table.
          if (!(await empty())) {
            manual();
            return;
          }
          const [lock] = await sql`
          SELECT pg_try_advisory_xact_lock(
            (hashtext('fedify.postgres.kv.index')::bigint << 32) |
            ${table.oid}::bigint
          ) AS acquired
        `;
          if (!lock.acquired) return;
          await sql.unsafe(`LOCK TABLE ${table.name} IN SHARE MODE`);
          // READ COMMITTED gives this recheck a fresh snapshot after the lock.
          if (await indexed()) return;
          if (!(await empty())) {
            manual();
            return;
          }
          const [ddl] = await sql`
          SELECT format(
            'CREATE INDEX %I ON %s ((timezone(''UTC'', timezone(''UTC'', created) + ttl))) WHERE ttl IS NOT NULL',
            ${table.idx}::text, ${table.name}::text
          ) AS command
        `;
          await sql.unsafe(ddl.command);
        },
      );
    } catch (error) {
      // This private transaction has rolled back.  Optional index setup must
      // not abort a caller's transaction or disable an otherwise usable store.
      logger.warn(
        "Failed to provision the expiry index for {tableName}: {error}. See {guide}.",
        {
          tableName: this.#tableName,
          error,
          guide: "https://fedify.dev/manual/kv#postgresql-expiry-index",
        },
      );
    }
  }

  /**
   * Drops the table used by the key–value store.  Does nothing if the table
   * does not exist.
   */
  async drop(): Promise<void> {
    await this.#expiring;
    await this.#sql`DROP TABLE IF EXISTS ${this.#sql(this.#tableName)};`;
  }

  #json(value: unknown) {
    // postgres.js can encode sql.json(null) as SQL NULL. Store JSON null.
    if (value === null) return this.#sql`'null'::jsonb`;
    if (this.#driverSerializesJson) return this.#sql.json(value as JSONValue);
    return this.#sql.json(JSON.stringify(value));
  }
}
