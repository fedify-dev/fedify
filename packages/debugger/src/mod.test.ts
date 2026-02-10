import { test } from "@fedify/fixture";
import {
  assert,
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
} from "@std/assert";
import { createFederationDebugger } from "./mod.tsx";
import type {
  Federation,
  FederationFetchOptions,
  FederationStartQueueOptions,
} from "@fedify/fedify/federation";
import type {
  FedifySpanExporter,
  TraceActivityRecord,
  TraceSummary,
} from "@fedify/fedify/otel";
import { trace } from "@opentelemetry/api";

function createMockExporter(
  traces: TraceSummary[] = [],
  activities: TraceActivityRecord[] = [],
): FedifySpanExporter {
  return {
    export(_spans: unknown, resultCallback: (result: unknown) => void) {
      resultCallback({ code: 0 });
    },
    forceFlush() {
      return Promise.resolve();
    },
    shutdown() {
      return Promise.resolve();
    },
    getRecentTraces() {
      return Promise.resolve(traces);
    },
    getActivitiesByTraceId(_traceId: string) {
      return Promise.resolve(activities);
    },
  } as unknown as FedifySpanExporter;
}

function createMockFederation(): {
  federation: Federation<void>;
  calls: Record<string, unknown[][]>;
} {
  const calls: Record<string, unknown[][]> = {};

  function track(name: string) {
    if (!calls[name]) calls[name] = [];
    // deno-lint-ignore no-explicit-any
    return (...args: any[]) => {
      calls[name].push(args);
      if (name === "fetch") {
        const request = args[0] as Request;
        const options = args[1] as FederationFetchOptions<void>;
        if (options.onNotFound) {
          return options.onNotFound(request);
        }
        return new Response("Federation response", { status: 200 });
      }
      if (name === "startQueue") return Promise.resolve();
      if (name === "processQueuedTask") return Promise.resolve();
      if (name === "createContext") return { data: "mock-context" };
      return { setCounter: () => ({}) };
    };
  }

  const federation = {
    setNodeInfoDispatcher: track("setNodeInfoDispatcher"),
    setWebFingerLinksDispatcher: track("setWebFingerLinksDispatcher"),
    setActorDispatcher: track("setActorDispatcher"),
    setObjectDispatcher: track("setObjectDispatcher"),
    setInboxDispatcher: track("setInboxDispatcher"),
    setOutboxDispatcher: track("setOutboxDispatcher"),
    setFollowingDispatcher: track("setFollowingDispatcher"),
    setFollowersDispatcher: track("setFollowersDispatcher"),
    setLikedDispatcher: track("setLikedDispatcher"),
    setFeaturedDispatcher: track("setFeaturedDispatcher"),
    setFeaturedTagsDispatcher: track("setFeaturedTagsDispatcher"),
    setInboxListeners: track("setInboxListeners"),
    setCollectionDispatcher: track("setCollectionDispatcher"),
    setOrderedCollectionDispatcher: track("setOrderedCollectionDispatcher"),
    setOutboxPermanentFailureHandler: track(
      "setOutboxPermanentFailureHandler",
    ),
    startQueue: track("startQueue"),
    processQueuedTask: track("processQueuedTask"),
    createContext: track("createContext"),
    fetch: track("fetch"),
  } as unknown as Federation<void>;

  return { federation, calls };
}

test("createFederationDebugger returns a Federation object", () => {
  const { federation } = createMockFederation();
  const exporter = createMockExporter();
  const dbg = createFederationDebugger(federation, { exporter });
  assertNotEquals(dbg, null);
  assertNotEquals(dbg, undefined);
  assertEquals(typeof dbg.fetch, "function");
  assertEquals(typeof dbg.startQueue, "function");
  assertEquals(typeof dbg.processQueuedTask, "function");
  assertEquals(typeof dbg.createContext, "function");
});

test("createFederationDebugger delegates startQueue", async () => {
  const { federation, calls } = createMockFederation();
  const exporter = createMockExporter();
  const dbg = createFederationDebugger(federation, { exporter });
  const options: FederationStartQueueOptions = { signal: undefined };
  await dbg.startQueue(undefined, options);
  assertEquals(calls["startQueue"]?.length, 1);
  assertEquals(calls["startQueue"]![0]![0], undefined);
  assertEquals(calls["startQueue"]![0]![1], options);
});

