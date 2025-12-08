import { properties } from "../lib/const.ts";
import { createMismatchRule } from "../lib/mismatch-rule-factory.ts";

export const ACTOR_OUTBOX_PROPERTY_MISMATCH =
  "actor-outbox-property-mismatch" as const;

const actorOutboxPropertyMismatch: Deno.lint.Rule = createMismatchRule(
  properties.outbox,
);

export default actorOutboxPropertyMismatch;
