import { createFederation, MemoryKvStore } from "@fedify/fedify";
import { Note, Person } from "@fedify/vocab";

export const federation = createFederation<void>({
  kv: new MemoryKvStore(),
});

federation.setActorDispatcher("/users/{identifier}", (ctx, identifier) => {
  return new Person({
    id: ctx.getActorUri(identifier),
    preferredUsername: identifier,
  });
});

federation.setObjectDispatcher(
  Note,
  "/users/{identifier}/{id}",
  (ctx, values) => {
    return new Note({
      id: ctx.getObjectUri(Note, values),
      name: values.id,
    });
  },
);