test("createFederationDebugger delegates processQueuedTask", async () => {
  const { federation, calls } = createMockFederation();
  const exporter = createMockExporter();
  const dbg = createFederationDebugger(federation, { exporter });
  const message = { type: "test" };
  await dbg.processQueuedTask(
    undefined,
    message as unknown as import("@fedify/fedify/federation").Message,
  );
  assertEquals(calls["processQueuedTask"]?.length, 1);
  assertEquals(calls["processQueuedTask"]![0]![1], message);
});

test("createFederationDebugger delegates createContext", () => {
  const { federation, calls } = createMockFederation();
  const exporter = createMockExporter();
  const dbg = createFederationDebugger(federation, { exporter });
  const url = new URL("https://example.com");
  dbg.createContext(url, undefined);
  assertEquals(calls["createContext"]?.length, 1);
  assertEquals(calls["createContext"]![0]![0], url);
});

test("createFederationDebugger delegates setActorDispatcher", () => {
  const { federation, calls } = createMockFederation();
  const exporter = createMockExporter();
  const dbg = createFederationDebugger(federation, { exporter });
  const dispatcher = () => null;
  dbg.setActorDispatcher("/users/{identifier}", dispatcher);
  assertEquals(calls["setActorDispatcher"]?.length, 1);
  assertEquals(calls["setActorDispatcher"]![0]![0], "/users/{identifier}");
  assertEquals(calls["setActorDispatcher"]![0]![1], dispatcher);
});

test("fetch delegates non-debug requests to inner federation", async () => {
  const { federation, calls } = createMockFederation();
  const exporter = createMockExporter();
  const dbg = createFederationDebugger(federation, { exporter });
  const request = new Request("https://example.com/users/alice");
  const response = await dbg.fetch(request, { contextData: undefined });
  assertEquals(calls["fetch"]?.length, 1);
  assertEquals(response.status, 200);
  assertEquals(await response.text(), "Federation response");
});

test("fetch intercepts debug path prefix requests", async () => {
  const { federation, calls } = createMockFederation();
  const exporter = createMockExporter();
  const dbg = createFederationDebugger(federation, { exporter });
  const request = new Request("https://example.com/__debug__/");
  const response = await dbg.fetch(request, { contextData: undefined });
  // The debug request should NOT be forwarded to inner federation
  assertEquals(calls["fetch"]?.length ?? 0, 0);
  assertEquals(response.status, 200);
});

test("fetch intercepts custom debug path prefix", async () => {
  const { federation } = createMockFederation();
  const exporter = createMockExporter();
  const dbg = createFederationDebugger(federation, {
    exporter,
    path: "/__my_debug__",
  });
  const request = new Request("https://example.com/__my_debug__/");
  const response = await dbg.fetch(request, { contextData: undefined });
  assertEquals(response.status, 200);
});

test("JSON API returns traces", async () => {
  const traces: TraceSummary[] = [
    {
      traceId: "abcdef1234567890abcdef1234567890",
      timestamp: "2026-01-01T00:00:00Z",
      activityCount: 3,
      activityTypes: ["Create", "Follow"],
    },
  ];
  const { federation } = createMockFederation();
  const exporter = createMockExporter(traces);
  const dbg = createFederationDebugger(federation, { exporter });
  const request = new Request("https://example.com/__debug__/api/traces");
  const response = await dbg.fetch(request, { contextData: undefined });
  assertEquals(response.status, 200);
  assertEquals(
    response.headers.get("content-type"),
    "application/json",
  );
  const body = await response.json() as TraceSummary[];
  assertEquals(body.length, 1);
  assertEquals(body[0].traceId, "abcdef1234567890abcdef1234567890");
  assertEquals(body[0].activityCount, 3);
});

test("fetch passes through onNotFound for non-debug requests", async () => {
  const { federation } = createMockFederation();
  const exporter = createMockExporter();
  const dbg = createFederationDebugger(federation, { exporter });
  let notFoundCalled = false;
  const request = new Request("https://example.com/unknown");
  const response = await dbg.fetch(request, {
    contextData: undefined,
    onNotFound: () => {
      notFoundCalled = true;
      return new Response("Custom Not Found", { status: 404 });
    },
  });
  assertEquals(notFoundCalled, true);
  assertEquals(response.status, 404);
  assertEquals(await response.text(), "Custom Not Found");
});

