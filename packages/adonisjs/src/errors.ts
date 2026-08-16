/**
 * Exceptions raised by `@fedify/adonisjs`.
 *
 * They extend AdonisJS's `Exception` base class, so applications can match on
 * `error.code` and the framework's exception handler renders them with the
 * right HTTP status.
 *
 * Every message says what to do about the problem rather than only what went
 * wrong: all three of these are configuration and lifecycle mistakes whose
 * natural symptom would otherwise be a silent 404 from every federation
 * endpoint.
 *
 * @module
 */
import { Exception } from "@adonisjs/core/exceptions";

/**
 * Raised when `config/fedify.ts` is missing, or does not export the result of
 * `defineConfig()`.
 */
export class E_INVALID_FEDIFY_CONFIG extends Exception {
  static override code = "E_INVALID_FEDIFY_CONFIG";
  static override status = 500;
  static override message =
    'Invalid "config/fedify.ts" file. Make sure to export the return value of the "defineConfig" method';
}

/**
 * Raised when the `Federation` instance is resolved from the container before
 * the application has finished booting.
 *
 * Dispatchers are registered on the `FederationBuilder` by preload files, and
 * the builder can only be turned into a `Federation` once every preload has
 * run.  Resolving `'fedify'` earlier would silently produce a `Federation` with
 * no routes at all, which is far harder to debug than an explicit error.
 */
export class E_FEDERATION_NOT_READY extends Exception {
  static override code = "E_FEDERATION_NOT_READY";
  static override status = 500;
  static override message =
    'The Federation instance is not available yet. It is built after the application boots, so it cannot be resolved from a service provider\'s register or boot method. Use "ctx.federation" inside HTTP requests, the "Context" argument inside dispatchers, or resolve it with "app.container.make(\'fedify\')" from code that runs once the application is ready';
}

/**
 * Raised when `ctx.federation` is accessed on a request the Fedify middleware
 * deliberately skipped, or on a request it never saw at all.
 */
export class E_FEDIFY_CONTEXT_UNAVAILABLE extends Exception {
  static override code = "E_FEDIFY_CONTEXT_UNAVAILABLE";
  static override status = 500;

  constructor(path: string) {
    super(
      `Cannot access "ctx.federation" for "${path}". Either the request path matches "ignoreRoutePrefixes" in config/fedify.ts, or the Fedify middleware is not registered in the server middleware stack of start/kernel.ts`,
    );
  }
}
