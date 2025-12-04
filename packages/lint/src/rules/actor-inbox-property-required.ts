import { properties } from "../lib/const.ts";
import { actorPropertyRequired } from "../lib/messages.ts";
import { createRequiredRule } from "../lib/required-rule-factory.ts";

export const ACTOR_INBOX_PROPERTY_REQUIRED = "actor-inbox-property-required";

const actorInboxPropertyRequired = createRequiredRule({
  propertyName: properties.inbox.name,
  dispatcherMethod: properties.inbox.setter,
  errorMessage: actorPropertyRequired(properties.inbox.name),
});

export default actorInboxPropertyRequired;
