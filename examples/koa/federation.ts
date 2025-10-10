import { createFederation, MemoryKvStore, Note, Person } from "@fedify/fedify";

export const federation = createFederation<void>({
  kv: new MemoryKvStore(),
});

federation.setActorDispatcher("/users/{handle}", (ctx, handle) => {
  return new Person({
    id: ctx.getActorUri(handle),
    preferredUsername: handle,
  });
});

federation.setObjectDispatcher(
  Note,
  "/users/{handle}/{id}",
  (ctx, values) => {
    return new Note({
      id: ctx.getObjectUri(Note, values),
      name: values.id,
    });
  },
);
