/**
 * `@fedify/adonisjs` — integrate [Fedify] with [AdonisJS].
 *
 * The package has two layers.  Most applications only need the first:
 *
 * 1. **The AdonisJS-native layer.**  Run `node ace configure @fedify/adonisjs`
 *    and the package installs a service provider, a server middleware, a
 *    `config/fedify.ts` file built with {@link defineConfig}, and a
 *    `start/federation.ts` preload file.  Dispatchers are registered on the
 *    builder exported by `@fedify/adonisjs/services/builder`, and every request
 *    gets a `ctx.federation` context.
 *
 * 2. **The plain middleware layer.**  {@link fedifyMiddleware} — the default
 *    export — takes a `Federation` instance and an optional context-data
 *    factory and returns an AdonisJS middleware, with no container or
 *    configuration involved.  This mirrors `integrateFederation()` from
 *    `@fedify/express` and is there for applications that build their
 *    `Federation` object themselves.
 *
 * [Fedify]: https://fedify.dev/
 * [AdonisJS]: https://adonisjs.com/
 *
 * @module
 */
export { configure } from "./configure.ts";
// Re-exported so that `node ace eject <stub> --pkg=@fedify/adonisjs` can find
// the templates; the configure command picks it up from here too.
export { stubsRoot } from "./stubs/main.ts";
export { defineConfig } from "./src/define_config.ts";
export { default, fedifyMiddleware } from "./src/middleware.ts";
export { configureFedifyLogging } from "./src/logging.ts";
export {
  E_FEDERATION_NOT_READY,
  E_FEDIFY_CONTEXT_UNAVAILABLE,
  E_INVALID_FEDIFY_CONFIG,
} from "./src/errors.ts";

export type {
  FedifyMiddlewareClass,
  FedifyMiddlewareHandler,
  FedifyMiddlewareOptions,
} from "./src/middleware.ts";
export type { FedifyLoggingOptions } from "./src/logging.ts";
export type {
  ContextData,
  ContextDataFactory,
  FedifyConfig,
  FedifyLoggingConfig,
  FedifyTypes,
  ResolvedFedifyConfig,
} from "./src/types.ts";
