import { test } from "@fedify/fixture";
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
  `${ruleName}: ✅ Good - delivery via a called nested helper`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    async function deliver() {
      await ctx.sendActivity(
        { identifier: ctx.identifier },
        new URL("https://example.com/inbox"),
        activity,
      );
    }
    await deliver();
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - delivery inside a non-literal if branch`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    if (activity.id != null) {
      await ctx.sendActivity(
        { identifier: ctx.identifier },
        new URL("https://example.com/inbox"),
        activity,
      );
    }
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - delivery inside try/catch/finally`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    try {
      await ctx.sendActivity(
        { identifier: ctx.identifier },
        new URL("https://example.com/inbox"),
        activity,
      );
    } catch (error) {
      console.error(error);
    } finally {
      console.log("done");
    }
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - delivery inside a switch case`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    switch (activity.constructor.name) {
      case "Create":
        await ctx.sendActivity(
          { identifier: ctx.identifier },
          new URL("https://example.com/inbox"),
          activity,
        );
        break;
      default:
        console.log(ctx.identifier);
    }
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - delivery inside a for-of loop`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    for (const inbox of [new URL("https://example.com/inbox")]) {
      await ctx.sendActivity(
        { identifier: ctx.identifier },
        inbox,
        activity,
      );
    }
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - awaited Promise.all(array.map(callback))`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const recipients = [new URL("https://example.com/inbox")];
    await Promise.all(recipients.map((inbox) =>
      ctx.sendActivity({ identifier: ctx.identifier }, inbox, activity)
    ));
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - returned Promise.all(array.map(callback))`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, (ctx, activity) => {
    const recipients = [new URL("https://example.com/inbox")];
    return Promise.all(recipients.map((inbox) =>
      ctx.sendActivity({ identifier: ctx.identifier }, inbox, activity)
    ));
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - awaited immediately invoked function expression`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    await (async () => {
      await ctx.sendActivity(
        { identifier: ctx.identifier },
        new URL("https://example.com/inbox"),
        activity,
      );
    })();
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - named helper passed by reference to forEach`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const deliver = (inbox) =>
      ctx.sendActivity({ identifier: ctx.identifier }, inbox, activity);
    const inboxes = [new URL("https://example.com/inbox")];
    inboxes.forEach(deliver);
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - dollar-prefixed helper name`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const $deliver = async () => {
      await ctx.sendActivity(
        { identifier: ctx.identifier },
        new URL("https://example.com/inbox"),
        activity,
      );
    };
    await $deliver();
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - sibling helper calling a sibling helper`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    async function outer() {
      await inner();
    }
    async function inner() {
      await ctx.sendActivity(
        { identifier: ctx.identifier },
        new URL("https://example.com/inbox"),
        activity,
      );
    }
    await outer();
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - helper held in an object literal`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const handlers = {
      deliver: () =>
        ctx.sendActivity(
          { identifier: ctx.identifier },
          new URL("https://example.com/inbox"),
          activity,
        ),
    };
    await handlers.deliver();
  });
`,
    rule,
    ruleName,
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
  `${ruleName}: ❌ Bad - hoisted function declaration without delivery`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, handleOutbox);

function handleOutbox(ctx, activity) {
  console.log(ctx.identifier, activity.id?.href);
}
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
  `${ruleName}: ❌ Bad - identifier containing ctx substring`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const myctx = {
      sendActivity: async () => {
        console.log(activity.id?.href);
      },
    };
    await myctx.sendActivity();
    console.log(ctx.identifier);
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

