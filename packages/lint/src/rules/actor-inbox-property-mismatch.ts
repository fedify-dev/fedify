import { properties } from "../lib/const.ts";
import { createMismatchRule } from "../lib/mismatch-rule-factory.ts";

export const ACTOR_INBOX_PROPERTY_MISMATCH =
  "actor-inbox-property-mismatch" as const;

const actorInboxPropertyMismatch: Deno.lint.Rule = createMismatchRule(
  properties.inbox,
);

export default actorInboxPropertyMismatch;
