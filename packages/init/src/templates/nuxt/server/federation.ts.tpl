import { createFederation } from "@fedify/fedify";
import { Person } from "@fedify/vocab";
import { getLogger } from "@logtape/logtape";
/* imports */

const logger = getLogger(/* logger */);

export default (async () => {
  const federation = createFederation({
    kv: /* kv */,
    queue: /* queue */,
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

  return federation;
})();