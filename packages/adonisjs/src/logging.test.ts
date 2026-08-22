/**
 * Tests for the LogTape → AdonisJS logger bridge.
 *
 * LogTape's configuration is process-global, so every test resets it again
 * afterwards.  Node's test runner gives each test file its own process, which
 * keeps that global out of the other suites.
 *
 * @module
 */
import { match, strictEqual } from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import type { Logger } from "@adonisjs/core/logger";
import { configure, getLogger, reset } from "@logtape/logtape";

import { configureFedifyLogging } from "./logging.ts";

/**
 * A stand-in for the AdonisJS (Pino) logger that records what it was told.
 */
function createLogger(): { logger: Logger; records: [string, string][] } {
  const records: [string, string][] = [];
  const record = (level: string) => (message: string) => {
    records.push([level, message]);
  };

  const logger = {
    trace: record("trace"),
    debug: record("debug"),
    info: record("info"),
    warn: record("warn"),
    error: record("error"),
    fatal: record("fatal"),
  } as unknown as Logger;

  return { logger, records };
}

describe("configureFedifyLogging", () => {
  afterEach(async () => {
    await reset();
  });

  it("routes Fedify's records into the AdonisJS logger", async () => {
    const { logger, records } = createLogger();
    await configureFedifyLogging({ logger });

    getLogger(["fedify", "federation"]).warn("Delivery failed.");

    // The first record is LogTape's own meta logger announcing itself, which
    // the default categories deliberately route here too.
    const delivery = records.find(([, message]) =>
      message.includes("Delivery failed.")
    );
    strictEqual(delivery !== undefined, true);
    // LogTape's `warning` maps onto Pino's `warn`.
    strictEqual(delivery![0], "warn");
    // The timestamp and the level are stripped; the AdonisJS logger adds both,
    // so the rendered message starts at the category.
    match(delivery![1], /^fedify.federation: Delivery failed\.$/);
  });

  it("leaves an existing LogTape configuration alone", async () => {
    await configure({ sinks: {}, loggers: [] });

    const { logger, records } = createLogger();
    // Without the guard `configure()` would throw ConfigError("Already
    // configured; ..."), which would take the whole application down during
    // the provider's boot() over a logging bridge.
    await configureFedifyLogging({ logger });

    strictEqual(records.length, 1);
    strictEqual(records[0]![0], "debug");
    match(records[0]![1], /already configured/i);
  });
});
