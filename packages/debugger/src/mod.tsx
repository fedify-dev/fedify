/** @jsx react-jsx */
/** @jsxImportSource hono/jsx */
/**
 * @module
 * Embedded ActivityPub debug dashboard for Fedify.
 *
 * This module provides a {@link createFederationDebugger} function that wraps
 * an existing {@link Federation} object, adding a real-time debug dashboard
 * accessible via a configurable path prefix.
 */
import type {
  Federation,
  FederationFetchOptions,
  KvKey,
  KvStore,
} from "@fedify/fedify/federation";
import { MemoryKvStore } from "@fedify/fedify/federation";
import { FedifySpanExporter } from "@fedify/fedify/otel";
import type { LogRecord, Sink } from "@logtape/logtape";
import { configureSync, getConfig } from "@logtape/logtape";
import { context, propagation, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { AsyncLocalStorage } from "node:async_hooks";
import { timingSafeEqual } from "node:crypto";
import { LoginPage } from "./views/login.tsx";
import { TracesListPage } from "./views/traces-list.tsx";
import { TraceDetailPage } from "./views/trace-detail.tsx";

/**
 * A serialized log record for the debug dashboard.
 */
export interface SerializedLogRecord {
  /**
   * The logger category.
   */
  readonly category: readonly string[];

  /**
   * The log level.
   */
  readonly level: string;

  /**
   * The rendered log message.
   */
  readonly message: string;

  /**
   * The timestamp in milliseconds since the Unix epoch.
   */
  readonly timestamp: number;

  /**
   * The extra properties of the log record (excluding traceId and spanId).
   */
  readonly properties: Record<string, unknown>;
}

/**
 * Cached auto-setup state so that repeated calls to
 * `createFederationDebugger()` without an explicit exporter reuse the same
 * global OpenTelemetry tracer provider and exporter instead of registering
 * duplicate providers and LogTape sinks.
 */
let _autoSetup: { exporter: FedifySpanExporter; kv: KvStore } | undefined;

/**
 * Resets the internal auto-setup state.  This is intended **only for tests**
 * that need to exercise the auto-setup code path more than once within the
 * same process.
 *
 * @internal
 */
export function resetAutoSetup(): void {
  _autoSetup = undefined;
}

/**
 * Persistent storage for log records grouped by trace ID, backed by a
 * {@link KvStore}.  When the same `KvStore` is shared across web and worker
 * processes the dashboard can display logs produced by background tasks.
 */
class LogStore {
  readonly #kv: KvStore;
  readonly #keyPrefix: KvKey;
  /** Per-trace monotonically increasing counter so entries sort correctly. */
  readonly #seq: Map<string, number> = new Map();
  /** Chain of pending write promises for flush(). */
  #pending: Promise<void> = Promise.resolve();

  constructor(kv: KvStore, keyPrefix: KvKey = ["fedify", "debugger", "logs"]) {
    this.#kv = kv;
    this.#keyPrefix = keyPrefix;
  }

  /**
   * Enqueue a log record for writing.  The write happens asynchronously;
   * call {@link flush} to wait for all pending writes to complete.
   */
  add(traceId: string, record: SerializedLogRecord): void {
    const seq = this.#seq.get(traceId) ?? 0;
    this.#seq.set(traceId, seq + 1);
    const key: KvKey = [
      ...this.#keyPrefix,
      traceId,
      seq.toString().padStart(10, "0"),
    ] as unknown as KvKey;
    this.#pending = this.#pending.then(() => this.#kv.set(key, record));
  }

  /** Wait for all pending writes to complete. */
  flush(): Promise<void> {
    return this.#pending;
  }

  async get(traceId: string): Promise<readonly SerializedLogRecord[]> {
    const prefix: KvKey = [...this.#keyPrefix, traceId] as unknown as KvKey;
    const logs: SerializedLogRecord[] = [];
    for await (const entry of this.#kv.list(prefix)) {
      logs.push(entry.value as SerializedLogRecord);
    }
    return logs;
  }
}

function serializeLogRecord(record: LogRecord): SerializedLogRecord {
  // Render message to string
  const messageParts: string[] = [];
  for (const part of record.message) {
    if (typeof part === "string") messageParts.push(part);
    else if (part == null) messageParts.push("");
    else messageParts.push(String(part));
  }
  // Exclude traceId and spanId from properties
  const { traceId: _t, spanId: _s, ...properties } = record.properties;
  return {
    category: record.category,
    level: record.level,
    message: messageParts.join(""),
    timestamp: record.timestamp,
    properties,
  };
}

function createLogSink(store: LogStore): Sink {
  return (record: LogRecord): void => {
    const traceId = record.properties.traceId;
    if (typeof traceId !== "string" || traceId.length === 0) return;
    store.add(traceId, serializeLogRecord(record));
  };
}

/**
 * Authentication configuration for the debug dashboard.
 *
 * The debug dashboard can be protected using one of three authentication modes:
 *
 * - `"password"` — Shows a password-only login form.
 * - `"usernamePassword"` — Shows a username + password login form.
 * - `"request"` — Authenticates based on the incoming request (e.g., IP
 *   address).  No login form is shown; unauthenticated requests receive a
 *   403 response.
 *
 * Each mode supports either a static credential check or a callback function.
 */
export type FederationDebuggerAuth =
  | {
    readonly type: "password";
    authenticate(password: string): boolean | Promise<boolean>;
  }
  | {
    readonly type: "password";
    readonly password: string;
  }
  | {
    readonly type: "usernamePassword";
    authenticate(
      username: string,
      password: string,
    ): boolean | Promise<boolean>;
  }
  | {
    readonly type: "usernamePassword";
    readonly username: string;
    readonly password: string;
  }
  | {
    readonly type: "request";
    authenticate(request: Request): boolean | Promise<boolean>;
  };

/**
 * Options for {@link createFederationDebugger} with an explicit exporter.
 *
 * When `exporter` is provided, the caller is responsible for setting up
 * the OpenTelemetry tracer provider and passing it to `createFederation()`.
 */
export interface FederationDebuggerOptions {
  /**
   * The path prefix for the debug dashboard.  Defaults to `"/__debug__"`.
   */
  path?: string;

  /**
   * The {@link FedifySpanExporter} to query trace data from.
   */
  exporter: FedifySpanExporter;

  /**
   * The {@link KvStore} to persist log records to.  This should typically be
   * the same `KvStore` instance that was passed to the `FedifySpanExporter`
   * so that logs and traces are co-located and accessible from all processes
   * (e.g., both web and worker nodes).
   */
  kv: KvStore;

  /**
   * Authentication configuration for the debug dashboard.  When omitted,
   * the dashboard is accessible without authentication.
   */
  auth?: FederationDebuggerAuth;
}

/**
 * Options for {@link createFederationDebugger} without an explicit exporter.
 *
 * When `exporter` is omitted, the debugger automatically creates a
 * {@link MemoryKvStore}, {@link FedifySpanExporter},
 * {@link BasicTracerProvider}, and registers it as the global tracer provider
 * so that `createFederation()` picks it up automatically.
 */
export interface FederationDebuggerSimpleOptions {
  /**
   * The path prefix for the debug dashboard.  Defaults to `"/__debug__"`.
   */
  path?: string;

  /**
   * Authentication configuration for the debug dashboard.  When omitted,
   * the dashboard is accessible without authentication.
   */
  auth?: FederationDebuggerAuth;
}

/**
 * Validates and normalizes the path prefix for the debug dashboard.
 *
 * The path must start with `/`, must not end with `/` (unless it is exactly
 * `"/"`), and must not contain control characters, semicolons, or commas
 * (which are unsafe in HTTP headers like `Set-Cookie` and `Location`).
 *
 * @param path The path prefix to validate.
 * @returns The normalized path prefix (trailing slash stripped).
 * @throws {TypeError} If the path is invalid.
 */
function validatePathPrefix(path: string): string {
  if (path === "" || !path.startsWith("/")) {
    throw new TypeError(
      `Invalid debug dashboard path: ${JSON.stringify(path)}. ` +
        "The path must start with '/'.",
    );
  }
  // Reject control characters, semicolons, and commas (unsafe in headers)
  // deno-lint-ignore no-control-regex
  if (/[\x00-\x1f\x7f;,]/.test(path)) {
    throw new TypeError(
      `Invalid debug dashboard path: ${JSON.stringify(path)}. ` +
        "The path must not contain control characters, semicolons, or commas.",
    );
  }
  // Strip trailing slash (unless the path is exactly "/")
  if (path.length > 1 && path.endsWith("/")) {
    return path.slice(0, -1);
  }
  return path;
}

/**
 * Wraps a {@link Federation} object with a debug dashboard.
 *
 * When called without an `exporter`, the debugger automatically sets up
 * OpenTelemetry tracing: it creates a {@link MemoryKvStore},
 * {@link FedifySpanExporter}, and {@link BasicTracerProvider}, then registers
 * it as the global tracer provider.  It also auto-configures LogTape to
 * collect logs per trace.
 *
 * @example Simple usage (recommended)
 * ```typescript ignore
 * const innerFederation = createFederation({ kv: new MemoryKvStore() });
 * const federation = createFederationDebugger(innerFederation);
 * ```
 *
 * @template TContextData The context data type of the federation.
 * @param federation The federation object to wrap.
 * @param options Optional path configuration.
 * @returns A new {@link Federation} object with the debug dashboard attached
 *          and a `sink` property for LogTape integration.
 */
export function createFederationDebugger<TContextData>(
  federation: Federation<TContextData>,
  options?: FederationDebuggerSimpleOptions,
): Federation<TContextData> & { sink: Sink };

/**
 * Wraps a {@link Federation} object with a debug dashboard.
 *
 * When called with an `exporter`, the caller is responsible for setting up
 * the OpenTelemetry tracer provider and passing it to `createFederation()`.
 * The returned object includes a `sink` property that should be added to
 * the LogTape configuration to collect logs per trace.
 *
 * @example Advanced usage with explicit exporter
 * ```typescript ignore
 * const kv = new MemoryKvStore();
 * const exporter = new FedifySpanExporter(kv);
 * const tracerProvider = new BasicTracerProvider({
 *   spanProcessors: [new SimpleSpanProcessor(exporter)],
 * });
 * const innerFederation = createFederation({ kv, tracerProvider });
 * const federation = createFederationDebugger(innerFederation, {
 *   exporter,
 *   kv,
 * });
 * await configure({
 *   sinks: { debugger: federation.sink },
 *   loggers: [
 *     { category: "fedify", sinks: ["debugger"] },
 *   ],
 * });
 * ```
 *
 * @template TContextData The context data type of the federation.
 * @param federation The federation object to wrap.
 * @param options Options including the exporter.
 * @returns A new {@link Federation} object with the debug dashboard attached
 *          and a `sink` property for LogTape integration.
 */
export function createFederationDebugger<TContextData>(
  federation: Federation<TContextData>,
  options: FederationDebuggerOptions,
): Federation<TContextData> & { sink: Sink };

export function createFederationDebugger<TContextData>(
  federation: Federation<TContextData>,
  options?: FederationDebuggerSimpleOptions | FederationDebuggerOptions,
): Federation<TContextData> & { sink: Sink } {
  const pathPrefix = validatePathPrefix(options?.path ?? "/__debug__");

  let exporter: FedifySpanExporter;
  let logKv: KvStore;
  if (options != null && "exporter" in options) {
    exporter = options.exporter;
    logKv = options.kv;
  } else if (_autoSetup != null) {
    // Reuse the exporter from a previous auto-setup call so that repeated
    // calls without an explicit exporter share the same global state.
    exporter = _autoSetup.exporter;
    logKv = _autoSetup.kv;
  } else {
    // Auto-setup: create MemoryKvStore, FedifySpanExporter,
    // BasicTracerProvider, and register globally
    const kv = new MemoryKvStore();
    logKv = kv;
    exporter = new FedifySpanExporter(kv);
    const tracerProvider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    trace.setGlobalTracerProvider(tracerProvider);
    // Register context manager so that parent-child spans share
    // the same traceId (required for context propagation):
    const contextManager = new AsyncLocalStorageContextManager();
    context.setGlobalContextManager(contextManager);
    // Register W3C Trace Context propagator so that trace context
    // is properly injected/extracted across queue boundaries:
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());

    _autoSetup = { exporter, kv };
  }

  const logStore = new LogStore(logKv);
  const sink = createLogSink(logStore);

  // Auto-configure LogTape when using the simplified overload:
  if (options == null || !("exporter" in options)) {
    const existingConfig = getConfig();
    if (existingConfig != null) {
      // Merge with existing config
      const sinks = { ...existingConfig.sinks, __fedify_debugger__: sink };
      const loggers = existingConfig.loggers.map((l) => ({
        ...l,
        sinks: Array.isArray(l.category) && l.category.length < 1
          ? [...(l.sinks ?? []), "__fedify_debugger__"]
          : l.sinks,
      }));
      if (
        loggers.every((l) =>
          typeof l.category === "string" ||
          Array.isArray(l.category) && l.category.length > 0
        )
      ) {
        loggers.push({ category: [], sinks: ["__fedify_debugger__"] });
      }
      configureSync(
        {
          ...existingConfig,
          contextLocalStorage: existingConfig.contextLocalStorage ??
            new AsyncLocalStorage(),
          reset: true,
          sinks,
          loggers,
          // deno-lint-ignore no-explicit-any
        } as any,
      );
    } else {
      configureSync({
        sinks: { __fedify_debugger__: sink },
        loggers: [
          { category: [], sinks: ["__fedify_debugger__"] },
        ],
        contextLocalStorage: new AsyncLocalStorage(),
      });
    }
  }

  const auth = options?.auth;
  const app = createDebugApp(pathPrefix, exporter, logStore, auth);

  // Override fetch to intercept debug path prefix:
  const debugFetch = async (
    request: Request,
    fetchOptions: FederationFetchOptions<TContextData>,
  ): Promise<Response> => {
    const url = new URL(request.url);
    if (
      url.pathname === pathPrefix ||
      url.pathname.startsWith(pathPrefix + "/")
    ) {
      return await app.fetch(request);
    }
    return await federation.fetch(request, fetchOptions);
  };

  // Use a Proxy to dynamically delegate all methods from the inner
  // federation, overriding only `fetch` and adding `sink`.  This avoids
  // a hardcoded method list that could silently become stale when the
  // Federation interface gains new methods.
  const overrides: Record<string | symbol, unknown> = {
    fetch: debugFetch,
    sink,
  };
  return new Proxy(federation as Federation<TContextData> & { sink: Sink }, {
    get(target, prop, receiver) {
      if (prop in overrides) return overrides[prop];
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === "function") return value.bind(target);
      return value;
    },
    has(target, prop) {
      if (prop in overrides) return true;
      return Reflect.has(target, prop);
    },
  });
}