test("traces list page returns HTML with trace IDs", async () => {
  const traces: TraceSummary[] = [
    {
      traceId: "abcdef1234567890abcdef1234567890",
      timestamp: "2026-01-01T00:00:00Z",
      activityCount: 2,
      activityTypes: ["Create", "Follow"],
    },
    {
      traceId: "1234567890abcdef1234567890abcdef",
      timestamp: "2026-01-02T00:00:00Z",
      activityCount: 1,
      activityTypes: ["Like"],
    },
  ];
  const { federation } = createMockFederation();
  const exporter = createMockExporter(traces);
  const dbg = createFederationDebugger(federation, { exporter });
  const request = new Request("https://example.com/__debug__/");
  const response = await dbg.fetch(request, { contextData: undefined });
  assertEquals(response.status, 200);
  const ct = response.headers.get("content-type") ?? "";
  assert(ct.includes("text/html"), `Expected text/html, got ${ct}`);
  const html = await response.text();
  assertStringIncludes(html, "Fedify Debug Dashboard");
  // Check that truncated trace IDs appear
  assertStringIncludes(html, "abcdef12");
  assertStringIncludes(html, "12345678");
  // Check activity types are shown
  assertStringIncludes(html, "Create");
  assertStringIncludes(html, "Follow");
  assertStringIncludes(html, "Like");
  // Check trace count
  assertStringIncludes(html, "<strong>2</strong>");
});

test("traces list page shows empty message when no traces", async () => {
  const { federation } = createMockFederation();
  const exporter = createMockExporter();
  const dbg = createFederationDebugger(federation, { exporter });
  const request = new Request("https://example.com/__debug__/");
  const response = await dbg.fetch(request, { contextData: undefined });
  assertEquals(response.status, 200);
  const html = await response.text();
  assertStringIncludes(html, "No traces captured yet.");
  assertStringIncludes(html, "<strong>0</strong>");
});

test("trace detail page returns HTML with activity details", async () => {
  const activities: TraceActivityRecord[] = [
    {
      traceId: "abcdef1234567890abcdef1234567890",
      spanId: "span123abc",
      direction: "inbound",
      activityType: "Create",
      activityId: "https://remote.example/activities/1",
      actorId: "https://remote.example/users/alice",
      activityJson:
        '{"type":"Create","actor":"https://remote.example/users/alice"}',
      verified: true,
      signatureDetails: {
        httpSignaturesVerified: true,
        httpSignaturesKeyId: "https://remote.example/users/alice#main-key",
        ldSignaturesVerified: false,
      },
      timestamp: "2026-01-01T00:00:00Z",
    },
    {
      traceId: "abcdef1234567890abcdef1234567890",
      spanId: "span456def",
      direction: "outbound",
      activityType: "Accept",
      actorId: "https://local.example/users/bob",
      activityJson: '{"type":"Accept"}',
      timestamp: "2026-01-01T00:00:01Z",
      inboxUrl: "https://remote.example/inbox",
    },
  ];
  const { federation } = createMockFederation();
  const exporter = createMockExporter([], activities);
  const dbg = createFederationDebugger(federation, { exporter });
  const request = new Request(
    "https://example.com/__debug__/traces/abcdef1234567890abcdef1234567890",
  );
  const response = await dbg.fetch(request, { contextData: undefined });
  assertEquals(response.status, 200);
  const ct = response.headers.get("content-type") ?? "";
  assert(ct.includes("text/html"), `Expected text/html, got ${ct}`);
  const html = await response.text();
  // Check page title
  assertStringIncludes(html, "Trace abcdef12");
  // Check activity types shown
  assertStringIncludes(html, "Create");
  assertStringIncludes(html, "Accept");
  // Check direction badges
  assertStringIncludes(html, "inbound");
  assertStringIncludes(html, "outbound");
  // Check actor IDs
  assertStringIncludes(html, "https://remote.example/users/alice");
  assertStringIncludes(html, "https://local.example/users/bob");
  // Check activity ID
  assertStringIncludes(html, "https://remote.example/activities/1");
  // Check signature details
  assertStringIncludes(
    html,
    "https://remote.example/users/alice#main-key",
  );
  // Check inbox URL for outbound
  assertStringIncludes(html, "https://remote.example/inbox");
  // Check back link
  assertStringIncludes(html, "Back to traces");
});

