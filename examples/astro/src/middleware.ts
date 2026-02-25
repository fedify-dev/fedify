import { fedifyMiddleware } from "@fedify/astro";
import { createFederation, MemoryKvStore } from "@fedify/fedify";
import { Image, Person } from "@fedify/vocab";

const federation = createFederation<void>({
  kv: new MemoryKvStore(),
});

federation.setActorDispatcher("/{identifier}", (context, identifier) => {
  if (identifier !== "demo") return null;
  return new Person({
    id: context.getActorUri(identifier),
    name: "Fedify Demo",
    preferredUsername: identifier,
    summary: "This is a demo actor for the Fedify Astro integration demo.",
    url: context.getActorUri(identifier),
    icon: new Image({ url: new URL("/demo-profile.png", context.url) }),
  });
});

export const onRequest = fedifyMiddleware(federation, (_context) => undefined);
