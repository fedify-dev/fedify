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
  KvStore,
} from "@fedify/fedify/federation";
import { MemoryKvStore } from "@fedify/fedify/federation";
import { FedifySpanExporter } from "@fedify/fedify/otel";
import type { Sink } from "@logtape/logtape";
import { configureSync, getConfig } from "@logtape/logtape";
import { context, propagation, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { AsyncLocalStorage } from "node:async_hooks";
import type { FederationDebuggerAuth } from "./auth.ts";
import { createLogSink, LogStore } from "./log-store.ts";
import { createDebugApp } from "./routes.tsx";

export type { FederationDebuggerAuth } from "./auth.ts";
export type { SerializedLogRecord } from "./log-store.ts";

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
