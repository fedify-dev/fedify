/// <reference types="@types/emscripten" />

// Statements must stay sequential within the owner transaction.
/* oxlint-disable eslint/no-await-in-loop */
import type { PGliteInterface, Transaction } from "@electric-sql/pglite";
import type {
  KvKey,
  AtomicKvStore,
  KvStoreCasEntry,
  KvStoreSetEntry,
  KvStoreListEntry,
  KvStoreSetOptions,
} from "@fedify/fedify";
import { getLogger } from "@logtape/logtape";

const logger = getLogger(["fedify", "pglite", "kv"]);

function quoteIdentifier(identifier: string): string {
  const parts = identifier.split(".");
  if (parts.includes("")) {
    throw new TypeError(
      `Invalid table name for the key–value store: ${JSON.stringify(
        identifier,
      )}`,
    );
  }
  return parts.map((part) => `"${part.replaceAll('"', '""')}"`).join(".");
}

function serializeJson(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized == null) {
    throw new TypeError("PGlite cannot store a value that is not valid JSON");
  }
  return serialized;
}

function captureKey(key: KvKey): KvKey {
  const parts = captureArray(key);
  if (
    parts.length === 0 ||
    parts.some(
      (part) =>
        typeof part !== "string" || !part.isWellFormed() || part.includes("\0"),
    )
  ) {
    throw new TypeError(
      "Keys must be nonempty arrays of well-formed strings without NUL.",
    );
  }
  return parts as [string, ...string[]];
}

function captureArray<T>(items: readonly T[]): T[] {
  if (!Array.isArray(items)) throw new TypeError("A batch must be an array.");
  for (let i = 0; i < items.length; i++) {
    if (!Object.hasOwn(items, i))
      throw new TypeError("Sparse arrays are not supported.");
  }
  return Array.from(items);
}

function captureKeys(keys: readonly KvKey[], unique = false): KvKey[] {
  const captured = captureArray(keys).map(captureKey);
  if (
    unique &&
    new Set(captured.map((key) => JSON.stringify(key))).size !== captured.length
  ) {
    throw new TypeError("Duplicate keys in an atomic mutation.");
  }
  return captured;
}

function serializeTtl(options?: KvStoreSetOptions): string | null {
  if (options?.ttl == null) return null;
  const ttl = Temporal.Duration.from(options.ttl);
  if (ttl.sign < 0) throw new RangeError("The TTL must not be negative.");
  return ttl.toString();
}

interface PreparedWrite {
  readonly key: KvKey;
  readonly value: string;
  readonly ttl: string | null;
}

/**
 * Options for the PGlite key–value store.
 */
export interface PgliteKvStoreOptions {
  /**
   * The table name to use for the key–value store.
   * A `.` separates the schema from the table name, so neither the whole
   * name nor any segment between dots can be empty.
   * `"fedify_kv_v2"` by default.
   * @default `"fedify_kv_v2"`
   */
  readonly tableName?: string;

  /**
   * Whether the table has already been initialized.  `false` by default.
   * @default `false`
   */
  readonly initialized?: boolean;
}

/**
 * A key–value store backed by an embedded PGlite database.
 *
 * Since Fedify 2.5.0, this implements {@link AtomicKvStore}. All keys in one
 * table share an atomic scope when wrappers share one normal PGlite owner,
 * using its standard text-array and JSONB codecs. Do not invoke store methods
 * inside the owner's transaction callback or concurrently bypass its normal
 * query/transaction queue with raw protocol or manual transaction control.
 * Worker proxies and independent owners sharing a directory are outside this
 * scope.
 *
 * Values use JSON.stringify() and JSONB equality: object member order is
 * ignored, array order matters, and JSON null differs from absence. Keys must
 * be nonempty arrays of well-formed strings without NUL. Unsupported JSONB
 * values, duplicate mutation keys, sparse arrays, negative TTLs, timestamp
 * overflow, and TTLs on CAS deletion reject. Omitting a replacement TTL clears
 * expiry. Zero TTL expires immediately; intervals round to microseconds on a
 * host clock that may resolve only milliseconds. Calendar units use the
 * session time zone. Each operation uses one transaction-start expiry cutoff.
 *
 * No fixed batch-entry limit is imposed; large batches occupy the shared
 * owner and consume its finite memory. Engine insertion limits depend on
 * compression and are checked when writes are attempted. A mismatch does not
 * prove hypothetical insertability. Statement failures reject and roll back;
 * commit or post-commit synchronization failures may leave committed changes
 * despite rejection and must not trigger replay. Successful mutation
 * transactions await the owner's syncToFs() policy outside the transaction,
 * including read-only CAS mismatches. Backend synchronization failures reject
 * rather than returning false.
 * Atomicity does not promise crash durability; see the package README for
 * supported storage and the owner's durability policy.
 *
 * The caller owns the PGlite instance and is responsible for closing it after
 * every operation using the store has completed.  Use only one PGlite instance
 * for a data directory within a runtime isolate.
 *
 * @example
 * ```ts ignore
 * import { PGlite } from "@electric-sql/pglite";
 * import { createFederation } from "@fedify/fedify";
 * import { PgliteKvStore } from "@fedify/pglite";
 *
 * const pg = new PGlite("./data/fedify");
 * const federation = createFederation({
 *   // ...
 *   kv: new PgliteKvStore(pg),
 * });
 *
 * // Close pg during application shutdown, after pending operations finish.
 * await pg.close();
 * ```
 * @since 2.4.0
 */