test(
  `${ruleName}: ❌ Bad - unused nested delivery helper`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    async function deliver() {
      await ctx.sendActivity(
        { identifier: ctx.identifier },
        new URL("https://example.com/inbox"),
        activity,
      );
    }
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
  `${ruleName}: ❌ Bad - delivery call behind if (false)`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    if (false) {
      await ctx.sendActivity(
        { identifier: ctx.identifier },
        new URL("https://example.com/inbox"),
        activity,
      );
    }
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
  `${ruleName}: ❌ Bad - delivery call after unconditional return`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    console.log(ctx.identifier, activity.id?.href);
    return;
    await ctx.sendActivity(
      { identifier: ctx.identifier },
      new URL("https://example.com/inbox"),
      activity,
    );
  });
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ✅ Good - delivery call inside a callback whose result is dropped`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const recipients = [new URL("https://example.com/inbox")];
    recipients.map((inbox) =>
      ctx.sendActivity({ identifier: ctx.identifier }, inbox, activity)
    );
    console.log(ctx.identifier, activity.id?.href);
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ❌ Bad - delivery call in the dead branch of if (true)`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    if (true) {
      console.log(ctx.identifier, activity.id?.href);
    } else {
      await ctx.sendActivity(
        { identifier: ctx.identifier },
        new URL("https://example.com/inbox"),
        activity,
      );
    }
  });
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ❌ Bad - delivery call after if (true) return`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    if (true) {
      return;
    }
    await ctx.sendActivity(
      { identifier: ctx.identifier },
      new URL("https://example.com/inbox"),
      activity,
    );
  });
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ❌ Bad - delivery call after both if/else branches return`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    if (activity.id == null) {
      return;
    } else {
      return;
    }
    await ctx.sendActivity(
      { identifier: ctx.identifier },
      new URL("https://example.com/inbox"),
      activity,
    );
  });
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ❌ Bad - delivery call after a return in the same switch case`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    switch (activity.id) {
      case null:
        return;
        await ctx.sendActivity(
          { identifier: ctx.identifier },
          new URL("https://example.com/inbox"),
          activity,
        );
    }
  });
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ❌ Bad - helper mentioned only in a comment`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    function deliver() {
      return ctx.sendActivity(
        { identifier: ctx.identifier },
        new URL("https://example.com/inbox"),
        activity,
      );
    }
    // call deliver() later
    console.log(ctx.identifier);
  });
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ❌ Bad - unrelated method sharing a local helper's name`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    function deliver() {
      return ctx.sendActivity(
        { identifier: ctx.identifier },
        new URL("https://example.com/inbox"),
        activity,
      );
    }
    const someService = { deliver: async () => {} };
    await someService.deliver();
  });
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ❌ Bad - delivery call after break in a switch case`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    switch (activity.constructor.name) {
      case "Create":
        break;
        await ctx.sendActivity(
          { identifier: ctx.identifier },
          new URL("https://example.com/inbox"),
          activity,
        );
    }
  });
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ❌ Bad - delivery call after continue in a loop`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    for (const inbox of [new URL("https://example.com/inbox")]) {
      continue;
      await ctx.sendActivity(
        { identifier: ctx.identifier },
        inbox,
        activity,
      );
    }
  });
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ✅ Good - awaited Promise.all assigned to a variable`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const recipients = [new URL("https://example.com/inbox")];
    let result;
    result = await Promise.all(recipients.map((inbox) =>
      ctx.sendActivity({ identifier: ctx.identifier }, inbox, activity)
    ));
    return result;
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ❌ Bad - helper only called from a dead branch`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    function deliver() {
      return ctx.sendActivity(
        { identifier: ctx.identifier },
        new URL("https://example.com/inbox"),
        activity,
      );
    }
    if (false) {
      deliver();
    }
  });
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ✅ Good - inner helper shadows a same-named outer helper`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    async function outer() {
      function deliver() {
        return ctx.sendActivity(
          { identifier: ctx.identifier },
          new URL("https://example.com/inbox"),
          activity,
        );
      }
      await deliver();
    }
    function deliver() {
      console.log("outer deliver never actually delivers");
    }
    await outer();
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - used helper has byte-identical text to an unused one`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const inbox = new URL("https://example.com/inbox");
    const handlers = {
      unused: () =>
        ctx.sendActivity({ identifier: ctx.identifier }, inbox, activity),
      used: () =>
        ctx.sendActivity({ identifier: ctx.identifier }, inbox, activity),
    };
    await handlers.used();
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ❌ Bad - unused helper has byte-identical text to a used one`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const inbox = new URL("https://example.com/inbox");
    const handlers = {
      used: () =>
        ctx.sendActivity({ identifier: ctx.identifier }, inbox, activity),
      unused: () =>
        ctx.sendActivity({ identifier: ctx.identifier }, inbox, activity),
    };
    console.log("never actually calls a handler");
  });
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ✅ Good - awaited callback nested inside an array literal and spreads`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    await Promise.all([
      ...inboxes.map((inbox) => ctx.sendActivity(sender, inbox, activity)),
      ...others.map((inbox) => ctx.sendActivity(sender, inbox, activity)),
    ]);
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - awaited callback nested inside an array literal and a chained call`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    await Promise.all(
      [inboxes.map((inbox) => ctx.sendActivity(sender, inbox, activity))]
        .flat(),
    );
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - awaited callback nested inside an object literal property`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    await Promise.all(
      Object.values({
        a: Promise.all(
          inboxes.map((inbox) => ctx.sendActivity(sender, inbox, activity)),
        ),
      }),
    );
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - callback passed to a bare forEach that is never awaited`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    inboxes.forEach((inbox) => ctx.sendActivity(sender, inbox, activity));
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ❌ Bad - callback passed to a bare forEach that never delivers`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    inboxes.forEach((inbox) => {
      console.log(inbox);
    });
  });
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ✅ Good - helper reached through an alias of an object property`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    const handlers = {
      deliver: () => ctx.sendActivity(sender, inbox, activity),
    };
    const alias = handlers.deliver;
    await alias();
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - helper called through a computed member access`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    const handlers = {
      deliver: () => ctx.sendActivity(sender, inbox, activity),
    };
    await handlers["deliver"]();
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - helper destructured from an object of helpers`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    const handlers = {
      deliver: () => ctx.sendActivity(sender, inbox, activity),
    };
    const { deliver } = handlers;
    await deliver();
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - helper assigned after its declaration`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    let deliver;
    deliver = () => ctx.sendActivity(sender, inbox, activity);
    await deliver();
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - helper declared below an unconditional return`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    await deliver();
    return;
    function deliver() {
      return ctx.sendActivity(sender, inbox, activity);
    }
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - helper stored in an array`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    const handlers = [() => ctx.sendActivity(sender, inbox, activity)];
    await handlers[0]();
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - helper wrapped in a call before being bound`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    const once = (fn) => fn;
    const deliver = once(() => ctx.sendActivity(sender, inbox, activity));
    await deliver();
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - map result kept in a variable before Promise.all`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    const promises = inboxes.map((target) =>
      ctx.sendActivity(sender, target, activity)
    );
    await Promise.all(promises);
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - helper assigned as a property after the object is created`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    const handlers = {};
    handlers.deliver = () => ctx.sendActivity(sender, inbox, activity);
    await handlers.deliver();
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - helper destructured straight from an object literal`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    const { deliver } = {
      deliver: () => ctx.sendActivity(sender, inbox, activity),
    };
    await deliver();
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - helper defined as a class method`,
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
        return ctx.sendActivity(sender, inbox, activity);
      }
    }
    await new Sender().deliver();
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ❌ Bad - helper assigned to a variable but never called`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    let deliver;
    deliver = () => ctx.sendActivity(sender, inbox, activity);
    console.log("never called");
  });
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ❌ Bad - helper assigned as a property but never called`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    const handlers = {};
    handlers.deliver = () => ctx.sendActivity(sender, inbox, activity);
    console.log("never called");
  });
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ✅ Good - callback passed to map whose result is never used`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    const promises = inboxes.map((target) =>
      ctx.sendActivity(sender, target, activity)
    );
    console.log("never awaited");
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ❌ Bad - helper declared below a return but never called`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    console.log("nothing below runs");
    return;
    function deliver() {
      return ctx.sendActivity(sender, inbox, activity);
    }
  });
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ❌ Bad - nested helper never called by the helper that declares it`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    async function outer() {
      function inner() {
        return ctx.sendActivity(sender, inbox, activity);
      }
      console.log("never calls inner");
    }
    await outer();
  });
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ❌ Bad - class whose methods are never used`,
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
        return ctx.sendActivity(sender, inbox, activity);
      }
    }
    console.log("never instantiated");
  });
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ✅ Good - delivery call in an if test`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    if (await ctx.sendActivity(sender, inbox, activity)) {
      console.log("sent");
    }
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - helper call in a switch discriminant`,
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
      return 1;
    }
    switch (await deliver()) {
      case 1:
        break;
    }
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - helper call in a switch case test`,
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
      return 1;
    }
    switch (1) {
      case await deliver():
        break;
    }
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - helper call in a while test`,
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
      return 1;
    }
    while (await deliver() > 1) {
      console.log("looping");
    }
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - helper call in a do-while test`,
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
      return 1;
    }
    do {
      console.log("once");
    } while (await deliver() > 1);
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - delivery call in a for loop init`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    for (let sent = await ctx.sendActivity(sender, inbox, activity); false;) {
      console.log(sent);
    }
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - helper call in a for loop test`,
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
      return 1;
    }
    for (let i = 0; i < await deliver(); i++) {
      console.log(i);
    }
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - helper call in a for loop update`,
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
      return 1;
    }
    for (let i = 0; i < 1; i += await deliver()) {
      console.log(i);
    }
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - helpers held in an array and run by a for-of loop`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    const jobs = [
      () => ctx.sendActivity(sender, inbox, activity),
      () => ctx.sendActivity(sender, inbox, activity),
    ];
    for (const job of jobs) await job();
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - awaited callback inside an if test`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    if (await Promise.all(inboxes.map((target) =>
      ctx.sendActivity(sender, target, activity)
    ))) {
      console.log("sent");
    }
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ❌ Bad - unrelated helper called in an if test`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    async function check() {
      return true;
    }
    async function deliver() {
      await ctx.sendActivity(sender, inbox, activity);
    }
    if (await check()) {
      console.log("checked");
    }
  });
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ❌ Bad - unrelated for-of head next to an unused helper`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    const deliver = () => ctx.sendActivity(sender, inbox, activity);
    for (const target of [inbox]) {
      console.log(target);
    }
  });
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ❌ Bad - delivery call in the branch behind an if test that is scanned`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    if (await Promise.resolve(false)) {
      return;
    }
    if (false) {
      await ctx.sendActivity(sender, inbox, activity);
    }
  });
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ✅ Good - callback passed to queue.push`,
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
  `${ruleName}: ✅ Good - callback passed to setTimeout`,
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
  `${ruleName}: ✅ Good - callback passed to a then that is not awaited`,
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
  }),
);

test(
  `${ruleName}: ✅ Good - callback inside an object passed to a call`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    const handlers = {};
    Object.assign(handlers, {
      deliver: () => ctx.sendActivity(sender, inbox, activity),
    });
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - delivery call that is never awaited`,
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
  }),
);

