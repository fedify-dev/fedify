import { createFederation, MemoryKvStore } from "@fedify/fedify/federation";
import { federation } from "@fedify/hono";
import { Person } from "@fedify/vocab";
import { Hono } from "hono";

const fedi = createFederation<void>({
  kv: new MemoryKvStore(),
});

fedi.setActorDispatcher("/{identifier}", (ctx, identifier) => {
  if (identifier !== "sample") return null;
  return new Person({
    id: ctx.getActorUri(identifier),
    name: "Sample",
    preferredUsername: identifier,
  });
});

const app: Hono = new Hono();
app.use(federation(fedi, () => undefined));
app.get("/", (c) => c.redirect("/sample"));
app.get("/sample", (c) => c.text("Hi, I am Sample!\n"));

if (import.meta.main) Deno.serve(app.fetch.bind(app));

export default app;
