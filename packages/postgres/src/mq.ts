import type {
  MessageQueue,
  MessageQueueEnqueueOptions,
  MessageQueueListenOptions,
} from "@fedify/fedify";
import { getLogger } from "@logtape/logtape";
import type { JSONValue, Parameter, Sql } from "postgres";
import postgres from "postgres";
import { driverSerializesJson } from "./utils.ts";

const logger = getLogger(["fedify", "postgres", "mq"]);
const INITIALIZE_MAX_ATTEMPTS = 5;
const INITIALIZE_BACKOFF_MS = 10;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isInitializationRaceError(error: unknown): boolean {
  return error instanceof postgres.PostgresError &&
    (
      // When concurrent CREATE TABLE IF NOT EXISTS statements race, PostgreSQL
      // may still raise duplicate-type errors for the table's implicit row type.
      error.constraint_name === "pg_type_typname_nsp_index" ||
      error.code === "42P07" || // duplicate_table
      error.code === "42710" // duplicate_object
    );
}

/**
 * Options for the PostgreSQL message queue.
 */
export interface PostgresMessageQueueOptions {
  /**
   * The table name to use for the message queue.
   * `"fedify_message_v2"` by default.
   * @default `"fedify_message_v2"`
   */
  readonly tableName?: string;

  /**
   * The channel name to use for the message queue.
   * `"fedify_channel"` by default.
   * @default `"fedify_channel"`
   */
  readonly channelName?: string;

  /**
   * Whether the table has been initialized.  `false` by default.
   * @default `false`
   */
  readonly initialized?: boolean;

  /**
   * The poll interval for the message queue.  5 seconds by default.
   * @default `{ seconds: 5 }`
   */
  readonly pollInterval?: Temporal.Duration | Temporal.DurationLike;
}

/**
 * A message queue that uses PostgreSQL as the underlying storage.
 *
 * @example
 * ```ts
 * import { createFederation } from "@fedify/fedify";
 * import { PostgresKvStore, PostgresMessageQueue } from "@fedify/postgres";
 * import postgres from "postgres";
 *
 * const sql = postgres("postgres://user:pass@localhost/db");
 *
 * const federation = createFederation({
 *   kv: new PostgresKvStore(sql),
 *   queue: new PostgresMessageQueue(sql),
 * });
 * ```
 */
export class PostgresMessageQueue implements MessageQueue {
  // deno-lint-ignore ban-types
  readonly #sql: Sql<{}>;
  readonly #tableName: string;
  readonly #channelName: string;
  readonly #pollIntervalMs: number;
  #initialized: boolean;
  #initPromise?: Promise<void>;
  #driverSerializesJson = false;

