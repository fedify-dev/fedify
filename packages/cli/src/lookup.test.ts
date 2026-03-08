import { Activity, Note } from "@fedify/vocab";
import { clearActiveConfig, setActiveConfig } from "@optique/config";
import { runWithConfig } from "@optique/config/run";
import { parse } from "@optique/core/parser";
import { UrlError } from "@fedify/vocab-runtime";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import process from "node:process";
import { Writable } from "node:stream";
import test from "node:test";
import { configContext } from "./config.ts";
import { getContextLoader } from "./docloader.ts";
import {
  authorizedFetchOption,
  clearTimeoutSignal,
  collectAsyncItems,
  collectRecursiveObjects,
  createTimeoutSignal,
  getLookupFailureHint,
  getRecursiveTargetId,
  lookupCommand,
  RecursiveLookupError,
  shouldPrintLookupFailureHint,
  shouldSuggestSuppressErrorsForLookupFailure,
  TimeoutError,
  toPresentationOrder,
  writeObjectToStream,
  writeSeparator,
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

test("writeObjectToStream - supports reusing an output stream", async () => {
  const testDir = "./test_output_reused_stream";
  const testFile = `${testDir}/notes.txt`;

  await mkdir(testDir, { recursive: true });

  const note1 = new Note({
    id: new URL("https://example.com/notes/1"),
    content: "First note",
  });
  const note2 = new Note({
    id: new URL("https://example.com/notes/2"),
    content: "Second note",
  });

  const contextLoader = await getContextLoader({});
  const stream = createWriteStream(testFile);

  await writeObjectToStream(note1, testFile, undefined, contextLoader, stream);
  await writeObjectToStream(note2, testFile, undefined, contextLoader, stream);
  await new Promise<void>((resolve, reject) => {
    stream.end((error?: Error | null) => {
      if (error != null) reject(error);
      else resolve();
    });
  });

  const content = await readFile(testFile, { encoding: "utf8" });
  assert.match(content, /First note/);
  assert.match(content, /Second note/);

  await rm(testDir, { recursive: true });
});

test("writeSeparator - writes to provided output stream", async () => {
  const testDir = "./test_output_separator";
  const testFile = `${testDir}/separator.txt`;
  await mkdir(testDir, { recursive: true });

  const stream = createWriteStream(testFile);
  await writeSeparator("----", stream);
  await new Promise<void>((resolve, reject) => {
    stream.end((error?: Error | null) => {
      if (error != null) reject(error);
      else resolve();
    });
  });

  const content = await readFile(testFile, { encoding: "utf8" });
  assert.strictEqual(content, "----\n");
  await rm(testDir, { recursive: true });
});

test("writeSeparator - writes to stdout when no stream is provided", async () => {
  const originalWrite = process.stdout.write;
  let output = "";
  process.stdout.write =
    ((chunk: string | Uint8Array, callback?: () => void) => {
      output += typeof chunk === "string"
        ? chunk
        : Buffer.from(chunk).toString();
      callback?.();
      return true;
    }) as typeof process.stdout.write;
  try {
    await writeSeparator("----");
    assert.strictEqual(output, "----\n");
  } finally {
    process.stdout.write = originalWrite;
  }
});

test("writeSeparator - rejects when stream emits write error", async () => {
  const stream = new Writable({
    write(_chunk, _encoding, callback) {
      this.emit("error", new Error("separator write failed"));
      callback();
    },
  });

  await assert.rejects(
    () => writeSeparator("----", stream),
    /separator write failed/,
  );
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

test("writeObjectToStream - rejects when stream emits write error", async () => {
  const note = new Note({
    id: new URL("https://example.com/notes/1"),
    content: "Test stream error",
  });
  const contextLoader = await getContextLoader({});
  const stream = new Writable({
    write(_chunk, _encoding, callback) {
      this.emit("error", new Error("write failed"));
      callback();
    },
  });

  await assert.rejects(
    () =>
      writeObjectToStream(note, undefined, undefined, contextLoader, stream),
    /write failed/,
  );
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

test("lookupCommand - parses --allow-private-address", () => {
  setActiveConfig(configContext.id, {});
  const result = parse(lookupCommand, [
    "lookup",
    "--allow-private-address",
    "https://example.com/notes/1",
  ]);
  clearActiveConfig(configContext.id);
  assert.ok(result.success);
  if (result.success) {
    assert.strictEqual(result.value.allowPrivateAddress, true);
  }
});

test("lookupCommand - reads allowPrivateAddress from config", async () => {
  const result = await runWithConfig(lookupCommand, configContext, {
    load: () => ({ lookup: { allowPrivateAddress: true } }),
    args: ["lookup", "https://example.com/notes/1"],
  });
  assert.strictEqual(result.allowPrivateAddress, true);
});

test("lookupCommand - parses --reverse", () => {
  setActiveConfig(configContext.id, {});
  const result = parse(lookupCommand, [
    "lookup",
    "--reverse",
    "https://example.com/notes/1",
  ]);
  clearActiveConfig(configContext.id);
  assert.ok(result.success);
  if (result.success) {
    assert.strictEqual(result.value.reverse, true);
  }
});

test("lookupCommand - reads reverse from config", async () => {
  const result = await runWithConfig(lookupCommand, configContext, {
    load: () => ({ lookup: { reverse: true } }),
    args: ["lookup", "https://example.com/notes/1"],
  });
  assert.strictEqual(result.reverse, true);
});

test("lookupCommand - parses recurse option", () => {
  setActiveConfig(configContext.id, {});
  const result = parse(lookupCommand, [
    "lookup",
    "--recurse",
    "replyTarget",
    "https://example.com/notes/1",
  ]);
  clearActiveConfig(configContext.id);
  assert.ok(result.success);
  if (result.success) {
    assert.strictEqual(result.value.recurse, "replyTarget");
    assert.strictEqual(result.value.recurseDepth, 20);
    assert.strictEqual(result.value.traverse, false);
  }
});

test("lookupCommand - rejects recurse-depth without recurse", () => {
  setActiveConfig(configContext.id, {});
  const result = parse(lookupCommand, [
    "lookup",
    "--recurse-depth",
    "10",
    "https://example.com/notes/1",
  ]);
  clearActiveConfig(configContext.id);
  assert.ok(!result.success);
});

test("lookupCommand - rejects traverse with recurse", () => {
  setActiveConfig(configContext.id, {});
  const result = parse(lookupCommand, [
    "lookup",
    "--traverse",
    "--recurse",
    "replyTarget",
    "https://example.com/notes/1",
  ]);
  clearActiveConfig(configContext.id);
  assert.ok(!result.success);
});

test("lookupCommand - rejects short-form inReplyTo", () => {
  setActiveConfig(configContext.id, {});
  const result = parse(lookupCommand, [
    "lookup",
    "--recurse",
    "inReplyTo",
    "https://example.com/notes/1",
  ]);
  clearActiveConfig(configContext.id);
  assert.ok(!result.success);
});

test("lookupCommand - accepts IRI inReplyTo", () => {
  setActiveConfig(configContext.id, {});
  const result = parse(lookupCommand, [
    "lookup",
    "--recurse",
    "https://www.w3.org/ns/activitystreams#inReplyTo",
    "https://example.com/notes/1",
  ]);
  clearActiveConfig(configContext.id);
  assert.ok(result.success);
  if (result.success) {
    assert.strictEqual(
      result.value.recurse,
      "https://www.w3.org/ns/activitystreams#inReplyTo",
    );
  }
});

test("lookupCommand - accepts short-form quoteUrl", () => {
  setActiveConfig(configContext.id, {});
  const result = parse(lookupCommand, [
    "lookup",
    "--recurse",
    "quoteUrl",
    "https://example.com/notes/1",
  ]);
  clearActiveConfig(configContext.id);
  assert.ok(result.success);
  if (result.success) {
    assert.strictEqual(result.value.recurse, "quoteUrl");
  }
});

for (
  const recurseProperty of [
    "https://www.w3.org/ns/activitystreams#quoteUrl",
    "https://misskey-hub.net/ns#_misskey_quote",
    "http://fedibird.com/ns#quoteUri",
  ]
) {
  test(`lookupCommand - accepts IRI ${recurseProperty}`, () => {
    setActiveConfig(configContext.id, {});
    const result = parse(lookupCommand, [
      "lookup",
      "--recurse",
      recurseProperty,
      "https://example.com/notes/1",
    ]);
    clearActiveConfig(configContext.id);
    assert.ok(result.success);
    if (result.success) {
      assert.strictEqual(result.value.recurse, recurseProperty);
    }
  });
}

test("getRecursiveTargetId - returns reply target for short name", () => {
  const replyTarget = new URL("https://example.com/notes/0");
  const note = new Note({
    id: new URL("https://example.com/notes/1"),
    replyTarget,
  });
  assert.equal(getRecursiveTargetId(note, "replyTarget"), replyTarget);
});

test("getRecursiveTargetId - returns reply target for IRI", () => {
  const replyTarget = new URL("https://example.com/notes/0");
  const note = new Note({
    id: new URL("https://example.com/notes/1"),
    replyTarget,
  });
  assert.equal(
    getRecursiveTargetId(
      note,
      "https://www.w3.org/ns/activitystreams#inReplyTo",
    ),
    replyTarget,
  );
});

test("getRecursiveTargetId - returns quote URL for short name", () => {
  const quoteUrl = new URL("https://example.com/notes/quoted");
  const note = new Note({
    id: new URL("https://example.com/notes/1"),
    quoteUrl,
  });
  assert.equal(getRecursiveTargetId(note, "quoteUrl"), quoteUrl);
});

for (
  const recurseProperty of [
    "https://www.w3.org/ns/activitystreams#quoteUrl",
    "https://misskey-hub.net/ns#_misskey_quote",
    "http://fedibird.com/ns#quoteUri",
  ] as const
) {
  test(`getRecursiveTargetId - returns quote URL for IRI ${recurseProperty}`, () => {
    const quoteUrl = new URL("https://example.com/notes/quoted");
    const note = new Note({
      id: new URL("https://example.com/notes/1"),
      quoteUrl,
    });
    assert.equal(getRecursiveTargetId(note, recurseProperty), quoteUrl);
  });
}

test("getRecursiveTargetId - returns null for unknown recurse property", () => {
  const quoteUrl = new URL("https://example.com/notes/quoted");
  const note = new Note({
    id: new URL("https://example.com/notes/1"),
    quoteUrl,
  });
  assert.equal(
    getRecursiveTargetId(
      note,
      "https://example.com/custom#prop" as Parameters<
        typeof getRecursiveTargetId
      >[1],
    ),
    null,
  );
});

test("getLookupFailureHint - suggests private-address for UrlError", () => {
  assert.equal(
    getLookupFailureHint(new UrlError("Localhost is not allowed")),
    "private-address",
  );
});

test("getLookupFailureHint - suggests recursive-private-address in recurse mode", () => {
  assert.equal(
    getLookupFailureHint(new UrlError("Invalid or private address"), {
      recursive: true,
    }),
    "recursive-private-address",
  );
});

test("getLookupFailureHint - suggests authorized-fetch for non-URL errors", () => {
  assert.equal(
    getLookupFailureHint(new Error("401 Unauthorized")),
    "authorized-fetch",
  );
});

test("getLookupFailureHint - does not treat all UrlError values as private", () => {
  assert.equal(
    getLookupFailureHint(new UrlError("Unsupported protocol: ftp:")),
    "authorized-fetch",
  );
});

test("shouldPrintLookupFailureHint - suppresses only authorized-fetch hint", () => {
  const loader =
    ((_url: string) =>
      Promise.reject(new Error("not used"))) as unknown as Parameters<
        typeof shouldPrintLookupFailureHint
      >[0];
  assert.equal(
    shouldPrintLookupFailureHint(loader, "authorized-fetch"),
    false,
  );
  assert.equal(
    shouldPrintLookupFailureHint(loader, "private-address"),
    true,
  );
  assert.equal(
    shouldPrintLookupFailureHint(loader, "recursive-private-address"),
    true,
  );
});

test("shouldSuggestSuppressErrorsForLookupFailure - only for authorized-fetch with auth", () => {
  const loader =
    ((_url: string) =>
      Promise.reject(new Error("not used"))) as unknown as Parameters<
        typeof shouldSuggestSuppressErrorsForLookupFailure
      >[0];
  assert.equal(
    shouldSuggestSuppressErrorsForLookupFailure(loader, "authorized-fetch"),
    true,
  );
  assert.equal(
    shouldSuggestSuppressErrorsForLookupFailure(loader, "private-address"),
    false,
  );
  assert.equal(
    shouldSuggestSuppressErrorsForLookupFailure(
      loader,
      "recursive-private-address",
    ),
    false,
  );
  assert.equal(
    shouldSuggestSuppressErrorsForLookupFailure(undefined, "authorized-fetch"),
    false,
  );
});

test("collectRecursiveObjects - follows chain up to depth limit", async () => {
  const note1 = new Note({
    id: new URL("https://example.com/notes/1"),
    replyTarget: new URL("https://example.com/notes/0"),
  });
  const note0 = new Note({
    id: new URL("https://example.com/notes/0"),
  });
  const objects = new Map<string, Note>([
    ["https://example.com/notes/0", note0],
  ]);
  const result = await collectRecursiveObjects(
    note1,
    "replyTarget",
    10,
    (url) => Promise.resolve(objects.get(url) ?? null),
    { suppressErrors: false },
  );
  assert.deepEqual(result, [note0]);
});

test("collectRecursiveObjects - respects recurse depth", async () => {
  const note2 = new Note({
    id: new URL("https://example.com/notes/2"),
    replyTarget: new URL("https://example.com/notes/1"),
  });
  const note1 = new Note({
    id: new URL("https://example.com/notes/1"),
    replyTarget: new URL("https://example.com/notes/0"),
  });
  const note0 = new Note({
    id: new URL("https://example.com/notes/0"),
  });
  const objects = new Map<string, Note>([
    ["https://example.com/notes/1", note1],
    ["https://example.com/notes/0", note0],
  ]);
  const result = await collectRecursiveObjects(
    note2,
    "replyTarget",
    1,
    (url) => Promise.resolve(objects.get(url) ?? null),
    { suppressErrors: false },
  );
  assert.deepEqual(result, [note1]);
});

test("collectRecursiveObjects - stops on cycle", async () => {
  const note2 = new Note({
    id: new URL("https://example.com/notes/2"),
    replyTarget: new URL("https://example.com/notes/1"),
  });
  const note1 = new Note({
    id: new URL("https://example.com/notes/1"),
    replyTarget: new URL("https://example.com/notes/2"),
  });
  const objects = new Map<string, Note>([
    ["https://example.com/notes/1", note1],
    ["https://example.com/notes/2", note2],
  ]);
  const visited = new Set<string>();
  const result = await collectRecursiveObjects(
    note2,
    "replyTarget",
    10,
    (url) => Promise.resolve(objects.get(url) ?? null),
    { suppressErrors: false, visited },
  );
  assert.deepEqual(result, [note1]);
});

test("collectRecursiveObjects - throws when lookup fails", async () => {
  const note = new Note({
    id: new URL("https://example.com/notes/1"),
    replyTarget: new URL("https://example.com/notes/0"),
  });
  await assert.rejects(
    collectRecursiveObjects(
      note,
      "replyTarget",
      10,
      () => Promise.resolve(null),
      { suppressErrors: false },
    ),
    RecursiveLookupError,
  );
});

test("collectRecursiveObjects - suppresses errors in best-effort mode", async () => {
  const note = new Note({
    id: new URL("https://example.com/notes/1"),
    replyTarget: new URL("https://example.com/notes/0"),
  });
  const result = await collectRecursiveObjects(
    note,
    "replyTarget",
    10,
    () => Promise.resolve(null),
    { suppressErrors: true },
  );
  assert.deepEqual(result, []);
});

test(
  "collectRecursiveObjects - suppress mode does not poison visited set",
  async () => {
    const note2 = new Note({
      id: new URL("https://example.com/notes/2"),
      replyTarget: new URL("https://example.com/notes/1"),
    });
    const visited = new Set<string>();
    const result = await collectRecursiveObjects(
      note2,
      "replyTarget",
      10,
      () => Promise.reject(new Error("temporary failure")),
      { suppressErrors: true, visited },
    );
    assert.deepEqual(result, []);
    assert.equal(visited.has("https://example.com/notes/1"), false);
  },
);

test(
  "toPresentationOrder - keeps order when reverse is false (default mode)",
  () => {
    assert.deepEqual(
      toPresentationOrder(
        ["https://example.com/1", "https://example.com/2"],
        false,
      ),
      ["https://example.com/1", "https://example.com/2"],
    );
  },
);

test("toPresentationOrder - reverses order when reverse is true (default mode)", () => {
  assert.deepEqual(
    toPresentationOrder(
      ["https://example.com/1", "https://example.com/2"],
      true,
    ),
    ["https://example.com/2", "https://example.com/1"],
  );
});

test("toPresentationOrder - reverses recursive chain order when reverse is true", () => {
  assert.deepEqual(
    toPresentationOrder(["self", "parent", "root"], true),
    ["root", "parent", "self"],
  );
});

test("toPresentationOrder - reverses traversed item order when reverse is true", () => {
  assert.deepEqual(
    toPresentationOrder(["item-1", "item-2", "item-3"], true),
    ["item-3", "item-2", "item-1"],
  );
});

test("collectAsyncItems - collects items without error", async () => {
  async function* source() {
    yield 1;
    yield 2;
  }
  const result = await collectAsyncItems(source());
  assert.deepEqual(result.items, [1, 2]);
  assert.equal(result.error, undefined);
});

test("collectAsyncItems - keeps partial items when iteration fails", async () => {
  async function* source() {
    yield "first";
    throw new Error("boom");
  }
  const result = await collectAsyncItems(source());
  assert.deepEqual(result.items, ["first"]);
  assert.ok(result.error instanceof Error);
  assert.equal((result.error as Error).message, "boom");
});
