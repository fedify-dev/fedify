import { createFederation, MemoryKvStore } from "@fedify/fedify";
import { Person } from "@fedify/vocab";
import Fastify from "fastify";
import fedifyPlugin from "../../packages/fastify/src/index.ts";

const fastify = Fastify({ logger: true });

const federation = createFederation<void>({
  kv: new MemoryKvStore(),
});

// Add a simple actor
federation.setActorDispatcher(
  "/users/{identifier}",
  (ctx, identifier) => {
    return new Person({
      id: ctx.getActorUri(identifier),
      name: identifier,
      summary: "This is a summary of the user",
      preferredUsername: identifier,
      url: new URL("/", ctx.url),
    });
  },
);

// Regular application routes
fastify.get("/", () => {
  return {
    message: "Hello World! This is a Fastify server with Fedify integration.",
  };
});

// Start the server
const start = async () => {
  // Register the Fedify plugin
  await fastify.register(fedifyPlugin, {
    federation,
    contextDataFactory: () => undefined,
  });

  await fastify.listen({ port: 3000, host: "0.0.0.0" });
  console.log("Server listening on http://localhost:3000");
  console.log("Try visiting:");
  console.log("- http://localhost:3000/ (regular route)");
  console.log("- http://localhost:3000/users/alice (federation route)");
};

start();
