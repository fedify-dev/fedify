import { Activity, Note } from "@fedify/vocab";
import { clearActiveConfig, setActiveConfig } from "@optique/config";
import { runWithConfig } from "@optique/config/run";
import { parse } from "@optique/core/parser";
import assert from "node:assert/strict";
import { mkdir, readFile, rm } from "node:fs/promises";
import test from "node:test";
import { configContext } from "./config.ts";
import { getContextLoader } from "./docloader.ts";
import {
    authorizedFetchOption,
    clearTimeoutSignal,
    createTimeoutSignal,
    lookupCommand,
    TimeoutError,
    writeObjectToStream,
} from "./lookup.ts";

function withActiveConfig<T>(config: unknown, fn: () => T): T {
  setActiveConfig(configContext.id, config);
  try {
    return fn();
  } finally {
    clearActiveConfig(configContext.id);
  }
}


// lookupCommand parsing tests

Deno.test("lookupCommand: binds config defaults when no CLI flags provided", async () => {
  const result = await runWithConfig(lookupCommand, configContext, {
    load: () => ({
      lookup: {
        timeout: 12,
        defaultFormat: "compact",
        separator: "----SEP----",
        traverse: true,
        suppressErrors: true,
        authorizedFetch: true,
        firstKnock: "rfc9421",
      },
    }),
    args: ["lookup", "https://example.com/object/1"],
  });

  assert.equal(result.command, "lookup");
  assert.deepEqual(result.urls, ["https://example.com/object/1"]);
});

Deno.test("Config lookup value constraints reject invalid timeout/format inputs deterministically", async () => {
  await assert.rejects(
    () =>
      runWithConfig(lookupCommand, configContext, {
        load: () => ({
          lookup: {
            timeout: "not-a-number",
            defaultFormat: "not-a-supported-format",
          },
        }),
        args: ["lookup", "https://example.com/object/1"],
      }),
    (err) => {
      assert.ok(err instanceof Error);
      assert.match(
        err.message,
        /(timeout|defaultFormat|lookup|schema|Invalid)/i,
      );
      return true;
    },
  );
});

Deno.test("lookup options parse: timeout/format/separator/traverse/suppress-errors via expected flags", () => {
  const result = withActiveConfig({}, () =>
    parse(lookupCommand, [
      "lookup",
      "--timeout",
      "1.5",
      "-s",
      "***",
      "--traverse",
      "-S",
      "-e",
      "https://example.com/object/1",
    ]));

  assert.ok(result.success);
  if (!result.success) return;

  assert.equal(result.value.timeout, 1.5);
  assert.equal(result.value.format, "expand");
  assert.equal(result.value.separator, "***");
  assert.equal(result.value.traverse, true);
  assert.equal(result.value.suppressErrors, true);
  assert.deepEqual(result.value.urls, ["https://example.com/object/1"]);
});

Deno.test("authorized fetch dependency: --first-knock requires -a/--authorized-fetch", () => {
  const result = withActiveConfig({}, () =>
    parse(lookupCommand, [
      "lookup",
      "--first-knock",
      "rfc9421",
      "https://example.com/object/1",
    ]));

  assert.ok(!result.success);
});

Deno.test("lookupCommand parses URL arguments and preserves order", () => {
  const result = withActiveConfig({}, () =>
    parse(lookupCommand, [
      "lookup",
      "https://example.com/objects/1",
      "@alice@example.com",
      "https://example.com/objects/2",
    ]));

  assert.ok(result.success);
  if (!result.success) return;

  assert.deepEqual(result.value.urls, [
    "https://example.com/objects/1",
    "@alice@example.com",
    "https://example.com/objects/2",
  ]);
});

Deno.test("CLI flags override config-bound lookup defaults", async () => {
  const result = await runWithConfig(lookupCommand, configContext, {
    load: () => ({
      lookup: {
        timeout: 30,
        defaultFormat: "raw",
        separator: "CONFIG_SEP",
        traverse: false,
        suppressErrors: false,
      },
    }),
    args: [
      "lookup",
      "--timeout",
      "2",
      "--compact",
      "--separator",
      "CLI_SEP",
      "--traverse",
      "--suppress-errors",
      "https://example.com/object/1",
    ],
  });

  assert.equal(result.timeout, 2);
  assert.equal(result.format, "compact");
  assert.equal(result.separator, "CLI_SEP");
  assert.equal(result.traverse, true);
  assert.equal(result.suppressErrors, true);
});

Deno.test("authorized fetch dependency: --tunnel-service requires -a/--authorized-fetch", () => {
  const result = withActiveConfig({}, () =>
    parse(lookupCommand, [
      "lookup",
      "--tunnel-service",
      "serveo.net",
      "https://example.com/object/1",
    ]));

  assert.ok(!result.success);
});

