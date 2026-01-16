import { type PlatformDatabase, SqliteDatabase } from "#sqlite";
import type {
  MessageQueue,
  MessageQueueEnqueueOptions,
  MessageQueueListenOptions,
} from "@fedify/fedify";
import { getLogger } from "@logtape/logtape";
import type { SqliteDatabaseAdapter } from "./adapter.ts";

const logger = getLogger(["fedify", "sqlite", "mq"]);

/**
 * Options for the SQLite message queue.
 */
export interface SqliteMessageQueueOptions {
  /**
   * The table name to use for the message queue.
   * Only letters, digits, and underscores are allowed.
   * `"fedify_message"` by default.
   * @default `"fedify_message"`
   */
  tableName?: string;

  /**
   * Whether the table has been initialized.  `false` by default.
   * @default `false`
   */
  initialized?: boolean;

  /**
   * The poll interval for the message queue.  5 seconds by default.
   */
  pollInterval?: Temporal.Duration | Temporal.DurationLike;
}

/**
 * A message queue that uses SQLite as the underlying storage.
 *
 * This implementation is designed for single-node deployments and uses
 * polling to check for new messages. It is not suitable for high-throughput
 * scenarios or distributed environments.
 *
 * @example
 * ```ts ignore
 * import { createFederation } from "@fedify/fedify";
 * import { SqliteMessageQueue } from "@fedify/sqlite";
 * import { DatabaseSync } from "node:sqlite";
 *
 * const db = new DatabaseSync(":memory:");
 * const federation = createFederation({
 *   // ...
 *   queue: new SqliteMessageQueue(db),
 * });
 * ```
 */
export class SqliteMessageQueue implements MessageQueue {
  static readonly #defaultTableName = "fedify_message";
  static readonly #tableNameRegex = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
  readonly #db: SqliteDatabaseAdapter;
  readonly #tableName: string;
  readonly #pollIntervalMs: number;
  #initialized: boolean;

  /**
   * SQLite message queue does not provide native retry mechanisms.
   */
  readonly nativeRetrial = false;

  /**
   * Creates a new SQLite message queue.
   * @param db The SQLite database to use. Supports `node:sqlite` and `bun:sqlite`.
   * @param options The options for the message queue.
   */
  constructor(
    readonly db: PlatformDatabase,
    readonly options: SqliteMessageQueueOptions = {},
  ) {
    this.#db = new SqliteDatabase(db);
    this.#initialized = options.initialized ?? false;
    this.#tableName = options.tableName ?? SqliteMessageQueue.#defaultTableName;
    this.#pollIntervalMs = Temporal.Duration.from(
      options.pollInterval ?? { seconds: 5 },
    ).total("millisecond");

