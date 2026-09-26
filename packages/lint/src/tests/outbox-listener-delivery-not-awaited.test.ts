import { test } from "node:test";
import { RULE_IDS } from "../lib/const.ts";
import lintTest from "../lib/test.ts";
import * as rule from "../rules/outbox-listener-delivery-not-awaited.ts";

const ruleName = RULE_IDS.outboxListenerDeliveryNotAwaited;

test(
  `${ruleName}: ✅ Good - awaited sendActivity call`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    await ctx.sendActivity(sender, inbox, activity);
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - awaited forwardActivity call`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    await ctx.forwardActivity(sender, [], { skipIfUnsigned: true });
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - delivery returned from the listener`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    return ctx.sendActivity(sender, inbox, activity);
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - awaited call through an optional chain`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    await ctx?.sendActivity(sender, inbox, activity);
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - awaited call through bracket notation`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    await ctx["sendActivity"](sender, inbox, activity);
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - awaited call through a type assertion`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    await (ctx as any).sendActivity(sender, inbox, activity);
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - awaited call inside a loop`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    for (const target of [inbox]) {
      await ctx.sendActivity(sender, target, activity);
    }
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - awaited call inside try/catch`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    try {
      await ctx.sendActivity(sender, inbox, activity);
    } catch (error) {
      console.error(error);
    }
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - awaited call in a conditional branch`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    if (activity.id != null) {
      await ctx.sendActivity(sender, inbox, activity);
    }
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - Promise.all over map`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    await Promise.all(inboxes.map((target) => ctx.sendActivity(sender, target, activity)));
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - Promise.all returned`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    return Promise.all(inboxes.map((target) => ctx.sendActivity(sender, target, activity)));
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - Promise.allSettled over map`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    await Promise.allSettled(inboxes.map((target) => ctx.sendActivity(sender, target, activity)));
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - promises spread into Promise.all`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    await Promise.all([...inboxes.map((target) => ctx.sendActivity(sender, target, activity)), ...others.map((target) =>
      ctx.sendActivity(sender, target, activity)
    )]);
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - Promise.all result kept in a variable`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    const results = await Promise.all(inboxes.map((target) => ctx.sendActivity(sender, target, activity)));
    console.log(results);
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - map result kept and awaited later`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    const promises = inboxes.map((target) => ctx.sendActivity(sender, target, activity));
    await Promise.all(promises);
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - promise handed to waitUntil`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    executionCtx.waitUntil(ctx.sendActivity(sender, inbox, activity));
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - promise handed to a nested waitUntil`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    c.executionCtx.waitUntil(ctx.sendActivity(sender, inbox, activity));
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - delivery opted out with void`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    void ctx.sendActivity(sender, inbox, activity);
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - awaited chain ending in catch`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    await ctx.sendActivity(sender, inbox, activity).catch(console.error);
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - awaited chain through then`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    await ctx.sendActivity(sender, inbox, activity).then(() => console.log("sent"));
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - awaited then callback returning a delivery`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    await Promise.resolve().then(() => ctx.sendActivity(sender, inbox, activity));
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - promise stored and awaited later`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    const pending = ctx.sendActivity(sender, inbox, activity);
    await pending;
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - promise stored and used in a nested callback`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    const pending = ctx.sendActivity(sender, inbox, activity);
    setTimeout(() => pending.then(console.log), 0);
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - promise stored in an object that is used`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    const jobs = { pending: ctx.sendActivity(sender, inbox, activity) };
    await jobs.pending;
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - promise assigned and awaited later`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    let pending;
    pending = ctx.sendActivity(sender, inbox, activity);
    await pending;
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - helper that awaits delivery, awaited by the caller`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    async function deliver() {
          await ctx.sendActivity(sender, inbox, activity);
        }
    await deliver();
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - helper that returns delivery, awaited by the caller`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    const deliver = () => ctx.sendActivity(sender, inbox, activity);
    await deliver();
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - helper that returns delivery, returned by the listener`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    const deliver = () => ctx.sendActivity(sender, inbox, activity);
    return deliver();
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - destructured delivery method, awaited`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    const { sendActivity } = ctx;
    await sendActivity(sender, inbox, activity);
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - delivery method taken from ctx, awaited`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    const send = ctx.sendActivity;
    await send(sender, inbox, activity);
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - dead branch with an unawaited call`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    if (false) {
      ctx.sendActivity(sender, inbox, activity);
    }
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - unreachable code after return`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    return;
    ctx.sendActivity(sender, inbox, activity);
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - unused helper with an unawaited call`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    function deliver() {
      ctx.sendActivity(sender, inbox, activity);
    }
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - callback handed to setTimeout`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    setTimeout(() => ctx.sendActivity(sender, inbox, activity), 0);
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - callback handed to queue.push`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    const queue = [];
    queue.push(() => ctx.sendActivity(sender, inbox, activity));
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - listener that delivers nothing`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    console.log(ctx.identifier, activity.id?.href);
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - arrow listener with an expression body`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, (ctx, activity) =>
    ctx.sendActivity(
      { identifier: ctx.identifier },
      new URL("https://example.com/inbox"),
      activity,
    ));
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - delivery method destructured in the parameters`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async ({ sendActivity }, activity) => {
    await sendActivity(
      { identifier: "alice" },
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
  `${ruleName}: ✅ Good - named listener that awaits delivery`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

async function handler(ctx, activity) {
  await ctx.sendActivity(
    { identifier: ctx.identifier },
    new URL("https://example.com/inbox"),
    activity,
  );
}

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, handler);
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - unawaited call in a helper declared outside the listener`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