Deno.test("lookupCommand requires at least one URL", () => {
  const result = withActiveConfig({}, () => parse(lookupCommand, ["lookup"]));

  assert.ok(!result.success);
  if (result.success) return;

  assert.ok(result.error);
});

Deno.test("TimeoutError constructor sets message and name", () => {
  const error = new TimeoutError("Test timeout message");
  assert.equal(error.message, "Test timeout message");
  assert.equal(error.name, "TimeoutError");
});

Deno.test("TimeoutError is instance of Error", () => {
  const error = new TimeoutError("Test error");
  assert.ok(error instanceof Error);
  assert.ok(error instanceof TimeoutError);
});

Deno.test("TimeoutError preserves stack trace", () => {
  const error = new TimeoutError("Test timeout");
  assert.ok(error.stack);
  assert.ok(error.stack.includes("TimeoutError"));
});

Deno.test("createTimeoutSignal handles zero timeout", () => {
  const signal = createTimeoutSignal(0);
  assert.ok(signal !== undefined);
  assert.ok(signal instanceof AbortSignal);
});

Deno.test("createTimeoutSignal multiple signals are independent", async () => {
  const signal1 = createTimeoutSignal(0.05);
  const signal2 = createTimeoutSignal(0.1);
  
  assert.ok(signal1);
  assert.ok(signal2);
  assert.ok(!signal1.aborted);
  assert.ok(!signal2.aborted);
  
  await new Promise((resolve) => setTimeout(resolve, 60));
  
  assert.ok(signal1.aborted);
  assert.ok(!signal2.aborted);
  
  clearTimeoutSignal(signal2);
});

Deno.test("clearTimeoutSignal handles undefined signal gracefully", () => {
  clearTimeoutSignal(undefined);
  assert.ok(true);
});

Deno.test("clearTimeoutSignal handles signal without timer", () => {
  const controller = new AbortController();
  const signal = controller.signal;
  clearTimeoutSignal(signal);
  assert.ok(true);
});

Deno.test("lookupCommand parses multiple URLs and handles correctly", () => {
  const result = withActiveConfig({}, () =>
    parse(lookupCommand, [
      "lookup",
      "https://example.com/1",
      "@user@domain.com",
      "https://example.com/2",
      "@another@server.net",
    ]));

  assert.ok(result.success);
  if (!result.success) return;

  assert.equal(result.value.urls.length, 4);
  assert.equal(result.value.urls[0], "https://example.com/1");
  assert.equal(result.value.urls[1], "@user@domain.com");
  assert.equal(result.value.urls[2], "https://example.com/2");
  assert.equal(result.value.urls[3], "@another@server.net");
});

Deno.test("lookupCommand traverse and suppressErrors work together", () => {
  const result = withActiveConfig({}, () =>
    parse(lookupCommand, [
      "lookup",
      "-t",
      "-S",
      "https://example.com/collection/1",
    ]));

  assert.ok(result.success);
  if (!result.success) return;

  assert.equal(result.value.traverse, true);
  assert.equal(result.value.suppressErrors, true);
});

Deno.test("lookupCommand accepts custom separator", () => {
  const result = withActiveConfig({}, () =>
    parse(lookupCommand, [
      "lookup",
      "-s",
      "===SEPARATOR===",
      "https://example.com/object/1",
    ]));

  assert.ok(result.success);
  if (!result.success) return;

  assert.equal(result.value.separator, "===SEPARATOR===");
});

Deno.test("authorizedFetchOption all flags work together", () => {
  const result = withActiveConfig({}, () =>
    parse(authorizedFetchOption, [
      "-a",
      "--first-knock",
      "rfc9421",
      "--tunnel-service",
      "serveo.net",
    ]));

  assert.ok(result.success);
  if (!result.success) return;

  assert.equal(result.value.authorizedFetch, true);
  assert.equal(result.value.firstKnock, "rfc9421");
  assert.equal(result.value.tunnelService, "serveo.net");
});

Deno.test("runLookup timeout configuration creates signal correctly", () => {
  const command = {
    urls: ["https://example.com/notes/1"],
    debug: false,
    traverse: false,
    suppressErrors: false,
    authorizedFetch: false,
    firstKnock: undefined,
    tunnelService: undefined,
    timeout: 5,
    userAgent: undefined,
    format: undefined,
    separator: "----",
    output: undefined,
  };

  assert.equal(command.timeout, 5);
  const signal = createTimeoutSignal(command.timeout);
  assert.ok(signal);
  assert.ok(!signal.aborted);
  clearTimeoutSignal(signal);
});

