/**
 * Bridges Fedify's [LogTape] logs into the AdonisJS logger.
 *
 * Fedify reports signature verification, delivery attempts, WebFinger lookups,
 * and document loading through LogTape, but none of it is visible unless
 * LogTape is configured.  This module routes those records into the
 * application's Pino logger so they share its formatting and level filtering.
 *
 * [LogTape]: https://logtape.org/
 *
 * @module
 */
import { AsyncLocalStorage } from "node:async_hooks";

import type { Logger } from "@adonisjs/core/logger";
import {
  configure,
  getConfig,
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
   * The LogTape categories to route into the AdonisJS logger.  The default
   * covers Fedify's logs and LogTape's meta category, where LogTape reports
   * its own misconfiguration.
   *
   * @default `[['logtape', 'meta'], ['fedify']]`
   */
  categories?: (string | string[])[];
}

/**
 * A Pino log method in its `(mergingObject, message)` form.
 */
type LogMethod = (
  properties: Record<string, unknown>,
  message: string,
) => void;

/**
 * Maps a LogTape level onto the matching Pino method (`warning` becomes
 * `warn`).  The methods are wrapped rather than bound because `bind()` would
 * pick the `(message, ...values)` overload instead of the merging-object one.
 */
function logWith(logger: Logger, level: LogLevel): LogMethod | undefined {
  switch (level) {
    case "trace":
      return (properties, message) => logger.trace(properties, message);
    case "debug":
      return (properties, message) => logger.debug(properties, message);
    case "info":
      return (properties, message) => logger.info(properties, message);
    case "warning":
      return (properties, message) => logger.warn(properties, message);
    case "error":
      return (properties, message) => logger.error(properties, message);
    case "fatal":
      return (properties, message) => logger.fatal(properties, message);
    default:
      return undefined;
  }
}

/**
 * Turns a record's LogTape properties into Pino's merging object, so that
 * `redact` paths, serializers, and log aggregators see them as fields rather
 * than as text flattened into the message.
 *
 * An `error` property holding an `Error` is moved to `err`, the key Pino
 * serialises errors under.  It is moved rather than copied because the
 * rendered message already carries the inspected value.
 */
function toLogFields(
  properties: Record<string, unknown>,
): Record<string, unknown> {
  const fields: Record<string, unknown> = { ...properties };

  if (fields.error instanceof Error && fields.err === undefined) {
    fields.err = fields.error;
    delete fields.error;
  }

  return fields;
}

/**
 * Configures LogTape so that Fedify's logs flow into the AdonisJS logger.
 * The service provider calls this during `boot()` unless `config/fedify.ts`
 * sets `logging: false`, the escape hatch for applications that configure
 * LogTape themselves.
 *
 * LogTape is a process-global singleton and `configure()` throws when called
 * twice.  The usual causes (an application configuring LogTape itself without
 * `logging: false`, or a test process booting several applications) should
 * keep the existing configuration, so this function logs a debug message and
 * returns instead of throwing.
 *
 * Timestamps and levels are stripped from the rendered message because the
 * AdonisJS logger adds its own.  Properties are also passed as Pino fields;
 * see {@link toLogFields}.
 *
 * @returns Whether this call configured LogTape and should therefore undo it.
 *   The provider resets it in `shutdown()` so that a process booting a second
 *   application (the test runner, an in-process dev-server restart) does not
 *   keep logging into the old application's logger.
 */
export async function configureFedifyLogging(
  options: FedifyLoggingOptions,
): Promise<boolean> {
  const { logger } = options;
  const categories = options.categories ?? [["logtape", "meta"], ["fedify"]];

  if (getConfig() != null) {
    logger.debug(
      "LogTape is already configured, so the Fedify logging bridge was left " +
        'alone. Set "logging" to false in config/fedify.ts to make that ' +
        "explicit.",
    );
    return false;
  }

  const formatter: TextFormatter = getTextFormatter({
    timestamp: "disabled",
    level: () => "",
  });

  await configure({
    sinks: {
      adonisjs: (record: LogRecord) => {
        // The formatter still emits an empty `[]` where the level would go.
        const message = formatter(record).replace(/^\[\]\s+/, "").trimEnd();
        const fields = toLogFields(record.properties);

        const write = logWith(logger, record.level);
        /* c8 ignore next 3 -- LogTape may add levels in a future release */
        if (write === undefined) {
          logger.info(fields, message);
          return;
        }
        write(fields, message);
      },
    },
    filters: {},
    loggers: categories.map((category) => ({ category, sinks: ["adonisjs"] })),
    contextLocalStorage: new AsyncLocalStorage(),
  });

  return true;
}
