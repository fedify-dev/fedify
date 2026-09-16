/// <reference types="@types/emscripten" />

import type { PGliteInterface } from "@electric-sql/pglite";
import type {
  KvKey,
  KvStore,
  KvStoreListEntry,
  KvStoreSetOptions,
} from "@fedify/fedify";
import { getLogger } from "@logtape/logtape";

const logger = getLogger(["fedify", "pglite", "kv"]);

function quoteIdentifier(identifier: string): string {
  const parts = identifier.split(".");
  if (parts.includes("")) {
    throw new TypeError(
      `Invalid table name for the key–value store: ${
        JSON.stringify(identifier)
      }`,
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
export class PgliteKvStore implements KvStore {
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
  constructor(
    pg: PGliteInterface,
    options: PgliteKvStoreOptions = {},
  ) {
    this.#pg = pg;
    this.#tableName = options.tableName ?? "fedify_kv_v2";
    this.#quotedTableName = quoteIdentifier(this.#tableName);
    this.#initialized = options.initialized ?? false;
  }

  async #expire(): Promise<void> {
    await this.#pg.query(`
      DELETE FROM ${this.#quotedTableName}
      WHERE ttl IS NOT NULL AND created + ttl < CURRENT_TIMESTAMP;
    `);
  }

  async get<T = unknown>(key: KvKey): Promise<T | undefined> {
    await this.initialize();
    const result = await this.#pg.query<{ value: T }>(
      `
      SELECT value
      FROM ${this.#quotedTableName}
      WHERE key = $1::text[]
        AND (ttl IS NULL OR created + ttl > CURRENT_TIMESTAMP);
    `,
      [key],
    );
    return result.rows[0]?.value;
  }

  async set(
    key: KvKey,
    value: unknown,
    options?: KvStoreSetOptions,
  ): Promise<void> {
    await this.initialize();
    const ttl = options?.ttl == null
      ? null
      : Temporal.Duration.from(options.ttl).toString();
    await this.#pg.query(
      `
      INSERT INTO ${this.#quotedTableName} (key, value, ttl)
      VALUES ($1::text[], $2::text::jsonb, $3::text::interval)
      ON CONFLICT (key)
        DO UPDATE SET
          value = EXCLUDED.value,
          created = CURRENT_TIMESTAMP,
          ttl = EXCLUDED.ttl;
    `,
      [key, serializeJson(value), ttl],
    );
    await this.#expire();
  }

  async delete(key: KvKey): Promise<void> {
    await this.initialize();
    await this.#pg.query(
      `
      DELETE FROM ${this.#quotedTableName}
      WHERE key = $1::text[];
    `,
      [key],
    );
    await this.#expire();
  }

  /** {@inheritDoc KvStore.cas} */
  async cas(
    key: KvKey,
    expectedValue: unknown,
    newValue: unknown,
    options?: KvStoreSetOptions,
  ): Promise<boolean> {
    await this.initialize();
    const ttl = options?.ttl == null
      ? null
      : Temporal.Duration.from(options.ttl).toString();

    if (expectedValue === undefined && newValue === undefined) {
      const matched = await this.get(key) === undefined;
      await this.#expire();
      return matched;
    }

    let rowCount: number;
    if (expectedValue === undefined) {
      const result = await this.#pg.query(
        `
        INSERT INTO ${this.#quotedTableName} AS existing
          (key, value, created, ttl)
        VALUES (
          $1::text[],
          $2::text::jsonb,
          CURRENT_TIMESTAMP,
          $3::text::interval
        )
        ON CONFLICT (key)
          DO UPDATE SET
            value = EXCLUDED.value,
            created = EXCLUDED.created,
            ttl = EXCLUDED.ttl
          WHERE existing.ttl IS NOT NULL
            AND existing.created + existing.ttl <= CURRENT_TIMESTAMP
        RETURNING key;
      `,
        [key, serializeJson(newValue), ttl],
      );
      rowCount = result.rows.length;
    } else if (newValue === undefined) {
      const result = await this.#pg.query(
        `
        DELETE FROM ${this.#quotedTableName}
        WHERE key = $1::text[]
          AND (ttl IS NULL OR created + ttl > CURRENT_TIMESTAMP)
          AND value = $2::text::jsonb
        RETURNING key;
      `,
        [key, serializeJson(expectedValue)],
      );
      rowCount = result.rows.length;
    } else {
      const result = await this.#pg.query(
        `
        UPDATE ${this.#quotedTableName}
        SET
          value = $3::text::jsonb,
          created = CURRENT_TIMESTAMP,
          ttl = $4::text::interval
        WHERE key = $1::text[]
          AND (ttl IS NULL OR created + ttl > CURRENT_TIMESTAMP)
          AND value = $2::text::jsonb
        RETURNING key;
      `,
        [
          key,
          serializeJson(expectedValue),
          serializeJson(newValue),
          ttl,
        ],
      );
      rowCount = result.rows.length;
    }

    await this.#expire();
    return rowCount > 0;
  }

  /** {@inheritDoc KvStore.list} */
  async *list(prefix?: KvKey): AsyncIterable<KvStoreListEntry> {
    await this.initialize();

    const result = prefix == null || prefix.length === 0
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
    await this.#pg.query(
      `DROP TABLE IF EXISTS ${this.#quotedTableName};`,
    );
    this.#initialized = false;
    this.#initializing = undefined;
  }
}
