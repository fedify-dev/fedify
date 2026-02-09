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
import type { FedifySpanExporter } from "@fedify/fedify/otel";
import { Hono } from "hono";

/**
 * Options for {@link createFederationDebugger}.
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
 * Wraps a {@link Federation} object with a debug dashboard.
 *
 * The returned object fully implements {@link Federation}.  Requests matching
 * the debug path prefix (default `/__debug__`) are handled by an internal
 * Hono app that serves the dashboard.  All other requests and method calls
 * are delegated to the inner federation object as-is.
 *
 * @template TContextData The context data type of the federation.
 * @param federation The federation object to wrap.
 * @param options Options for the debugger.
 * @returns A new {@link Federation} object with the debug dashboard attached.
 */
export function createFederationDebugger<TContextData>(
  federation: Federation<TContextData>,
  options: FederationDebuggerOptions,
): Federation<TContextData> {
  const pathPrefix = options.path ?? "/__debug__";
  const exporter = options.exporter;

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
    return c.text(
      `Trace ${traceId}: ${activities.length} activities`,
      200,
    );
  });

  app.get("/", async (c) => {
    const traces = await exporter.getRecentTraces();
    return c.text(
      `Debug Dashboard: ${traces.length} traces`,
      200,
    );
  });

  return app;
}
