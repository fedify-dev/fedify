import { test } from "node:test";
import { RULE_IDS } from "../lib/const.ts";
import lintTest from "../lib/test.ts";
import * as notAwaited from "../rules/outbox-listener-delivery-not-awaited.ts";
import * as required from "../rules/outbox-listener-delivery-required.ts";

// The two rules divide the work: outbox-listener-delivery-required reports a
// listener with no delivery call that can run, and
// outbox-listener-delivery-not-awaited reports a delivery call that can run
// but is not awaited. Neither should have anything to say about what the
// other one reports.

const REQUIRED_MESSAGE = "Outbox listeners should deliver posted activities";
const NOT_AWAITED_MESSAGE = "Delivery is not awaited";

// Every listener the not-awaited rule reports has a delivery call.
const UNAWAITED: [title: string, code: string][] = [
  [
    "bare sendActivity call",
    `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    ctx.sendActivity(sender, inbox, activity);
  });
`,
  ],
  [
    "bare forwardActivity call",
    `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    ctx.forwardActivity(sender, [], { skipIfUnsigned: true });
  });
`,
  ],
  [
    "discarded chain ending in catch",
    `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    ctx.sendActivity(sender, inbox, activity).catch(console.error);
  });
`,
  ],
  [
    "discarded chain through then",
    `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    ctx.sendActivity(sender, inbox, activity).then(() => console.log("sent"));
  });
`,
  ],
  [
    "discarded chain ending in finally",
    `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    ctx.sendActivity(sender, inbox, activity).finally(() => console.log("done"));
  });
`,
  ],
  [
    "discarded then callback returning a delivery",
    `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    Promise.resolve().then(() => ctx.sendActivity(sender, inbox, activity));
  });
`,
  ],
  [
    "promise stored and never used",
    `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    const pending = ctx.sendActivity(sender, inbox, activity);
  });
`,
  ],
  [
    "promise assigned and never used",
    `
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
  ],
  [
    "promise stored in an object that is never used",
    `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    const jobs = { pending: ctx.sendActivity(sender, inbox, activity) };
  });
`,
  ],
  [
    "callback passed to forEach",
    `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    inboxes.forEach((target) => ctx.sendActivity(sender, target, activity));
  });
`,
  ],
  [
    "map result dropped",
    `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    inboxes.map((target) => ctx.sendActivity(sender, target, activity));
  });
`,
  ],
  [
    "map result kept but never used",
    `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    const promises = inboxes.map((target) => ctx.sendActivity(sender, target, activity));
  });
`,
  ],
  [
    "Promise.all that is never awaited",
    `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    Promise.all(inboxes.map((target) => ctx.sendActivity(sender, target, activity)));
  });
`,
  ],
  [
    "bare call inside an async callback",
    `
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
  ],
  [
    "bare call inside a try block",
    `
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
  ],
  [
    "bare call inside a loop",
    `
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
  ],
  [
    "bare call behind a logical and",
    `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    activity.id != null && ctx.sendActivity(sender, inbox, activity);
  });
`,
  ],
  [
    "bare call in a conditional expression",
    `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    activity.id != null ? ctx.sendActivity(sender, inbox, activity) : null;
  });
`,
  ],
  [
    "bare call in a sequence expression",
    `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    (ctx.sendActivity(sender, inbox, activity), console.log("sent"));
  });
`,
  ],
  [
    "bare call in an immediately invoked function",
    `
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
  ],
  [
    "bare call through an optional chain",
    `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    ctx?.sendActivity(sender, inbox, activity);
  });
`,
  ],
  [
    "bare call through bracket notation",
    `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    ctx["sendActivity"](sender, inbox, activity);
  });
`,
  ],
  [
    "bare call through a type assertion",
    `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    (ctx as any).sendActivity(sender, inbox, activity);
  });
`,
  ],
  [
    "bare call to a destructured delivery method",
    `
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
  ],
  [
    "bare call to a delivery method taken from ctx",
    `
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
  ],
  [
    "helper that awaits delivery, called without await",
    `
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
  ],
  [
    "helper that returns delivery, called without await",
    `
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
  ],
  [
    "helper that calls a delivering helper, called without await",
    `
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
  ],
  [
    "helper with a bare call inside it, called with await",
    `
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
  ],
  [
    "delivery method destructured in the parameters, called without await",
    `
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
  ],
  [
    "named listener with a bare call",
    `
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
  ],
  [
    "bare call in a class method",
    `
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
  ],
  [
    "bare call in an object method",
    `
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
  ],
];

// A listener with no delivery call that can run is the required rule's business.
const NO_DELIVERY: [title: string, code: string][] = [
  [
    "a listener that delivers nothing",
    `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    console.log(ctx.identifier);
  });
`,
  ],
  [
    "a delivery call only in a dead branch",
    `
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
  ],
  [
    "a delivery call after a return",
    `
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
  ],
  [
    "a delivery call after a throw",
    `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    throw new Error("stop");
    ctx.sendActivity(sender, inbox, activity);
  });
`,
  ],
  [
    "a delivery call only in a helper nothing uses",
    `
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
  ],
  [
    "a delivery call only in an object nothing uses",
    `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    const handlers = { deliver: () => ctx.sendActivity(sender, inbox, activity) };
  });
`,
  ],
];

for (const [title, code] of UNAWAITED) {
  test(
    `outbox-listener rules: ✅ delivery-required stays quiet on ${title}`,
    lintTest({
      code,
      rule: required,
      ruleName: RULE_IDS.outboxListenerDeliveryRequired,
    }),
  );
}

for (const [title, code] of NO_DELIVERY) {
  test(
    `outbox-listener rules: ❌ delivery-required reports ${title}`,
    lintTest({
      code,
      rule: required,
      ruleName: RULE_IDS.outboxListenerDeliveryRequired,
      expectedError: REQUIRED_MESSAGE,
    }),
  );
  test(
    `outbox-listener rules: ✅ delivery-not-awaited stays quiet on ${title}`,
    lintTest({
      code,
      rule: notAwaited,
      ruleName: RULE_IDS.outboxListenerDeliveryNotAwaited,
    }),
  );
}

for (const [title, code] of UNAWAITED.slice(0, 1)) {
  test(
    `outbox-listener rules: ❌ delivery-not-awaited reports ${title}`,
    lintTest({
      code,
      rule: notAwaited,
      ruleName: RULE_IDS.outboxListenerDeliveryNotAwaited,
      expectedError: NOT_AWAITED_MESSAGE,
    }),
  );
}