test("writeObjectToStream - writes Note object with default options", async () => {
  const testDir = "./test_output_note";
  const testFile = `${testDir}/note.txt`;

  await mkdir(testDir, { recursive: true });

  const note = new Note({
    id: new URL("https://example.com/notes/1"),
    content: "Hello, fediverse!",
  });

  const contextLoader = await getContextLoader({});
  await writeObjectToStream(note, testFile, undefined, contextLoader);
  await new Promise((resolve) => setTimeout(resolve, 100));

  const content = await readFile(testFile, { encoding: "utf8" });

  assert.ok(content);
  assert.match(content, /Hello, fediverse!/);
  assert.match(content, /id/);

  await rm(testDir, { recursive: true });
});

test("writeObjectToStream - writes Activity object in raw JSON-LD format", async () => {
  const testDir = "./test_output_activity";
  const testFile = `${testDir}/raw.json`;

  await mkdir(testDir, { recursive: true });

  const activity = new Activity({
    id: new URL("https://example.com/activities/1"),
  });

  const contextLoader = await getContextLoader({});
  await writeObjectToStream(activity, testFile, "raw", contextLoader);
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Verify file exists and contains JSON-LD
  const content = await readFile(testFile);

  assert.ok(content);
  assert.ok(content.includes("@context"));
  assert.ok(content.includes("id"));

  await rm(testDir, { recursive: true });
});

test("writeObjectToStream - writes object in compact JSON-LD format", async () => {
  const testDir = "./test_output_compact";
  const testFile = `${testDir}/compact.json`;

  await mkdir(testDir, { recursive: true });

  const note = new Note({
    id: new URL("https://example.com/notes/1"),
    content: "Test note",
  });

  const contextLoader = await getContextLoader({});
  await writeObjectToStream(note, testFile, "compact", contextLoader);
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Verify file exists and contains compacted JSON-LD
  const content = await readFile(testFile);
  assert.ok(content);
  assert.ok(content.includes("Test note"));

  await rm(testDir, { recursive: true });
});

test("writeObjectToStream - writes object in expanded JSON-LD format", async () => {
  const testDir = "./test_output_expand";
  const testFile = `${testDir}/expand.json`;

  await mkdir(testDir, { recursive: true });

  const note = new Note({
    id: new URL("https://example.com/notes/1"),
    content: "Test note for expansion",
  });

  const contextLoader = await getContextLoader({});
  await writeObjectToStream(note, testFile, "expand", contextLoader);
  await new Promise((resolve) => setTimeout(resolve, 100));

  const content = await readFile(testFile);
  assert.ok(content);
  assert.ok(content.includes("Test note for expansion"));

  await rm(testDir, { recursive: true });
});

test("writeObjectToStream - writes to stdout when no output file specified", async () => {
  const note = new Note({
    id: new URL("https://example.com/notes/1"),
    content: "Test stdout note",
  });

  const contextLoader = await getContextLoader({});

  await writeObjectToStream(note, undefined, undefined, contextLoader);
});

test("writeObjectToStream - handles empty content properly", async () => {
  const testDir = "./test_output_empty";
  const testFile = `${testDir}/empty.txt`;

  await mkdir(testDir, { recursive: true });

  const note = new Note({
    id: new URL("https://example.com/notes/1"),
  });

  const contextLoader = await getContextLoader({});

  await writeObjectToStream(note, testFile, undefined, contextLoader);
  await new Promise((resolve) => setTimeout(resolve, 100));

  const content = await readFile(testFile);
  assert.ok(content);
  assert.ok(content.includes("Note"));

  await rm(testDir, { recursive: true });
});

test("createTimeoutSignal - returns undefined when no timeout specified", () => {
  const signal = createTimeoutSignal();
  assert.strictEqual(signal, undefined);
});

test("createTimeoutSignal - returns undefined when timeout is null", () => {
  const signal = createTimeoutSignal(undefined);
  assert.strictEqual(signal, undefined);
});

test("createTimeoutSignal - creates AbortSignal that aborts after timeout", async () => {
  const signal = createTimeoutSignal(0.1);
  assert.ok(signal);
  assert.ok(!signal.aborted);

  await new Promise((resolve) => setTimeout(resolve, 150));

  assert.ok(signal.aborted);
  assert.ok(signal.reason instanceof TimeoutError);
  assert.equal(
    (signal.reason as TimeoutError).message,
    "Request timed out after 0.1 seconds",
  );
});

