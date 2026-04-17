import { test } from "node:test";
import { RULE_IDS } from "../lib/const.ts";
import lintTest from "../lib/test.ts";
import * as rule from "../rules/outbox-listener-send-activity-required.ts";

const ruleName = RULE_IDS.outboxListenerSendActivityRequired;

test(
  `${ruleName}: ✅ Good - direct sendActivity call`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    await ctx.sendActivity(
      { identifier: ctx.identifier },
      new URL("https://example.com/inbox"),
      activity,
    );
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - non-federation object`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

const fakeFederation = {
  setOutboxListeners() {
    return {
      on() {
        return this;
      },
    };
  },
};

fakeFederation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    activity;
    ctx.identifier;
  });
`,
    rule,
    ruleName,
    federationSetup: "",
  }),
);

test(
  `${ruleName}: ❌ Bad - missing sendActivity call`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    console.log(ctx.identifier, activity.id?.href);
  });
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should call ctx.sendActivity() explicitly.",
  }),
);

test(
  `${ruleName}: ❌ Bad - chained authorize without sendActivity`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .authorize((_ctx, _identifier) => true)
  .on(Activity, async (ctx, activity) => {
    console.log(ctx.identifier, activity.id?.href);
  });
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should call ctx.sendActivity() explicitly.",
  }),
);
