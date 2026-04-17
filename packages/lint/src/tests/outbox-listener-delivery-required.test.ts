import { test } from "node:test";
import { RULE_IDS } from "../lib/const.ts";
import lintTest from "../lib/test.ts";
import * as rule from "../rules/outbox-listener-delivery-required.ts";

const ruleName = RULE_IDS.outboxListenerDeliveryRequired;

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
  `${ruleName}: ✅ Good - direct forwardActivity call`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx) => {
    await ctx.forwardActivity(
      { identifier: ctx.identifier },
      [],
      { skipIfUnsigned: true },
    );
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - named listener callback`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

const handler = async (ctx, activity) => {
  await ctx.sendActivity(
    { identifier: ctx.identifier },
    new URL("https://example.com/inbox"),
    activity,
  );
};

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, handler);
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - destructured ctx delivery alias`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx) => {
    const { forwardActivity: deliver } = ctx;
    await deliver({ identifier: ctx.identifier }, [], { skipIfUnsigned: true });
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - assignment pattern context parameter`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx = globalThis.ctx) => {
    await ctx.sendActivity(
      { identifier: ctx.identifier },
      new URL("https://example.com/inbox"),
      new Activity({}),
    );
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - optional chaining and type assertion`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    await (ctx as typeof ctx)?.sendActivity(
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
  `${ruleName}: ✅ Good - bracket notation delivery call`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    await ctx["sendActivity"](
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
  `${ruleName}: ✅ Good - template literal bracket delivery call`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    await ctx[\`sendActivity\`](
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
  `${ruleName}: ✅ Good - template literal delivery expression`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const rendered = \`\${await ctx.sendActivity(
      { identifier: ctx.identifier },
      new URL("https://example.com/inbox"),
      activity,
    )}\`;
    console.log(rendered);
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
  `${ruleName}: ❌ Bad - missing delivery call`,
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
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ❌ Bad - chained authorize without delivery`,
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
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ❌ Bad - named listener without delivery`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

const handler = async (ctx, activity) => {
  console.log(ctx.identifier, activity.id?.href);
};

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, handler);
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ❌ Bad - comment mentioning delivery methods`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    // ctx.sendActivity(...)
    // ctx.forwardActivity(...)
    console.log(ctx.identifier, activity.id?.href);
  });
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ❌ Bad - string mentioning delivery methods`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async () => {
    return ".sendActivity(.forwardActivity(";
  });
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ❌ Bad - other object sendActivity false positive`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const other = { sendActivity: async () => {} };
    await other.sendActivity(activity);
    console.log(ctx.identifier, activity.id?.href);
  });
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ❌ Bad - template literal mentioning delivery methods`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async () => {
    return \`.sendActivity(.forwardActivity(\`;
  });
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ❌ Bad - template literal mentioning ctx.sendActivity`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async () => {
    return \`ctx.sendActivity(\`;
  });
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);