test(
  `${ruleName}: ❌ Bad - callback passed to a call that never delivers`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    const queue = [];
    queue.push(() => console.log("no delivery in here"));
  });
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ✅ Good - bare delivery call in a class method`,
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
  }),
);

test(
  `${ruleName}: ✅ Good - bare delivery call in a static class method`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    class Sender {
      static deliver() {
        ctx.sendActivity(sender, inbox, activity);
      }
    }
    Sender.deliver();
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - bare delivery call in an object method`,
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
  }),
);

test(
  `${ruleName}: ✅ Good - bare delivery call in an async object method`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    const handlers = {
      async deliver() {
        ctx.sendActivity(sender, inbox, activity);
      },
    };
    await handlers.deliver();
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - bare delivery call in an object getter`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    const handlers = {
      get deliver() {
        ctx.sendActivity(sender, inbox, activity);
        return 1;
      },
    };
    console.log(handlers.deliver);
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - delivery inside a for-in loop`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    for (const key in { a: 1 }) {
      await ctx.sendActivity(sender, inbox, activity);
    }
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - delivery inside a labeled loop`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    outer: for (const target of [inbox]) {
      await ctx.sendActivity(sender, target, activity);
      break outer;
    }
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - helper held in an array destructuring`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    const [deliver] = [() => ctx.sendActivity(sender, inbox, activity)];
    await deliver();
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - helper held in a destructuring default`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    const { deliver = () => ctx.sendActivity(sender, inbox, activity) } = {};
    await deliver();
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - helper held in a rest element`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    const { ...handlers } = { deliver: () => ctx.sendActivity(sender, inbox, activity) };
    await handlers.deliver();
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - helpers that call each other and deliver`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    async function first() {
      await second();
    }
    async function second() {
      await ctx.sendActivity(sender, inbox, activity);
      await first();
    }
    await first();
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ❌ Bad - helpers that call each other without delivering`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    async function first() {
      await second();
    }
    async function second() {
      await first();
    }
    await first();
  });
