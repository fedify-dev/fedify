/**
 * Log record storage for the debug dashboard, backed by a {@link KvStore}.
 *
 * @module
 */
import type { KvKey, KvStore } from "@fedify/fedify/federation";
import type { LogRecord, Sink } from "@logtape/logtape";

/**
 * A serialized log record for the debug dashboard.
 */
export interface SerializedLogRecord {
  /**
   * The logger category.
   */
  readonly category: readonly string[];

  /**
   * The log level.
   */
  readonly level: string;

  /**
   * The rendered log message.
   */
  readonly message: string;

  /**
   * The timestamp in milliseconds since the Unix epoch.
   */
  readonly timestamp: number;

  /**
   * The extra properties of the log record (excluding traceId and spanId).
   */
  readonly properties: Record<string, unknown>;
}

/**
 * Persistent storage for log records grouped by trace ID, backed by a
 * {@link KvStore}.  When the same `KvStore` is shared across web and worker
 * processes the dashboard can display logs produced by background tasks.
 */
export class LogStore {
  readonly #kv: KvStore;
  readonly #keyPrefix: KvKey;
  /** Chain of pending write promises for flush(). */
  #pending: Promise<void> = Promise.resolve();

  constructor(kv: KvStore, keyPrefix: KvKey = ["fedify", "debugger", "logs"]) {
    this.#kv = kv;
    this.#keyPrefix = keyPrefix;
  }

  /**
   * Enqueue a log record for writing.  The write happens asynchronously;
   * call {@link flush} to wait for all pending writes to complete.
   *
   * Keys use a timestamp + random suffix so that entries sort
   * chronologically and never collide, even across multiple processes
   * sharing the same {@link KvStore}.
   */
  add(traceId: string, record: SerializedLogRecord): void {
    const key: KvKey = [
      ...this.#keyPrefix,
      traceId,
      `${Date.now().toString(36).padStart(10, "0")}-${
        Math.random().toString(36).slice(2)
      }`,
    ] as unknown as KvKey;
    // Errors are swallowed so a single failed write cannot poison the
    // chain or cause an unhandled rejection — logging is best-effort.
    this.#pending = this.#pending.then(
      () => this.#kv.set(key, record),
    ).catch(() => {});
  }

  /** Wait for all pending writes to complete. */
  flush(): Promise<void> {
    return this.#pending;
  }

  async get(traceId: string): Promise<readonly SerializedLogRecord[]> {
    const prefix: KvKey = [...this.#keyPrefix, traceId] as unknown as KvKey;
    const logs: SerializedLogRecord[] = [];
    for await (const entry of this.#kv.list(prefix)) {
      logs.push(entry.value as SerializedLogRecord);
    }
    return logs;
  }
}

/**
 * Converts a {@link LogRecord} into a plain serializable object suitable
 * for storage in a {@link KvStore}.
 */
export function serializeLogRecord(record: LogRecord): SerializedLogRecord {
  // Render message to string
  const messageParts: string[] = [];
  for (const part of record.message) {
    if (typeof part === "string") messageParts.push(part);
    else if (part == null) messageParts.push("");
    else messageParts.push(String(part));
  }
  // Exclude traceId and spanId from properties
  const { traceId: _t, spanId: _s, ...properties } = record.properties;
  return {
    category: record.category,
    level: record.level,
    message: messageParts.join(""),
    timestamp: record.timestamp,
    properties,
  };
}

/**
 * Creates a LogTape {@link Sink} that writes log records into the given
 * {@link LogStore}, grouped by their `traceId` property.  Records without
 * a `traceId` are silently discarded.
 */
export function createLogSink(store: LogStore): Sink {
  return (record: LogRecord): void => {
    const traceId = record.properties.traceId;
    if (typeof traceId !== "string" || traceId.length === 0) return;
    store.add(traceId, serializeLogRecord(record));
  };
}
