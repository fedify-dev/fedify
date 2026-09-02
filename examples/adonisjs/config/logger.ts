import env from "#start/env";
import { defineConfig, targets } from "@adonisjs/core/logger";
import type { InferLoggers } from "@adonisjs/core/types";

/**
 * Logger configuration.
 *
 * AdonisJS boots a `LoggerManager` unconditionally, so this file is required
 * even for an example that logs nothing of its own — without it the application
 * fails at startup with `Cannot read properties of undefined (reading
 * 'loggers')`.
 *
 * Fedify's own diagnostics (signature verification, delivery attempts,
 * WebFinger lookups) arrive here too: `@fedify/adonisjs` bridges its LogTape
 * output into this logger by default, so raising `LOG_LEVEL` to `debug` shows
 * what the federation layer is doing.
 */
const loggerConfig = defineConfig({
  default: "app",

  loggers: {
    app: {
      enabled: true,
      name: "fedify-adonisjs-example",
      level: env.get("LOG_LEVEL"),
      /**
       * Write to stdout.  `pino-pretty` is deliberately not a dependency of
       * this example, so the output stays newline-delimited JSON.
       */
      transport: {
        targets: [targets.file({ destination: 1 })],
      },
    },
  },
});

export default loggerConfig;

declare module "@adonisjs/core/types" {
  export interface LoggersList extends InferLoggers<typeof loggerConfig> {}
}
