/**
 * Bridges Fedify's [LogTape] logs into the AdonisJS logger.
 *
 * Fedify reports a great deal of operational detail through LogTape: HTTP
 * Signature verification results, delivery attempts and retries, WebFinger
 * lookups, JSON-LD document loading.  None of it reaches the terminal unless
 * LogTape is configured, and "my inbox silently drops everything" is a
 * miserable thing to debug without those logs.
 *
 * This module wires LogTape's records into the application's Pino logger, so
 * Fedify's output lands in the same stream, with the same formatting and the
 * same log level filtering, as everything else the application logs.
 *
 * [LogTape]: https://logtape.org/
 *
 * @module
 */
import type { Logger } from "@adonisjs/core/logger";
import {
  configure,
  getTextFormatter,
  type LogLevel,
  type LogRecord,
  type TextFormatter,
} from "@logtape/logtape";

/**
 * Options for {@link configureFedifyLogging}.
 */
export interface FedifyLoggingOptions {
  /**
   * The AdonisJS logger to forward records to.
   */
  logger: Logger;

  /**
   * The LogTape categories to route into the AdonisJS logger.
   *
   * The default covers Fedify's own logs plus LogTape's meta category, which is
   * where LogTape reports its own misconfiguration.
   *
   * @default `[['logtape', 'meta'], ['fedify']]`
   */
  categories?: (string | string[])[];
}

/**
 * Maps a LogTape level onto the matching Pino method.
 *
 * The only mismatch is LogTape's `warning` versus Pino's `warn`.
 */
function logWith(
  logger: Logger,
  level: LogLevel,
): ((message: string) => void) | undefined {
  switch (level) {
    case "trace":
      return logger.trace.bind(logger);
    case "debug":
      return logger.debug.bind(logger);
    case "info":
      return logger.info.bind(logger);
    case "warning":
      return logger.warn.bind(logger);
    case "error":
      return logger.error.bind(logger);
    case "fatal":
      return logger.fatal.bind(logger);
    default:
      return undefined;
  }
}

/**
 * Configures LogTape so that Fedify's logs flow into the AdonisJS logger.
 *
 * LogTape is a process-global singleton, so this must be called at most once
 * per process.  The service provider calls it during `boot()` unless the
 * application sets `logging: false` in `config/fedify.ts`, which is the escape
 * hatch for applications that configure LogTape themselves.
 *
 * Timestamps and levels are stripped from the rendered message because the
 * AdonisJS logger adds both; leaving them in produces doubled-up output.
 */
export async function configureFedifyLogging(
  options: FedifyLoggingOptions,
): Promise<void> {
  const { logger } = options;
  const categories = options.categories ?? [["logtape", "meta"], ["fedify"]];

  const formatter: TextFormatter = getTextFormatter({
    timestamp: "disabled",
    level: () => "",
  });

  await configure({
    sinks: {
      adonisjs: (record: LogRecord) => {
        const write = logWith(logger, record.level);
        /* c8 ignore next 3 -- defensive: LogTape may add levels in a future release */
        if (write === undefined) {
          logger.info(formatter(record));
          return;
        }
        // The formatter still emits an empty `[]` where the level would go.
        write(formatter(record).replace(/^\[\]\s+/, "").trimEnd());
      },
    },
    filters: {},
    loggers: categories.map((category) => ({ category, sinks: ["adonisjs"] })),
  });
}
