import { createFederation, MemoryKvStore } from "@fedify/fedify";
import { integrateHandler } from "@fedify/fresh";
import { define, type State } from "../utils.ts";

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
