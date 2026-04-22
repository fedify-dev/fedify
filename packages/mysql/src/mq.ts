import type {
  MessageQueue,
  MessageQueueEnqueueOptions,
  MessageQueueListenOptions,
} from "@fedify/fedify";
import { getLogger } from "@logtape/logtape";
import type { RowDataPacket } from "mysql2/promise";

const logger = getLogger(["fedify", "mysql", "mq"]);
const INITIALIZE_MAX_ATTEMPTS = 5;
const INITIALIZE_BACKOFF_MS = 10;
// Maximum number of distinct ordering-key candidates fetched per poll cycle.
// Raising this reduces the chance of missing a key under high contention, at
// the cost of a slightly larger result set from the GROUP BY query.
const ORDERING_KEY_CANDIDATE_LIMIT = 10;

interface MysqlQueryable {
  query<TRows = unknown>(
    sql: string,
    values?: unknown,
  ): Promise<[TRows, unknown]>;
}

interface MysqlPoolConnection extends MysqlQueryable {
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void;
}

interface MysqlPool extends MysqlQueryable {
  getConnection(): Promise<MysqlPoolConnection>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(
  result: void | Promise<void>,
  timeoutMs: number,
): Promise<void> {
  const resolved = Promise.resolve(result);
  if (timeoutMs <= 0) return resolved;
  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Message handler timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  return Promise.race([resolved, timeoutPromise]).finally(() =>
    clearTimeout(timer!)
  );
}

/**
 * Computes a MySQL advisory lock name for the given table name and ordering
 * key.  The result is always at most 64 characters, which is well within
 * MySQL's advisory lock name length limit.
 */
function getMysqlLockName(tableName: string, orderingKey: string): string {
  const raw = `${tableName}:${orderingKey}`;
  if (raw.length <= 64) return raw;
  // Use two djb2-variant hash functions to produce a 20-char collision-resistant
  // name that fits within MySQL's advisory lock name length limit.
  let h1 = 0;
  let h2 = 5381;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    h1 = (((h1 << 5) - h1) + c) | 0;
    h2 = (((h2 << 5) + h2) + c) | 0;
  }
  return `fdy:${(h1 >>> 0).toString(16).padStart(8, "0")}${
    (h2 >>> 0).toString(16).padStart(8, "0")
  }`;
}

/**
 * Options for the MySQL message queue.
 *
 * @since 2.1.0
 */
export interface MysqlMessageQueueOptions {
  /**
   * The table name to use for the message queue.
   * `"fedify_mq"` by default.
   * @default `"fedify_mq"`
   * @since 2.1.0
   */
  readonly tableName?: string;

  /**
   * Whether the table has been initialized.  `false` by default.
   * @default `false`
   * @since 2.1.0
   */
  readonly initialized?: boolean;

  /**
   * The poll interval for the message queue.  1 second by default.
   *
   * Since MySQL/MariaDB has no `LISTEN`/`NOTIFY` equivalent, messages are
   * discovered using periodic polling.  A shorter interval reduces message
   * delivery latency at the cost of additional database load.
   *
   * @default `{ seconds: 1 }`
   * @since 2.1.0
   */
  readonly pollInterval?: Temporal.Duration | Temporal.DurationLike;

  /**
   * The maximum time to wait for a message handler to complete before
   * the queue moves on.  This is a *soft* timeout: when a handler exceeds
   * the limit, the queue stops waiting and logs a timeout error, but it
   * cannot cancel the handler itself — the handler's promise continues
   * running in the background.  In the ordered-key path the advisory lock
   * is always released in a `finally` block, so a timed-out handler will
   * not permanently block the same ordering key.  However, concurrent
   * side-effects from the still-running handler may interleave with the
   * next handler for the same key; callers should be aware of this.
   *
   * Set to zero to disable the timeout (not recommended in production).
   *
   * 60 seconds by default.
   * @default `{ seconds: 60 }`
   * @since 2.1.0
   */
  readonly handlerTimeout?: Temporal.Duration | Temporal.DurationLike;
}

