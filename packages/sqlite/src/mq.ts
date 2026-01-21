import { type PlatformDatabase, SqliteDatabase } from "#sqlite";
import type {
  MessageQueue,
  MessageQueueEnqueueOptions,
  MessageQueueListenOptions,
} from "@fedify/fedify";
import { getLogger } from "@logtape/logtape";
import type { SqliteDatabaseAdapter } from "./adapter.ts";

const logger = getLogger(["fedify", "sqlite", "mq"]);

class EnqueueEvent extends Event {
  readonly delayMs: number;
  constructor(delayMs: number) {
    super("enqueue");
    this.delayMs = delayMs;
  }
}

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
   * The poll interval for the message queue.
   * @default `{ seconds: 5 }`
   */
  pollInterval?: Temporal.Duration | Temporal.DurationLike;

  /**
   * Maximum number of retries for SQLITE_BUSY errors.
   * @default `5`
   */
  maxRetries?: number;

  /**
   * Initial retry delay in milliseconds for SQLITE_BUSY errors.
   * Uses exponential backoff.
   * @default `100`
   */
  retryDelayMs?: number;

  /**
   * SQLite journal mode to use.
   * WAL (Write-Ahead Logging) mode is recommended for better concurrency
   * in multi-process environments.
   * Note: WAL mode is persistent per database file, not per connection.
   * @default `"WAL"`
   */
  journalMode?: "WAL" | "DELETE" | "TRUNCATE" | "PERSIST" | "MEMORY";
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
export class SqliteMessageQueue implements MessageQueue, Disposable {
  static readonly #defaultTableName = "fedify_message";
  static readonly #tableNameRegex = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
  // In-memory event emitter for notifying listeners when messages are enqueued.
  // Scoped per table name to allow multiple queues to coexist.
  static readonly #notifyChannels = new Map<string, EventTarget>();
  // Track active instance IDs per table name for accurate cleanup
  static readonly #activeInstances = new Map<string, Set<string>>();

