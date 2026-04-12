import { createFederation } from "@fedify/fedify";
import { MemoryKvStore } from "@fedify/fedify";
import { Person } from "@fedify/vocab";
import { getLogger } from "@logtape/logtape";

const logger = getLogger("nuxt");

const federation = createFederation({
  kv: new MemoryKvStore(),
});

federation.setActorDispatcher(
  "/users/{identifier}",
  async (ctx, identifier) => {
    return new Person({
      id: ctx.getActorUri(identifier),
      preferredUsername: identifier,
      name: identifier,
    });
  },
);

export default federation;