`,
    rule,
    ruleName,
    expectedError: "Outbox listeners should deliver posted activities",
  }),
);

test(
  `${ruleName}: ❌ Bad - statically false while loop hides delivery`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    while (false) {
      await ctx.sendActivity(
        { identifier: ctx.identifier },
        new URL("https://example.com/inbox"),
        activity,
      );
    }
  });
`,
    rule,
    ruleName,
    expectedError: "Outbox listeners should deliver posted activities",
  }),
);

test(
  `${ruleName}: ❌ Bad - statically false for loop hides delivery`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    for (; false;) {
      await ctx.sendActivity(
        { identifier: ctx.identifier },
        new URL("https://example.com/inbox"),
        activity,
      );
    }
  });
`,
    rule,
    ruleName,
    expectedError: "Outbox listeners should deliver posted activities",
  }),
);

test(
  `${ruleName}: ❌ Bad - statically false for loop update hides delivery`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    for (let i = 0; false; await ctx.sendActivity(
      { identifier: ctx.identifier },
      new URL("https://example.com/inbox"),
      activity,
    )) {}
  });
`,
    rule,
    ruleName,
    expectedError: "Outbox listeners should deliver posted activities",
  }),
);

test(
  `${ruleName}: ✅ Good - do while (false) executes once`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    do {
      await ctx.sendActivity(
        { identifier: ctx.identifier },
        new URL("https://example.com/inbox"),
        activity,
      );
    } while (false);
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - delivery in loop binding pattern`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    for (const { id = await ctx.sendActivity(
      { identifier: ctx.identifier },
      new URL("https://example.com/inbox"),
      activity,
    ) } of [{}]) {}
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - delivery in loop binding computed member expression`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    let target: Record<string, unknown> = {};
    for ({ id: target[await ctx.sendActivity(
      { identifier: ctx.identifier },
      new URL("https://example.com/inbox"),
      activity,
    ) as unknown as string] } of [{}]) {}
  });
`,
    rule,
    ruleName,
  }),
);

for (
  const [kind, pattern, member, readsTarget] of [
    [
      "object",
      "{ deliver: target.deliver = DEFAULT }",
      "target.deliver",
      false,
    ],
    ["array", "[target.deliver = DEFAULT]", "target.deliver", false],
    [
      "computed object",
      '{ deliver: target["deliver"] = DEFAULT }',
      'target["deliver"]',
      false,
    ],
    [
      "nested object",
      "{ deliver: target.nested.deliver = DEFAULT }",
      "target.nested.deliver",
      // Accessing the intermediate object conservatively reaches its functions.
      true,
    ],
  ] as const
) {
  for (const used of [false, true]) {
    test(
      `${ruleName}: ${
        used ? "used" : "unused"
      } ${kind} member-target default function`,
      lintTest({
        code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const target = { deliver: () => {}, nested: { deliver: () => {} } };
    for (${
          pattern.replace(
            "DEFAULT",
            `() => {
      ctx.sendActivity(
        { identifier: ctx.identifier },
        new URL("https://example.com/inbox"),
        activity,
      );
    }`,
          )
        } of [${kind === "array" ? "[]" : "{}"}]) {
      ${used ? `${member}();` : ""}
    }
  });
`,
        rule,
        ruleName,
        expectedError: used || readsTarget
          ? undefined
          : "Outbox listeners should deliver posted activities",
      }),
    );
  }
}

for (const shadowed of [false, true]) {
  test(
    `${ruleName}: member-target default preserves ${
      shadowed ? "local" : "inherited"
    } object functions`,
    lintTest({
      code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const target = {
      deliver: async () => {
        ctx.sendActivity(
          { identifier: ctx.identifier },
          new URL("https://example.com/inbox"),
          activity,
        );
      },
    };
    const run = async () => {
      ${
        shadowed
          ? "const target = { deliver: async () => {}, fallback: () => {} };"
          : ""
      }
      for ({ fallback: target.fallback = () => {} } of [{}]) {}
      await target.deliver();
    };
    await run();
  });
`,
      rule,
      ruleName,
      expectedError: shadowed
        ? "Outbox listeners should deliver posted activities"
        : undefined,
    }),
  );
}

for (
  const [kind, pattern, existingValues] of [
    ["object", "{ deliver = DEFAULT }", "[{ deliver }]"],
    ["array", "[deliver = DEFAULT]", "[[deliver]]"],
    [
      "nested object",
      "{ handler: { deliver } = { deliver: DEFAULT } }",
      "[{ handler: { deliver } }]",
    ],
    ["nested array", "[[deliver] = [DEFAULT]]", "[[[deliver]]]"],
  ] as const
) {
  for (const dropped of [false, true]) {
    test(
      `${ruleName}: ${kind} assignment default preserves enclosing ${
        dropped ? "dropped" : "awaited"
      } delivery`,
      lintTest({
        code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    let deliver = async () => {
      ${dropped ? "" : "await "}ctx.sendActivity(
        { identifier: ctx.identifier }, "followers", activity,
      );
    };
    const run = async () => {
      for (${
          pattern.replace("DEFAULT", "async () => {}")
        } of ${existingValues}) {}
      await deliver();
    };
    await run();
  });
`,
        rule,
        ruleName,
        expectedError: undefined,
      }),
    );
  }
}

