/**
 * The `ctx.federation` accessor: a Macroable getter on `HttpContext` (like
 * `ctx.view`) that reads a per-request factory the middleware stores on the
 * instance, and memoises the result.
 *
 * @module
 */
import { HttpContext } from "@adonisjs/core/http";
import type { RequestContext } from "@fedify/fedify";

import { E_FEDIFY_CONTEXT_UNAVAILABLE } from "./errors.ts";

/**
 * The per-request slot holding the factory for `ctx.federation`.  A
 * registered symbol so the ESM and CommonJS builds share it, keyed by major
 * version so another major in the same process gets its own.
 */
const FACTORY: unique symbol = Symbol.for(
  "@fedify/adonisjs@2/federation-factory",
);

/**
 * The accessors this module has installed, so a `federation` member defined
 * by somebody else can be told apart from ours.  `Macroable.getter()` wraps
 * the function it is given, hence a registry rather than a marker; it lives on
 * `globalThis` for the same reasons as {@link FACTORY}.
 */
const INSTALLED: unique symbol = Symbol.for(
  "@fedify/adonisjs@2/federation-getters",
);

const registry = globalThis as { [INSTALLED]?: WeakSet<object> };

const installedGetters: WeakSet<object> = registry[INSTALLED] ??= new WeakSet();

/**
 * The shape of a context that carries the {@link FACTORY} slot.
 */
type FactoryCarrier = {
  [FACTORY]?: () => RequestContext<unknown>;
};

/**
 * A context class the getter can be installed on.
 */
export type HttpContextClass = typeof HttpContext;

/**
 * Records how to create the `RequestContext` for `ctx`; the getter runs
 * `create` on first access.
 */
export function setFederationContextFactory<TContextData>(
  ctx: HttpContext,
  create: () => RequestContext<TContextData>,
): void {
  Object.defineProperty(ctx, FACTORY, {
    value: create,
    configurable: true,
    enumerable: false,
    writable: true,
  });
}

/**
 * Installs the `federation` getter on a context class, once per class.  The
 * middleware also calls this on `ctx.constructor`, which covers an
 * application with its own copy of `@adonisjs/core`.  Macroable's
 * `singleton` flag memoises the value on the instance.
 *
 * @returns `false` when a `federation` member somebody else defined is in the
 *   way; nothing is changed then, and the caller decides how to report it.
 */
export function ensureFederationGetter(
  target: HttpContextClass = HttpContext,
): boolean {
  const existing = Object.getOwnPropertyDescriptor(
    target.prototype,
    "federation",
  );
  if (existing !== undefined) return isOwnGetter(existing.get);

  target.getter("federation", function (this: HttpContext) {
    const create = (this as HttpContext & FactoryCarrier)[FACTORY];
    if (create === undefined) {
      throw new E_FEDIFY_CONTEXT_UNAVAILABLE(this.request.url());
    }
    return create() as HttpContext["federation"];
  }, true);

  // Record the wrapper Macroable actually installed.
  const installed = Object.getOwnPropertyDescriptor(
    target.prototype,
    "federation",
  )?.get;
  if (installed !== undefined) installedGetters.add(installed);

  return true;
}

/**
 * {@link ensureFederationGetter}, but a conflict throws.  Called from the
 * provider's `boot()`.
 */
export function installFederationGetter(
  target: HttpContextClass = HttpContext,
): void {
  if (ensureFederationGetter(target)) return;

  throw new Error(
    'Cannot install "ctx.federation": the HttpContext class already has a ' +
      '"federation" member that @fedify/adonisjs did not define. Remove the ' +
      "conflicting macro or getter, or rename it",
  );
}

function isOwnGetter(fn: unknown): boolean {
  return typeof fn === "function" && installedGetters.has(fn);
}
