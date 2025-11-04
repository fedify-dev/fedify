import type { Federation, FederationFetchOptions } from "@fedify/fedify";
import { createFederation, MemoryKvStore } from "@fedify/fedify";
import type { Context, Middleware } from "fresh";
import { define, type State } from "../utils.ts";

/**
 * Creates federation fetch options for Fresh 2.0 context.
 * Handles 404 and 406 responses by delegating to Fresh's routing system.
 */
function integrateFetchOptions<TState>(
  ctx: Context<TState>,
): Omit<FederationFetchOptions<void>, "contextData"> {
  return {
    onNotFound: ctx.next.bind(ctx),
    async onNotAcceptable(_request: Request) {
      const response = await ctx.next();
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

/**
 * Integrates Fedify federation with Fresh 2.0 middleware.
 *
 * @param federation - The Fedify federation instance
 * @param createContextData - Function to create context data from Fresh context
 * @returns A Fresh middleware function
 */
function integrateHandler<TContextData, TState>(
  federation: Federation<TContextData>,
  createContextData: (
    ctx: Context<TState>,
  ) => TContextData | Promise<TContextData>,
): Middleware<TState> {
  return async (ctx: Context<TState>): Promise<Response> => {
    const contextData = await createContextData(ctx);
    return await federation.fetch(ctx.req, {
      contextData,
      ...integrateFetchOptions(ctx),
    });
  };
}

// Create the federation instance
const federation = createFederation<void>({
  kv: new MemoryKvStore(),
});

//federation example
federation
  .setNodeInfoDispatcher("/nodeinfo/2.1", () => {
    return {
      software: {
        name: "your-software-name", // Lowercase, digits, and hyphens only.
        version: "1.0.0",
        homepage: new URL("https://your-software.com/"),
      },
      protocols: ["activitypub"],
      usage: {
        // Usage statistics is hard-coded here for demonstration purposes.
        // You should replace these with real statistics:
        users: { total: 100, activeHalfyear: 50, activeMonth: 20 },
        localPosts: 1000,
        localComments: 2000,
      },
    };
  });

// Export the middleware
export default define.middleware(
  integrateHandler<void, State>(federation, () => undefined),
);
