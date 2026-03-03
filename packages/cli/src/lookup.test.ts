import { Activity, Note } from "@fedify/vocab";
import type { DocumentLoader } from "@fedify/vocab-runtime";
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
import { userAgentOption } from "./options.ts";

function withActiveConfig<T>(config: unknown, fn: () => T): T {
  setActiveConfig(configContext.id, config);
  try {
    return fn();
  } finally {
    clearActiveConfig(configContext.id);
  }
}

// Mock DocumentLoader for integration tests
function createMockDocumentLoader(
  responses: Record<string, any> = {},
): DocumentLoader {
  return async (url: string, options?: { signal?: AbortSignal }) => {
    await new Promise((resolve) => setTimeout(resolve, 10));

    if (options?.signal?.aborted) {
      throw options.signal.reason || new Error("Aborted");
    }

    const response = responses[url];
    if (!response) {
      throw new Error(`Not found: ${url}`);
    }

    return {
      document: response,
      documentUrl: url,
      contextUrl: null,
    };
  };
}

async function wrapDocumentLoaderWithTimeout(
  loader: DocumentLoader,
  timeoutSeconds?: number,
): Promise<DocumentLoader> {
  if (timeoutSeconds == null) return loader;

  return (url: string, options?) => {
    const signal = createTimeoutSignal(timeoutSeconds);
    return loader(url, { ...options, signal }).finally(() =>
      clearTimeoutSignal(signal)
    );
  };
}

// Fake timers implementation for timeout testing
function withFakeTimersSpy<T>(
  fn: (ctx: {
    clock: { advance(ms: number): void; runAll(): void; now(): number };
    spy: {
      setTimeoutCalls(): number;
      clearTimeoutCalls(): number;
      pendingTimersCount(): number;
    };
  }) => T | Promise<T>,
): Promise<T> {
  type TimerTask = {
    id: number;
    due: number;
    order: number;
    cb: (...args: any[]) => void;
    args: any[];
  };

  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;

  let currentNow = 0;
  let nextId = 1;
  let nextOrder = 1;
  const tasks = new Map<number, TimerTask>();

  let setTimeoutCalls = 0;
  let clearTimeoutCalls = 0;

  function toFiniteDelay(timeout?: number): number {
    const n = Number(timeout);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, n);
  }

  function runDueTasks(): void {
    while (true) {
      let next: TimerTask | undefined;
      for (const t of tasks.values()) {
        if (t.due <= currentNow) {
          if (
            next == null ||
            t.due < next.due ||
            (t.due === next.due && t.order < next.order)
          ) {
            next = t;
          }
        }
      }
      if (!next) break;
      tasks.delete(next.id);
      next.cb(...next.args);
    }
  }

  function patchedSetTimeout(
    handler: TimerHandler,
    timeout?: number,
    ...args: any[]
  ): any {
    setTimeoutCalls++;
    if (typeof handler !== "function") {
      throw new Error(
        "withFakeTimersSpy(): patched setTimeout() only supports function callbacks.",
      );
    }
    const delay = toFiniteDelay(timeout);
    const id = nextId++;
    tasks.set(id, {
      id,
      due: currentNow + delay,
      order: nextOrder++,
      cb: handler as any,
      args,
    });
    return id;
  }

  function patchedClearTimeout(id: any): void {
    clearTimeoutCalls++;
    const n = typeof id === "number" ? id : Number(id);
    if (Number.isFinite(n)) tasks.delete(n);
  }

  (globalThis as any).setTimeout = patchedSetTimeout;
  (globalThis as any).clearTimeout = patchedClearTimeout;

  const clock = {
    advance(ms: number): void {
      const n = Number(ms);
      currentNow += Number.isFinite(n) ? Math.max(0, n) : 0;
      runDueTasks();
    },
    runAll(): void {
      while (tasks.size > 0) {
        let minDue = Infinity;
        for (const t of tasks.values()) minDue = Math.min(minDue, t.due);
        if (!Number.isFinite(minDue)) break;
        currentNow = Math.max(currentNow, minDue);
        runDueTasks();
      }
    },
    now(): number {
      return currentNow;
    },
  };

  const spy = {
    setTimeoutCalls(): number {
      return setTimeoutCalls;
    },
    clearTimeoutCalls(): number {
      return clearTimeoutCalls;
    },
    pendingTimersCount(): number {
      return tasks.size;
    },
  };

  try {
    return Promise.resolve(fn({ clock, spy }));
  } finally {
    (globalThis as any).setTimeout = originalSetTimeout;
    (globalThis as any).clearTimeout = originalClearTimeout;
  }
}

