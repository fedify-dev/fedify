import { properties } from "../lib/const.ts";
import { createRequiredRule } from "../lib/required-rule-factory.ts";

export const ACTOR_SHARED_INBOX_PROPERTY_REQUIRED =
  "actor-shared-inbox-property-required";

const actorSharedInboxPropertyRequired = createRequiredRule(
  properties.sharedInbox,
);

export default actorSharedInboxPropertyRequired;