    if (!SqliteMessageQueue.#tableNameRegex.test(this.#tableName)) {
      throw new Error(
        `Invalid table name for the message queue: ${this.#tableName}`,
      );
    }
  }

  /**
   * {@inheritDoc MessageQueue.enqueue}
   */
  enqueue(
    // deno-lint-ignore no-explicit-any
    message: any,
    options?: MessageQueueEnqueueOptions,
  ): Promise<void> {
    this.initialize();

    const id = crypto.randomUUID();
    const encodedMessage = this.#encodeMessage(message);
    const now = Temporal.Now.instant().epochMilliseconds;
    const delay = options?.delay ?? Temporal.Duration.from({ seconds: 0 });
    const scheduled = now + delay.total({ unit: "milliseconds" });

    if (options?.delay) {
      logger.debug("Enqueuing a message with a delay of {delay}...", {
        delay,
        message,
      });
    } else {
      logger.debug("Enqueuing a message...", { message });
    }

    this.#db
      .prepare(
        `INSERT INTO "${this.#tableName}" (id, message, created, scheduled)
        VALUES (?, ?, ?, ?)`,
      )
      .run(id, encodedMessage, now, scheduled);

    logger.debug("Enqueued a message.", { message });
    return Promise.resolve();
  }

  /**
   * {@inheritDoc MessageQueue.enqueueMany}
   */
  enqueueMany(
    // deno-lint-ignore no-explicit-any
    messages: readonly any[],
    options?: MessageQueueEnqueueOptions,
  ): Promise<void> {
    if (messages.length === 0) return Promise.resolve();

    this.initialize();

    const now = Temporal.Now.instant().epochMilliseconds;
    const delay = options?.delay ?? Temporal.Duration.from({ seconds: 0 });
    const scheduled = now + delay.total({ unit: "milliseconds" });

    if (options?.delay) {
      logger.debug("Enqueuing messages with a delay of {delay}...", {
        delay,
        messages,
      });
    } else {
      logger.debug("Enqueuing messages...", { messages });
    }

    try {
      this.#db.exec("BEGIN IMMEDIATE");

      const stmt = this.#db.prepare(
        `INSERT INTO "${this.#tableName}" (id, message, created, scheduled)
        VALUES (?, ?, ?, ?)`,
      );

      for (const message of messages) {
        const id = crypto.randomUUID();
        const encodedMessage = this.#encodeMessage(message);
        stmt.run(id, encodedMessage, now, scheduled);
      }

      this.#db.exec("COMMIT");
      logger.debug("Enqueued messages.", { messages });
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
    return Promise.resolve();
  }

  /**
   * {@inheritDoc MessageQueue.listen}
   */
  async listen(
    // deno-lint-ignore no-explicit-any
    handler: (message: any) => Promise<void> | void,
    options?: MessageQueueListenOptions,
  ): Promise<void> {
    this.initialize();

    const { signal } = options ?? {};
    logger.debug(
      "Starting to listen for messages on table {tableName}...",
      { tableName: this.#tableName },
    );

    while (signal == null || !signal.aborted) {
      const now = Temporal.Now.instant().epochMilliseconds;

      // Get the oldest message that is ready to be processed
      const result = this.#db
        .prepare(
          `SELECT id, message
          FROM "${this.#tableName}"
          WHERE scheduled <= ?
          ORDER BY scheduled
          LIMIT 1`,
        )
        .get(now) as { id: string; message: string } | undefined;

      if (result) {
        // Delete the message before processing to prevent duplicate processing
        this.#db
          .prepare(`DELETE FROM "${this.#tableName}" WHERE id = ?`)
          .run(result.id);

        const message = this.#decodeMessage(result.message);
        logger.debug("Processing message {id}...", { id: result.id, message });

        try {
          await handler(message);
          logger.debug("Processed message {id}.", { id: result.id });
        } catch (error) {
          logger.error(
            "Failed to process message {id}: {error}",
            { id: result.id, error },
          );
          throw error;
        }

        // Check for next message immediately
        continue;
      }

      // No messages available, wait before polling again
      await this.#wait(this.#pollIntervalMs, signal);
    }

    logger.debug("Stopped listening for messages on table {tableName}.", {
      tableName: this.#tableName,
    });
  }

  /**
   * Creates the message queue table if it does not already exist.
   * Does nothing if the table already exists.
   */
  initialize(): void {
    if (this.#initialized) {
      return;
    }

    logger.debug("Initializing the message queue table {tableName}...", {
      tableName: this.#tableName,
    });

    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS "${this.#tableName}" (
        id TEXT PRIMARY KEY,
        message TEXT NOT NULL,
        created INTEGER NOT NULL,
        scheduled INTEGER NOT NULL
      )
    `);

    this.#db.exec(`
      CREATE INDEX IF NOT EXISTS "idx_${this.#tableName}_scheduled"
      ON "${this.#tableName}" (scheduled)
    `);

    this.#initialized = true;
    logger.debug("Initialized the message queue table {tableName}.", {
      tableName: this.#tableName,
    });
  }

  /**
   * Drops the table used by the message queue.  Does nothing if the table
   * does not exist.
   */
  drop(): void {
    this.#db.exec(`DROP TABLE IF EXISTS "${this.#tableName}"`);
    this.#initialized = false;
  }

  #encodeMessage(message: unknown): string {
    return JSON.stringify(message);
  }

  #decodeMessage(message: string): unknown {
    return JSON.parse(message);
  }

  #wait(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve) => {
      if (signal?.aborted) {
        resolve();
        return;
      }

      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);

      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };

      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
}
