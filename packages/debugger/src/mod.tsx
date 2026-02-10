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
} from "@fedify/fedify/federation";
import { MemoryKvStore } from "@fedify/fedify/federation";
import { FedifySpanExporter } from "@fedify/fedify/otel";
import type { LogRecord, Sink } from "@logtape/logtape";
import { configure, configureSync, getConfig } from "@logtape/logtape";
import { context, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { Hono } from "hono";
import { AsyncLocalStorage } from "node:async_hooks";
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

const DEFAULT_MAX_LOG_ENTRIES = 10_000;

/**
 * In-memory storage for log records grouped by trace ID.
 */
class LogStore {
  readonly #maxEntries: number;
  readonly #logs: Map<string, SerializedLogRecord[]> = new Map();
  #totalEntries = 0;

  constructor(maxEntries: number = DEFAULT_MAX_LOG_ENTRIES) {
    this.#maxEntries = maxEntries;
  }

  add(traceId: string, record: SerializedLogRecord): void {
    let list = this.#logs.get(traceId);
    if (list == null) {
      list = [];
      this.#logs.set(traceId, list);
    }
    list.push(record);
    this.#totalEntries++;
    // Evict oldest trace groups when exceeding max entries
    while (this.#totalEntries > this.#maxEntries && this.#logs.size > 0) {
      const oldest = this.#logs.keys().next();
      if (oldest.done) break;
      const evicted = this.#logs.get(oldest.value);
      if (evicted != null) this.#totalEntries -= evicted.length;
      this.#logs.delete(oldest.value);
    }
  }

  get(traceId: string): SerializedLogRecord[] {
    return this.#logs.get(traceId) ?? [];
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
 * Wraps a {@link Federation} object with a debug dashboard.
 *
 * When called without an `exporter`, the debugger automatically sets up
 * OpenTelemetry tracing: it creates a {@link MemoryKvStore},
 * {@link FedifySpanExporter}, and {@link BasicTracerProvider}, then registers
 * it as the global tracer provider.  It also auto-configures LogTape to
 * collect logs per trace.
 *
 * @example Simple usage (recommended)
 * ```typescript
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
 * ```typescript
 * const kv = new MemoryKvStore();
 * const exporter = new FedifySpanExporter(kv);
 * const tracerProvider = new BasicTracerProvider({
 *   spanProcessors: [new SimpleSpanProcessor(exporter)],
 * });
 * const innerFederation = createFederation({ kv, tracerProvider });
 * const federation = createFederationDebugger(innerFederation, { exporter });
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
  const pathPrefix = options?.path ?? "/__debug__";

  const logStore = new LogStore();
  const sink = createLogSink(logStore);

  let exporter: FedifySpanExporter;
  if (options != null && "exporter" in options) {
    exporter = options.exporter;
  } else {
    // Auto-setup: create MemoryKvStore, FedifySpanExporter,
    // BasicTracerProvider, and register globally
    const kv = new MemoryKvStore();
    exporter = new FedifySpanExporter(kv);
    const tracerProvider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    trace.setGlobalTracerProvider(tracerProvider);
    // Register context manager so that parent-child spans share
    // the same traceId (required for context propagation):
    const contextManager = new AsyncLocalStorageContextManager();
    context.setGlobalContextManager(contextManager);

    // Auto-configure LogTape to include the debugger sink
    const existingConfig = getConfig();
    if (existingConfig != null) {
      // Merge with existing config
      const sinks = { ...existingConfig.sinks, __fedify_debugger__: sink };
      const loggers = existingConfig.loggers.map((l) => ({
        ...l,
        sinks: [...(l.sinks ?? []), "__fedify_debugger__"],
      }));
      if (
        loggers.every((l) =>
          typeof l.category === "string" ||
          Array.isArray(l.category) && l.category.length > 0
        )
      ) {
        loggers.push({ category: [], sinks: ["__fedify_debugger__"] });
      }
      configure(
        {
          contextLocalStorage: new AsyncLocalStorage(),
          ...existingConfig,
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

  const proxy: Federation<TContextData> & { sink: Sink } =
    // deno-lint-ignore no-explicit-any
    Object.create(null) as any;

  // Expose the sink for advanced users to include in their LogTape config
  proxy.sink = sink;

  // Delegate all Federatable methods directly:
  const delegatedMethods = [
    "setNodeInfoDispatcher",
    "setWebFingerLinksDispatcher",
    "setActorDispatcher",
    "setObjectDispatcher",
    "setInboxDispatcher",
    "setOutboxDispatcher",
    "setFollowingDispatcher",
    "setFollowersDispatcher",
    "setLikedDispatcher",
    "setFeaturedDispatcher",
    "setFeaturedTagsDispatcher",
    "setInboxListeners",
    "setCollectionDispatcher",
    "setOrderedCollectionDispatcher",
    "setOutboxPermanentFailureHandler",
    // Federation-specific methods:
    "startQueue",
    "processQueuedTask",
    "createContext",
  ] as const;

  for (const method of delegatedMethods) {
    // deno-lint-ignore no-explicit-any
    (proxy as any)[method] = (...args: unknown[]) => {
      // deno-lint-ignore no-explicit-any
      return (federation as any)[method](...args);
    };
  }

  // Override fetch to intercept debug path prefix:
  proxy.fetch = async (
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

  return proxy;
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

function parseCookies(header: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const pair of header.split(";")) {
    const [name, ...rest] = pair.trim().split("=");
    if (name) cookies[name.trim()] = rest.join("=").trim();
  }
  return cookies;
}

async function checkAuth(
  auth: FederationDebuggerAuth,
  formData: { username?: string; password: string },
): Promise<boolean> {
  if (auth.type === "password") {
    if ("authenticate" in auth) {
      return await auth.authenticate(formData.password);
    }
    return formData.password === auth.password;
  }
  if (auth.type === "usernamePassword") {
    if ("authenticate" in auth) {
      return await auth.authenticate(
        formData.username ?? "",
        formData.password,
      );
    }
    return formData.username === auth.username &&
      formData.password === auth.password;
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
        return new Response(null, {
          status: 303,
          headers: {
            "Location": pathPrefix + "/",
            "Set-Cookie":
              `${SESSION_COOKIE_NAME}=${sig}; Path=${pathPrefix}; HttpOnly; SameSite=Strict`,
          },
        });
      });

      // GET /logout handler
      app.get("/logout", (_c) => {
        return new Response(null, {
          status: 303,
          headers: {
            "Location": pathPrefix + "/",
            "Set-Cookie":
              `${SESSION_COOKIE_NAME}=; Path=${pathPrefix}; HttpOnly; SameSite=Strict; Max-Age=0`,
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

        const cookieHeader = c.req.header("cookie") ?? "";
        const cookies = parseCookies(cookieHeader);
        const sessionValue = cookies[SESSION_COOKIE_NAME];
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

  app.get("/api/logs/:traceId", (c) => {
    const traceId = c.req.param("traceId");
    const logs = logStore.get(traceId);
    return c.json(logs);
  });

  app.get("/traces/:traceId", async (c) => {
    const traceId = c.req.param("traceId");
    const activities = await exporter.getActivitiesByTraceId(traceId);
    const logs = logStore.get(traceId);
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
