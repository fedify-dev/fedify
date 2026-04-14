import { Activity, Collection, Note } from "@fedify/vocab";
import type { Annotations } from "@optique/core/annotations";
import { parse, type Parser, type Result } from "@optique/core/parser";
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
  runLookup,
  shouldPrintLookupFailureHint,
  shouldSuggestSuppressErrorsForLookupFailure,
  TimeoutError,
  toPresentationOrder,
  writeObjectToStream,
  writeSeparator,
} from "./lookup.ts";

async function parseWithConfig<TValue, TState>(
  parser: Parser<"sync", TValue, TState>,
  args: readonly string[],
  config: Record<string, unknown> = {},
): Promise<Result<TValue>> {
  const annotations = await (configContext.getAnnotations as (
    request?: unknown,
    options?: unknown,
  ) => PromiseLike<Annotations> | Annotations)(
    { phase: "phase2", parsed: {} },
    { load: () => ({ config, meta: undefined }) },
  );
  return parse(parser, args, { annotations });
}

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
  const result = parse(authorizedFetchOption, []);
  assert.ok(result.success);
  if (result.success) {
    assert.strictEqual(result.value.authorizedFetch, false);
    assert.strictEqual(result.value.firstKnock, undefined);
    assert.strictEqual(result.value.tunnelService, undefined);
  }
});

