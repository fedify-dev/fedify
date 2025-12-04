import { actorKeyPropertyRequired } from "../lib/messages.ts";
import { createRequiredRule } from "../lib/required-rule-factory.ts";

export const ACTOR_ASSERTION_METHOD_REQUIRED =
  "actor-assertion-method-required";

const actorAssertionMethodRequired: Deno.lint.Rule = createRequiredRule({
  propertyName: "assertionMethod",
  dispatcherMethod: "setKeyPairsDispatcher",
  errorMessage: actorKeyPropertyRequired("assertionMethod"),
});

export default actorAssertionMethodRequired;
