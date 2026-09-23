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
  `${ruleName}: ❌ Bad - delivery call only inside an unawaited callback`,
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
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
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
