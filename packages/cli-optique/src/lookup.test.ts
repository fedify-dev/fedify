import { Activity, Note } from "@fedify/fedify";
import { assertEquals, assertExists } from "@std/assert";
import test from "node:test";
import { mkdir, readFile, rm } from "node:fs/promises";
import { getContextLoader } from "../../cli/src/docloader.ts";
import {
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

  const content = await readFile(testFile, { encoding: "utf8" });

  assertExists(content);
  assertEquals(content.includes("Hello, fediverse!"), true);
  assertEquals(content.includes("id"), true);

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

  // Verify file exists and contains JSON-LD
  const content = await readFile(testFile);

  assertExists(content);
  assertEquals(content.includes("@context"), true);
  assertEquals(content.includes("id"), true);

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

  // Verify file exists and contains compacted JSON-LD
  const content = await readFile(testFile);
  assertExists(content);
  assertEquals(content.includes("Test note"), true);

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

  const content = await readFile(testFile);
  assertExists(content);
  assertEquals(content.includes("Test note for expansion"), true);

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

  const content = await readFile(testFile);
  assertExists(content);
  assertEquals(content.includes("Note"), true);

  await rm(testDir, { recursive: true });
});

test("createTimeoutSignal - returns undefined when no timeout specified", () => {
  const signal = createTimeoutSignal();
  assertEquals(signal, undefined);
});

test("createTimeoutSignal - returns undefined when timeout is null", () => {
  const signal = createTimeoutSignal(undefined);
  assertEquals(signal, undefined);
});

test("createTimeoutSignal - creates AbortSignal that aborts after timeout", async () => {
  const signal = createTimeoutSignal(0.1);
  assertExists(signal);
  assertEquals(signal.aborted, false);

  await new Promise((resolve) => setTimeout(resolve, 150));

  assertEquals(signal.aborted, true);
  assertEquals(signal.reason instanceof TimeoutError, true);
  assertEquals(
    (signal.reason as TimeoutError).message,
    "Request timed out after 0.1 seconds",
  );
});

test("createTimeoutSignal - signal is not aborted before timeout", () => {
  const signal = createTimeoutSignal(1); // 1 second timeout
  assertExists(signal);
  assertEquals(signal.aborted, false);

  clearTimeoutSignal(signal);
});

test("clearTimeoutSignal - cleans up timer properly", async () => {
  const signal = createTimeoutSignal(0.05); // 50ms timeout
  assertExists(signal);
  assertEquals(signal.aborted, false);

  clearTimeoutSignal(signal);

  await new Promise((resolve) => setTimeout(resolve, 100));

  assertEquals(signal.aborted, false);
});
