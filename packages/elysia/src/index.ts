import type { Federation } from "@fedify/fedify";
import type { AnyElysia } from "elysia";

export type ContextDataFactory<TContextData> = (
  req?: Request,
) => TContextData | Promise<TContextData>;

export const fedify = <TContextData = unknown>(
  federation: Federation<TContextData>,
  contextDataFactory: ContextDataFactory<TContextData>,
): (app: AnyElysia) => AnyElysia => {
  return (app: AnyElysia) =>
    app
      .decorate("federation", federation)
      .onRequest(async ({ request, set, federation }) => {
        let notFound = false;
        let notAcceptable = false;

        // Create context data using the factory or default to empty object
        const contextData = await contextDataFactory(request);

        const response: Response = await federation.fetch(request, {
          contextData,
          onNotFound: () => {
            // Let Elysia handle non-federation routes
            notFound = true;
            return new Response("Not found", { status: 404 });
          },
          onNotAcceptable: () => {
            // Let Elysia handle when federation doesn't accept the request
            notAcceptable = true;
            return new Response("Not acceptable", {
              status: 406,
              headers: {
                "Content-Type": "text/plain",
                Vary: "Accept",
              },
            });
          },
        });

        if (!notFound && !notAcceptable) {
          set.status = response.status;

          // Return response body if it exists
          if (response.body) {
            return response;
          }

          response.headers.forEach((value, key) => {
            set.headers[key] = value;
          });

          // Return empty response for successful requests without body
          return new Response(null, { status: response.status });
        }

        // Continue to next handler if federation didn't handle the request
      })
      .as("global");
};