export class PgliteKvStore implements AtomicKvStore {
  readonly #pg: PGliteInterface;
  readonly #tableName: string;
  readonly #quotedTableName: string;
  #initialized: boolean;
  #initializing?: Promise<void>;

  /**
   * Creates a new PGlite key–value store.
   * @param pg The caller-owned PGlite instance to use.
   * @param options The options for the key–value store.
   */
  constructor(pg: PGliteInterface, options: PgliteKvStoreOptions = {}) {
    this.#pg = pg;
    this.#tableName = options.tableName ?? "fedify_kv_v2";
    this.#quotedTableName = quoteIdentifier(this.#tableName);
    this.#initialized = options.initialized ?? false;
  }

  async #expire(tx: Transaction): Promise<void> {
    await tx.query(`
      DELETE FROM ${this.#quotedTableName}
      WHERE ttl IS NOT NULL AND created + ttl < CURRENT_TIMESTAMP;
    `);
  }

  async #write(tx: Transaction, entry: PreparedWrite): Promise<void> {
    await tx.query(
      `
      INSERT INTO ${this.#quotedTableName} (key, value, created, ttl)
      VALUES ($1::text[], $2::text::jsonb, CURRENT_TIMESTAMP, $3::text::interval)
      ON CONFLICT (key)
        DO UPDATE SET value = EXCLUDED.value,
          created = EXCLUDED.created, ttl = EXCLUDED.ttl;
      `,
      [entry.key, entry.value, entry.ttl],
    );
  }

  async #remove(tx: Transaction, key: KvKey): Promise<void> {
    await tx.query(
      `DELETE FROM ${this.#quotedTableName} WHERE key = $1::text[];`,
      [key],
    );
  }

  /** {@inheritDoc AtomicKvStore.get} */
  async get<T = unknown>(key: KvKey): Promise<T | undefined> {
    const captured = captureKey(key);
    await this.initialize();
    const result = await this.#pg.query<{ value: T }>(
      `
      SELECT value FROM ${this.#quotedTableName}
      WHERE key = $1::text[]
        AND (ttl IS NULL OR created + ttl > CURRENT_TIMESTAMP);
      `,
      [captured],
    );
    return result.rows[0]?.value;
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
  async getMany<T = unknown>(
    keys: readonly KvKey[],
  ): Promise<(T | undefined)[]> {
    const captured = captureKeys(keys);
    if (captured.length === 0) return [];
    await this.initialize();
    return await this.#pg.transaction(async (tx) => {
      const values: (T | undefined)[] = [];
      for (const key of captured) {
        const result = await tx.query<{ value: T }>(
          `SELECT value FROM ${this.#quotedTableName}
          WHERE key = $1::text[]
            AND (ttl IS NULL OR created + ttl > CURRENT_TIMESTAMP);`,
          [key],
        );
        values.push(result.rows[0]?.value);
      }
      return values;
    });
  }

  /**
   * {@inheritDoc AtomicKvStore.setMany}
   * @since 2.5.0
   */
  async setMany(entries: readonly KvStoreSetEntry[]): Promise<void> {
    const captured = captureArray(entries);
    const keys = captureKeys(
      captured.map((entry) => entry.key),
      true,
    );
    const writes = captured.map((entry, index): PreparedWrite => ({
      key: keys[index],
      value: serializeJson(entry.value),
      ttl: serializeTtl(entry.options),
    }));
    if (writes.length === 0) return;
    await this.initialize();
    await this.#pg.transaction(async (tx) => {
      for (const entry of writes) {
        await tx.query(
          "SELECT (CURRENT_TIMESTAMP + $1::text::interval) IS NULL;",
          [entry.ttl],
        );
      }
      for (const entry of writes) await this.#write(tx, entry);
      await this.#expire(tx);
    });
    // PGlite 0.5.8 does not sync after COMMIT; keep the owner's policy.
    await this.#pg.syncToFs();
  }

  /**
   * {@inheritDoc AtomicKvStore.deleteMany}
   * @since 2.5.0
   */
  async deleteMany(keys: readonly KvKey[]): Promise<void> {
    const captured = captureKeys(keys, true);
    if (captured.length === 0) return;
    await this.initialize();
    await this.#pg.transaction(async (tx) => {
      for (const key of captured) await this.#remove(tx, key);
      await this.#expire(tx);
    });
    // PGlite 0.5.8 does not sync after COMMIT; keep the owner's policy.
    await this.#pg.syncToFs();
  }

  /**
   * {@inheritDoc AtomicKvStore.casMany}
   * @since 2.5.0
   */
  async casMany(entries: readonly KvStoreCasEntry[]): Promise<boolean> {
    const captured = captureArray(entries);
    const keys = captureKeys(
      captured.map((entry) => entry.key),
      true,
    );
    const changes = captured.map((entry, index) => {
      if (entry.newValue === undefined && entry.options?.ttl != null) {
        throw new TypeError("A CAS deletion must not specify a TTL.");
      }
      return {
        key: keys[index],
        expected:
          entry.expectedValue === undefined
            ? undefined
            : serializeJson(entry.expectedValue),
        value:
          entry.newValue === undefined
            ? undefined
            : serializeJson(entry.newValue),
        ttl: serializeTtl(entry.options),
      };
    });
    if (changes.length === 0) return true;
    await this.initialize();
    const committed = await this.#pg.transaction(async (tx) => {
      // Validate every backend codec and expiry before a mismatch can return.
      // Let SQL errors escape so PGlite rolls the transaction back.
      for (const entry of changes) {
        await tx.query(
          `SELECT ($1::text::jsonb) IS NULL, ($2::text::jsonb) IS NULL,
            (CURRENT_TIMESTAMP + $3::text::interval) IS NULL;`,
          [entry.expected ?? null, entry.value ?? null, entry.ttl],
        );
      }
      for (const entry of changes) {
        const result = await tx.query<{ matched: boolean }>(
          `SELECT ${entry.expected === undefined ? "NOT " : ""}EXISTS (
            SELECT 1 FROM ${this.#quotedTableName}
            WHERE key = $1::text[]
              AND (ttl IS NULL OR created + ttl > CURRENT_TIMESTAMP)
              ${entry.expected === undefined ? "" : "AND value = $2::text::jsonb"}
          ) AS matched;`,
          entry.expected === undefined
            ? [entry.key]
            : [entry.key, entry.expected],
        );
        if (!result.rows[0].matched) return false;
      }
      for (const entry of changes) {
        if (entry.value === undefined) await this.#remove(tx, entry.key);
        else await this.#write(tx, { ...entry, value: entry.value });
      }
      await this.#expire(tx);
      return true;
    });
    await this.#pg.syncToFs();
    return committed;
  }

  /** {@inheritDoc AtomicKvStore.list} */
  async *list(prefix?: KvKey): AsyncIterable<KvStoreListEntry> {
    if (prefix != null && (!Array.isArray(prefix) || prefix.length > 0)) {
      prefix = captureKey(prefix);
    }
    await this.initialize();

    const result =
      prefix == null || prefix.length === 0
        ? await this.#pg.query<{ key: KvKey; value: unknown }>(`
        SELECT key, value
        FROM ${this.#quotedTableName}
        WHERE ttl IS NULL OR created + ttl > CURRENT_TIMESTAMP
        ORDER BY key;
      `)
        : await this.#pg.query<{ key: KvKey; value: unknown }>(
            `
        SELECT key, value
        FROM ${this.#quotedTableName}
        WHERE array_length(key, 1) >= $1
          AND key[1:$1] = $2::text[]
          AND (ttl IS NULL OR created + ttl > CURRENT_TIMESTAMP)
        ORDER BY key;
      `,
            [prefix.length, prefix],
          );

    for (const row of result.rows) yield row;
  }

  /**
   * Creates the table used by the store if it does not already exist.
   */
  async initialize(): Promise<void> {
    await this.#pg.waitReady;
    if (this.#initialized) return;
    this.#initializing ??= (async () => {
      logger.debug("Initializing the key–value store table {tableName}...", {
        tableName: this.#tableName,
      });
      await this.#pg.query(`
        CREATE TABLE IF NOT EXISTS ${this.#quotedTableName} (
          key text[] PRIMARY KEY,
          value jsonb NOT NULL,
          created timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
          ttl interval
        );
      `);
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
   * Drops the table used by the store.  Does nothing if it does not exist.
   */
  async drop(): Promise<void> {
    await this.#pg.waitReady;
    await this.#pg.query(`DROP TABLE IF EXISTS ${this.#quotedTableName};`);
    this.#initialized = false;
    this.#initializing = undefined;
  }
}
