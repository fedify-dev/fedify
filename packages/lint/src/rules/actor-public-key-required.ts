import { actorKeyPropertyRequired } from "../lib/messages.ts";
import { createRequiredRule } from "../lib/required-rule-factory.ts";

export const ACTOR_PUBLIC_KEY_REQUIRED = "actor-public-key-required";

const actorPublicKeyRequired: Deno.lint.Rule = createRequiredRule({
  propertyName: "publicKey",
  dispatcherMethod: "setKeyPairsDispatcher",
  errorMessage: actorKeyPropertyRequired("publicKey"),
});

export default actorPublicKeyRequired;
