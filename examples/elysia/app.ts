import { fedify } from "@fedify/elysia";
import { createFederation, MemoryKvStore } from "@fedify/fedify";
import { Person } from "@fedify/vocab";
import { Elysia, redirect } from "elysia";

const federation = createFederation<void>({
  kv: new MemoryKvStore(),
});

federation.setNodeInfoDispatcher("/nodeinfo/2.1", (ctx) => {
  return {
    software: {
      name: "fedify-elysia", // Lowercase, digits, and hyphens only.
      version: "1.0.0",
      homepage: new URL(ctx.canonicalOrigin),
    },
    protocols: ["activitypub"],
    usage: {
      // Usage statistics is hard-coded here for demonstration purposes.
      // You should replace these with real statistics:
      users: { total: 1, activeHalfyear: 1, activeMonth: 1 },
      localPosts: 0,
      localComments: 0,
    },
  };
});

federation.setActorDispatcher("/{identifier}", (ctx, identifier) => {
  if (identifier !== "sample") return null;
  return new Person({
    id: ctx.getActorUri(identifier),
    name: "Sample",
    preferredUsername: identifier,
  });
});

const app = new Elysia();

app
  .use(fedify(federation, () => undefined))
  .get("/", () => redirect("sample"))
  .get("/sample", () => "Hi, I am Sample!\n")
  .listen(3000);

console.log("Elysia App Start!");
