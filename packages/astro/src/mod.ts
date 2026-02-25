/**
 * Fedify with Astro
 * =================
 *
 * This package provides an [Astro] integration and middleware to integrate
 * with the Fedify.
 *
 * [Astro]: https://astro.build/
 *
 * @module
 * @since 2.1.0
 */
import type {
  Federation,
  FederationFetchOptions,
} from "@fedify/fedify/federation";
import type { APIContext, AstroIntegration, MiddlewareHandler } from "astro";

/**
 * A factory function to create a context data for the {@link Federation}
 * object.
 *
 * @template TContextData A type of the context data for the
 *                        {@link Federation} object.
 * @param context An Astro context object.
 * @returns A context data for the {@link Federation} object.
 * @since 2.1.0
 */
export type ContextDataFactory<TContextData> = (
  context: APIContext,
) => TContextData | Promise<TContextData>;

/**
 * Create an Astro integration that configures Vite SSR settings for
 * Fedify compatibility.
 *
 * This integration adds `@fedify/fedify` and `@fedify/vocab` to Vite's
 * `ssr.noExternal` list, which is necessary because these packages contain
 * dependencies that Vite must bundle for SSR.
 *
 * @example astro.config.mjs
 * ``` typescript
 * import { defineConfig } from "astro/config";
 * import { fedifyIntegration } from "@fedify/astro";
 *
 * export default defineConfig({
 *   integrations: [fedifyIntegration()],
 *   output: "server",
 * });
 * ```
 *
 * @returns An Astro integration object.
 * @since 2.1.0
 */
export function fedifyIntegration(): AstroIntegration {
  return {
    name: "@fedify/astro",
    hooks: {
      "astro:config:setup": ({ updateConfig }) => {
        updateConfig({
          vite: {
            ssr: {
              noExternal: ["@fedify/fedify", "@fedify/vocab"],
            },
          },
        });
      },
    },
  };
}

/**
 * Create an Astro middleware to integrate with the {@link Federation} object.
 *
 * @example src/middleware.ts
 * ``` typescript
 * import { createFederation } from "@fedify/fedify";
 * import { fedifyMiddleware } from "@fedify/astro";
 *
 * const federation = createFederation<void>({
 *   // Omitted for brevity; see the related section for details.
 * });
 *
 * export const onRequest = fedifyMiddleware(
 *   federation,
 *   (context) => undefined,
 * );
 * ```
 *
 * @template TContextData A type of the context data for the
 *                        {@link Federation} object.
 * @param federation A {@link Federation} object to integrate with Astro.
 * @param contextDataFactory A function to create a context data for the
 *                           {@link Federation} object.
 * @returns An Astro middleware function.
 * @since 2.1.0
 */
export function fedifyMiddleware<TContextData>(
  federation: Federation<TContextData>,
  contextDataFactory: ContextDataFactory<TContextData>,
): MiddlewareHandler {
  return async (context, next) => {
    const contextData = await contextDataFactory(context);
    return await federation.fetch(context.request, {
      contextData,
      ...integrateFetchOptions(next),
    });
  };
}

function integrateFetchOptions(
  next: () => Promise<Response>,
): Omit<FederationFetchOptions<void>, "contextData"> {
  return {
    // If the `federation` object finds a request not responsible for it
    // (i.e., not a federation-related request), it will call the `next`
    // provided by the Astro framework to continue the request handling
    // by Astro:
    async onNotFound(_request: Request): Promise<Response> {
      return await next();
    },

    // Similar to `onNotFound`, but slightly more tricky one.
    // When the `federation` object finds a request not acceptable type-wise
    // (i.e., a user-agent doesn't want JSON-LD), it will call the `next`
    // provided by the Astro framework so that it renders HTML if there's some
    // page.  Otherwise, it will simply return a 406 Not Acceptable response.
    // This kind of trick enables the Fedify and Astro to share the same routes
    // and they do content negotiation depending on `Accept` header:
    async onNotAcceptable(_request: Request): Promise<Response> {
      const response = await next();
      if (response.status !== 404) return response;
      return new Response("Not acceptable", {
        status: 406,
        headers: {
          "Content-Type": "text/plain",
          Vary: "Accept",
        },
      });
    },
  };
}
