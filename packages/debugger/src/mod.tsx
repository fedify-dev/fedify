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
import { trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { Hono } from "hono";
import { LoginPage } from "./views/login.tsx";
import { TracesListPage } from "./views/traces-list.tsx";
import { TraceDetailPage } from "./views/trace-detail.tsx";

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
 * it as the global tracer provider.  This means `createFederation()` will
 * automatically use it without needing an explicit `tracerProvider` option.
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
 * @returns A new {@link Federation} object with the debug dashboard attached.
 */
export function createFederationDebugger<TContextData>(
  federation: Federation<TContextData>,
  options?: FederationDebuggerSimpleOptions,
): Federation<TContextData>;

/**
 * Wraps a {@link Federation} object with a debug dashboard.
 *
 * When called with an `exporter`, the caller is responsible for setting up
 * the OpenTelemetry tracer provider and passing it to `createFederation()`.
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
 * ```
 *
 * @template TContextData The context data type of the federation.
 * @param federation The federation object to wrap.
 * @param options Options including the exporter.
 * @returns A new {@link Federation} object with the debug dashboard attached.
 */
export function createFederationDebugger<TContextData>(
  federation: Federation<TContextData>,
  options: FederationDebuggerOptions,
): Federation<TContextData>;

export function createFederationDebugger<TContextData>(
  federation: Federation<TContextData>,
  options?: FederationDebuggerSimpleOptions | FederationDebuggerOptions,
): Federation<TContextData> {
  const pathPrefix = options?.path ?? "/__debug__";

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
  }

  const auth = options?.auth;
  const app = createDebugApp(pathPrefix, exporter, auth);

  // deno-lint-ignore no-explicit-any
  const proxy: Federation<TContextData> = Object.create(null) as any;

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

  app.get("/traces/:traceId", async (c) => {
    const traceId = c.req.param("traceId");
    const activities = await exporter.getActivitiesByTraceId(traceId);
    return c.html(
      <TraceDetailPage
        traceId={traceId}
        activities={activities}
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