  constructor(
    // deno-lint-ignore ban-types
    sql: Sql<{}>,
    options: PostgresMessageQueueOptions = {},
  ) {
    this.#sql = sql;
    this.#tableName = options?.tableName ?? "fedify_message_v2";
    this.#channelName = options?.channelName ?? "fedify_channel";
    this.#pollIntervalMs = Temporal.Duration.from(
      options?.pollInterval ?? { seconds: 5 },
    ).total("millisecond");
    this.#initialized = options?.initialized ?? false;
  }

  async enqueue(
    // deno-lint-ignore no-explicit-any
    message: any,
    options?: MessageQueueEnqueueOptions,
  ): Promise<void> {
    await this.initialize();
    const delay = options?.delay ?? Temporal.Duration.from({ seconds: 0 });
    const orderingKey = options?.orderingKey ?? null;
    if (options?.delay) {
      logger.debug("Enqueuing a message with a delay of {delay}...", {
        delay,
        message,
        orderingKey,
      });
    } else {
      logger.debug("Enqueuing a message...", { message, orderingKey });
    }
    await this.#sql`
      INSERT INTO ${this.#sql(this.#tableName)} (message, delay, ordering_key)
      VALUES (
        ${this.#json(message)},
        ${delay.toString()},
        ${orderingKey}
      );
    `;
    logger.debug("Enqueued a message.", { message, orderingKey });
    await this.#sql.notify(this.#channelName, delay.toString());
    logger.debug("Notified the message queue channel {channelName}.", {
      channelName: this.#channelName,
      message,
      orderingKey,
    });
  }

  async enqueueMany(
    // deno-lint-ignore no-explicit-any
    messages: readonly any[],
    options?: MessageQueueEnqueueOptions,
  ): Promise<void> {
    if (messages.length === 0) return;
    await this.initialize();
    const delay = options?.delay ?? Temporal.Duration.from({ seconds: 0 });
    const orderingKey = options?.orderingKey ?? null;
    if (options?.delay) {
      logger.debug("Enqueuing messages with a delay of {delay}...", {
        delay,
        messages,
        orderingKey,
      });
    } else {
      logger.debug("Enqueuing messages...", { messages, orderingKey });
    }
    for (const message of messages) {
      await this.#sql`
        INSERT INTO ${this.#sql(this.#tableName)} (message, delay, ordering_key)
        VALUES (
          ${this.#json(message)},
          ${delay.toString()},
          ${orderingKey}
        );
      `;
    }
    logger.debug("Enqueued messages.", { messages, orderingKey });
    await this.#sql.notify(this.#channelName, delay.toString());
    logger.debug("Notified the message queue channel {channelName}.", {
      channelName: this.#channelName,
      messages,
      orderingKey,
    });
  }

  async listen(
    // deno-lint-ignore no-explicit-any
    handler: (message: any) => void | Promise<void>,
    options: MessageQueueListenOptions = {},
  ): Promise<void> {
    await this.initialize();
    const { signal } = options;
    const poll = async () => {
      while (!signal?.aborted) {
        let processed = false;

        // Step 1: Try to process messages without ordering key first.
        // These don't need advisory locks.
        for (
          const row of await this.#sql`
          WITH candidate AS (
            SELECT id, ordering_key
            FROM ${this.#sql(this.#tableName)}
            WHERE created + delay < CURRENT_TIMESTAMP
              AND ordering_key IS NULL
            ORDER BY created
            LIMIT 1
            FOR UPDATE SKIP LOCKED
          )
          DELETE FROM ${this.#sql(this.#tableName)}
          WHERE id IN (SELECT id FROM candidate)
          RETURNING message, ordering_key;
        `
        ) {
          if (signal?.aborted) return;
          await handler(row.message);
          processed = true;
        }

        // If we processed a message without ordering key, continue the loop
        if (processed) continue;

        // Step 2: Try to process a message with an ordering key.
        // We do this separately to ensure pg_try_advisory_lock is called
        // exactly once per attempt.
        // We loop through candidates until we find one we can lock, or run out.
        //
        // IMPORTANT: Advisory locks are session-level (i.e., tied to a specific
        // PostgreSQL connection).  Since the postgres.js driver uses a
        // connection pool, consecutive queries may run on different pooled
        // connections.  If pg_try_advisory_lock and pg_advisory_unlock execute
        // on different connections, the unlock silently fails ("you don't own a
        // lock of type ExclusiveLock") and the lock leaks permanently, blocking
        // all future processing of that ordering key.  To prevent this, we use
        // sql.reserve() to pin a single connection for the entire
        // lock → delete → handler → unlock sequence.
        const attemptedOrderingKeys = new Set<string>();
        while (!signal?.aborted) {
          // Find a candidate with ordering key that we haven't tried yet
          const candidateResult = await this.#sql`
            SELECT id, ordering_key
            FROM ${this.#sql(this.#tableName)}
            WHERE created + delay < CURRENT_TIMESTAMP
              AND ordering_key IS NOT NULL
              ${
            attemptedOrderingKeys.size > 0
              ? this.#sql`AND ordering_key NOT IN ${
                this.#sql([...attemptedOrderingKeys])
              }`
              : this.#sql``
          }
            ORDER BY created
            LIMIT 1
          `;

          if (candidateResult.length === 0) {
            // No more candidates to try
            break;
          }

          const candidate = candidateResult[0];
          const candidateId = candidate.id as string;
          const orderingKey = candidate.ordering_key as string;
          attemptedOrderingKeys.add(orderingKey);

          // Reserve a dedicated connection so that the advisory lock and
          // unlock are guaranteed to run on the same connection:
          const reserved = await this.#sql.reserve();
          try {
            // Try to acquire the advisory lock (exactly once)
            const lockResult = await reserved`
              SELECT pg_try_advisory_lock(
                hashtext(${this.#tableName}),
                hashtext(${orderingKey})
              ) AS acquired
            `;

            if (lockResult[0].acquired) {
              try {
                // We have the lock, now delete and process the message
                const deleteResult = await reserved`
                  DELETE FROM ${reserved(this.#tableName)}
                  WHERE id = ${candidateId}
                  RETURNING message, ordering_key
                `;

                for (const row of deleteResult) {
                  if (signal?.aborted) return;
                  await handler(row.message);
                  processed = true;
                }
              } finally {
                // Always release the advisory lock on the SAME connection
                await reserved`
                  SELECT pg_advisory_unlock(
                    hashtext(${this.#tableName}),
                    hashtext(${orderingKey})
                  )
                `;
              }
              // If we processed a message, continue the outer loop
              if (processed) break;
            }
          } finally {
            reserved.release();
          }
          // Lock not acquired, try next candidate with different ordering key
        }

        // If we processed a message, continue the outer loop
        if (processed) continue;

        // No messages to process, exit the loop
        break;
      }
    };
    // Serialize poll() so that at most one runs at a time, preventing
    // concurrent database contention from NOTIFY floods (e.g., 100 bulk
    // messages each sending a NOTIFY).  Callers that arrive while poll()
    // is running will wait for the current run to finish and then start a
    // new one, rather than spawning concurrent poll() calls.
    let pollLock: Promise<void> = Promise.resolve();
    const serializedPoll = () => {
      const next = pollLock.then(poll);
      pollLock = next.catch(() => {});
      return next;
    };
    const timeouts = new Set<ReturnType<typeof setTimeout>>();
    const listen = await this.#sql.listen(
      this.#channelName,
      async (delay) => {
        const duration = Temporal.Duration.from(delay);
        const durationMs = duration.total("millisecond");
        if (durationMs < 1) await serializedPoll();
        else {
          const timeout = setTimeout(() => {
            timeouts.delete(timeout);
            void serializedPoll();
          }, durationMs);
          timeouts.add(timeout);
        }
      },
      serializedPoll,
    );
    signal?.addEventListener("abort", () => {
      listen.unlisten();
      for (const timeout of timeouts) clearTimeout(timeout);
      timeouts.clear();
    });
    while (!signal?.aborted) {
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
      await serializedPoll();
    }
    await new Promise<void>((resolve) => {
      signal?.addEventListener("abort", () => resolve());
      if (signal?.aborted) return resolve();
    });
  }

  /**
   * Initializes the message queue table if it does not already exist.
   */
  initialize(): Promise<void> {
    if (this.#initialized) return Promise.resolve();
    return (this.#initPromise ??= this.#doInitialize());
  }

  async #doInitialize(): Promise<void> {
    logger.debug("Initializing the message queue table {tableName}...", {
      tableName: this.#tableName,
    });
    for (let attempt = 1; attempt <= INITIALIZE_MAX_ATTEMPTS; attempt++) {
      try {
        await this.#sql`
      CREATE TABLE IF NOT EXISTS ${this.#sql(this.#tableName)} (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        message jsonb NOT NULL,
        delay interval DEFAULT '0 seconds',
        created timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
        ordering_key text
      );
    `;
        // Add ordering_key column if it doesn't exist (for existing tables)
        await this.#sql`
      ALTER TABLE ${this.#sql(this.#tableName)}
      ADD COLUMN IF NOT EXISTS ordering_key text;
    `;
        break;
      } catch (error) {
        if (
          !isInitializationRaceError(error) ||
          attempt >= INITIALIZE_MAX_ATTEMPTS
        ) {
          logger.error(
            "Failed to initialize the message queue table: {error}",
            { error },
          );
          throw error;
        }
        const backoffMs = INITIALIZE_BACKOFF_MS * 2 ** (attempt - 1);
        logger.debug(
          "Initialization raced for table {tableName}; retrying in {backoffMs}ms (attempt {attempt}/{maxAttempts}).",
          {
            tableName: this.#tableName,
            backoffMs,
            attempt,
            maxAttempts: INITIALIZE_MAX_ATTEMPTS,
            error,
          },
        );
        await sleep(backoffMs);
      }
    }
    this.#driverSerializesJson = await driverSerializesJson(this.#sql);
    this.#initialized = true;
    logger.debug("Initialized the message queue table {tableName}.", {
      tableName: this.#tableName,
    });
  }

  /**
   * Drops the message queue table if it exists.
   */
  async drop(): Promise<void> {
    await this.#sql`DROP TABLE IF EXISTS ${this.#sql(this.#tableName)};`;
  }

  #json(value: unknown): Parameter {
    if (this.#driverSerializesJson) return this.#sql.json(value as JSONValue);
    return this.#sql.json(JSON.stringify(value));
  }
}

// cSpell: ignore typname unlisten