function deliverIt(ctx, activity) {
  ctx.sendActivity({ identifier: ctx.identifier }, "followers", activity);
}

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    deliverIt(ctx, activity);
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ❌ Bad - bare sendActivity call`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    ctx.sendActivity(sender, inbox, activity);
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - bare forwardActivity call`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    ctx.forwardActivity(sender, [], { skipIfUnsigned: true });
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - discarded chain ending in catch`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    ctx.sendActivity(sender, inbox, activity).catch(console.error);
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - discarded chain through then`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    ctx.sendActivity(sender, inbox, activity).then(() => console.log("sent"));
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - discarded chain ending in finally`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    ctx.sendActivity(sender, inbox, activity).finally(() => console.log("done"));
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - discarded then callback returning a delivery`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    Promise.resolve().then(() => ctx.sendActivity(sender, inbox, activity));
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - promise stored and never used`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    const pending = ctx.sendActivity(sender, inbox, activity);
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - promise assigned and never used`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    let pending;
    pending = ctx.sendActivity(sender, inbox, activity);
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - promise stored in an object that is never used`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    const jobs = { pending: ctx.sendActivity(sender, inbox, activity) };
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - callback passed to forEach`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    inboxes.forEach((target) => ctx.sendActivity(sender, target, activity));
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - map result dropped`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    inboxes.map((target) => ctx.sendActivity(sender, target, activity));
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - map result kept but never used`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    const promises = inboxes.map((target) => ctx.sendActivity(sender, target, activity));
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - Promise.all that is never awaited`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    Promise.all(inboxes.map((target) => ctx.sendActivity(sender, target, activity)));
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - bare call inside an async callback`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    await Promise.all(inboxes.map(async (target) => {
      ctx.sendActivity(sender, target, activity);
    }));
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - bare call inside a try block`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    try {
      ctx.sendActivity(sender, inbox, activity);
    } catch (error) {
      console.error(error);
    }
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - bare call inside a loop`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    for (const target of [inbox]) {
      ctx.sendActivity(sender, target, activity);
    }
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - bare call behind a logical and`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    activity.id != null && ctx.sendActivity(sender, inbox, activity);
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - bare call in a conditional expression`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    activity.id != null ? ctx.sendActivity(sender, inbox, activity) : null;
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - bare call in a sequence expression`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    (ctx.sendActivity(sender, inbox, activity), console.log("sent"));
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - bare call in an immediately invoked function`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    (async () => {
      return ctx.sendActivity(sender, inbox, activity);
    })();
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - bare call through an optional chain`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    ctx?.sendActivity(sender, inbox, activity);
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - bare call through bracket notation`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    ctx["sendActivity"](sender, inbox, activity);
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - bare call through a type assertion`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    (ctx as any).sendActivity(sender, inbox, activity);
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - bare call to a destructured delivery method`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    const { sendActivity } = ctx;
    sendActivity(sender, inbox, activity);
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - bare call to a delivery method taken from ctx`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    const send = ctx.sendActivity;
    send(sender, inbox, activity);
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - helper that awaits delivery, called without await`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    async function deliver() {
          await ctx.sendActivity(sender, inbox, activity);
        }
    deliver();
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - helper that returns delivery, called without await`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    const deliver = () => ctx.sendActivity(sender, inbox, activity);
    deliver();
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - helper that calls a delivering helper, called without await`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    async function deliver() {
          await ctx.sendActivity(sender, inbox, activity);
        }
    async function outer() {
      await deliver();
    }
    outer();
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - helper with a bare call inside it, called with await`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    async function deliver() {
      ctx.sendActivity(sender, inbox, activity);
    }
    await deliver();
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - delivery method destructured in the parameters, called without await`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async ({ sendActivity }, activity) => {
    sendActivity(
      { identifier: "alice" },
      new URL("https://example.com/inbox"),
      activity,
    );
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - named listener with a bare call`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

async function handler(ctx, activity) {
  ctx.sendActivity(
    { identifier: ctx.identifier },
    new URL("https://example.com/inbox"),
    activity,
  );
}

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, handler);
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
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
    ctx.sendActivity({ identifier: ctx.identifier }, "followers", activity);
  });
`,
    rule,
    ruleName,
    federationSetup: "",
  }),
);