for (
  const [kind, pattern, missingValues] of [
    ["object", "{ deliver = DEFAULT }", "[{}]"],
    ["array", "[deliver = DEFAULT]", "[[]]"],
  ] as const
) {
  for (
    const [declaration, prefix, setup, parameter] of [
      ["const", "const ", "", ""],
      ["let", "let ", "", ""],
      ["var", "var ", "", ""],
      ["local assignment", "", "let deliver = async () => {};", ""],
      ["uninitialized let", "", "let deliver;", ""],
      ["uninitialized var", "", "var deliver;", ""],
      ["var loop binding", "", "for (var deliver of [undefined]) {}", ""],
      ["non-function let", "", "let deliver = undefined;", ""],
      ["parameter", "", "", "deliver"],
      ["object parameter", "", "", "{ deliver } = {}"],
      ["array parameter", "", "", "[deliver] = []"],
    ] as const
  ) {
    test(
      `${ruleName}: ${kind} default respects ${declaration} shadowing`,
      lintTest({
        code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const deliver = async () => {
      ctx.sendActivity({ identifier: ctx.identifier }, "followers", activity);
    };
    const run = async (${parameter}) => {
      ${setup}
      for (${prefix}${
          pattern.replace("DEFAULT", "async () => {}")
        } of ${missingValues}) {
        await deliver();
      }
    };
    await run();
  });
`,
        rule,
        ruleName,
        expectedError: "Outbox listeners should deliver posted activities",
      }),
    );
  }

  for (const used of [false, true]) {
    test(
      `${ruleName}: ${
        used ? "used" : "unused"
      } ${kind} assignment fallback in a nested helper`,
      lintTest({
        code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    let deliver;
    const run = async () => {
      for (${
          pattern.replace(
            "DEFAULT",
            `async () => {
        ctx.sendActivity({ identifier: ctx.identifier }, "followers", activity);
      }`,
          )
        } of ${missingValues}) {}
      ${used ? "await deliver();" : ""}
    };
    await run();
  });
`,
        rule,
        ruleName,
        expectedError: used
          ? undefined
          : "Outbox listeners should deliver posted activities",
      }),
    );
  }
}

for (
  const [kind, block] of [
    [
      "nested block",
      'if (dryRun) { const deliver = "skipped"; console.log(deliver); }',
    ],
    ["for initializer", "for (let deliver = 0; deliver < 1; deliver++) {}"],
  ] as const
) {
  for (const dropped of [false, true]) {
    test(
      `${ruleName}: non-function ${kind} declaration preserves an outer ${
        dropped ? "dropped" : "awaited"
      } delivery`,
      lintTest({
        code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const deliver = async () => {
      ${dropped ? "" : "await "}ctx.sendActivity(
        { identifier: ctx.identifier }, "followers", activity,
      );
    };
    const run = async () => {
      ${block}
      await deliver();
    };
    await run();
  });
`,
        rule,
        ruleName,
        expectedError: undefined,
      }),
    );
  }
}

for (
  const [kind, declaration] of [
    ["block let", "{ let deliver; }"],
    ["block const", "{ const deliver = 0; }"],
    ["for initializer", "for (let deliver = 0; deliver < 1; deliver++) {}"],
    ["for binding", "for (const deliver of [0]) {}"],
    ["class static block", "const C = class { static { var deliver; } };"],
    [
      "class static block assignment default",
      "const C = class { static { for ({ deliver = async () => {} } of [{ deliver }]); } };",
    ],
  ] as const
) {
  for (const dropped of [false, true]) {
    test(
      `${ruleName}: assignment default preserves outer ${
        dropped ? "dropped" : "awaited"
      } delivery after an unrelated ${kind}`,
      lintTest({
        code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    let deliver = async () => {
      ${dropped ? "" : "await "}ctx.sendActivity(
        { identifier: ctx.identifier }, "followers", activity,
      );
    };
    const run = async () => {
      ${declaration}
      for ({ deliver = async () => {} } of [{ deliver }]) {}
      await deliver();
    };
    await run();
  });
`,
        rule,
        ruleName,
        expectedError: undefined,
      }),
    );
  }
}

const expectRequired = (reaches: boolean, _dropped: boolean) =>
  reaches ? undefined : "Outbox listeners should deliver posted activities";

const OUTER_TARGET = (dropped: boolean) => `
    const key = "fallback";
    let target = {
      deliver: async () => {
        ${dropped ? "" : "await "}ctx.sendActivity(
          { identifier: ctx.identifier }, "followers", activity,
        );
      },
      fallback: () => {},
      handlers: {},
    };`;

