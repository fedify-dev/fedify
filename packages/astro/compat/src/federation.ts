import { createFederation, MemoryKvStore } from "@fedify/fedify";
import { Note, Person } from "@fedify/vocab";

const federation = createFederation<void>({ kv: new MemoryKvStore() });

federation.setActorDispatcher(
  "/users/{identifier}",
  (context, identifier) =>
    identifier === "alice"
      ? new Person({
        id: context.getActorUri(identifier),
        name: "Alice",
        preferredUsername: identifier,
        url: context.getActorUri(identifier),
      })
      : null,
);

federation.setObjectDispatcher(
  Note,
  "/objects/{id}",
  (context, values) =>
    values.id === "test"
      ? new Note({
        id: context.getObjectUri(Note, values),
        content: "Test note",
      })
      : null,
);

export default federation;
