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
import { TracesListPage } from "./views/traces-list.tsx";
import { TraceDetailPage } from "./views/trace-detail.tsx";

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

  const app = createDebugApp(pathPrefix, exporter);

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

function createDebugApp(
  pathPrefix: string,
  exporter: FedifySpanExporter,
): Hono {
  const app = new Hono({ strict: false }).basePath(pathPrefix);

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
