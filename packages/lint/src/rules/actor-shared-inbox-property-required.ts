import { properties } from "../lib/const.ts";
import { actorPropertyRequired } from "../lib/messages.ts";
import { createRequiredRule } from "../lib/required-rule-factory.ts";

export const ACTOR_SHARED_INBOX_PROPERTY_REQUIRED =
  "actor-shared-inbox-property-required";

const actorSharedInboxPropertyRequired = createRequiredRule({
  propertyName: properties.sharedInbox.name,
  dispatcherMethod: properties.sharedInbox.setter,
  errorMessage: actorPropertyRequired(properties.sharedInbox.name),
});

export default actorSharedInboxPropertyRequired;