for (
  const [kind, write] of [
    ["property", "target.fallback = () => {};"],
    ["computed literal", 'target["fallback"] = () => {};'],
    ["computed key", "target[key] = () => {};"],
    ["nested property", "target.handlers.fallback = () => {};"],
  ] as const
) {
  for (
    const [scenario, read, call] of [
      ["called", "await target.deliver();", "await run();"],
      ["uncalled", "await target.deliver();", ""],
      ["write-only", "", "await run();"],
    ] as const
  ) {
    for (const dropped of [false, true]) {
      test(
        `${ruleName}: ${kind} write in a ${scenario} nested helper keeps ${
          dropped ? "dropped" : "awaited"
        } object delivery`,
        lintTest({
          code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {${OUTER_TARGET(dropped)}
    const run = async () => {
      ${write}
      ${read}
    };
    ${call}
  });
`,
          rule,
          ruleName,
          expectedError: expectRequired(scenario === "called", dropped),
        }),
      );
    }
  }
}

for (
  const [kind, reaches, helper] of [
    [
      "local object",
      false,
      `const run = async () => {
      const target = { deliver: async () => {}, handlers: {} };
      target.fallback = () => {};
      await target.deliver();
    };`,
    ],
    [
      "local empty object",
      false,
      `const run = async () => {
      const target = { handlers: {} };
      target.fallback = () => {};
      await target.deliver();
    };`,
    ],
    [
      "parameter",
      false,
      `const run = async (target = { handlers: {} }) => {
      target.fallback = () => {};
      await target.deliver();
    };`,
    ],
    [
      "constructor parameter property",
      false,
      `class Runner {
      constructor(private target: any) {
        target.fallback = () => {};
        target.deliver();
      }
    }
    const run = async () => new Runner({});`,
    ],
    [
      "empty class",
      false,
      `const run = async () => {
      class target {}
      target.fallback = () => {};
      await target.deliver();
    };`,
    ],
    [
      "var in dead code",
      false,
      `const run = async () => {
      if (false) {
        var target;
      }
      target.fallback = () => {};
      await target.deliver();
    };`,
    ],
    [
      "var after return",
      false,
      `const run = async () => {
      target.fallback = () => {};
      await target.deliver();
      return;
      var target;
    };`,
    ],
    [
      "catch binding",
      false,
      `const run = async () => {
      try {
        throw {};
      } catch (target) {
        target.fallback = () => {};
        await target.deliver();
      }
    };`,
    ],
    [
      "loop binding",
      false,
      `const run = async () => {
      for (const target of [{ handlers: {} }]) {
        target.fallback = () => {};
        await target.deliver();
      }
    };`,
    ],
    [
      "switch-local binding",
      false,
      `const run = async () => {
      switch (activity.id) {
        default:
          let target = { handlers: {} };
          target.fallback = () => {};
          await target.deliver();
      }
    };`,
    ],
    [
      "static block var",
      false,
      `const run = async () => {
      const C = class {
        static {
          var target = { handlers: {} };
          target.fallback = () => {};
          target.deliver();
        }
      };
    };`,
    ],
    [
      "enum member",
      false,
      `const run = async () => {
      enum E {
        target = 0,
        result = (target.fallback = () => {}, target.deliver(), 1),
      }
    };`,
    ],
    [
      "block-local read",
      false,
      `const run = async () => {
      target.fallback = () => {};
      {
        const target = { deliver: async () => {}, handlers: {} };
        await target.deliver();
      }
    };`,
    ],
    [
      "reassigned outer binding",
      false,
      `const run = async () => {
      target = { deliver: async () => {}, handlers: {} };
      target.fallback = () => {};
      await target.deliver();
    };`,
    ],
    [
      "reassignment in a parameter default",
      false,
      `const run = async (
      _ = (target = { deliver: async () => {}, handlers: {} }),
    ) => {
      target.fallback = () => {};
      await target.deliver();
    };`,
    ],
    [
      "destructured reassignment",
      false,
      `const run = async () => {
      ({ target } = { target: { deliver: async () => {}, handlers: {} } });
      target.fallback = () => {};
      await target.deliver();
    };`,
    ],
    [
      "closure over a local empty object",
      false,
      `const run = async () => {
      const target = {};
      const go = async () => {
        target.fallback = () => {};
        await target.deliver();
      };
      await go();
    };`,
    ],
    [
      "closure over a loop binding",
      false,
      `const run = async () => {
      for (const target of [{}]) {
        const go = async () => {
          target.fallback = () => {};
          await target.deliver();
        };
        await go();
      }
    };`,
    ],
    [
      "closure over the outer object",
      true,
      `const run = async () => {
      const go = async () => {
        target.fallback = () => {};
        await target.deliver();
      };
      await go();
    };`,
    ],
    [
      "write inside a block",
      true,
      `const run = async () => {
      if (activity.id != null) {
        target.fallback = () => {};
      }
      await target.deliver();
    };`,
    ],
    [
      "expression-bodied helper",
      true,
      `const run = async () => (
      target.fallback = () => {}, await target.deliver()
    );`,
    ],
    [
      "write before a member loop default",
      true,
      `const run = async () => {
      target.fallback = () => {};
      for ({ other: target.other = () => {} } of [{}]) {}
      await target.deliver();
    };`,
    ],
    [
      "write after a member loop default",
      true,
      `const run = async () => {
      for ({ other: target.other = () => {} } of [{}]) {}
      target.fallback = () => {};
      await target.deliver();
    };`,
    ],
  ] as const
) {
  for (const dropped of [false, true]) {
    test(
      `${ruleName}: nested helper property write with ${kind} ${
        reaches ? "keeps" : "does not reach"
      } ${dropped ? "dropped" : "awaited"} outer object delivery`,
      lintTest({
        code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {${OUTER_TARGET(dropped)}
    ${helper}
    await run();
  });
`,
        rule,
        ruleName,
        expectedError: expectRequired(reaches, dropped),
      }),
    );
  }
}

test(
  `${ruleName}: unread function written by a nested helper does not count`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const target = { deliver: async () => {} };
    const run = async () => {
      target.fallback = async () => {
        await ctx.sendActivity(
          { identifier: ctx.identifier }, "followers", activity,
        );
      };
    };
    await run();
  });
