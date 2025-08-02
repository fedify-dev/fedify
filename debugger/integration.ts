/**
 * Federation router integration utilities for the debugger.
 *
 * @module
 * @since 1.9.0
 */

import type { Federation, FederationBuilder } from "@fedify/fedify/federation";
import { DebugObserver, type DebugObserverOptions } from "./observer.ts";
import { createDebugHandler } from "./handler.ts";

/**
 * Options for integrating the debugger with a federation.
 * @since 1.9.0
 */
export interface IntegrateDebuggerOptions extends DebugObserverOptions {
  /**
   * Whether to automatically register routes.
   * If false, you need to manually mount the debug handler.
   * @default true
   */
  autoRegisterRoutes?: boolean;
}

/**
 * Integration result containing the observer and handler.
 * @since 1.9.0
 */
export interface DebuggerIntegration<TContextData> {
  /**
   * The debug observer instance.
   */
  observer: DebugObserver<TContextData>;

  /**
   * The debug handler app (Hono instance).
   * Only present if autoRegisterRoutes was false.
   */
  handler?: ReturnType<typeof createDebugHandler>;

  /**
   * The path where the debugger is mounted.
   */
  path: string;
}

/**
 * Integrates the debugger with a federation builder.
 *
 * This function adds a debug observer to the federation and optionally
 * registers the debug dashboard routes.
 *
 * @example
 * ```typescript
 * import { createFederation } from "@fedify/fedify";
 * import { integrateDebugger } from "@fedify/debugger";
 *
 * const federation = createFederation({
 *   kv: new MemoryKvStore(),
 * });
 *
 * // In development
 * if (process.env.NODE_ENV !== "production") {
 *   const { observer } = integrateDebugger(federation, {
 *     path: "/__debugger__",
 *     maxActivities: 500,
 *   });
 * }
 * ```
 *
 * @param federation The federation builder to integrate with
 * @param options Debugger configuration options
 * @returns The debugger integration result
 * @since 1.9.0
 */
export function integrateDebugger<TContextData>(
  federation: FederationBuilder<TContextData>,
  options: IntegrateDebuggerOptions = {},
): DebuggerIntegration<TContextData> {
  const {
    path = "/__debugger__",
    autoRegisterRoutes = true,
    ...observerOptions
  } = options;

  // Create the debug observer
  const observer = new DebugObserver<TContextData>({
    path,
    ...observerOptions,
  });

  // Add the observer to the federation
  const currentOptions = (federation as any).options || {};
  const observers = currentOptions.observers || [];
  observers.push(observer);

  // Update federation options
  (federation as any).options = {
    ...currentOptions,
    observers,
  };

  const result: DebuggerIntegration<TContextData> = {
    observer,
    path,
  };

  if (autoRegisterRoutes) {
    // Create and register the debug handler
    const handler = createDebugHandler(observer);

    // Register routes with the federation
    // Note: This requires federation to support route registration
    // For now, we'll return the handler for manual mounting
    result.handler = handler;

    console.warn(
      `[Fedify Debugger] Auto-registration not yet implemented. ` +
        `Please manually mount the debug handler at ${path}`,
    );
  } else {
    // Return handler for manual mounting
    result.handler = createDebugHandler(observer);
  }

  return result;
}

/**
 * Integrates the debugger with an already-created Federation instance.
 *
 * This is useful when you have a Federation instance rather than a builder.
 *
 * @example
 * ```typescript
 * import { Federation } from "@fedify/fedify";
 * import { integrateDebuggerWithFederation } from "@fedify/debugger";
 *
 * const federation: Federation<void> = // ... your federation instance
 *
 * // Add debugger
 * const { observer, handler } = integrateDebuggerWithFederation(federation, {
 *   production: false,
 * });
 *
 * // Mount the handler manually
 * app.route("/__debugger__", handler);
 * ```
 *
 * @param federation The federation instance
 * @param options Debugger configuration options
 * @returns The debugger integration result
 * @since 1.9.0
 */
export function integrateDebuggerWithFederation<TContextData>(
  federation: Federation<TContextData>,
  options: IntegrateDebuggerOptions = {},
): DebuggerIntegration<TContextData> {
  const {
    path = "/__debugger__",
    ...observerOptions
  } = options;

  // Create the debug observer
  const observer = new DebugObserver<TContextData>({
    path,
    ...observerOptions,
  });

  // For Federation instances, we need to add observers differently
  // This might require changes to the Federation API
  console.warn(
    `[Fedify Debugger] Direct federation integration not yet supported. ` +
      `Please use integrateDebugger with FederationBuilder instead.`,
  );

  return {
    observer,
    handler: createDebugHandler(observer),
    path,
  };
}

/**
 * Creates a standalone debugger setup for manual integration.
 *
 * This is the most flexible approach, giving you full control over
 * how the debugger is integrated.
 *
 * @example
 * ```typescript
 * import { createFederation } from "@fedify/fedify";
 * import { createDebugger } from "@fedify/debugger";
 * import { Hono } from "hono";
 *
 * const { observer, handler } = createDebugger({
 *   maxActivities: 1000,
 * });
 *
 * const federation = createFederation({
 *   kv: new MemoryKvStore(),
 *   observers: [observer],
 * });
 *
 * const app = new Hono();
 * app.route("/__debugger__", handler);
 * ```
 *
 * @param options Debugger configuration options
 * @returns The observer and handler
 * @since 1.9.0
 */
export function createDebugger<TContextData>(
  options: DebugObserverOptions = {},
): {
  observer: DebugObserver<TContextData>;
  handler: ReturnType<typeof createDebugHandler>;
} {
  const observer = new DebugObserver<TContextData>(options);
  const handler = createDebugHandler(observer);

  return { observer, handler };
}