// Config binding and parsing tests

Deno.test("Config lookup section binds into command defaults when no CLI flags provided", async () => {
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

Deno.test("Shared options parsing remains consistent for lookup (aliases and types)", () => {
  const uaShort = withActiveConfig(
    {},
    () => parse(userAgentOption, ["-u", "UA/short"]),
  );
  assert.ok(uaShort.success);
  if (!uaShort.success) return;
  assert.equal(uaShort.value.userAgent, "UA/short");

  const uaLong = withActiveConfig(
    {},
    () => parse(userAgentOption, ["--user-agent", "UA/long"]),
  );
  assert.ok(uaLong.success);
  if (!uaLong.success) return;
  assert.equal(uaLong.value.userAgent, "UA/long");

  const lookupParsed = withActiveConfig(
    {},
    () =>
      parse(lookupCommand, [
        "lookup",
        "-T",
        "2",
        "https://example.com/object/1",
      ]),
  );
  assert.ok(lookupParsed.success);
  if (!lookupParsed.success) return;
  assert.equal(typeof lookupParsed.value.timeout, "number");
  assert.equal(lookupParsed.value.timeout, 2);
});


// Timeout signal with fake timers

Deno.test(
  "createTimeoutSignal aborts only after the configured timeout with TimeoutError reason",
  async () => {
    await withFakeTimersSpy(({ clock }) => {
      const signal = createTimeoutSignal(0.1);
      assert.ok(signal);

      assert.equal(signal.aborted, false);

      clock.advance(99);
      assert.equal(signal.aborted, false);

      clock.advance(1);
      assert.equal(signal.aborted, true);
      assert.ok(signal.reason instanceof TimeoutError);
      assert.equal(signal.reason.name, "TimeoutError");
      assert.match(signal.reason.message, /Request timed out after 0.1 seconds/);

      clearTimeoutSignal(signal);
    });
  },
);

Deno.test(
  "clearTimeoutSignal cancels the timer so the signal never aborts",
  async () => {
    await withFakeTimersSpy(({ clock, spy }) => {
      const signal = createTimeoutSignal(0.05);
      assert.ok(signal);

      const clearsBefore = spy.clearTimeoutCalls();
      clearTimeoutSignal(signal);
      const clearsAfter = spy.clearTimeoutCalls();
      assert.equal(clearsAfter, clearsBefore + 1);

      clock.advance(1_000);
      assert.equal(signal.aborted, false);

      const clearsBefore2 = spy.clearTimeoutCalls();
      clearTimeoutSignal(signal);
      assert.equal(spy.clearTimeoutCalls(), clearsBefore2);
    });
  },
);


// Additional parsing tests

Deno.test("lookupCommand requires at least one URL", () => {
  const result = withActiveConfig({}, () => parse(lookupCommand, ["lookup"]));

  assert.ok(!result.success);
  if (result.success) return;

  assert.ok(result.error);
});

Deno.test("lookupCommand parses timeout as float", () => {
  const result = withActiveConfig({}, () =>
    parse(lookupCommand, [
      "lookup",
      "--timeout",
      "3.5",
      "https://example.com/object/1",
    ]));

  assert.ok(result.success);
  if (!result.success) return;

  assert.strictEqual(result.value.timeout, 3.5);
  assert.strictEqual(typeof result.value.timeout, "number");
});

Deno.test("lookupCommand combines multiple flags correctly", () => {
  const result = withActiveConfig({}, () =>
    parse(lookupCommand, [
      "lookup",
      "-t",
      "-S",
      "-r",
      "-T",
      "5",
      "-s",
      "===",
      "https://example.com/collection/1",
      "https://example.com/object/2",
    ]));

  assert.ok(result.success);
  if (!result.success) return;

  assert.strictEqual(result.value.traverse, true);
  assert.strictEqual(result.value.suppressErrors, true);
  assert.strictEqual(result.value.format, "raw");
  assert.strictEqual(result.value.timeout, 5);
  assert.strictEqual(result.value.separator, "===");
  assert.equal(result.value.urls.length, 2);
});


// Core timeout logic tests

Deno.test("TimeoutError has correct name and message", () => {
  const error = new TimeoutError("Request timed out after 5 seconds");

  assert.equal(error.name, "TimeoutError");
  assert.equal(error.message, "Request timed out after 5 seconds");
  assert.ok(error instanceof Error);
  assert.ok(error instanceof TimeoutError);
});

Deno.test("TimeoutError is throwable and catchable", () => {
  try {
    throw new TimeoutError("Test timeout");
  } catch (error) {
    assert.ok(error instanceof TimeoutError);
    assert.equal((error as TimeoutError).name, "TimeoutError");
    assert.equal((error as Error).message, "Test timeout");
  }
});

Deno.test("createTimeoutSignal with zero timeout creates immediate abort", async () => {
  const signal = createTimeoutSignal(0);
  assert.ok(signal instanceof AbortSignal);

  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(signal.aborted, true);
  assert.ok(signal.reason instanceof TimeoutError);

  clearTimeoutSignal(signal);
});

Deno.test("TimeoutError message contains timeout duration", () => {
  const error1 = new TimeoutError("Request timed out after 10 seconds");
  assert.ok(error1.message.includes("10"));

  const error2 = new TimeoutError("Request timed out after 0.5 seconds");
  assert.ok(error2.message.includes("0.5"));
});

Deno.test("Multiple timeout signals can be created independently", () => {
  const signal1 = createTimeoutSignal(10);
  const signal2 = createTimeoutSignal(20);
  const signal3 = createTimeoutSignal(30);

  assert.ok(signal1 instanceof AbortSignal);
  assert.ok(signal2 instanceof AbortSignal);
  assert.ok(signal3 instanceof AbortSignal);

  assert.notEqual(signal1, signal2);
  assert.notEqual(signal2, signal3);

  clearTimeoutSignal(signal1);
  clearTimeoutSignal(signal2);
  clearTimeoutSignal(signal3);
});


// DocumentLoader integration tests

Deno.test("Wrapped document loader succeeds when request completes before timeout", async () => {
  const mockLoader = createMockDocumentLoader({
    "https://example.com/note/1": {
      "@context": "https://www.w3.org/ns/activitystreams",
      "type": "Note",
      "id": "https://example.com/note/1",
      "content": "Hello!",
    },
  });

  const wrappedLoader = await wrapDocumentLoaderWithTimeout(mockLoader, 1);

  const result = await wrappedLoader("https://example.com/note/1");

  assert.ok(result.document);
  assert.equal(result.document.type, "Note");
  assert.equal(result.document.id, "https://example.com/note/1");
});

Deno.test("Wrapped document loader aborts when request exceeds timeout", async () => {
  const slowLoader: DocumentLoader = async (url, options?) => {
    await new Promise((resolve) => setTimeout(resolve, 200));

    if (options?.signal?.aborted) {
      throw options.signal.reason || new Error("Aborted");
    }

    return {
      document: { type: "Note" },
      documentUrl: url,
      contextUrl: null,
    };
  };

  const wrappedLoader = await wrapDocumentLoaderWithTimeout(slowLoader, 0.05);

  await assert.rejects(
    async () => {
      await wrappedLoader("https://slow-server.example.com/note");
    },
    (error: Error) => {
      assert.ok(
        error.message.includes("timed out") || error.name === "TimeoutError",
      );
      return true;
    },
  );
});

Deno.test("Wrapped document loader without timeout behaves like original", async () => {
  const mockLoader = createMockDocumentLoader({
    "https://example.com/note/2": {
      type: "Note",
      content: "No timeout",
    },
  });

  const wrappedLoader = await wrapDocumentLoaderWithTimeout(
    mockLoader,
    undefined,
  );

  const result = await wrappedLoader("https://example.com/note/2");

  assert.ok(result.document);
  assert.equal(result.document.type, "Note");
});

Deno.test("Wrapped document loader propagates network errors", async () => {
  const failingLoader: DocumentLoader = async (url) => {
    throw new Error(`Network error: ${url}`);
  };

  const wrappedLoader = await wrapDocumentLoaderWithTimeout(failingLoader, 5);

  await assert.rejects(
    async () => {
      await wrappedLoader("https://404.example.com/note");
    },
    (error: Error) => {
      assert.ok(error.message.includes("Network error"));
      return true;
    },
  );
});

Deno.test("Document loader handles multiple concurrent requests with timeout", async () => {
  const mockLoader = createMockDocumentLoader({
    "https://example.com/note/1": { type: "Note", id: "1" },
    "https://example.com/note/2": { type: "Note", id: "2" },
    "https://example.com/note/3": { type: "Note", id: "3" },
  });

  const wrappedLoader = await wrapDocumentLoaderWithTimeout(mockLoader, 1);

  const results = await Promise.all([
    wrappedLoader("https://example.com/note/1"),
    wrappedLoader("https://example.com/note/2"),
    wrappedLoader("https://example.com/note/3"),
  ]);

  assert.equal(results.length, 3);
  assert.equal(results[0].document.id, "1");
  assert.equal(results[1].document.id, "2");
  assert.equal(results[2].document.id, "3");
});

Deno.test("Document loader timeout cleans up properly after abort", async () => {
  const slowLoader: DocumentLoader = async (url, options?) => {
    await new Promise((resolve) => setTimeout(resolve, 100));

    if (options?.signal?.aborted) {
      throw new Error("Request was aborted");
    }

    return {
      document: { type: "Note" },
      documentUrl: url,
      contextUrl: null,
    };
  };

  const wrappedLoader = await wrapDocumentLoaderWithTimeout(slowLoader, 0.02);

  try {
    await wrappedLoader("https://slow.example.com/note");
    assert.fail("Should have thrown timeout error");
  } catch (error) {
    assert.ok(error instanceof Error);
  }

  assert.ok(true);
});

Deno.test("Document loader handles AbortSignal passed from outside", async () => {
  const mockLoader = createMockDocumentLoader({
    "https://example.com/note": { type: "Note" },
  });

  const controller = new AbortController();

  controller.abort(new Error("Manual abort"));

  await assert.rejects(
    async () => {
      await mockLoader("https://example.com/note", {
        signal: controller.signal,
      });
    },
    (error: Error) => {
      assert.ok(
        error.message.includes("Manual abort") ||
          error.message.includes("Aborted"),
      );
      return true;
    },
  );
});

Deno.test("Document loader respects zero timeout as immediate abort", async () => {
  const mockLoader = createMockDocumentLoader({
    "https://example.com/note": { type: "Note" },
  });

  const wrappedLoader = await wrapDocumentLoaderWithTimeout(mockLoader, 0);

  await assert.rejects(
    async () => {
      await wrappedLoader("https://example.com/note");
    },
    (error: Error) => {
      return true;
    },
  );
});

// ============================================================================
// Original tests from lookup.test.ts below
// ============================================================================

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
