import { notStrictEqual, ok, strictEqual, throws } from "node:assert/strict";
import { test } from "node:test";
import { createFederationDebugger, resetAutoSetup } from "@fedify/debugger";
import type {
  FederationDebuggerAuth,
  SerializedLogRecord,
} from "@fedify/debugger";
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
  notStrictEqual(dbg, null);
  notStrictEqual(dbg, undefined);
  strictEqual(typeof dbg.fetch, "function");
  strictEqual(typeof dbg.startQueue, "function");
  strictEqual(typeof dbg.processQueuedTask, "function");
  strictEqual(typeof dbg.createContext, "function");
});

test("createFederationDebugger delegates startQueue", async () => {
  const { federation, calls } = createMockFederation();
  const exporter = createMockExporter();
  const dbg = createFederationDebugger(federation, { exporter });
  const options: FederationStartQueueOptions = { signal: undefined };
  await dbg.startQueue(undefined, options);
  strictEqual(calls["startQueue"]?.length, 1);
  strictEqual(calls["startQueue"]![0]![0], undefined);
  strictEqual(calls["startQueue"]![0]![1], options);
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
  strictEqual(calls["processQueuedTask"]?.length, 1);
  strictEqual(calls["processQueuedTask"]![0]![1], message);
});

test("createFederationDebugger delegates createContext", () => {
  const { federation, calls } = createMockFederation();
  const exporter = createMockExporter();
  const dbg = createFederationDebugger(federation, { exporter });
  const url = new URL("https://example.com");
  dbg.createContext(url, undefined);
  strictEqual(calls["createContext"]?.length, 1);
  strictEqual(calls["createContext"]![0]![0], url);
});

test("createFederationDebugger delegates setActorDispatcher", () => {
  const { federation, calls } = createMockFederation();
  const exporter = createMockExporter();
  const dbg = createFederationDebugger(federation, { exporter });
  const dispatcher = () => null;
  dbg.setActorDispatcher("/users/{identifier}", dispatcher);
  strictEqual(calls["setActorDispatcher"]?.length, 1);
  strictEqual(calls["setActorDispatcher"]![0]![0], "/users/{identifier}");
  strictEqual(calls["setActorDispatcher"]![0]![1], dispatcher);
});

test("fetch delegates non-debug requests to inner federation", async () => {
  const { federation, calls } = createMockFederation();
  const exporter = createMockExporter();
  const dbg = createFederationDebugger(federation, { exporter });
  const request = new Request("https://example.com/users/alice");
  const response = await dbg.fetch(request, { contextData: undefined });
  strictEqual(calls["fetch"]?.length, 1);
  strictEqual(response.status, 200);
  strictEqual(await response.text(), "Federation response");
});

test("fetch intercepts debug path prefix requests", async () => {
  const { federation, calls } = createMockFederation();
  const exporter = createMockExporter();
  const dbg = createFederationDebugger(federation, { exporter });
  const request = new Request("https://example.com/__debug__/");
  const response = await dbg.fetch(request, { contextData: undefined });
  // The debug request should NOT be forwarded to inner federation
  strictEqual(calls["fetch"]?.length ?? 0, 0);
  strictEqual(response.status, 200);
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
  strictEqual(response.status, 200);
});

// ---------- Path validation tests ----------

test("path validation: empty string throws TypeError", () => {
  const { federation } = createMockFederation();
  const exporter = createMockExporter();
  throws(
    () => createFederationDebugger(federation, { exporter, path: "" }),
    TypeError,
  );
});

test("path validation: path without leading slash throws TypeError", () => {
  const { federation } = createMockFederation();
  const exporter = createMockExporter();
  throws(
    () => createFederationDebugger(federation, { exporter, path: "debug" }),
    TypeError,
  );
});

test("path validation: path with control characters throws TypeError", () => {
  const { federation } = createMockFederation();
  const exporter = createMockExporter();
  throws(
    () =>
      createFederationDebugger(federation, {
        exporter,
        path: "/debug\x00path",
      }),
    TypeError,
  );
});

