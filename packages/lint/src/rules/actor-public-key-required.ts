import { properties } from "../lib/const.ts";
import { createRequiredRule } from "../lib/required-rule-factory.ts";

export const ACTOR_PUBLIC_KEY_REQUIRED = "actor-public-key-required";

const actorPublicKeyRequired: Deno.lint.Rule = createRequiredRule(
  properties.publicKey,
);

export default actorPublicKeyRequired;
