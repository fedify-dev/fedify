import { properties } from "../lib/const.ts";
import { createMismatchRule } from "../lib/mismatch-rule-factory.ts";

export const ACTOR_SHARED_INBOX_PROPERTY_MISMATCH =
  "actor-shared-inbox-property-mismatch" as const;

const actorSharedInboxPropertyMismatch: Deno.lint.Rule = createMismatchRule(
  properties.sharedInbox,
);

export default actorSharedInboxPropertyMismatch;
