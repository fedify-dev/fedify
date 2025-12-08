import { properties } from "../lib/const.ts";
import { createRequiredRule } from "../lib/required-rule-factory.ts";

export const ACTOR_ID_REQUIRED = "actor-id-required" as const;

/**
 * Lint rule that checks if the actor's `id` property EXISTS in the returned object.
 *
 * This is a `*-required` rule that only validates property existence.
 * For checking if the value uses the correct `ctx.getActorUri()` method,
 * use `actor-id-mismatch`.
 */
const actorIdRequired = createRequiredRule(properties.id);

export default actorIdRequired;
