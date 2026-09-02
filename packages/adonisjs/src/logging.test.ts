/**
 * Tests for the LogTape → AdonisJS logger bridge.
 *
 * LogTape's configuration is process-global, so every test resets it again
 * afterwards.  Node's test runner gives each test file its own process, which
 * keeps that global out of the other suites.
 *
 * @module
 */
import { deepStrictEqual, match, ok, strictEqual } from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import type { Logger } from "@adonisjs/core/logger";
import { configure, getLogger, reset, withContext } from "@logtape/logtape";

import { configureFedifyLogging } from "./logging.ts";

/**
 * One call the bridge made on the AdonisJS logger.
 */
interface Recorded {
  level: string;
  message: string;
  fields: Record<string, unknown>;
}

/**
 * A stand-in for the AdonisJS (Pino) logger that records what it was told.
 *
 * Pino's methods take an optional merging object before the message, which is
 * the form the bridge uses for every forwarded record; the fake accepts both
 * so that the bridge's own plain-string notices are recorded too.
 */
function createLogger(): { logger: Logger; records: Recorded[] } {
  const records: Recorded[] = [];
  const record = (level: string) =>
  (
    fieldsOrMessage: Record<string, unknown> | string,
    message?: string,
  ) => {
    records.push(
      typeof fieldsOrMessage === "string"
        ? { level, message: fieldsOrMessage, fields: {} }
        : { level, message: message ?? "", fields: fieldsOrMessage },
    );
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
    strictEqual(await configureFedifyLogging({ logger }), true);

    getLogger(["fedify", "federation"]).warn("Delivery failed.");

    // The first record is LogTape's own meta logger announcing itself, which
    // the default categories deliberately route here too.
    const delivery = records.find(({ message }) =>
      message.includes("Delivery failed.")
    );
    ok(delivery);
    // LogTape's `warning` maps onto Pino's `warn`.
    strictEqual(delivery.level, "warn");
    // The timestamp and the level are stripped; the AdonisJS logger adds both,
    // so the rendered message starts at the category.
    match(delivery.message, /^fedify.federation: Delivery failed\.$/);
  });

  it("hands the record's properties to Pino as fields", async () => {
    // Flattening everything into the message would leave Pino nothing to
    // apply its `redact` paths and serializers to, and a log aggregator
    // nothing to filter on.
    const { logger, records } = createLogger();
    await configureFedifyLogging({ logger });

    getLogger(["fedify", "federation"]).warn(
      "Delivery to {inbox} failed after {attempt} attempts.",
      { inbox: "https://example.com/inbox", attempt: 3 },
    );

    const delivery = records.find(({ message }) =>
      message.includes("Delivery to")
    );
    ok(delivery);
    deepStrictEqual(delivery.fields, {
      inbox: "https://example.com/inbox",
      attempt: 3,
    });
    // ...and the rendered message still reads as it did before.
    match(delivery.message, /Delivery to 'https:\/\/example\.com\/inbox'/);
  });

  it("moves an Error into the field Pino serialises it under", async () => {
    // Pino turns an `Error` into a structured `err` field -- message, type and
    // stack -- and leaves any other key as inspected text.
    const { logger, records } = createLogger();
    await configureFedifyLogging({ logger });

    const error = new Error("Signature verification failed.");
    getLogger(["fedify", "sig", "http"]).error("Failed: {error}", { error });

    const failure = records.find(({ message }) => message.includes("Failed:"));
    ok(failure);
    strictEqual(failure.level, "error");
    strictEqual(failure.fields.err, error);
    // Moved rather than copied: the rendered message already carries it.
    strictEqual("error" in failure.fields, false);
  });

  it("keeps Fedify's implicit context available to the sink", async () => {
    // Fedify's `requestId` and `messageId` ride on LogTape's implicit
    // contexts, which resolve to `undefined` without a `contextLocalStorage`.
    const { logger, records } = createLogger();
    await configureFedifyLogging({ logger });

    await withContext({ requestId: "REQ-1" }, () => {
      getLogger(["fedify", "federation"]).warn("Delivery failed: {requestId}");
    });

    const delivery = records.find(({ message }) =>
      message.includes("Delivery failed")
    );
    ok(delivery);
    match(delivery.message, /Delivery failed: 'REQ-1'$/);
    strictEqual(delivery.fields.requestId, "REQ-1");
  });

  it("leaves an existing LogTape configuration alone", async () => {
    await configure({ sinks: {}, loggers: [] });

    const { logger, records } = createLogger();
    // Without the guard `configure()` would throw ConfigError("Already
    // configured; ..."), which would take the whole application down during
    // the provider's boot() over a logging bridge.
    strictEqual(await configureFedifyLogging({ logger }), false);

    strictEqual(records.length, 1);
    strictEqual(records[0]!.level, "debug");
    match(records[0]!.message, /already configured/i);
  });
});