/**
 * A message queue that uses MySQL or MariaDB as the underlying storage.
 * Messages are delivered via periodic polling, since MySQL and MariaDB do not
 * provide a `LISTEN`/`NOTIFY` equivalent.
 *
 * Concurrent workers are supported via `SELECT … FOR UPDATE SKIP LOCKED`
 * (requires MySQL 8.0+ or MariaDB 10.6+) and MySQL advisory locks
 * (`GET_LOCK`/`RELEASE_LOCK`) for ordering-key serialization.
 *
 * @example
 * ```ts
 * import { createFederation } from "@fedify/fedify";
 * import { MysqlKvStore, MysqlMessageQueue } from "@fedify/mysql";
 * import mysql from "mysql2/promise";
 *
 * const pool = mysql.createPool("mysql://user:pass@localhost/db");
 *
 * const federation = createFederation({
 *   kv: new MysqlKvStore(pool),
 *   queue: new MysqlMessageQueue(pool),
 * });
 * ```
 *
 * @since 2.1.0
 */
export class MysqlMessageQueue implements MessageQueue {
  /**
   * MySQL/MariaDB does not provide native retry mechanisms; Fedify handles
   * retries itself.
   * @since 2.1.0
   */
  readonly nativeRetrial = false;

  readonly #pool: MysqlPool;
  readonly #tableName: string;
  readonly #pollIntervalMs: number;
  readonly #handlerTimeoutMs: number;
  #initialized: boolean;
  #initPromise?: Promise<void>;