test(
  `${ruleName}: ❌ Bad - bare call in a class method`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    class Sender {
      deliver() {
        ctx.sendActivity(sender, inbox, activity);
      }
    }
    new Sender().deliver();
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - bare call in an object method`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    const handlers = {
      deliver() {
        ctx.sendActivity(sender, inbox, activity);
      },
    };
    handlers.deliver();
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - awaiting the array of promises that map returns`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    await inboxes.map((target) => ctx.sendActivity(sender, target, activity));
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - awaiting the array of promises that flatMap returns`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    await inboxes.flatMap((target) =>
      ctx.sendActivity(sender, target, activity)
    );
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - awaiting an array literal of promises`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    await [ctx.sendActivity(sender, inbox, activity)];
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - returning the array of promises that map returns from the listener`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    return inboxes.map((target) => ctx.sendActivity(sender, target, activity));
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - async callback passed to forEach`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    inboxes.forEach(async (target) => {
      await ctx.sendActivity(sender, target, activity);
    });
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - async callback passed to map, with the result dropped`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    inboxes.map(async (target) => {
      await ctx.sendActivity(sender, target, activity);
    });
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - async function invoked immediately without await`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    (async () => {
      await ctx.sendActivity(sender, inbox, activity);
    })();
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - named function that returns delivery, passed to forEach`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    const deliver = (target) => ctx.sendActivity(sender, target, activity);
    inboxes.forEach(deliver);
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - named async function that awaits delivery, passed to forEach`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    async function deliver(target) {
      await ctx.sendActivity(sender, target, activity);
    }
    inboxes.forEach(deliver);
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - named function that returns delivery, passed to map with the result dropped`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    const deliver = (target) => ctx.sendActivity(sender, target, activity);
    inboxes.map(deliver);
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - named async function that awaits delivery, passed to a then that is not awaited`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    async function deliver() {
      await ctx.sendActivity(sender, inbox, activity);
    }
    Promise.resolve().then(deliver);
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - helper returning Promise.all over a map, called without await`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    function deliverAll() {
      return Promise.all(inboxes.map((target) => ctx.sendActivity(sender, target, activity)));
    }
    deliverAll();
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - helper awaiting Promise.all over a map, called without await`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    async function deliverAll() {
      await Promise.all(inboxes.map((target) => ctx.sendActivity(sender, target, activity)));
    }
    deliverAll();
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - not operator applied to a delivery promise`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    !ctx.sendActivity(sender, inbox, activity);
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - typeof applied to a delivery promise`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    typeof ctx.sendActivity(sender, inbox, activity);
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - Promise.race that is never awaited`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    Promise.race([ctx.sendActivity(sender, inbox, activity)]);
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - Promise.any that is never awaited`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    Promise.any([ctx.sendActivity(sender, inbox, activity)]);
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - helper that delivers but is only mentioned and never called`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    const deliver = () => {
      ctx.sendActivity(sender, inbox, activity);
    };
    console.log(deliver);
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ✅ Good - Promise.all over an async callback that awaits delivery`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    await Promise.all(
      inboxes.map(async (target) => {
        await ctx.sendActivity(sender, target, activity);
      }),
    );
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - async function invoked immediately and awaited`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    await (async () => {
      await ctx.sendActivity(sender, inbox, activity);
    })();
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - named async function passed to map inside Promise.all`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    async function deliver(target) {
      await ctx.sendActivity(sender, target, activity);
    }
    await Promise.all(inboxes.map(deliver));
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - async callback handed to an unknown function`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    setTimeout(async () => {
      await ctx.sendActivity(sender, inbox, activity);
    }, 0);
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - awaited Promise.race`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    await Promise.race([ctx.sendActivity(sender, inbox, activity)]);
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - awaited Promise.any`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    await Promise.any([ctx.sendActivity(sender, inbox, activity)]);
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - helper returning an array of promises, passed to Promise.all`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    const deliverAll = () => inboxes.map((target) => ctx.sendActivity(sender, target, activity));
    await Promise.all(deliverAll());
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - helper returning Promise.all, awaited by the caller`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    async function deliverAll() {
      return Promise.all(inboxes.map((target) => ctx.sendActivity(sender, target, activity)));
    }
    await deliverAll();
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - delivery method taken from ctx in a helper nothing uses`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    function unused() {
      const send = ctx.sendActivity;
      return send;
    }
    function send() {}
    send(sender, inbox, activity);
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - delivery method taken from ctx in a dead branch`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    function send() {}
    if (false) {
      const send = ctx.sendActivity;
    }
    send(sender, inbox, activity);
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - promise mentioned only in a dead branch`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    const pending = ctx.sendActivity(sender, inbox, activity);
    if (false) {
      await pending;
    }
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - delivery promise handed to an unknown function`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    track(ctx.sendActivity(sender, inbox, activity));
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - delivery promise used as a condition`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    const label = ctx.sendActivity(sender, inbox, activity) ? "sent" : "not sent";
    console.log(label);
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - delivery promise as the last operand of an awaited sequence`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    await (console.log("sending"), ctx.sendActivity(sender, inbox, activity));
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - delivery promise handed to a constructor`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    new Tracker(ctx.sendActivity(sender, inbox, activity));
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - promise stored on an object that is read later`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    const state = {};
    state.pending = ctx.sendActivity(sender, inbox, activity);
    console.log(state);
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - awaited call through template literal bracket notation`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    await ctx[\`sendActivity\`](sender, inbox, activity);
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - listener without a context parameter`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async () => {
    console.log("no context to deliver with");
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - listener that destructures unrelated fields`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async ({ identifier, ...rest }, activity) => {
    console.log(identifier, rest, activity);
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - delivery method with a default in the parameters, awaited`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async ({ sendActivity = fallbackSend }, activity) => {
    await sendActivity({ identifier: "alice" }, "followers", activity);
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ❌ Bad - bare call through template literal bracket notation`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    ctx[\`sendActivity\`](sender, inbox, activity);
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - promise stored on an object that is never read`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    const state = {};
    state.pending = ctx.sendActivity(sender, inbox, activity);
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - delivery method with a default in the parameters, called without await`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async ({ sendActivity = fallbackSend }, activity) => {
    sendActivity({ identifier: "alice" }, "followers", activity);
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);
