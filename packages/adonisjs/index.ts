/**
 * `@fedify/adonisjs` — integrate [Fedify] with [AdonisJS].
 *
 * The package has two layers.  Most applications only need the first:
 *
 * 1. **The AdonisJS-native layer.**  Run `node ace configure @fedify/adonisjs`
 *    and the package installs the service provider
 *    (`@fedify/adonisjs/fedify_provider`), the server middleware
 *    (`@fedify/adonisjs/fedify_middleware`), a `config/fedify.ts` file built
 *    with {@link defineConfig}, and a `start/federation.ts` preload file.  The
 *    provider constructs the middleware from the built `Federation` and the
 *    configuration, dispatchers are registered on the builder exported by
 *    `@fedify/adonisjs/services/builder`, and every request gets a
 *    `ctx.federation` context.
 *
 * 2. **The plain middleware layer.**  {@link fedifyMiddleware} — the default
 *    export — takes a `Federation` instance and a context-data factory
 *    (optional only when the context data admits `undefined`) and returns an
 *    AdonisJS middleware class, with no container or
 *    configuration involved.  This mirrors `integrateFederation()` from
 *    `@fedify/express` and is there for applications that build their
 *    `Federation` object themselves.  {@link FedifyMiddleware} is the class
 *    behind both layers.
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
// The default export is the main integration function, per Fedify's
// integration guide; the class behind it is exported by name.
export {
  default as FedifyMiddleware,
  fedifyMiddleware,
  fedifyMiddleware as default,
} from "./src/fedify_middleware.ts";
export { configureFedifyLogging } from "./src/logging.ts";
export {
  E_FEDERATION_NOT_READY,
  E_FEDIFY_CONTEXT_UNAVAILABLE,
  E_INVALID_FEDIFY_CONFIG,
  E_MISSING_FEDERATION,
} from "./src/errors.ts";

export type {
  FedifyMiddlewareArgs,
  FedifyMiddlewareClass,
  FedifyMiddlewareHandler,
  FedifyMiddlewareOptions,
} from "./src/fedify_middleware.ts";
export type { FedifyLoggingOptions } from "./src/logging.ts";
export type {
  ContextData,
  ContextDataFactory,
  ContextDataFactoryOption,
  FedifyConfig,
  FedifyConfigBase,
  FedifyLoggingConfig,
  FedifyTypes,
  ResolvedFedifyConfig,
} from "./src/types.ts";
