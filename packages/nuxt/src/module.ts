import {
  addServerHandler,
  addServerPlugin,
  addServerTemplate,
  createResolver,
  defineNuxtModule,
  resolveAlias,
} from "@nuxt/kit";
import type { Nuxt, NuxtModule } from "@nuxt/schema";
import type { H3Event } from "h3";
import { isAbsolute, resolve } from "node:path";

/**
 * A factory function that creates context data for the Federation instance.
 */
export type ContextDataFactory<TContextData> = (
  event: H3Event,
  request: Request,
) => TContextData | Promise<TContextData>;

export interface ModuleOptions {
  /**
   * Path to a module that exports the configured Federation instance.
   *
   * The module must export either:
   *  - a default export of `Federation`, or
   *  - a named export `federation`.
   */
  federationModule: string;

  /**
   * Optional path to a module that exports context data factory.
   *
   * The module must export either:
   *  - a default export function, or
   *  - a named export `contextDataFactory`.
   */
  contextDataFactoryModule?: string;
}

export function resolveModulePath(
  modulePath: string,
  aliases: Record<string, string>,
  rootDir: string,
): string {
  const resolved = resolveAlias(modulePath, aliases);
  if (isAbsolute(resolved)) return resolved;
  return resolve(rootDir, resolved);
}

export function buildContextFactoryResolver(
  contextDataFactoryModule: string | null,
): string {
  if (contextDataFactoryModule == null) {
    return "const contextDataFactory = undefined;";
  }
  return `
const contextDataFactory =
  contextFactoryModule.default ??
  contextFactoryModule.contextDataFactory;
if (contextDataFactory == null) {
  throw new TypeError(
    \'@fedify/nuxt: contextDataFactoryModule must export a function as "default" or named "contextDataFactory", but neither was found.\'
  );
}
if (typeof contextDataFactory !== 'function') {
  throw new TypeError(
    \'@fedify/nuxt: contextDataFactoryModule must export a function as "default" or named "contextDataFactory".\'
  );
}`;
}

/**
 * Nuxt module to integrate Fedify with Nuxt/Nitro request handling.
 */
const fedifyNuxtModule: NuxtModule<ModuleOptions, ModuleOptions, false> =
  defineNuxtModule<ModuleOptions>({
    meta: {
      name: "@fedify/nuxt",
      configKey: "fedify",
    },
    defaults: {
      federationModule: "#server/federation",
      contextDataFactoryModule: undefined,
    },
    setup(options: ModuleOptions, nuxt: Nuxt) {
      const resolver = createResolver(import.meta.url);
      const rootDir = nuxt.options.rootDir;
      const federationModule = resolveModulePath(
        options.federationModule,
        nuxt.options.alias,
        rootDir,
      );
      const contextDataFactoryModule = options.contextDataFactoryModule == null
        ? undefined
        : resolveModulePath(
          options.contextDataFactoryModule,
          nuxt.options.alias,
          rootDir,
        );

      const middlewareFilename = "fedify-nuxt-options.mjs";

      addServerTemplate({
        filename: middlewareFilename,
        getContents: () => {
          const imports = [
            `import * as federationModule from ${
              JSON.stringify(federationModule)
            };`,
            `import { createFedifyMiddleware } from ${
              JSON.stringify(
                resolver.resolve("../src/runtime/server/middleware.ts"),
              )
            };`,
          ];

          if (contextDataFactoryModule != null) {
            imports.push(
              `import * as contextFactoryModule from ${
                JSON.stringify(contextDataFactoryModule)
              };`,
            );
          }

          return [
            ...imports,
            "const federation = federationModule.default ?? federationModule.federation;",
            buildContextFactoryResolver(contextDataFactoryModule ?? null),
            "export default createFedifyMiddleware(federation, contextDataFactory);",
            "",
          ].join("\n");
        },
      });

      addServerHandler({
        route: "",
        middleware: true,
        handler: middlewareFilename,
      });

      addServerPlugin(resolver.resolve("../src/runtime/server/plugin.ts"));
    },
  });

export default fedifyNuxtModule;