test("path validation: path with semicolon throws TypeError", () => {
  const { federation } = createMockFederation();
  const exporter = createMockExporter();
  throws(
    () =>
      createFederationDebugger(federation, { exporter, path: "/debug;bad" }),
    TypeError,
  );
});

test("path validation: path with comma throws TypeError", () => {
  const { federation } = createMockFederation();
  const exporter = createMockExporter();
  throws(
    () =>
      createFederationDebugger(federation, { exporter, path: "/debug,bad" }),
    TypeError,
  );
});

test("path validation: trailing slash is stripped", async () => {
  const { federation } = createMockFederation();
  const exporter = createMockExporter();
  const dbg = createFederationDebugger(federation, {
    exporter,
    path: "/__debug__/",
  });
  // The trailing slash should be normalized away, so /__debug__/ still works
  const request = new Request("https://example.com/__debug__/");
  const response = await dbg.fetch(request, { contextData: undefined });
  strictEqual(response.status, 200);
});

test("path validation: valid path is accepted", () => {
  const { federation } = createMockFederation();
  const exporter = createMockExporter();
  // Should not throw
  const dbg = createFederationDebugger(federation, {
    exporter,
    path: "/my-debug_panel",
  });
  notStrictEqual(dbg, null);
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
  strictEqual(response.status, 200);
  strictEqual(
    response.headers.get("content-type"),
    "application/json",
  );
  const body = await response.json() as TraceSummary[];
  strictEqual(body.length, 1);
  strictEqual(body[0].traceId, "abcdef1234567890abcdef1234567890");
  strictEqual(body[0].activityCount, 3);
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
  strictEqual(notFoundCalled, true);
  strictEqual(response.status, 404);
  strictEqual(await response.text(), "Custom Not Found");
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
  strictEqual(response.status, 200);
  const ct = response.headers.get("content-type") ?? "";
  ok(ct.includes("text/html"), `Expected text/html, got ${ct}`);
  const html = await response.text();
  ok(html.includes("Fedify Debug Dashboard"));
  // Check that truncated trace IDs appear
  ok(html.includes("abcdef12"));
  ok(html.includes("12345678"));
  // Check activity types are shown
  ok(html.includes("Create"));
  ok(html.includes("Follow"));
  ok(html.includes("Like"));
  // Check trace count
  ok(html.includes("<strong>2</strong>"));
});

test("traces list page shows empty message when no traces", async () => {
  const { federation } = createMockFederation();
  const exporter = createMockExporter();
  const dbg = createFederationDebugger(federation, { exporter });
  const request = new Request("https://example.com/__debug__/");
  const response = await dbg.fetch(request, { contextData: undefined });
  strictEqual(response.status, 200);
  const html = await response.text();
  ok(html.includes("No traces captured yet."));
  ok(html.includes("<strong>0</strong>"));
});

test("traces list page escapes pathPrefix in inline script", async () => {
  const { federation } = createMockFederation();
  const exporter = createMockExporter();
  const malicious = '/__debug__"></script><img src=x onerror=alert(1)>';
  const dbg = createFederationDebugger(federation, {
    exporter,
    path: malicious,
  });
  const request = new Request("https://example.com" + malicious + "/");
  const response = await dbg.fetch(request, { contextData: undefined });
  strictEqual(response.status, 200);
  const html = await response.text();
  // The malicious pathPrefix must not appear unescaped in the inline script;
  // it should be JSON-encoded with < escaped as \u003c to prevent breaking
  // out of the <script> tag.
  ok(
    !html.includes("onerror=alert(1)>"),
    "Malicious pathPrefix should be escaped in inline script",
  );
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
  strictEqual(response.status, 200);
  const ct = response.headers.get("content-type") ?? "";
  ok(ct.includes("text/html"), `Expected text/html, got ${ct}`);
  const html = await response.text();
  // Check page title
  ok(html.includes("Trace abcdef12"));
  // Check activity types shown
  ok(html.includes("Create"));
  ok(html.includes("Accept"));
  // Check direction badges
  ok(html.includes("inbound"));
  ok(html.includes("outbound"));
  // Check actor IDs
  ok(html.includes("https://remote.example/users/alice"));
  ok(html.includes("https://local.example/users/bob"));
  // Check activity ID
  ok(html.includes("https://remote.example/activities/1"));
  // Check signature details
  ok(html.includes("https://remote.example/users/alice#main-key"));
  // Check inbox URL for outbound
  ok(html.includes("https://remote.example/inbox"));
  // Check back link
  ok(html.includes("Back to traces"));
});