  static #getNotifyChannel(tableName: string): EventTarget {
    let channel = SqliteMessageQueue.#notifyChannels.get(tableName);
    if (channel == null) {
      channel = new EventTarget();
      SqliteMessageQueue.#notifyChannels.set(tableName, channel);
    }
    return channel;
  }

  readonly #db: SqliteDatabaseAdapter;
  readonly #tableName: string;
  readonly #pollIntervalMs: number;
  readonly #instanceId: string;
  readonly #maxRetries: number;
  readonly #retryDelayMs: number;
  readonly #journalMode: string;
  #initialized: boolean;

  /**
   * SQLite message queue does not provide native retry mechanisms.
   */
  readonly nativeRetrial = false;

  /**
   * Creates a new SQLite message queue.
   * @param db The SQLite database to use. Supports `node:sqlite`, `bun:sqlite`.
   * @param options The options for the message queue.
   */
  constructor(
    readonly db: PlatformDatabase,
    readonly options: SqliteMessageQueueOptions = {},
  ) {
    this.#db = new SqliteDatabase(db);
    this.#initialized = options.initialized ?? false;
    this.#tableName = options.tableName ?? SqliteMessageQueue.#defaultTableName;
    this.#instanceId = crypto.randomUUID();
    this.#pollIntervalMs = Temporal.Duration.from(
      options.pollInterval ?? { seconds: 5 },
    ).total("millisecond");
    this.#maxRetries = options.maxRetries ?? 5;
    this.#retryDelayMs = options.retryDelayMs ?? 100;
    this.#journalMode = options.journalMode ?? "WAL";

    if (!SqliteMessageQueue.#tableNameRegex.test(this.#tableName)) {
      throw new Error(
        `Invalid table name for the message queue: ${this.#tableName}`,
      );
    }

    // Register this instance ID for this table
    this.#registerInstance();
  }

  #registerInstance(): void {
    let instances = SqliteMessageQueue.#activeInstances.get(this.#tableName);
    if (instances == null) {
      instances = new Set();
      SqliteMessageQueue.#activeInstances.set(this.#tableName, instances);
    }
    instances.add(this.#instanceId);
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

    return this.#retryOnBusy(() => {
      this.#db
        .prepare(
          `INSERT INTO "${this.#tableName}" (id, message, created, scheduled)
          VALUES (?, ?, ?, ?)`,
        )
        .run(id, encodedMessage, now, scheduled);

      logger.debug("Enqueued a message.", { message });

      // Notify listeners that a message has been enqueued
      const delayMs = delay.total("millisecond");
      SqliteMessageQueue.#getNotifyChannel(this.#tableName).dispatchEvent(
        new EnqueueEvent(delayMs),
      );
    });
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

    return this.#withTransactionRetries(() => {
      const stmt = this.#db.prepare(
        `INSERT INTO "${this.#tableName}" (id, message, created, scheduled)
        VALUES (?, ?, ?, ?)`,
      );

      for (const message of messages) {
        const id = crypto.randomUUID();
        const encodedMessage = this.#encodeMessage(message);
        stmt.run(id, encodedMessage, now, scheduled);
      }

      logger.debug("Enqueued messages.", { messages });

      // Notify listeners that messages have been enqueued
      const delayMs = delay.total("millisecond");
      SqliteMessageQueue.#getNotifyChannel(this.#tableName).dispatchEvent(
        new EnqueueEvent(delayMs),
      );
    }).catch((error) => {
      logger.error(
        "Failed to enqueue messages to table {tableName}: {error}",
        {
          tableName: this.#tableName,
          messageCount: messages.length,
          error,
        },
      );
      throw error;
    });
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

    const channel = SqliteMessageQueue.#getNotifyChannel(this.#tableName);
    const timeouts = new Set<ReturnType<typeof setTimeout>>();

    const poll = async () => {
      while (signal == null || !signal.aborted) {
        const now = Temporal.Now.instant().epochMilliseconds;

        // Atomically fetch and delete the oldest message that is ready to be
        // processed using DELETE ... RETURNING (SQLite >= 3.35.0)
        // Wrapped in BEGIN IMMEDIATE transaction to ensure proper locking
        // and prevent race conditions in multi-process scenarios
        const result = await this.#withTransactionRetries(() => {
          return this.#db
            .prepare(
              `DELETE FROM "${this.#tableName}"
              WHERE id = (
                SELECT id FROM "${this.#tableName}"
                WHERE scheduled <= ?
                ORDER BY scheduled
                LIMIT 1
              )
              RETURNING id, message`,
            )
            .get(now) as { id: string; message: string } | undefined;
        });

        if (result) {
          const message = this.#decodeMessage(result.message);
          logger.debug("Processing message {id}...", {
            id: result.id,
            message,
          });
          try {
            await handler(message);
            logger.debug("Processed message {id}.", { id: result.id });
          } catch (error) {
            logger.error(
              "Failed to process message {id} from table {tableName}: {error}",
              {
                id: result.id,
                tableName: this.#tableName,
                message,
                error,
              },
            );
          }

          // Check for next message immediately
          continue;
        }

        // No more messages ready to process
        break;
      }
    };

    const onEnqueue = (event: Event) => {
      const delayMs = (event as EnqueueEvent).delayMs;
      if (delayMs < 1) {
        poll();
      } else {
        timeouts.add(setTimeout(poll, delayMs));
      }
    };

    channel.addEventListener("enqueue", onEnqueue);
    signal?.addEventListener("abort", () => {
      channel.removeEventListener("enqueue", onEnqueue);
      for (const timeout of timeouts) clearTimeout(timeout);
    });

    // Initial poll
    await poll();

    // Periodic polling as fallback
    while (signal == null || !signal.aborted) {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      await new Promise<unknown>((resolve) => {
        signal?.addEventListener("abort", resolve);
        timeout = setTimeout(() => {
          signal?.removeEventListener("abort", resolve);
          resolve(0);
        }, this.#pollIntervalMs);
        timeouts.add(timeout);
      });
      if (timeout != null) timeouts.delete(timeout);
      await poll();
    }

    logger.debug("Stopped listening for messages on table {tableName}.", {
      tableName: this.#tableName,
    });
  }

  /**
   * Creates the message queue table if it does not already exist.
   * Does nothing if the table already exists.
   *
   * This method also configures the SQLite journal mode for better concurrency.
   * WAL (Write-Ahead Logging) mode is enabled by default to improve
   * concurrent access in multi-process environments.
   */
  initialize(): void {
    if (this.#initialized) {
      return;
    }

    logger.debug("Initializing the message queue table {tableName}...", {
      tableName: this.#tableName,
    });

    // Set journal mode for better concurrency
    // Note: This is persistent per database file and must be set outside a transaction
    this.#db.exec(`PRAGMA journal_mode=${this.#journalMode}`);

    this.#withTransaction(() => {
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
    });

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

  /**
   * Closes the database connection.
   */
  [Symbol.dispose](): void {
    try {
      this.#db.close();
      this.#unregisterInstance();
    } catch (error) {
      logger.error(
        "Failed to close the database connection for table {tableName}: {error}",
        { tableName: this.#tableName, error },
      );
    }
  }

  #unregisterInstance(): void {
    const instances = SqliteMessageQueue.#activeInstances.get(this.#tableName);
    if (instances == null) return;

    instances.delete(this.#instanceId);

    // If no more instances exist for this table, cleanup EventTarget to prevent memory leak
    if (instances.size === 0) {
      SqliteMessageQueue.#activeInstances.delete(this.#tableName);
      SqliteMessageQueue.#notifyChannels.delete(this.#tableName);
    }
  }

  /**
   * Checks if an error is a SQLITE_BUSY error or transaction conflict.
   * Handles different error formats from node:sqlite and bun:sqlite.
   */
  #isBusyError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;

    // Check error message for SQLITE_BUSY
    if (
      error.message.includes("SQLITE_BUSY") ||
      error.message.includes("database is locked") ||
      error.message.includes("transaction within a transaction")
    ) {
      return true;
    }

    // Check error code property (node:sqlite)
    const errorWithCode = error as Error & { code?: string };
    if (errorWithCode.code === "SQLITE_BUSY") {
      return true;
    }

    // Check errno property (bun:sqlite)
    const errorWithErrno = error as Error & { errno?: number };
    if (errorWithErrno.errno === 5) { // SQLITE_BUSY = 5
      return true;
    }

    return false;
  }

  /**
   * Retries a database operation with exponential backoff on SQLITE_BUSY errors.
   */
  async #retryOnBusy<T>(operation: () => T): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.#maxRetries; attempt++) {
      try {
        return operation();
      } catch (error) {
        lastError = error;

        if (!this.#isBusyError(error)) {
          logger.error(
            "Database operation failed on table {tableName}: {error}",
            {
              tableName: this.#tableName,
              error,
            },
          );
          throw error;
        }

        if (attempt === this.#maxRetries) {
          logger.error(
            "Max retries ({maxRetries}) reached for SQLITE_BUSY error on table {tableName}.",
            {
              maxRetries: this.#maxRetries,
              tableName: this.#tableName,
              error,
            },
          );
          throw error;
        }

        // Exponential backoff: retryDelayMs * 2^attempt
        const delayMs = this.#retryDelayMs * Math.pow(2, attempt);
        logger.debug(
          "SQLITE_BUSY error on table {tableName}, retrying in {delayMs}ms (attempt {attempt}/{maxRetries})...",
          {
            tableName: this.#tableName,
            delayMs,
            attempt: attempt + 1,
            maxRetries: this.#maxRetries,
          },
        );

        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    throw lastError;
  }

  /**
   * Executes a database operation within a transaction.
   * Automatically handles BEGIN IMMEDIATE, COMMIT, and ROLLBACK.
   */
  #withTransaction<T>(operation: () => T): T {
    let transactionStarted = false;
    try {
      this.#db.exec("BEGIN IMMEDIATE");
      transactionStarted = true;
      const result = operation();
      this.#db.exec("COMMIT");
      return result;
    } catch (error) {
      // Only rollback if transaction was successfully started
      if (transactionStarted) {
        try {
          this.#db.exec("ROLLBACK");
        } catch {
          // Ignore rollback errors - transaction might have been rolled back already
        }
      }
      throw error;
    }
  }

  /**
   * Executes a database operation within a transaction with retry logic.
   * Automatically handles BEGIN IMMEDIATE, COMMIT, and ROLLBACK.
   * Retries on SQLITE_BUSY errors with exponential backoff.
   */
  async #withTransactionRetries<T>(operation: () => T): Promise<T> {
    return await this.#retryOnBusy(() => this.#withTransaction(operation));
  }

  #encodeMessage(message: unknown): string {
    return JSON.stringify(message);
  }

  #decodeMessage(message: string): unknown {
    return JSON.parse(message);
  }
}