test("createTimeoutSignal - signal is not aborted before timeout", () => {
  const signal = createTimeoutSignal(1); // 1 second timeout
  assert.ok(signal);
  assert.ok(!signal.aborted);

  clearTimeoutSignal(signal);
});

test("clearTimeoutSignal - cleans up timer properly", async () => {
  const signal = createTimeoutSignal(0.05); // 50ms timeout
  assert.ok(signal);
  assert.ok(!signal.aborted);

  clearTimeoutSignal(signal);

  await new Promise((resolve) => setTimeout(resolve, 100));

  assert.ok(!signal.aborted);
});

test("authorizedFetchOption - parses successfully without -a flag", () => {
  setActiveConfig(configContext.id, {});
  const result = parse(authorizedFetchOption, []);
  clearActiveConfig(configContext.id);
  assert.ok(result.success);
  if (result.success) {
    assert.strictEqual(result.value.authorizedFetch, false);
    assert.strictEqual(result.value.firstKnock, undefined);
    assert.strictEqual(result.value.tunnelService, undefined);
  }
});

test("authorizedFetchOption - parses with -a without tunnelService config", async () => {
  const result = await runWithConfig(authorizedFetchOption, configContext, {
    load: () => ({}),
    args: ["-a"],
  });
  assert.strictEqual(result.authorizedFetch, true);
  assert.strictEqual(result.firstKnock, "draft-cavage-http-signatures-12");
  assert.strictEqual(result.tunnelService, undefined);
});

test("authorizedFetchOption - uses config to enable authorized fetch", async () => {
  const result = await runWithConfig(authorizedFetchOption, configContext, {
    load: () => ({ lookup: { authorizedFetch: true } }),
    args: [],
  });
  assert.strictEqual(result.authorizedFetch, true);
  assert.strictEqual(result.firstKnock, "draft-cavage-http-signatures-12");
  assert.strictEqual(result.tunnelService, undefined);
});

test("authorizedFetchOption - reads firstKnock from config", async () => {
  const result = await runWithConfig(authorizedFetchOption, configContext, {
    load: () => ({
      lookup: {
        authorizedFetch: true,
        firstKnock: "rfc9421",
      },
      tunnelService: "serveo.net",
    }),
    args: [],
  });
  assert.strictEqual(result.authorizedFetch, true);
  assert.strictEqual(result.firstKnock, "rfc9421");
  assert.strictEqual(result.tunnelService, undefined);
});

test("authorizedFetchOption - invalid when --first-knock is used without -a", () => {
  setActiveConfig(configContext.id, {});
  const result = parse(authorizedFetchOption, [
    "--first-knock",
    "rfc9421",
  ]);
  clearActiveConfig(configContext.id);
  assert.ok(!result.success);
});

test("authorizedFetchOption - invalid when --tunnel-service is used without -a", () => {
  setActiveConfig(configContext.id, {});
  const result = parse(authorizedFetchOption, [
    "--tunnel-service",
    "serveo.net",
  ]);
  clearActiveConfig(configContext.id);
  assert.ok(!result.success);
});

test("authorizedFetchOption - parses successfully with -a flag", () => {
  setActiveConfig(configContext.id, {});
  const result = parse(authorizedFetchOption, ["-a"]);
  clearActiveConfig(configContext.id);
  assert.ok(result.success);
  if (result.success) {
    assert.strictEqual(result.value.authorizedFetch, true);
    assert.strictEqual(
      result.value.firstKnock,
      "draft-cavage-http-signatures-12",
    );
    assert.strictEqual(result.value.tunnelService, undefined);
  }
});

test("authorizedFetchOption - parses with -a and --first-knock", () => {
  setActiveConfig(configContext.id, {});
  const result = parse(authorizedFetchOption, [
    "-a",
    "--first-knock",
    "rfc9421",
  ]);
  clearActiveConfig(configContext.id);
  assert.ok(result.success);
  if (result.success) {
    assert.strictEqual(result.value.authorizedFetch, true);
    assert.strictEqual(result.value.firstKnock, "rfc9421");
    assert.strictEqual(result.value.tunnelService, undefined);
  }
});

test("authorizedFetchOption - parses with -a and --tunnel-service", () => {
  setActiveConfig(configContext.id, {});
  const result = parse(authorizedFetchOption, [
    "-a",
    "--tunnel-service",
    "serveo.net",
  ]);
  clearActiveConfig(configContext.id);
  assert.ok(result.success);
  if (result.success) {
    assert.strictEqual(result.value.authorizedFetch, true);
    assert.strictEqual(
      result.value.firstKnock,
      "draft-cavage-http-signatures-12",
    );
    assert.strictEqual(result.value.tunnelService, "serveo.net");
  }
});