const SESSION_COOKIE_NAME = "__fedify_debug_session";
const SESSION_TOKEN = "authenticated";

async function generateHmacKey(): Promise<CryptoKey> {
  return await crypto.subtle.generateKey(
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes.buffer as ArrayBuffer;
}

async function signSession(key: CryptoKey): Promise<string> {
  const encoder = new TextEncoder();
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(SESSION_TOKEN),
  );
  return toHex(signature);
}

async function verifySession(
  key: CryptoKey,
  signature: string,
): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    return await crypto.subtle.verify(
      "HMAC",
      key,
      fromHex(signature),
      encoder.encode(SESSION_TOKEN),
    );
  } catch {
    return false;
  }
}

/**
 * Constant-time string comparison to prevent timing attacks on credential
 * checks.  Uses {@link timingSafeEqual} from `node:crypto` under the hood.
 */
function constantTimeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  if (bufA.byteLength !== bufB.byteLength) {
    // Still compare to burn the same amount of time regardless, but
    // the result is always false when lengths differ.
    timingSafeEqual(bufA, new Uint8Array(bufA.byteLength));
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

async function checkAuth(
  auth: FederationDebuggerAuth,
  formData: { username?: string; password: string },
): Promise<boolean> {
  if (auth.type === "password") {
    if ("authenticate" in auth) {
      return await auth.authenticate(formData.password);
    }
    return constantTimeEqual(formData.password, auth.password);
  }
  if (auth.type === "usernamePassword") {
    if ("authenticate" in auth) {
      return await auth.authenticate(
        formData.username ?? "",
        formData.password,
      );
    }
    // Check both fields in constant time (don't short-circuit)
    const usernameMatch = constantTimeEqual(
      formData.username ?? "",
      auth.username,
    );
    const passwordMatch = constantTimeEqual(formData.password, auth.password);
    return usernameMatch && passwordMatch;
  }
  return false;
}

function createDebugApp(
  pathPrefix: string,
  exporter: FedifySpanExporter,
  logStore: LogStore,
  auth?: FederationDebuggerAuth,
): Hono {
  const app = new Hono({ strict: false }).basePath(pathPrefix);

  // For "password" and "usernamePassword" modes, we need an HMAC key
  // for signing session cookies.
  let hmacKeyPromise: Promise<CryptoKey> | undefined;
  if (auth != null && auth.type !== "request") {
    hmacKeyPromise = generateHmacKey();
  }

  // Auth middleware
  if (auth != null) {
    if (auth.type === "request") {
      // Request-based auth: check every request, return 403 on failure
      app.use("*", async (c, next) => {
        const allowed = await auth.authenticate(c.req.raw);
        if (!allowed) {
          return c.text("Forbidden", 403);
        }
        await next();
      });
    } else {
      // Cookie-based auth for "password" and "usernamePassword" modes
      const showUsername = auth.type === "usernamePassword";

      // POST /login handler
      app.post("/login", async (c) => {
        const body = await c.req.parseBody();
        const password = typeof body.password === "string" ? body.password : "";
        const username = typeof body.username === "string"
          ? body.username
          : undefined;
        const ok = await checkAuth(auth, { username, password });
        if (!ok) {
          return c.html(
            <LoginPage
              pathPrefix={pathPrefix}
              showUsername={showUsername}
              error="Invalid credentials."
            />,
            401,
          );
        }
        const key = await hmacKeyPromise!;
        const sig = await signSession(key);
        const secure = new URL(c.req.url).protocol === "https:";
        return new Response(null, {
          status: 303,
          headers: {
            "Location": pathPrefix + "/",
            "Set-Cookie":
              `${SESSION_COOKIE_NAME}=${sig}; Path=${pathPrefix}; HttpOnly; SameSite=Strict${
                secure ? "; Secure" : ""
              }`,
          },
        });
      });

      // GET /logout handler
      app.get("/logout", (c) => {
        const secure = new URL(c.req.url).protocol === "https:";
        return new Response(null, {
          status: 303,
          headers: {
            "Location": pathPrefix + "/",
            "Set-Cookie":
              `${SESSION_COOKIE_NAME}=; Path=${pathPrefix}; HttpOnly; SameSite=Strict${
                secure ? "; Secure" : ""
              }; Max-Age=0`,
          },
        });
      });

      // Auth check middleware (skip for /login and /logout)
      app.use("*", async (c, next) => {
        const path = new URL(c.req.url).pathname;
        const loginPath = pathPrefix + "/login";
        const logoutPath = pathPrefix + "/logout";
        if (path === loginPath || path === logoutPath) {
          await next();
          return;
        }

        const sessionValue = getCookie(c, SESSION_COOKIE_NAME);
        if (sessionValue) {
          const key = await hmacKeyPromise!;
          const valid = await verifySession(key, sessionValue);
          if (valid) {
            await next();
            return;
          }
        }

        // Not authenticated — show login form
        return c.html(
          <LoginPage
            pathPrefix={pathPrefix}
            showUsername={showUsername}
          />,
          401,
        );
      });
    }
  }

  app.get("/api/traces", async (c) => {
    const traces = await exporter.getRecentTraces();
    return c.json(traces);
  });

  app.get("/api/logs/:traceId", async (c) => {
    const traceId = c.req.param("traceId");
    await logStore.flush();
    const logs = await logStore.get(traceId);
    return c.json(logs);
  });

  app.get("/traces/:traceId", async (c) => {
    const traceId = c.req.param("traceId");
    await logStore.flush();
    const activities = await exporter.getActivitiesByTraceId(traceId);
    const logs = await logStore.get(traceId);
    return c.html(
      <TraceDetailPage
        traceId={traceId}
        activities={activities}
        logs={logs}
        pathPrefix={pathPrefix}
      />,
    );
  });

  app.get("/", async (c) => {
    const traces = await exporter.getRecentTraces();
    return c.html(
      <TracesListPage traces={traces} pathPrefix={pathPrefix} />,
    );
  });

  return app;
}