test("trace detail page shows empty message when no activities", async () => {
  const { federation } = createMockFederation();
  const exporter = createMockExporter([], []);
  const dbg = createFederationDebugger(federation, { exporter });
  const request = new Request(
    "https://example.com/__debug__/traces/0000000000000000",
  );
  const response = await dbg.fetch(request, { contextData: undefined });
  strictEqual(response.status, 200);
  const html = await response.text();
  ok(html.includes("No activities found for this trace."));
});

// ---------- Simplified overload tests ----------

test("simplified overload returns Federation without exporter", () => {
  // Save original global tracer provider to restore later
  const originalProvider = trace.getTracerProvider();
  resetAutoSetup();
  try {
    const { federation } = createMockFederation();
    const dbg = createFederationDebugger(federation);
    notStrictEqual(dbg, null);
    notStrictEqual(dbg, undefined);
    strictEqual(typeof dbg.fetch, "function");
    strictEqual(typeof dbg.startQueue, "function");
  } finally {
    // Restore original provider
    trace.setGlobalTracerProvider(originalProvider);
    resetAutoSetup();
  }
});

test("simplified overload registers a global TracerProvider", () => {
  // Disable any existing global provider first
  trace.disable();
  resetAutoSetup();
  try {
    const { federation } = createMockFederation();
    // Before: the global provider should return a noop tracer
    const _noopTracer = trace.getTracer("test-before");
    createFederationDebugger(federation);
    // After: the global provider should return a real tracer backed by
    // BasicTracerProvider.  We verify by checking the tracer can start spans.
    const tracer = trace.getTracer("test-after");
    notStrictEqual(tracer, null);
    notStrictEqual(tracer, undefined);
    // The tracer should be functional (not a noop)
    const span = tracer.startSpan("test-span");
    notStrictEqual(span, null);
    // Span should have a valid spanContext with non-zero traceId
    const ctx = span.spanContext();
    notStrictEqual(ctx.traceId, "00000000000000000000000000000000");
    span.end();
  } finally {
    trace.disable();
    resetAutoSetup();
  }
});

test("simplified overload serves debug dashboard", async () => {
  const originalProvider = trace.getTracerProvider();
  resetAutoSetup();
  try {
    const { federation } = createMockFederation();
    const dbg = createFederationDebugger(federation);
    const request = new Request("https://example.com/__debug__/");
    const response = await dbg.fetch(request, { contextData: undefined });
    strictEqual(response.status, 200);
    const ct = response.headers.get("content-type") ?? "";
    ok(ct.includes("text/html"), `Expected text/html, got ${ct}`);
    const html = await response.text();
    ok(html.includes("Fedify Debug Dashboard"));
  } finally {
    trace.setGlobalTracerProvider(originalProvider);
    resetAutoSetup();
  }
});

test("simplified overload with custom path", async () => {
  const originalProvider = trace.getTracerProvider();
  resetAutoSetup();
  try {
    const { federation } = createMockFederation();
    const dbg = createFederationDebugger(federation, { path: "/_dbg" });
    const request = new Request("https://example.com/_dbg/");
    const response = await dbg.fetch(request, { contextData: undefined });
    strictEqual(response.status, 200);
    const ct = response.headers.get("content-type") ?? "";
    ok(ct.includes("text/html"), `Expected text/html, got ${ct}`);
  } finally {
    trace.setGlobalTracerProvider(originalProvider);
    resetAutoSetup();
  }
});

