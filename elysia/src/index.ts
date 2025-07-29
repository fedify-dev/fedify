import { type Federation } from "@fedify/fedify";
import type { Elysia } from "elysia";

export const fedify = <TContextData = unknown>(
  federation: Federation<TContextData>,
) => {
  return (app: Elysia) =>
    app
      .decorate("federation", federation)
      .onRequest(async ({ request, set }) => {
        console.log("bye");
        let notFound = false;
        let notAcceptable = false;

        // Create context data - you may want to make this configurable
        const contextData = {} as TContextData;

        const response = await federation.fetch(request, {
          contextData,
          onload: () => {
            console.log("dfsfdsfds");
          },
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

        // If federation handled the request, return the response
        if (notFound || (notAcceptable && request != null)) {
          console.log("hi!");
          set.status = response.status;

          response.headers.forEach((value, key) => {
            set.headers[key] = value;
          });

          return response;
        }
      })
      .as("global");
};