  /**
   * Creates a new MySQL message queue.
   * @param pool The MySQL connection pool to use.
   * @param options Options for the message queue.
   * @since 2.1.0
   */
  constructor(pool: MysqlPool, options: MysqlMessageQueueOptions = {}) {
    this.#pool = pool;
    const tableName = options.tableName ?? "fedify_mq";
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
      throw new RangeError(
        `Invalid table name: ${JSON.stringify(tableName)}. ` +
          "Table names must start with a letter or underscore and contain " +
          "only letters, digits, and underscores.",
      );
    }
    // MySQL identifiers are limited to 64 characters.  The derived index name
    // is "idx_<tableName>_deliver_after" (18 extra chars), so the table name
    // itself must be at most 46 characters long.
    if (tableName.length > 46) {
      throw new RangeError(
        `Invalid table name: ${JSON.stringify(tableName)}. ` +
          "Table names must be at most 46 characters long (MySQL identifier " +
          'limit is 64 chars; the derived index "idx_<name>_deliver_after" ' +
          "uses 18 more).",
      );
    }
    this.#tableName = tableName;
    this.#pollIntervalMs = Temporal.Duration.from(
      options.pollInterval ?? { seconds: 1 },
    ).total("millisecond");
    this.#handlerTimeoutMs = Temporal.Duration.from(
      options.handlerTimeout ?? { seconds: 60 },
    ).total("millisecond");
    this.#initialized = options.initialized ?? false;
  }

  /**
   * {@inheritDoc MessageQueue.enqueue}
   * @since 2.1.0
   */
  async enqueue(
    // deno-lint-ignore no-explicit-any
    message: any,
    options?: MessageQueueEnqueueOptions,
  ): Promise<void> {
    await this.initialize();
    const delayMs = options?.delay == null
      ? 0
      : Math.max(Math.round(options.delay.total("millisecond")), 0);
    const orderingKey = options?.orderingKey ?? null;
    if (options?.delay) {
      logger.debug("Enqueuing a message with a delay of {delayMs}ms...", {
        delayMs,
        message,
        orderingKey,
      });
    } else {
      logger.debug("Enqueuing a message...", { message, orderingKey });
    }
    await this.#pool.query(
      `INSERT INTO \`${this.#tableName}\`
         (\`id\`, \`message\`, \`deliver_after\`, \`ordering_key\`)
       VALUES (
         UUID(),
         ?,
         DATE_ADD(NOW(6), INTERVAL ? MICROSECOND),
         ?
       )`,
      [JSON.stringify(message), delayMs * 1000, orderingKey],
    );
    logger.debug("Enqueued a message.", { message, orderingKey });
  }

  /**
   * {@inheritDoc MessageQueue.enqueueMany}
   * @since 2.1.0
   */
  async enqueueMany(
    // deno-lint-ignore no-explicit-any
    messages: readonly any[],
    options?: MessageQueueEnqueueOptions,
  ): Promise<void> {
    if (messages.length === 0) return;
    await this.initialize();
    const delayMs = options?.delay == null
      ? 0
      : Math.max(Math.round(options.delay.total("millisecond")), 0);
    const orderingKey = options?.orderingKey ?? null;
    if (options?.delay) {
      logger.debug(
        "Enqueuing {count} messages with a delay of {delayMs}ms...",
        { count: messages.length, delayMs, orderingKey },
      );
    } else {
      logger.debug("Enqueuing {count} messages...", {
        count: messages.length,
        orderingKey,
      });
    }
    const placeholders = messages.map(() =>
      "(UUID(), ?, DATE_ADD(NOW(6), INTERVAL ? MICROSECOND), ?)"
    ).join(", ");
    // Each row gets a monotonically increasing interval so that messages
    // sharing the same orderingKey are assigned distinct deliver_after values
    // within a single INSERT statement.  Without this tie-breaker, all rows
    // would receive the same NOW(6) timestamp (MySQL evaluates NOW(6) once per
    // statement), making dequeue order nondeterministic for ordered keys.
    const values = messages.flatMap((message, index) => [
      JSON.stringify(message),
      delayMs * 1000 + index,
      orderingKey,
    ]);
    let conn: MysqlPoolConnection | undefined;
    try {
      conn = await this.#pool.getConnection();
      await conn.beginTransaction();
      await conn.query(
        `INSERT INTO \`${this.#tableName}\`
           (\`id\`, \`message\`, \`deliver_after\`, \`ordering_key\`)
         VALUES ${placeholders}`,
        values,
      );
      await conn.commit();
    } catch (e) {
      if (conn != null) await conn.rollback();
      throw e;
    } finally {
      conn?.release();
    }
    logger.debug("Enqueued {count} messages.", {
      count: messages.length,
      orderingKey,
    });
  }

  /**
   * {@inheritDoc MessageQueue.listen}
   * @since 2.1.0
   */
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

        // Step 1: Try to process messages without an ordering key first.
        // These don't need advisory locks — FOR UPDATE SKIP LOCKED is
        // sufficient to prevent two workers from processing the same message.
        const noKeyMsg = await this.#dequeueWithoutOrderingKey();
        if (noKeyMsg !== undefined) {
          if (signal?.aborted) return;
          await withTimeout(handler(noKeyMsg), this.#handlerTimeoutMs);
          processed = true;
          continue;
        }

        // Step 2: Try to process messages with an ordering key.
        // MySQL advisory locks (GET_LOCK / RELEASE_LOCK) ensure that only
        // one worker processes each ordering key at a time, providing
        // sequential processing guarantees.
        //
        // IMPORTANT: GET_LOCK / RELEASE_LOCK are session-level in MySQL, i.e.
        // they are tied to a specific connection.  We therefore use a
        // dedicated connection (pool.getConnection()) for the entire
        // lock → dequeue → handler → unlock sequence so that the lock and
        // unlock are guaranteed to execute on the same connection.
        //
        // We fetch up to ORDERING_KEY_CANDIDATE_LIMIT distinct ordering keys
        // in a single GROUP BY query and iterate over them in memory, avoiding
        // the O(n) NOT IN list that would grow with each failed lock attempt.
        const candidates = await this.#findOrderingKeyCandidates();
        for (const orderingKey of candidates) {
          if (signal?.aborted) break;
          const lockName = getMysqlLockName(this.#tableName, orderingKey);

          let conn: MysqlPoolConnection | undefined;
          try {
            conn = await this.#pool.getConnection();
            const [lockResult] = await conn.query<RowDataPacket[]>(
              `SELECT GET_LOCK(?, 0) AS acquired`,
              [lockName],
            );
            if (lockResult[0].acquired === null) {
              // GET_LOCK() returns NULL when an error occurred (e.g. the
              // server ran out of lock resources).  Log a warning and skip
              // this ordering key so the worker can still process others.
              logger.warn(
                "GET_LOCK({lockName}) returned NULL (server error); " +
                  "skipping ordering key {orderingKey}.",
                { lockName, orderingKey },
              );
            } else if (lockResult[0].acquired === 1) {
              try {
                const msg = await this.#dequeueOrderedMessage(
                  conn,
                  orderingKey,
                );
                if (msg !== undefined) {
                  if (signal?.aborted) return;
                  await withTimeout(handler(msg), this.#handlerTimeoutMs);
                  processed = true;
                }
              } finally {
                // Always release the advisory lock on the SAME connection
                await conn.query(`SELECT RELEASE_LOCK(?)`, [lockName]);
              }
              if (processed) break;
            }
            // acquired === 0: lock not acquired → try next ordering key
          } finally {
            conn?.release();
          }
        }

        if (!processed) break;
      }
    };

    const safePoll = async (trigger: string) => {
      try {
        await poll();
      } catch (error) {
        logger.error(
          "Error while polling for messages ({trigger}); " +
            "will retry on next poll: {error}",
          { trigger, error },
        );
      }
    };

    // Immediately process any messages that were enqueued before listen() was
    // called, so that pre-queued messages are not delayed by the first
    // poll interval.
    await safePoll("initial");

    while (!signal?.aborted) {
      await new Promise<unknown>((resolve) => {
        const timeoutId = setTimeout(() => {
          signal?.removeEventListener("abort", onAbort);
          resolve(0);
        }, this.#pollIntervalMs);
        function onAbort() {
          clearTimeout(timeoutId);
          resolve(undefined);
        }
        signal?.addEventListener("abort", onAbort, { once: true });
      });
      if (signal?.aborted) break;
      await safePoll("interval");
    }
  }

  /**
   * Atomically dequeues the oldest ready message that has no ordering key,
   * using `FOR UPDATE SKIP LOCKED` within a transaction.
   * Returns `undefined` when no such message is available.
   */
  async #dequeueWithoutOrderingKey(): Promise<unknown> {
    let conn: MysqlPoolConnection | undefined;
    try {
      conn = await this.#pool.getConnection();
      await conn.beginTransaction();
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT \`id\`, \`message\`
         FROM \`${this.#tableName}\`
         WHERE \`deliver_after\` <= NOW(6) AND \`ordering_key\` IS NULL
         ORDER BY \`deliver_after\`
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
      );
      if (rows.length === 0) {
        await conn.rollback();
        return undefined;
      }
      const { id, message } = rows[0];
      await conn.query(
        `DELETE FROM \`${this.#tableName}\` WHERE \`id\` = ?`,
        [id],
      );
      await conn.commit();
      return message;
    } catch (e) {
      if (conn != null) await conn.rollback();
      throw e;
    } finally {
      conn?.release();
    }
  }

  /**
   * Returns up to {@link ORDERING_KEY_CANDIDATE_LIMIT} distinct ordering keys
   * that have at least one ready message, ordered by their earliest
   * `deliver_after`.  Fetching a batch in one query avoids the growing
   * `NOT IN (…)` list that results from repeatedly calling a single-result
   * version after each failed lock attempt.
   */
  async #findOrderingKeyCandidates(): Promise<string[]> {
    const [rows] = await this.#pool.query<RowDataPacket[]>(
      `SELECT \`ordering_key\`
       FROM \`${this.#tableName}\`
       WHERE \`deliver_after\` <= NOW(6) AND \`ordering_key\` IS NOT NULL
       GROUP BY \`ordering_key\`
       ORDER BY MIN(\`deliver_after\`)
       LIMIT ?`,
      [ORDERING_KEY_CANDIDATE_LIMIT],
    );
    return rows.map((r) => r.ordering_key as string);
  }

  /**
   * Dequeues the oldest ready message for the given ordering key using
   * the supplied (dedicated) connection.  The caller MUST hold the advisory
   * lock for `orderingKey` before calling this method.
   * Returns `undefined` when no ready message exists for the ordering key.
   */
  async #dequeueOrderedMessage(
    conn: MysqlPoolConnection,
    orderingKey: string,
  ): Promise<unknown> {
    await conn.beginTransaction();
    try {
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT \`id\`, \`message\`
         FROM \`${this.#tableName}\`
         WHERE \`deliver_after\` <= NOW(6) AND \`ordering_key\` = ?
         ORDER BY \`deliver_after\`
         LIMIT 1`,
        [orderingKey],
      );
      if (rows.length === 0) {
        await conn.rollback();
        return undefined;
      }
      const { id, message } = rows[0];
      await conn.query(
        `DELETE FROM \`${this.#tableName}\` WHERE \`id\` = ?`,
        [id],
      );
      await conn.commit();
      return message;
    } catch (e) {
      await conn.rollback();
      throw e;
    }
  }

  /**
   * Initializes the message queue table if it does not already exist.
   * Concurrent calls are coalesced — only one initialization runs at a time.
   *
   * @since 2.1.0
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
        await this.#pool.query(
          `CREATE TABLE IF NOT EXISTS \`${this.#tableName}\` (
            \`id\`            CHAR(36)    NOT NULL,
            \`message\`       JSON        NOT NULL,
            \`deliver_after\` DATETIME(6) NOT NULL DEFAULT NOW(6),
            \`ordering_key\`  TEXT        NULL     DEFAULT NULL,
            PRIMARY KEY (\`id\`)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
        );
        try {
          await this.#pool.query(
            `CREATE INDEX \`idx_${this.#tableName}_deliver_after\`
             ON \`${this.#tableName}\` (\`deliver_after\`)`,
          );
        } catch (e) {
          // Ignore duplicate index (ER_DUP_KEYNAME) from concurrent init
          if ((e as { code?: string }).code !== "ER_DUP_KEYNAME") throw e;
        }
        try {
          // Composite index to speed up #findOrderingKeyCandidates():
          // scans for the oldest ready message per ordering key.
          // ordering_key uses a 766-character prefix because TEXT columns
          // require a prefix length for indexing, and InnoDB's 3072-byte key
          // limit in utf8mb4 (4 bytes/char) leaves room for 766 chars once the
          // DATETIME(6) companion column (8 bytes) is included:
          // 766 * 4 + 8 = 3072 bytes exactly.
          await this.#pool.query(
            `CREATE INDEX \`idx_${this.#tableName}_ok_da\`
             ON \`${this.#tableName}\` (\`ordering_key\`(766), \`deliver_after\`)`,
          );
        } catch (e) {
          // Ignore duplicate index (ER_DUP_KEYNAME) from concurrent init
          if ((e as { code?: string }).code !== "ER_DUP_KEYNAME") throw e;
        }
        break;
      } catch (error) {
        if (attempt >= INITIALIZE_MAX_ATTEMPTS) {
          logger.error(
            "Failed to initialize the message queue table: {error}",
            { error },
          );
          throw error;
        }
        const backoffMs = INITIALIZE_BACKOFF_MS * 2 ** (attempt - 1);
        logger.debug(
          "Initialization race for table {tableName}; " +
            "retrying in {backoffMs}ms " +
            "(attempt {attempt}/{maxAttempts}).",
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
    this.#initialized = true;
    logger.debug("Initialized the message queue table {tableName}.", {
      tableName: this.#tableName,
    });
  }

  /**
   * Drops the message queue table if it exists.  Resets the initialized flag
   * so that {@link MysqlMessageQueue.initialize} can recreate the table on
   * the next call.
   *
   * @since 2.1.0
   */
  async drop(): Promise<void> {
    // Wait for any in-flight initialization to complete before dropping the
    // table.  Without this, drop() could finish before #doInitialize() sets
    // #initialized = true, leaving the instance in a state where it believes
    // the table exists even though it has already been dropped.
    if (this.#initPromise != null) {
      try {
        await this.#initPromise;
      } catch {
        // Ignore initialization errors — we are dropping the table anyway.
      }
    }
    await this.#pool.query(
      `DROP TABLE IF EXISTS \`${this.#tableName}\``,
    );
    this.#initialized = false;
    this.#initPromise = undefined;
  }
}