test("simplified overload delegates non-debug requests", async () => {
  const originalProvider = trace.getTracerProvider();
  resetAutoSetup();
  try {
    const { federation, calls } = createMockFederation();
    const dbg = createFederationDebugger(federation);
    const request = new Request("https://example.com/users/alice");
    const response = await dbg.fetch(request, { contextData: undefined });
    strictEqual(calls["fetch"]?.length, 1);
    strictEqual(response.status, 200);
    strictEqual(await response.text(), "Federation response");
  } finally {
    trace.setGlobalTracerProvider(originalProvider);
    resetAutoSetup();
  }
});

test("simplified overload JSON API returns traces", async () => {
  const originalProvider = trace.getTracerProvider();
  resetAutoSetup();
  try {
    const { federation } = createMockFederation();
    const dbg = createFederationDebugger(federation);
    const request = new Request("https://example.com/__debug__/api/traces");
    const response = await dbg.fetch(request, { contextData: undefined });
    strictEqual(response.status, 200);
    strictEqual(
      response.headers.get("content-type"),
      "application/json",
    );
    const body = await response.json() as TraceSummary[];
    // Should return empty array since no spans have been exported
    strictEqual(body.length, 0);
  } finally {
    trace.setGlobalTracerProvider(originalProvider);
    resetAutoSetup();
  }
});

// ---------- Auth: password (static) tests ----------

test("auth password static: unauthenticated request shows login form", async () => {
  const { federation } = createMockFederation();
  const exporter = createMockExporter();
  const auth: FederationDebuggerAuth = {
    type: "password",
    password: "secret123",
  };
  const dbg = createFederationDebugger(federation, { exporter, auth });
  const request = new Request("https://example.com/__debug__/");
  const response = await dbg.fetch(request, { contextData: undefined });
  strictEqual(response.status, 401);
  const html = await response.text();
  ok(html.includes("Login Required"));
  ok(html.includes('name="password"'));
  // Should NOT have a username field for password-only mode
  ok(!html.includes('name="username"'), "Should not have username field");
});

