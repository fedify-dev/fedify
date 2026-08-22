/**
 * The AdonisJS server middleware that mounts Fedify.
 *
 * Register it in the **server** stack of `start/kernel.ts` — the `configure`
 * hook does this automatically:
 *
 * ```ts
 * server.use([
 *   // ...
 *   () => import('@fedify/adonisjs/middleware'),
 * ])
 * ```
 *
 * All of the actual work lives in `middleware.ts`; this class only resolves the
 * federation instance and the configuration from the IoC container.
 *
 * @module
 */
import type { HttpContext } from "@adonisjs/core/http";
import type { NextFn } from "@adonisjs/core/types/http";

import { fedifyMiddleware } from "./middleware.ts";
import type { ContextData } from "./types.ts";

export default class FedifyMiddleware {
  /**
   * Nothing is cached here on purpose.
   *
   * AdonisJS constructs a fresh middleware instance for every request, so an
   * instance field would never be read twice, and `ContainerResolver` does not
   * expose the application it belongs to, so a keyed module-level cache cannot
   * be built safely either.  It does not matter: both bindings are memoised by
   * the service provider, so resolving them is a map lookup, and
   * `fedifyMiddleware` only closes over its three arguments.
   *
   * The request-scoped resolver is used rather than the application container
   * so that resolution participates in whatever request-scoped bindings the
   * application has registered.  Both reach the same singletons.
   */
  async handle(ctx: HttpContext, next: NextFn): Promise<void> {
    const federation = await ctx.containerResolver.make("fedify");
    const config = await ctx.containerResolver.make("fedify.config");

    const Middleware = fedifyMiddleware<ContextData>(
      federation,
      config.contextDataFactory,
      {
        ignoreRoutePrefixes: config.ignoreRoutePrefixes,
      },
    );

    return new Middleware().handle(ctx, next);
  }
}
