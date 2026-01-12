import { createFederation, MemoryKvStore } from "@fedify/fedify";
import { Note, Person } from "@fedify/vocab";

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