test("auth password static: correct password sets session cookie", async () => {
  const { federation } = createMockFederation();
  const exporter = createMockExporter();
  const auth: FederationDebuggerAuth = {
    type: "password",
    password: "secret123",
  };
  const dbg = createFederationDebugger(federation, { exporter, auth });
  const body = new URLSearchParams({ password: "secret123" });
  const request = new Request("https://example.com/__debug__/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const response = await dbg.fetch(request, { contextData: undefined });
  strictEqual(response.status, 303);
  const location = response.headers.get("location");
  strictEqual(location, "/__debug__/");
  const setCookie = response.headers.get("set-cookie");
  ok(setCookie != null, "Should set a cookie");
  ok(setCookie!.includes("__fedify_debug_session="));
  ok(
    setCookie!.includes("; Secure"),
    "HTTPS login cookie should include Secure",
  );
});

test("auth password static: login cookie omits Secure on HTTP", async () => {
  const { federation } = createMockFederation();
  const exporter = createMockExporter();
  const auth: FederationDebuggerAuth = {
    type: "password",
    password: "secret123",
  };
  const dbg = createFederationDebugger(federation, { exporter, auth });
  const body = new URLSearchParams({ password: "secret123" });
  const request = new Request("http://example.com/__debug__/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const response = await dbg.fetch(request, { contextData: undefined });
  strictEqual(response.status, 303);
  const setCookie = response.headers.get("set-cookie");
  ok(setCookie != null, "Should set a cookie");
  ok(
    !setCookie!.includes("; Secure"),
    "HTTP login cookie should not include Secure",
  );
});

test("auth password static: wrong password shows error", async () => {
  const { federation } = createMockFederation();
  const exporter = createMockExporter();
  const auth: FederationDebuggerAuth = {
    type: "password",
    password: "secret123",
  };
  const dbg = createFederationDebugger(federation, { exporter, auth });
  const body = new URLSearchParams({ password: "wrong" });
  const request = new Request("https://example.com/__debug__/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const response = await dbg.fetch(request, { contextData: undefined });
  strictEqual(response.status, 401);
  const html = await response.text();
  ok(html.includes("Invalid credentials."));
});

// ---------- Auth: password (callback) tests ----------

test("auth password callback: authenticate function is called", async () => {
  const { federation } = createMockFederation();
  const exporter = createMockExporter();
  let receivedPassword = "";
  const auth: FederationDebuggerAuth = {
    type: "password",
    authenticate(password: string) {
      receivedPassword = password;
      return password === "callback-pw";
    },
  };
  const dbg = createFederationDebugger(federation, { exporter, auth });
  const body = new URLSearchParams({ password: "callback-pw" });
  const request = new Request("https://example.com/__debug__/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const response = await dbg.fetch(request, { contextData: undefined });
  strictEqual(response.status, 303);
  strictEqual(receivedPassword, "callback-pw");
});

// ---------- Auth: usernamePassword (static) tests ----------

test("auth usernamePassword static: login form shows username field", async () => {
  const { federation } = createMockFederation();
  const exporter = createMockExporter();
  const auth: FederationDebuggerAuth = {
    type: "usernamePassword",
    username: "admin",
    password: "secret",
  };
  const dbg = createFederationDebugger(federation, { exporter, auth });
  const request = new Request("https://example.com/__debug__/");
  const response = await dbg.fetch(request, { contextData: undefined });
  strictEqual(response.status, 401);
  const html = await response.text();
  ok(html.includes('name="username"'));
  ok(html.includes('name="password"'));
});

test("auth usernamePassword static: correct credentials set cookie", async () => {
  const { federation } = createMockFederation();
  const exporter = createMockExporter();
  const auth: FederationDebuggerAuth = {
    type: "usernamePassword",
    username: "admin",
    password: "secret",
  };
  const dbg = createFederationDebugger(federation, { exporter, auth });
  const body = new URLSearchParams({
    username: "admin",
    password: "secret",
  });
  const request = new Request("https://example.com/__debug__/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const response = await dbg.fetch(request, { contextData: undefined });
  strictEqual(response.status, 303);
  const setCookie = response.headers.get("set-cookie");
  ok(setCookie != null);
  ok(setCookie!.includes("__fedify_debug_session="));
});

test("auth usernamePassword static: wrong username is rejected", async () => {
  const { federation } = createMockFederation();
  const exporter = createMockExporter();
  const auth: FederationDebuggerAuth = {
    type: "usernamePassword",
    username: "admin",
    password: "secret",
  };
  const dbg = createFederationDebugger(federation, { exporter, auth });
  const body = new URLSearchParams({
    username: "wrong",
    password: "secret",
  });
  const request = new Request("https://example.com/__debug__/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const response = await dbg.fetch(request, { contextData: undefined });
  strictEqual(response.status, 401);
  const html = await response.text();
  ok(html.includes("Invalid credentials."));
});

// ---------- Auth: usernamePassword (callback) tests ----------

test("auth usernamePassword callback: authenticate receives both args", async () => {
  const { federation } = createMockFederation();
  const exporter = createMockExporter();
  let receivedUsername = "";
  let receivedPassword = "";
  const auth: FederationDebuggerAuth = {
    type: "usernamePassword",
    authenticate(username: string, password: string) {
      receivedUsername = username;
      receivedPassword = password;
      return username === "user1" && password === "pass1";
    },
  };
  const dbg = createFederationDebugger(federation, { exporter, auth });
  const body = new URLSearchParams({
    username: "user1",
    password: "pass1",
  });
  const request = new Request("https://example.com/__debug__/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const response = await dbg.fetch(request, { contextData: undefined });
  strictEqual(response.status, 303);
  strictEqual(receivedUsername, "user1");
  strictEqual(receivedPassword, "pass1");
});

// ---------- Auth: request-based tests ----------

test("auth request: allowed request passes through", async () => {
  const { federation } = createMockFederation();
  const exporter = createMockExporter();
  const auth: FederationDebuggerAuth = {
    type: "request",
    authenticate(_request: Request) {
      return true;
    },
  };
  const dbg = createFederationDebugger(federation, { exporter, auth });
  const request = new Request("https://example.com/__debug__/");
  const response = await dbg.fetch(request, { contextData: undefined });
  strictEqual(response.status, 200);
  const html = await response.text();
  ok(html.includes("Fedify Debug Dashboard"));
});

test("auth request: rejected request returns 403", async () => {
  const { federation } = createMockFederation();
  const exporter = createMockExporter();
  const auth: FederationDebuggerAuth = {
    type: "request",
    authenticate(_request: Request) {
      return false;
    },
  };
  const dbg = createFederationDebugger(federation, { exporter, auth });
  const request = new Request("https://example.com/__debug__/");
  const response = await dbg.fetch(request, { contextData: undefined });
  strictEqual(response.status, 403);
  strictEqual(await response.text(), "Forbidden");
});

test("auth request: receives the actual Request object", async () => {
  const { federation } = createMockFederation();
  const exporter = createMockExporter();
  let receivedHeader = "";
  const auth: FederationDebuggerAuth = {
    type: "request",
    authenticate(request: Request) {
      receivedHeader = request.headers.get("X-Test-Header") ?? "";
      return receivedHeader === "allowed";
    },
  };
  const dbg = createFederationDebugger(federation, { exporter, auth });
  const request = new Request("https://example.com/__debug__/", {
    headers: { "X-Test-Header": "allowed" },
  });
  const response = await dbg.fetch(request, { contextData: undefined });
  strictEqual(response.status, 200);
  strictEqual(receivedHeader, "allowed");
});

test("auth request: non-debug requests bypass auth", async () => {
  const { federation, calls } = createMockFederation();
  const exporter = createMockExporter();
  const auth: FederationDebuggerAuth = {
    type: "request",
    authenticate(_request: Request) {
      return false; // reject everything
    },
  };
  const dbg = createFederationDebugger(federation, { exporter, auth });
  // Non-debug requests should go to the inner federation, not the auth layer
  const request = new Request("https://example.com/users/alice");
  const response = await dbg.fetch(request, { contextData: undefined });
  strictEqual(response.status, 200);
  strictEqual(calls["fetch"]?.length, 1);
});

// ---------- Auth: logout tests ----------

test("auth password: logout clears session cookie", async () => {
  const { federation } = createMockFederation();
  const exporter = createMockExporter();
  const auth: FederationDebuggerAuth = {
    type: "password",
    password: "secret123",
  };
  const dbg = createFederationDebugger(federation, { exporter, auth });
  const request = new Request("https://example.com/__debug__/logout");
  const response = await dbg.fetch(request, { contextData: undefined });
  strictEqual(response.status, 303);
  strictEqual(response.headers.get("location"), "/__debug__/");
  const setCookie = response.headers.get("set-cookie");
  ok(setCookie != null);
  ok(setCookie!.includes("Max-Age=0"));
  ok(
    setCookie!.includes("; Secure"),
    "HTTPS logout cookie should include Secure",
  );
});

test("auth password: logout cookie omits Secure on HTTP", async () => {
  const { federation } = createMockFederation();
  const exporter = createMockExporter();
  const auth: FederationDebuggerAuth = {
    type: "password",
    password: "secret123",
  };
  const dbg = createFederationDebugger(federation, { exporter, auth });
  const request = new Request("http://example.com/__debug__/logout");
  const response = await dbg.fetch(request, { contextData: undefined });
  strictEqual(response.status, 303);
  const setCookie = response.headers.get("set-cookie");
  ok(setCookie != null);
  ok(
    !setCookie!.includes("; Secure"),
    "HTTP logout cookie should not include Secure",
  );
});

// ---------- Auth: session lifecycle tests ----------

test("auth password: valid session cookie grants access", async () => {
  const { federation } = createMockFederation();
  const exporter = createMockExporter();
  const auth: FederationDebuggerAuth = {
    type: "password",
    password: "secret123",
  };
  const dbg = createFederationDebugger(federation, { exporter, auth });
  // Step 1: login to get a session cookie
  const loginBody = new URLSearchParams({ password: "secret123" });
  const loginResponse = await dbg.fetch(
    new Request("https://example.com/__debug__/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: loginBody.toString(),
    }),
    { contextData: undefined },
  );
  strictEqual(loginResponse.status, 303);
  const setCookie = loginResponse.headers.get("set-cookie")!;
  // Extract the cookie value
  const cookieValue = setCookie.split(";")[0];

  // Step 2: use the cookie to access a protected page
  const dashboardResponse = await dbg.fetch(
    new Request("https://example.com/__debug__/", {
      headers: { Cookie: cookieValue },
    }),
    { contextData: undefined },
  );
  strictEqual(dashboardResponse.status, 200);
  const html = await dashboardResponse.text();
  ok(html.includes("Fedify Debug Dashboard"));
});

test("auth password: forged session cookie is rejected", async () => {
  const { federation } = createMockFederation();
  const exporter = createMockExporter();
  const auth: FederationDebuggerAuth = {
    type: "password",
    password: "secret123",
  };
  const dbg = createFederationDebugger(federation, { exporter, auth });
  // Use a fake/forged cookie value
  const response = await dbg.fetch(
    new Request("https://example.com/__debug__/", {
      headers: {
        Cookie: "__fedify_debug_session=deadbeefdeadbeefdeadbeefdeadbeef",
      },
    }),
    { contextData: undefined },
  );
  // Should show login form (401), not grant access
  strictEqual(response.status, 401);
  const html = await response.text();
  ok(html.includes("Login Required"));
});

// ---------- Idempotency tests ----------

test("simplified overload is idempotent: repeated calls share exporter", async () => {
  trace.disable();
  resetAutoSetup();
  try {
    const { federation: fed1 } = createMockFederation();
    const { federation: fed2 } = createMockFederation();
    // First call: sets up global OTel + exporter
    const dbg1 = createFederationDebugger(fed1);
    // Second call: should reuse the same exporter, so both dashboards
    // see the same trace data
    const dbg2 = createFederationDebugger(fed2);
    // Both should still be functional
    notStrictEqual(dbg1, null);
    notStrictEqual(dbg2, null);
    strictEqual(typeof dbg1.fetch, "function");
    strictEqual(typeof dbg2.fetch, "function");
    // Both should serve the same trace data (shared exporter)
    const r1 = await dbg1.fetch(
      new Request("https://example.com/__debug__/api/traces"),
      { contextData: undefined },
    );
    const r2 = await dbg2.fetch(
      new Request("https://example.com/__debug__/api/traces"),
      { contextData: undefined },
    );
    const t1 = await r1.json();
    const t2 = await r2.json();
    strictEqual(
      JSON.stringify(t1),
      JSON.stringify(t2),
      "Both debugger instances should share the same exporter",
    );
  } finally {
    trace.disable();
    resetAutoSetup();
  }
});

// ---------- Sink property tests ----------

test("createFederationDebugger exposes a sink property", () => {
  const { federation } = createMockFederation();
  const exporter = createMockExporter();
  const dbg = createFederationDebugger(federation, { exporter });
  notStrictEqual(dbg.sink, null);
  notStrictEqual(dbg.sink, undefined);
  strictEqual(typeof dbg.sink, "function");
});

test("simplified overload exposes a sink property", () => {
  const originalProvider = trace.getTracerProvider();
  resetAutoSetup();
  try {
    const { federation } = createMockFederation();
    const dbg = createFederationDebugger(federation);
    notStrictEqual(dbg.sink, null);
    strictEqual(typeof dbg.sink, "function");
  } finally {
    trace.setGlobalTracerProvider(originalProvider);
    resetAutoSetup();
  }
});

// ---------- Log collection tests ----------

test("sink collects logs by traceId and API returns them", async () => {
  const { federation } = createMockFederation();
  const exporter = createMockExporter();
  const dbg = createFederationDebugger(federation, { exporter });

  // Simulate log records with traceId in properties
  const traceId = "aaaa1111bbbb2222cccc3333dddd4444";
  dbg.sink({
    category: ["fedify", "federation", "http"],
    level: "info",
    message: ["GET ", "/users/alice", ": ", "200"],
    rawMessage: "{method} {path}: {status}",
    timestamp: Date.now(),
    properties: {
      traceId,
      spanId: "1234567890abcdef",
      method: "GET",
      path: "/users/alice",
      status: 200,
    },
  });

  // Check via API
  const request = new Request(
    `https://example.com/__debug__/api/logs/${traceId}`,
  );
  const response = await dbg.fetch(request, { contextData: undefined });
  strictEqual(response.status, 200);
  strictEqual(response.headers.get("content-type"), "application/json");
  const logs = (await response.json()) as SerializedLogRecord[];
  strictEqual(logs.length, 1);
  strictEqual(logs[0].level, "info");
  strictEqual(logs[0].message, "GET /users/alice: 200");
  strictEqual(logs[0].category[0], "fedify");
  // traceId and spanId should be excluded from properties
  strictEqual("traceId" in logs[0].properties, false);
  strictEqual("spanId" in logs[0].properties, false);
  // Other properties should be preserved
  strictEqual(logs[0].properties.method, "GET");
});

test("sink ignores log records without traceId", async () => {
  const { federation } = createMockFederation();
  const exporter = createMockExporter();
  const dbg = createFederationDebugger(federation, { exporter });

  // Log without traceId — should be silently ignored
  dbg.sink({
    category: ["app"],
    level: "debug",
    message: ["some message"],
    rawMessage: "some message",
    timestamp: Date.now(),
    properties: {},
  });

  // No logs should be stored for any traceId
  const request = new Request(
    "https://example.com/__debug__/api/logs/nonexistent",
  );
  const response = await dbg.fetch(request, { contextData: undefined });
  strictEqual(response.status, 200);
  const logs = (await response.json()) as SerializedLogRecord[];
  strictEqual(logs.length, 0);
});

test("multiple logs for the same trace are grouped", async () => {
  const { federation } = createMockFederation();
  const exporter = createMockExporter();
  const dbg = createFederationDebugger(federation, { exporter });

  const traceId = "aaaa1111bbbb2222cccc3333dddd4444";
  for (let i = 0; i < 5; i++) {
    dbg.sink({
      category: ["fedify"],
      level: "info",
      message: [`log ${i}`],
      rawMessage: `log ${i}`,
      timestamp: Date.now() + i,
      properties: { traceId, spanId: "abcdef1234567890" },
    });
  }

  const request = new Request(
    `https://example.com/__debug__/api/logs/${traceId}`,
  );
  const response = await dbg.fetch(request, { contextData: undefined });
  const logs = (await response.json()) as SerializedLogRecord[];
  strictEqual(logs.length, 5);
  strictEqual(logs[0].message, "log 0");
  strictEqual(logs[4].message, "log 4");
});

test("trace detail page shows log records", async () => {
  const { federation } = createMockFederation();
  const exporter = createMockExporter();
  const dbg = createFederationDebugger(federation, { exporter });

  const traceId = "aaaa1111bbbb2222cccc3333dddd4444";
  dbg.sink({
    category: ["fedify", "federation"],
    level: "warning",
    message: ["Something went wrong"],
    rawMessage: "Something went wrong",
    timestamp: 1700000000000,
    properties: { traceId, spanId: "1234567890abcdef" },
  });

  const request = new Request(
    `https://example.com/__debug__/traces/${traceId}`,
  );
  const response = await dbg.fetch(request, { contextData: undefined });
  strictEqual(response.status, 200);
  const html = await response.text();
  ok(html.includes("Logs"));
  ok(html.includes("Something went wrong"));
  ok(html.includes("warning"));
  ok(html.includes("fedify.federation"));
  // "1" and "log record" are separated by HTML tags
  ok(html.includes("log record"));
});

test("trace detail page shows empty log message", async () => {
  const { federation } = createMockFederation();
  const exporter = createMockExporter();
  const dbg = createFederationDebugger(federation, { exporter });

  const request = new Request(
    "https://example.com/__debug__/traces/0000000000000000",
  );
  const response = await dbg.fetch(request, { contextData: undefined });
  strictEqual(response.status, 200);
  const html = await response.text();
  ok(html.includes("No logs captured for this trace."));
});
