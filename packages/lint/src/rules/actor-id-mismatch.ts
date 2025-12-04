import { properties } from "../lib/const.ts";
import { createMismatchRule } from "../lib/mismatch-rule-factory.ts";

export const ACTOR_ID_MISMATCH = "actor-id-mismatch" as const;

/**
 * Lint rule that checks if the actor's `id` property uses the correct
 * `ctx.getActorUri(identifier)` method call.
 *
 * This is a `*-mismatch` rule that validates the VALUE of the property,
 * not just its existence. For checking property existence, use `actor-id-required`.
 */
const actorIdMismatch = createMismatchRule({
  propertyPath: properties.id.name,
  methodName: properties.id.getter,
});

export default actorIdMismatch;
