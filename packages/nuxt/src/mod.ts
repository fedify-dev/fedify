import {
  addServerHandler,
  addServerPlugin,
  addTemplate,
  createResolver,
  defineNuxtModule,
  resolveAlias,
} from "@nuxt/kit";
import type { H3Event } from "h3";

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

/**
 * Nuxt module to integrate Fedify with Nuxt/Nitro request handling.
 */
const fedifyNuxtModule: ReturnType<typeof defineNuxtModule<ModuleOptions>> =
  defineNuxtModule<ModuleOptions>({
    meta: {
      name: "@fedify/nuxt",
      configKey: "fedify",
    },
    defaults: {
      federationModule: "~/server/federation",
      contextDataFactoryModule: undefined,
    },
    setup(
      options: ModuleOptions,
      nuxt: { options: { alias: Record<string, string> } },
    ) {
      const resolver = createResolver(import.meta.url);
      const federationModule = resolveAlias(
        options.federationModule,
        nuxt.options.alias,
      );
      const contextDataFactoryModule = options.contextDataFactoryModule == null
        ? undefined
        : resolveAlias(options.contextDataFactoryModule, nuxt.options.alias);

      const middlewareTemplate = addTemplate({
        filename: "fedify-nuxt-options.mjs",
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

          const contextFactoryResolver = contextDataFactoryModule == null
            ? "const contextDataFactory = undefined;"
            : [
              "const contextDataFactory =",
              "  contextFactoryModule.default ??",
              "  contextFactoryModule.contextDataFactory;",
            ].join("\n");

          return [
            ...imports,
            "const federation = federationModule.default ?? federationModule.federation;",
            contextFactoryResolver,
            "export default createFedifyMiddleware(federation, contextDataFactory);",
            "",
          ].join("\n");
        },
      });

      addServerHandler({
        route: "",
        middleware: true,
        handler: middlewareTemplate.dst,
      });

      addServerPlugin(resolver.resolve("../src/runtime/server/plugin.ts"));
    },
  });

export default fedifyNuxtModule;
