import { createFederation, MemoryKvStore } from "@fedify/fedify";
import { Person } from "@fedify/vocab";

// Create the federation instance
export const federation = createFederation<void>({
  kv: new MemoryKvStore(),
});

// Set up a NodeInfo dispatcher for the federation instance
federation.setNodeInfoDispatcher("/nodeinfo/2.1", () => {
  return {
    software: {
      name: "fresh-example", // Lowercase, digits, and hyphens only.
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

federation.setActorDispatcher("/users/{identifier}", (ctx, identifier) => {
  if (identifier !== "sample") return null;
  return new Person({
    id: ctx.getActorUri(identifier),
    name: "Sample",
    preferredUsername: identifier,
  });
});
