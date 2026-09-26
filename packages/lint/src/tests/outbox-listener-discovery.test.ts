import { test } from "node:test";
import { RULE_IDS } from "../lib/const.ts";
import lintTest from "../lib/test.ts";
import * as rule from "../rules/outbox-listener-delivery-required.ts";

// How a listener registration is found and resolved to a function, which
// the outbox listener rules share.

const ruleName = RULE_IDS.outboxListenerDeliveryRequired;

test(
  `${ruleName}: ✅ Good listener held in an object literal property`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

const handlers = {
  deliver: async (ctx, activity) => {
    await ctx.sendActivity({ identifier: ctx.identifier }, "followers", activity);
  },
};
federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, handlers.deliver);
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ❌ Bad listener held in an object literal property that does not deliver`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

const handlers = {
  deliver: async (ctx) => {
    console.log(ctx.identifier);
  },
};
federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, handlers.deliver);
`,
    rule,
    ruleName,
    expectedError: "Outbox listeners should deliver posted activities",
  }),
);

test(
  `${ruleName}: ✅ Good listener passed through an alias of a named function`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

const handler = async (ctx, activity) => {
  await ctx.sendActivity({ identifier: ctx.identifier }, "followers", activity);
};
const alias = handler;
federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, alias);
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ❌ Bad listener passed through an alias of a function that does not deliver`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

const handler = async (ctx) => {
  console.log(ctx.identifier);
};
const alias = handler;
federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, alias);
`,
    rule,
    ruleName,
    expectedError: "Outbox listeners should deliver posted activities",
  }),
);

test(
  `${ruleName}: ✅ Good listener registered after authorize and onError`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";


federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .authorize(() => true)
  .onError(() => {})
  .on(Activity, async (ctx, activity) => {
    await ctx.sendActivity({ identifier: ctx.identifier }, "followers", activity);
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ❌ Bad listener registered after authorize that does not deliver`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";


federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .authorize(() => true)
  .on(Activity, async (ctx) => {
    console.log(ctx.identifier);
  });
`,
    rule,
    ruleName,
    expectedError: "Outbox listeners should deliver posted activities",
  }),
);

test(
  `${ruleName}: ✅ Good on called on a plain object`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

const emitter = { on() {} };

emitter.on(Activity, async (ctx) => {
  console.log(ctx.identifier);
});
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good on called on the result of an unrelated call`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

getEmitter().on(Activity, async (ctx) => {
  console.log(ctx.identifier);
});
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good on called after an unrelated method in the chain`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";


federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .somethingElse()
  .on(Activity, async (ctx) => {
    console.log(ctx.identifier);
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good listener that cannot be resolved`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";


federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, unknownHandler);
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good listener bound to something that is not a function`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

const handler = 5;
federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, handler);
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good listener held in a computed property`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

const handlers = {
  deliver: async (ctx) => {
    console.log(ctx.identifier);
  },
};
federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, handlers["deliver"]);
`,
    rule,
    ruleName,
  }),
);
