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

/**
 * Options for the PostgreSQL message queue.
 */
export interface PostgresMessageQueueOptions {
  /**
   * The table name to use for the message queue.
   * `"fedify_message_v2"` by default.
   * @default `"fedify_message_v2"`
   */
  tableName?: string;

  /**
   * The channel name to use for the message queue.
   * `"fedify_channel"` by default.
   * @default `"fedify_channel"`
   */
  channelName?: string;

  /**
   * Whether the table has been initialized.  `false` by default.
   * @default `false`
   */
  initialized?: boolean;

  /**
   * The poll interval for the message queue.  5 seconds by default.
   * @default `{ seconds: 5 }`
   */
  pollInterval?: Temporal.Duration | Temporal.DurationLike;
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
    if (options?.delay) {
      logger.debug("Enqueuing a message with a delay of {delay}...", {
        delay,
        message,
      });
    } else {
      logger.debug("Enqueuing a message...", { message });
    }
    await this.#sql`
      INSERT INTO ${this.#sql(this.#tableName)} (message, delay)
      VALUES (
        ${this.#json(message)},
        ${delay.toString()}
      );
    `;
    logger.debug("Enqueued a message.", { message });
    await this.#sql.notify(this.#channelName, delay.toString());
    logger.debug("Notified the message queue channel {channelName}.", {
      channelName: this.#channelName,
      message,
    });
  }

  async enqueueMany(
    // deno-lint-ignore no-explicit-any
    messages: any[],
    options?: MessageQueueEnqueueOptions,
  ): Promise<void> {
    if (messages.length === 0) return;
    await this.initialize();
    const delay = options?.delay ?? Temporal.Duration.from({ seconds: 0 });
    if (options?.delay) {
      logger.debug("Enqueuing messages with a delay of {delay}...", {
        delay,
        messages,
      });
    } else {
      logger.debug("Enqueuing messages...", { messages });
    }
    for (const message of messages) {
      await this.#sql`
        INSERT INTO ${this.#sql(this.#tableName)} (message, delay)
        VALUES (
          ${this.#json(message)},
          ${delay.toString()}
        );
      `;
    }
    logger.debug("Enqueued messages.", { messages });
    await this.#sql.notify(this.#channelName, delay.toString());
    logger.debug("Notified the message queue channel {channelName}.", {
      channelName: this.#channelName,
      messages,
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
        const query = this.#sql`
          DELETE FROM ${this.#sql(this.#tableName)}
          WHERE id = (
            SELECT id
            FROM ${this.#sql(this.#tableName)}
            WHERE created + delay < CURRENT_TIMESTAMP
            ORDER BY created
            LIMIT 1
          )
          RETURNING message;
        `.execute();
        const cancel = query.cancel.bind(query);
        signal?.addEventListener("abort", cancel);
        let i = 0;
        for (const message of await query) {
          if (signal?.aborted) return;
          await handler(message.message);
          i++;
        }
        signal?.removeEventListener("abort", cancel);
        if (i < 1) break;
      }
    };
    const timeouts = new Set<ReturnType<typeof setTimeout>>();
    const listen = await this.#sql.listen(
      this.#channelName,
      async (delay) => {
        const duration = Temporal.Duration.from(delay);
        const durationMs = duration.total("millisecond");
        if (durationMs < 1) await poll();
        else timeouts.add(setTimeout(poll, durationMs));
      },
      poll,
    );
    signal?.addEventListener("abort", () => {
      listen.unlisten();
      for (const timeout of timeouts) clearTimeout(timeout);
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
      await poll();
    }
    await new Promise<void>((resolve) => {
      signal?.addEventListener("abort", () => resolve());
      if (signal?.aborted) return resolve();
    });
  }

  /**
   * Initializes the message queue table if it does not already exist.
   */
  async initialize(): Promise<void> {
    if (this.#initialized) return;
    logger.debug("Initializing the message queue table {tableName}...", {
      tableName: this.#tableName,
    });
    try {
      await this.#sql`
      CREATE TABLE IF NOT EXISTS ${this.#sql(this.#tableName)} (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        message jsonb NOT NULL,
        delay interval DEFAULT '0 seconds',
        created timestamp with time zone DEFAULT CURRENT_TIMESTAMP
      );
    `;
    } catch (error) {
      if (
        !(error instanceof postgres.PostgresError &&
          error.constraint_name === "pg_type_typname_nsp_index")
      ) {
        logger.error("Failed to initialize the message queue table: {error}", {
          error,
        });
        throw error;
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

// cSpell: ignore typname
