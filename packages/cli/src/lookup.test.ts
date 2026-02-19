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
  TimeoutError,
  writeObjectToStream,
} from "./lookup.ts";

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