`,
    rule,
    ruleName,
    expectedError: "Outbox listeners should deliver posted activities",
  }),
);

test(
  `${ruleName}: ✅ Good - module function`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
async function deliver(ctx, activity) { await ctx.sendActivity({ identifier: ctx.identifier }, "followers", activity); }

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    await deliver(ctx, activity);
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - module arrow with renamed context`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
const deliver = async (context, activity) => { await context.sendActivity({ identifier: context.identifier }, "followers", activity); };

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    await deliver(ctx, activity);
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - module function alias`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
async function send(ctx, activity) { await ctx.sendActivity({ identifier: ctx.identifier }, "followers", activity); }
const deliver = send;

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    await deliver(ctx, activity);
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - exported helper`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
export async function deliver(ctx, activity) { await ctx.forwardActivity({ identifier: ctx.identifier }, "followers"); }

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    await deliver(ctx, activity);
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - module object method`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
const delivery = { async deliver(context, activity) { await context.sendActivity({ identifier: context.identifier }, "followers", activity); } };

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    await delivery.deliver(ctx, activity);
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - module object literal property`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
const delivery = { "deliver": async (context, activity) => { await context.sendActivity({ identifier: context.identifier }, "followers", activity); } };

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    await delivery["deliver"](ctx, activity);
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - context in second argument`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
const deliver = async (activity, context) => { await context.sendActivity({ identifier: context.identifier }, "followers", activity); };

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    await deliver(activity, ctx);
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - destructured helper context`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
async function deliver({ sendActivity: send }, activity) { await send({ identifier: "alice" }, "followers", activity); }

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    await deliver(ctx, activity);
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - multiple helper hops`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
async function deliver(context, activity) { await forward(activity, context); }
async function forward(activity, outbox) { await outbox.forwardActivity({ identifier: outbox.identifier }, "followers"); }

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    await deliver(ctx, activity);
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - self recursion with delivery`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
async function deliver(context, activity) { if (activity) await deliver(context, null); await context.sendActivity({ identifier: context.identifier }, "followers", activity); }

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    await deliver(ctx, activity);
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - module alias resolves in declaration scope`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
async function send(context, activity) { await context.sendActivity({ identifier: context.identifier }, "followers", activity); }
const deliver = send;

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const send = () => {}; await deliver(ctx, activity);
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - unrelated local helper does not overwrite module helper`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
async function deliver(context, activity) { await context.sendActivity({ identifier: context.identifier }, "followers", activity); }
function unrelated() { const deliver = () => {}; }

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    await deliver(ctx, activity);
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - context assertion`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
async function deliver(context, activity) { await context.sendActivity({ identifier: context.identifier }, "followers", activity); }

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    await deliver(ctx as any, activity);
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ❌ Bad - uncalled module helper`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
async function deliver(ctx, activity) { await ctx.sendActivity({ identifier: ctx.identifier }, "followers", activity); }

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    console.log(activity);
  });
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ❌ Bad - imported helper`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
import { deliver } from "./delivery.ts";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    await deliver(ctx, activity);
  });
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ❌ Bad - helper called with other object`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
async function deliver(context, activity) { await context.sendActivity({ identifier: context.identifier }, "followers", activity); }

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const other = { sendActivity() {} }; await deliver(other, activity);
  });
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ❌ Bad - helper called without context`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
async function deliver(context, activity) { await context.sendActivity({ identifier: context.identifier }, "followers", activity); }

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    await deliver();
  });
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ❌ Bad - local binding shadows module helper`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
async function deliver(context, activity) { await context.sendActivity({ identifier: context.identifier }, "followers", activity); }

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const deliver = () => {}; await deliver(ctx, activity);
  });
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ❌ Bad - block binding shadows module helper`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
async function deliver(context, activity) { await context.sendActivity({ identifier: context.identifier }, "followers", activity); }

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    { const deliver = () => {}; await deliver(ctx, activity); }
  });
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ❌ Bad - helper parameter shadows module helper`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
async function send(context, activity) { await context.sendActivity({ identifier: context.identifier }, "followers", activity); }
async function deliver(context, send) { await send(context); }

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    await deliver(ctx, () => {});
  });
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ❌ Bad - destructured parameter shadows module helper`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
async function send(context, activity) { await context.sendActivity({ identifier: context.identifier }, "followers", activity); }
async function deliver(context, { send }) { await send(context); }

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    await deliver(ctx, { send() {} });
  });
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ❌ Bad - block binding shadows context`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
async function deliver(context, activity) { await context.sendActivity({ identifier: context.identifier }, "followers", activity); }

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    { const ctx = {}; await deliver(ctx, activity); }
  });
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ❌ Bad - uncalled nested function invokes module helper`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
async function deliver(context, activity) { await context.sendActivity({ identifier: context.identifier }, "followers", activity); }

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const unused = () => deliver(ctx, activity);
  });
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ❌ Bad - mutual recursion without delivery`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
async function deliver(context, activity) { await again(context, activity); }
async function again(context, activity) { await deliver(context, activity); }

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    await deliver(ctx, activity);
  });
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ❌ Bad - cyclic helper aliases`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
const deliver = again; const again = deliver;

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    await deliver(ctx, activity);
  });
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ❌ Bad - dynamic object key`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
const delivery = { deliver: async (context, activity) => { await context.sendActivity({ identifier: context.identifier }, "followers", activity); } };
const key = "deliver";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    await delivery[key](ctx, activity);
  });
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ✅ Good - helper declared after listener`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
federation.setOutboxListeners("/users/{identifier}/outbox").on(Activity, async (ctx, activity) => { await deliver(ctx, activity); });
async function deliver(context, activity) { await context.sendActivity({ identifier: context.identifier }, "followers", activity); }
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - mutual recursion from both entry points`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
async function first(ctx, activity) { await second(ctx, activity); }
async function second(ctx, activity) { await first(ctx, activity); await ctx.sendActivity({ identifier: ctx.identifier }, "followers", activity); }
federation.setOutboxListeners("/users/{identifier}/outbox")
.on(Activity, first).on(Activity, second);
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - named listener uses module helper`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
async function deliver(context, activity) { await context.sendActivity({ identifier: context.identifier }, "followers", activity); }
async function listener(ctx, activity) { await deliver(ctx, activity); }
function unrelated() { const listener = () => {}; }
federation.setOutboxListeners("/users/{identifier}/outbox").on(Activity, listener);
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - revisit helper with a different context position`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
async function route(first, second, activity) { await deliver(second, activity); }
async function deliver(ctx, activity) { await ctx.sendActivity({ identifier: ctx.identifier }, "followers", activity); }
federation.setOutboxListeners("/users/{identifier}/outbox").on(Activity, async (ctx, activity) => { await route(ctx, {}, activity); await route({}, ctx, activity); });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - local helper with renamed context`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
federation.setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    async function deliver(context, activity) {
      await context.sendActivity({ identifier: context.identifier }, "followers", activity);
    }
    await deliver(ctx, activity);
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ❌ Bad - unrelated static block with const binding`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
function deliver(context) {}
class Unrelated {
  static {
    const deliver = context => context.sendActivity();
  }
}
federation.setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx) => { await deliver(ctx); });
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ❌ Bad - unrelated static block with var binding`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
function deliver(context) {}
class Unrelated {
  static {
    var deliver = context => context.sendActivity();
  }
}
federation.setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx) => { await deliver(ctx); });
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ❌ Bad - uninitialized var redeclaration keeps listener`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
var listener = (ctx) => { console.log(ctx); };
var listener;
federation.setOutboxListeners("/users/{identifier}/outbox").on(Activity, listener);
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ✅ Good - uninitialized var redeclaration keeps helper`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
var deliver = context => context.sendActivity();
var deliver;
federation.setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx) => { await deliver(ctx); });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ❌ Bad - function-body function and var share binding`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
function setup() {
  function listener(ctx) { ctx.sendActivity(); }
  var listener = ctx => {};
  federation.setOutboxListeners("/users/{identifier}/outbox").on(Activity, listener);
}
setup();
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ❌ Bad - namespace function does not overwrite module helper`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
function deliver(context) {}
namespace Unrelated {
  export function deliver(context) { context.sendActivity(); }
}
federation.setOutboxListeners("/users/{identifier}/outbox").on(Activity, ctx => deliver(ctx));
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ❌ Bad - namespace var does not overwrite module helper`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
function deliver(context) {}
namespace Unrelated {
  export var deliver = context => context.sendActivity();
}
federation.setOutboxListeners("/users/{identifier}/outbox").on(Activity, ctx => deliver(ctx));
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ❌ Bad - named class expression shadows context`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
function deliver(context) { context.sendActivity(); }
federation.setOutboxListeners("/users/{identifier}/outbox").on(Activity, ctx => {
  const C = class ctx { static sendActivity() {} static { deliver(ctx); } };
});
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ❌ Bad - uncalled instance field does not deliver`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
function deliver(context) { context.sendActivity(); }
federation.setOutboxListeners("/users/{identifier}/outbox").on(Activity, ctx => {
  class Unused { value = deliver(ctx); }
});
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ❌ Bad - var initializer overrides later function declaration`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
function setup() {
  var listener = ctx => {};
  function listener(ctx) { ctx.sendActivity(); }
  federation.setOutboxListeners("/users/{identifier}/outbox").on(Activity, listener);
}
setup();
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ❌ Bad - static-block function and var share binding`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
class Setup {
  static {
    function listener(ctx) { ctx.sendActivity(); }
    var listener = ctx => {};
    federation.setOutboxListeners("/users/{identifier}/outbox").on(Activity, listener);
  }
}
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ❌ Bad - generator helper`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
function* deliver(context) { context.sendActivity(); }
federation.setOutboxListeners("/users/{identifier}/outbox").on(Activity, ctx => deliver(ctx));
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ❌ Bad - async generator helper`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
async function* deliver(context) { context.sendActivity(); }
federation.setOutboxListeners("/users/{identifier}/outbox").on(Activity, ctx => deliver(ctx));
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ❌ Bad - generator function binding`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
const deliver = function* (context) { context.sendActivity(); };
federation.setOutboxListeners("/users/{identifier}/outbox").on(Activity, ctx => deliver(ctx));
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ✅ Good - computed instance-field key delivers during definition`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
function deliver(context) { context.sendActivity(); return "key"; }
federation.setOutboxListeners("/users/{identifier}/outbox").on(Activity, ctx => {
  class Example { [deliver(ctx)] = 0; }
});
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ❌ Bad - uncalled auto-accessor initializer does not deliver`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
function deliver(context) { context.sendActivity(); }
federation.setOutboxListeners("/users/{identifier}/outbox").on(Activity, ctx => {
  class Unused { accessor value = deliver(ctx); }
});
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ❌ Bad - class declaration shadows module helper`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
function deliver(context) { context.sendActivity(); }
federation.setOutboxListeners("/users/{identifier}/outbox").on(Activity, ctx => {
  class deliver {} deliver(ctx);
});
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ❌ Bad - catch parameter shadows context`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
function deliver(context) { context.sendActivity(); }
federation.setOutboxListeners("/users/{identifier}/outbox").on(Activity, ctx => {
  try {} catch (ctx) { deliver(ctx); }
});
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ❌ Bad - loop binding shadows context`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
function deliver(context) { context.sendActivity(); }
federation.setOutboxListeners("/users/{identifier}/outbox").on(Activity, ctx => {
  for (const ctx of items) deliver(ctx);
});
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ❌ Bad - spread makes context argument position unknown`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
function deliver(context) { context.sendActivity(); }
federation.setOutboxListeners("/users/{identifier}/outbox").on(Activity, ctx => {
  deliver(...rest, ctx);
});
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ❌ Bad - rest helper parameters are not context parameters`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
function deliver(...args) { args[0].sendActivity(); }
federation.setOutboxListeners("/users/{identifier}/outbox").on(Activity, ctx => {
  deliver(ctx);
});
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

for (
  const statement of ["if (false) { deliver(ctx); }", "return; deliver(ctx);"]
) {
  test(
    `${ruleName}: dead module helper call (${statement})`,
    lintTest({
      code: `
import { Activity } from "@fedify/vocab";
function deliver(ctx) { ctx.sendActivity(); }
federation.setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, ctx => { ${statement} });
`,
      rule,
      ruleName,
      expectedError: "Outbox listeners should deliver posted activities",
    }),
  );
}