test("authorizedFetchOption - parses with -a without tunnelService config", async () => {
  const result = await parseWithConfig(authorizedFetchOption, ["-a"]);
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

test("authorizedFetchOption - uses config to enable authorized fetch", async () => {
  const result = await parseWithConfig(
    authorizedFetchOption,
    [],
    { lookup: { authorizedFetch: true } },
  );
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

test("authorizedFetchOption - reads firstKnock from config", async () => {
  const result = await parseWithConfig(
    authorizedFetchOption,
    [],
    {
      lookup: {
        authorizedFetch: true,
        firstKnock: "rfc9421",
      },
      tunnelService: "serveo.net",
    },
  );
  assert.ok(result.success);
  if (result.success) {
    assert.strictEqual(result.value.authorizedFetch, true);
    assert.strictEqual(result.value.firstKnock, "rfc9421");
    assert.strictEqual(result.value.tunnelService, "serveo.net");
  }
});

test("authorizedFetchOption - invalid when --first-knock is used without -a", () => {
  const result = parse(authorizedFetchOption, [
    "--first-knock",
    "rfc9421",
  ]);
  assert.ok(!result.success);
});

test("authorizedFetchOption - invalid when --tunnel-service is used without -a", () => {
  const result = parse(authorizedFetchOption, [
    "--tunnel-service",
    "serveo.net",
  ]);
  assert.ok(!result.success);
});

test("authorizedFetchOption - parses successfully with -a flag", () => {
  const result = parse(authorizedFetchOption, ["-a"]);
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
  const result = parse(authorizedFetchOption, [
    "-a",
    "--first-knock",
    "rfc9421",
  ]);
  assert.ok(result.success);
  if (result.success) {
    assert.strictEqual(result.value.authorizedFetch, true);
    assert.strictEqual(result.value.firstKnock, "rfc9421");
    assert.strictEqual(result.value.tunnelService, undefined);
  }
});

test("authorizedFetchOption - parses with -a and --tunnel-service", () => {
  const result = parse(authorizedFetchOption, [
    "-a",
    "--tunnel-service",
    "serveo.net",
  ]);
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
  const result = parse(lookupCommand, [
    "lookup",
    "--allow-private-address",
    "https://example.com/notes/1",
  ]);
  assert.ok(result.success);
  if (result.success) {
    assert.strictEqual(result.value.allowPrivateAddress, true);
  }
});

test("lookupCommand - reads allowPrivateAddress from config", async () => {
  const result = await parseWithConfig(
    lookupCommand,
    ["lookup", "https://example.com/notes/1"],
    { lookup: { allowPrivateAddress: true } },
  );
  assert.ok(result.success);
  if (result.success) {
    assert.strictEqual(result.value.allowPrivateAddress, true);
  }
});

test("lookupCommand - parses --reverse", () => {
  const result = parse(lookupCommand, [
    "lookup",
    "--reverse",
    "https://example.com/notes/1",
  ]);
  assert.ok(result.success);
  if (result.success) {
    assert.strictEqual(result.value.reverse, true);
  }
});

test("lookupCommand - reads reverse from config", async () => {
  const result = await parseWithConfig(
    lookupCommand,
    ["lookup", "https://example.com/notes/1"],
    { lookup: { reverse: true } },
  );
  assert.ok(result.success);
  if (result.success) {
    assert.strictEqual(result.value.reverse, true);
  }
});

test("lookupCommand - parses recurse option", () => {
  const result = parse(lookupCommand, [
    "lookup",
    "--recurse",
    "replyTarget",
    "https://example.com/notes/1",
  ]);
  assert.ok(result.success);
  if (result.success) {
    assert.strictEqual(result.value.recurse, "replyTarget");
    assert.strictEqual(result.value.recurseDepth, 20);
    assert.strictEqual(result.value.traverse, false);
  }
});

test("lookupCommand - rejects recurse-depth without recurse", () => {
  const result = parse(lookupCommand, [
    "lookup",
    "--recurse-depth",
    "10",
    "https://example.com/notes/1",
  ]);
  assert.ok(!result.success);
});

test("lookupCommand - rejects traverse with recurse", () => {
  const result = parse(lookupCommand, [
    "lookup",
    "--traverse",
    "--recurse",
    "replyTarget",
    "https://example.com/notes/1",
  ]);
  assert.ok(!result.success);
});

test("lookupCommand - rejects short-form inReplyTo", () => {
  const result = parse(lookupCommand, [
    "lookup",
    "--recurse",
    "inReplyTo",
    "https://example.com/notes/1",
  ]);
  assert.ok(!result.success);
});

test("lookupCommand - accepts IRI inReplyTo", () => {
  const result = parse(lookupCommand, [
    "lookup",
    "--recurse",
    "https://www.w3.org/ns/activitystreams#inReplyTo",
    "https://example.com/notes/1",
  ]);
  assert.ok(result.success);
  if (result.success) {
    assert.strictEqual(
      result.value.recurse,
      "https://www.w3.org/ns/activitystreams#inReplyTo",
    );
  }
});

test("lookupCommand - accepts short-form quoteUrl", () => {
  const result = parse(lookupCommand, [
    "lookup",
    "--recurse",
    "quoteUrl",
    "https://example.com/notes/1",
  ]);
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
    const result = parse(lookupCommand, [
      "lookup",
      "--recurse",
      recurseProperty,
      "https://example.com/notes/1",
    ]);
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

class ExitSignal extends Error {
  code: number;
  constructor(code: number) {
    super(`Exited with code ${code}`);
    this.code = code;
  }
}

function createLookupRunCommand(
  overrides: Partial<Parameters<typeof runLookup>[0]>,
): Parameters<typeof runLookup>[0] {
  const baseCommand = {
    command: "lookup",
    urls: [],
    traverse: false,
    recurse: undefined,
    recurseDepth: undefined,
    suppressErrors: false,
    authorizedFetch: false,
    firstKnock: undefined,
    tunnelService: undefined,
    userAgent: "FedifyTest/1.0",
    allowPrivateAddress: true,
    timeout: undefined,
    reverse: false,
    format: "raw",
    separator: "----",
    output: undefined,
    debug: false,
    ignoreConfig: false,
    configPath: undefined,
  } satisfies Parameters<typeof runLookup>[0];
  return { ...baseCommand, ...overrides } as Parameters<typeof runLookup>[0];
}

async function runLookupAndCaptureExitCode(
  command: Parameters<typeof runLookup>[0],
  deps?: Parameters<typeof runLookup>[1],
): Promise<number | null> {
  try {
    await runLookup(command, {
      ...deps,
      exit: (code: number) => {
        throw new ExitSignal(code);
      },
    });
    return null;
  } catch (error) {
    if (error instanceof ExitSignal) return error.code;
    throw error;
  }
}

function extractIdsFromRawOutput(content: string): string[] {
  return [...content.matchAll(/"id"\s*:\s*"([^"]+)"/g)].map((match) =>
    match[1]
  );
}

test("runLookup - reverses output order in default multi-input mode", async () => {
  const testDir = "./test_output_runlookup_default_reverse";
  const testFile = `${testDir}/out.jsonl`;
  await mkdir(testDir, { recursive: true });
  try {
    const objects = new Map([
      [
        "u1",
        new Note({
          id: new URL("https://example.com/notes/1"),
          content: "one",
        }),
      ],
      [
        "u2",
        new Note({
          id: new URL("https://example.com/notes/2"),
          content: "two",
        }),
      ],
      [
        "u3",
        new Note({
          id: new URL("https://example.com/notes/3"),
          content: "three",
        }),
      ],
    ]);
    const exitCode = await runLookupAndCaptureExitCode(
      createLookupRunCommand({
        urls: ["u1", "u2", "u3"],
        reverse: true,
        output: testFile,
      }),
      {
        lookupObject: (url) =>
          Promise.resolve(
            objects.get(typeof url === "string" ? url : url.href) ?? null,
          ),
        traverseCollection: () => {
          throw new Error("not used");
        },
      },
    );
    assert.equal(exitCode, null);
    const content = await readFile(testFile, "utf8");
    assert.deepEqual(extractIdsFromRawOutput(content), [
      "https://example.com/notes/3",
      "https://example.com/notes/2",
      "https://example.com/notes/1",
    ]);
  } finally {
    await rm(testDir, { recursive: true });
  }
});

test("runLookup - reverses output order in recurse mode", async () => {
  const testDir = "./test_output_runlookup_recurse_reverse";
  const testFile = `${testDir}/out.jsonl`;
  await mkdir(testDir, { recursive: true });
  try {
    const u1 = "https://lookup.test/u1";
    const u2 = "https://lookup.test/u2";
    const u3 = "https://lookup.test/u3";
    const objects = new Map([
      [
        u1,
        new Note({
          id: new URL("https://example.com/notes/1"),
          content: "one",
        }),
      ],
      [
        u2,
        new Note({
          id: new URL("https://example.com/notes/2"),
          replyTarget: new URL(u1),
          content: "two",
        }),
      ],
      [
        u3,
        new Note({
          id: new URL("https://example.com/notes/3"),
          replyTarget: new URL(u2),
          content: "three",
        }),
      ],
    ]);
    const exitCode = await runLookupAndCaptureExitCode(
      createLookupRunCommand({
        urls: [u3],
        recurse: "replyTarget",
        recurseDepth: 20,
        reverse: true,
        output: testFile,
      }),
      {
        lookupObject: (url) =>
          Promise.resolve(
            objects.get(typeof url === "string" ? url : url.href) ?? null,
          ),
        traverseCollection: () => {
          throw new Error("not used");
        },
      },
    );
    assert.equal(exitCode, 0);
    const content = await readFile(testFile, "utf8");
    assert.deepEqual(extractIdsFromRawOutput(content), [
      "https://example.com/notes/1",
      "https://example.com/notes/2",
      "https://example.com/notes/3",
    ]);
  } finally {
    await rm(testDir, { recursive: true });
  }
});

test("runLookup - reverses output order in traverse mode", async () => {
  const testDir = "./test_output_runlookup_traverse_reverse";
  const testFile = `${testDir}/out.jsonl`;
  await mkdir(testDir, { recursive: true });
  try {
    const collection = new Collection({
      id: new URL("https://example.com/collection"),
    });
    const items = [
      new Note({ id: new URL("https://example.com/items/1"), content: "one" }),
      new Note({ id: new URL("https://example.com/items/2"), content: "two" }),
      new Note({
        id: new URL("https://example.com/items/3"),
        content: "three",
      }),
    ];
    const exitCode = await runLookupAndCaptureExitCode(
      createLookupRunCommand({
        urls: ["collection-url"],
        traverse: true,
        reverse: true,
        output: testFile,
      }),
      {
        lookupObject: (url) =>
          Promise.resolve(url === "collection-url" ? collection : null),
        async *traverseCollection() {
          for (const item of items) yield item;
        },
      },
    );
    assert.equal(exitCode, 0);
    const content = await readFile(testFile, "utf8");
    assert.deepEqual(extractIdsFromRawOutput(content), [
      "https://example.com/items/3",
      "https://example.com/items/2",
      "https://example.com/items/1",
    ]);
  } finally {
    await rm(testDir, { recursive: true });
  }
});

test("runLookup - emits reversed partial items on traverse reverse failure", async () => {
  const testDir = "./test_output_runlookup_traverse_reverse_partial_failure";
  const testFile = `${testDir}/out.jsonl`;
  await mkdir(testDir, { recursive: true });
  try {
    const collection = new Collection({
      id: new URL("https://example.com/collection"),
    });
    const item1 = new Note({
      id: new URL("https://example.com/items/1"),
      content: "one",
    });
    const item2 = new Note({
      id: new URL("https://example.com/items/2"),
      content: "two",
    });
    const exitCode = await runLookupAndCaptureExitCode(
      createLookupRunCommand({
        urls: ["collection-url"],
        traverse: true,
        reverse: true,
        output: testFile,
      }),
      {
        lookupObject: (url) =>
          Promise.resolve(
            (typeof url === "string" ? url : url.href) === "collection-url"
              ? collection
              : null,
          ),
        async *traverseCollection() {
          yield item1;
          yield item2;
          throw new Error("traversal failed");
        },
      },
    );
    assert.equal(exitCode, 1);
    const content = await readFile(testFile, "utf8");
    assert.deepEqual(extractIdsFromRawOutput(content), [
      "https://example.com/items/2",
      "https://example.com/items/1",
    ]);
  } finally {
    await rm(testDir, { recursive: true });
  }
});

test("runLookup - writes separators between adjacent traversed items", async () => {
  const testDir = "./test_output_runlookup_traverse_separator";
  const testFile = `${testDir}/out.jsonl`;
  const separator = "<SEP>";
  await mkdir(testDir, { recursive: true });
  try {
    const collectionA = new Collection({
      id: new URL("https://example.com/collections/a"),
    });
    const collectionB = new Collection({
      id: new URL("https://example.com/collections/b"),
    });
    const a1 = new Note({
      id: new URL("https://example.com/items/a1"),
      content: "a1",
    });
    const a2 = new Note({
      id: new URL("https://example.com/items/a2"),
      content: "a2",
    });
    const b1 = new Note({
      id: new URL("https://example.com/items/b1"),
      content: "b1",
    });
    const exitCode = await runLookupAndCaptureExitCode(
      createLookupRunCommand({
        urls: ["collection-a", "collection-b"],
        traverse: true,
        separator,
        output: testFile,
      }),
      {
        lookupObject: (url) => {
          const key = typeof url === "string" ? url : url.href;
          if (key === "collection-a") return Promise.resolve(collectionA);
          if (key === "collection-b") return Promise.resolve(collectionB);
          return Promise.resolve(null);
        },
        async *traverseCollection(collection) {
          if (collection === collectionA) {
            yield a1;
            yield a2;
          } else if (collection === collectionB) {
            yield b1;
          }
        },
      },
    );
    assert.equal(exitCode, 0);
    const content = await readFile(testFile, "utf8");
    assert.deepEqual(extractIdsFromRawOutput(content), [
      "https://example.com/items/a1",
      "https://example.com/items/a2",
      "https://example.com/items/b1",
    ]);
    assert.equal(content.split(`${separator}\n`).length - 1, 2);
  } finally {
    await rm(testDir, { recursive: true });
  }
});

test(
  "runLookup - writes separators between adjacent traversed items in reverse mode",
  async () => {
    const testDir = "./test_output_runlookup_traverse_separator_reverse";
    const testFile = `${testDir}/out.jsonl`;
    const separator = "<SEP>";
    await mkdir(testDir, { recursive: true });
    try {
      const collectionA = new Collection({
        id: new URL("https://example.com/collections/a"),
      });
      const collectionB = new Collection({
        id: new URL("https://example.com/collections/b"),
      });
      const a1 = new Note({
        id: new URL("https://example.com/items/a1"),
        content: "a1",
      });
      const a2 = new Note({
        id: new URL("https://example.com/items/a2"),
        content: "a2",
      });
      const b1 = new Note({
        id: new URL("https://example.com/items/b1"),
        content: "b1",
      });
      const exitCode = await runLookupAndCaptureExitCode(
        createLookupRunCommand({
          urls: ["collection-a", "collection-b"],
          traverse: true,
          reverse: true,
          separator,
          output: testFile,
        }),
        {
          lookupObject: (url) => {
            const key = typeof url === "string" ? url : url.href;
            if (key === "collection-a") return Promise.resolve(collectionA);
            if (key === "collection-b") return Promise.resolve(collectionB);
            return Promise.resolve(null);
          },
          async *traverseCollection(collection) {
            if (collection === collectionA) {
              yield a1;
              yield a2;
            } else if (collection === collectionB) {
              yield b1;
            }
          },
        },
      );
      assert.equal(exitCode, 0);
      const content = await readFile(testFile, "utf8");
      assert.deepEqual(extractIdsFromRawOutput(content), [
        "https://example.com/items/a2",
        "https://example.com/items/a1",
        "https://example.com/items/b1",
      ]);
      assert.equal(content.split(`${separator}\n`).length - 1, 2);
    } finally {
      await rm(testDir, { recursive: true });
    }
  },
);

test("runLookup - emits root object on recurse reverse failure", async () => {
  const testDir = "./test_output_runlookup_recurse_reverse_partial_failure";
  const testFile = `${testDir}/out.jsonl`;
  await mkdir(testDir, { recursive: true });
  try {
    const u3 = "https://lookup.test/u3";
    const root = new Note({
      id: new URL("https://example.com/notes/3"),
      replyTarget: new URL("https://lookup.test/u2"),
      content: "three",
    });
    const exitCode = await runLookupAndCaptureExitCode(
      createLookupRunCommand({
        urls: [u3],
        recurse: "replyTarget",
        recurseDepth: 20,
        reverse: true,
        output: testFile,
      }),
      {
        lookupObject: (url) => {
          const key = typeof url === "string" ? url : url.href;
          if (key === u3) return Promise.resolve(root);
          throw new Error("recursive lookup failed");
        },
        traverseCollection: () => {
          throw new Error("not used");
        },
      },
    );
    assert.equal(exitCode, 1);
    const content = await readFile(testFile, "utf8");
    assert.deepEqual(extractIdsFromRawOutput(content), [
      "https://example.com/notes/3",
    ]);
  } finally {
    await rm(testDir, { recursive: true });
  }
});