test("trace detail page shows empty message when no activities", async () => {
  const { federation } = createMockFederation();
  const exporter = createMockExporter([], []);
  const dbg = createFederationDebugger(federation, { exporter });
  const request = new Request(
    "https://example.com/__debug__/traces/0000000000000000",
  );
  const response = await dbg.fetch(request, { contextData: undefined });
  assertEquals(response.status, 200);
  const html = await response.text();
  assertStringIncludes(html, "No activities found for this trace.");
});

// ---------- Simplified overload tests ----------

test("simplified overload returns Federation without exporter", () => {
  // Save original global tracer provider to restore later
  const originalProvider = trace.getTracerProvider();
  try {
    const { federation } = createMockFederation();
    const dbg = createFederationDebugger(federation);
    assertNotEquals(dbg, null);
    assertNotEquals(dbg, undefined);
    assertEquals(typeof dbg.fetch, "function");
    assertEquals(typeof dbg.startQueue, "function");
  } finally {
    // Restore original provider
    trace.setGlobalTracerProvider(originalProvider);
  }
});

test("simplified overload registers a global TracerProvider", () => {
  // Disable any existing global provider first
  trace.disable();
  try {
    const { federation } = createMockFederation();
    // Before: the global provider should return a noop tracer
    const _noopTracer = trace.getTracer("test-before");
    createFederationDebugger(federation);
    // After: the global provider should return a real tracer backed by
    // BasicTracerProvider.  We verify by checking the tracer can start spans.
    const tracer = trace.getTracer("test-after");
    assertNotEquals(tracer, null);
    assertNotEquals(tracer, undefined);
    // The tracer should be functional (not a noop)
    const span = tracer.startSpan("test-span");
    assertNotEquals(span, null);
    // Span should have a valid spanContext with non-zero traceId
    const ctx = span.spanContext();
    assertNotEquals(ctx.traceId, "00000000000000000000000000000000");
    span.end();
  } finally {
    trace.disable();
  }
});

test("simplified overload serves debug dashboard", async () => {
  const originalProvider = trace.getTracerProvider();
  try {
    const { federation } = createMockFederation();
    const dbg = createFederationDebugger(federation);
    const request = new Request("https://example.com/__debug__/");
    const response = await dbg.fetch(request, { contextData: undefined });
    assertEquals(response.status, 200);
    const ct = response.headers.get("content-type") ?? "";
    assert(ct.includes("text/html"), `Expected text/html, got ${ct}`);
    const html = await response.text();
    assertStringIncludes(html, "Fedify Debug Dashboard");
  } finally {
    trace.setGlobalTracerProvider(originalProvider);
  }
});

test("simplified overload with custom path", async () => {
  const originalProvider = trace.getTracerProvider();
  try {
    const { federation } = createMockFederation();
    const dbg = createFederationDebugger(federation, { path: "/_dbg" });
    const request = new Request("https://example.com/_dbg/");
    const response = await dbg.fetch(request, { contextData: undefined });
    assertEquals(response.status, 200);
    const ct = response.headers.get("content-type") ?? "";
    assert(ct.includes("text/html"), `Expected text/html, got ${ct}`);
  } finally {
    trace.setGlobalTracerProvider(originalProvider);
  }
});

test("simplified overload delegates non-debug requests", async () => {
  const originalProvider = trace.getTracerProvider();
  try {
    const { federation, calls } = createMockFederation();
    const dbg = createFederationDebugger(federation);
    const request = new Request("https://example.com/users/alice");
    const response = await dbg.fetch(request, { contextData: undefined });
    assertEquals(calls["fetch"]?.length, 1);
    assertEquals(response.status, 200);
    assertEquals(await response.text(), "Federation response");
  } finally {
    trace.setGlobalTracerProvider(originalProvider);
  }
});

test("simplified overload JSON API returns traces", async () => {
  const originalProvider = trace.getTracerProvider();
  try {
    const { federation } = createMockFederation();
    const dbg = createFederationDebugger(federation);
    const request = new Request("https://example.com/__debug__/api/traces");
    const response = await dbg.fetch(request, { contextData: undefined });
    assertEquals(response.status, 200);
    assertEquals(
      response.headers.get("content-type"),
      "application/json",
    );
    const body = await response.json() as TraceSummary[];
    // Should return empty array since no spans have been exported
    assertEquals(body.length, 0);
  } finally {
    trace.setGlobalTracerProvider(originalProvider);
  }
});
