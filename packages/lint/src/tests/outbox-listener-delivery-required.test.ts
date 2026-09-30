import { test } from "@fedify/fixture";
import { RULE_IDS } from "../lib/const.ts";
import lintTest from "../lib/test.ts";
import * as rule from "../rules/outbox-listener-delivery-required.ts";

const ruleName = RULE_IDS.outboxListenerDeliveryRequired;

const assignedDelivery = `
import { Activity } from "@fedify/vocab";
federation.setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const target = { deliver: async () => {} };
    const setup = () => {
      target.deliver = async () => {
        await ctx.sendActivity(
          { identifier: ctx.identifier }, "followers", activity,
        );
      };
    };
    SETUP_AND_DELIVERY
  });
`;

test(
  `${ruleName}: ✅ Good - called setup installs delivery before use`,
  lintTest({
    code: assignedDelivery.replace(
      "SETUP_AND_DELIVERY",
      "setup(); await target.deliver();",
    ),
    rule,
    ruleName,
  }),
);

for (
  const [name, code] of [
    ["uncalled setup", "await target.deliver();"],
    ["setup called after delivery", "await target.deliver(); setup();"],
  ] as const
) {
  test(
    `${ruleName}: ❌ Bad - ${name}`,
    lintTest({
      code: assignedDelivery.replace("SETUP_AND_DELIVERY", code),
      rule,
      ruleName,
      expectedError:
        "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
    }),
  );
}

test(
  `${ruleName}: ❌ Bad - setup writes to a shadowing object`,
  lintTest({
    code: assignedDelivery.replace(
      "target.deliver = async () => {",
      "const target = { deliver: async () => {} }; target.deliver = async () => {",
    ).replace("SETUP_AND_DELIVERY", "setup(); await target.deliver();"),
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

for (
  const [name, code] of [
    ["uncalled setup with conditional assignment", "await target.deliver();"],
    [
      "called setup with conditional assignment",
      "setup(); await target.deliver();",
    ],
  ] as const
) {
  test(
    `${ruleName}: ❌ Bad - ${name}`,
    lintTest({
      code: assignedDelivery.replace(
        "      target.deliver = async () => {",
        "      if (Math.random() < 0.5) target.deliver = async () => {",
      ).replace("SETUP_AND_DELIVERY", code),
      rule,
      ruleName,
      expectedError:
        "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
    }),
  );
}

test(
  `${ruleName}: ✅ Good - passed setup callback with conditional assignment`,
  lintTest({
    code: assignedDelivery.replace(
      "      target.deliver = async () => {",
      "      if (true) target.deliver = async () => {",
    ).replace(
      "SETUP_AND_DELIVERY",
      "await Promise.resolve().then(setup); await target.deliver();",
    ),
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ❌ Bad - setup assigns a nested object method`,
  lintTest({
    code: assignedDelivery.replace(
      "const target = { deliver: async () => {} };",
      "const target = { methods: { deliver: async () => {} } };",
    ).replaceAll("target.deliver", "target.methods.deliver").replace(
      "SETUP_AND_DELIVERY",
      "setup(); await target.methods.deliver();",
    ),
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

for (
  const [name, code] of [
    ["returned method call", "setup(); return target.deliver();"],
    [
      "method call in initializer",
      "setup(); const result = target.deliver(); await result;",
    ],
  ] as const
) {
  test(
    `${ruleName}: ✅ Good - setup before ${name}`,
    lintTest({
      code: assignedDelivery.replace("SETUP_AND_DELIVERY", code),
      rule,
      ruleName,
    }),
  );
}

test(
  `${ruleName}: ❌ Bad - installed function uses unrelated parameter`,
  lintTest({
    code: assignedDelivery.replace(
      /target\.deliver = async \(\) => \{[\s\S]*?\n[ ]{6}\};/,
      "target.deliver = async ({ sendActivity }) => { sendActivity(); };",
    ).replace(
      "SETUP_AND_DELIVERY",
      "setup(); await target.deliver({ sendActivity: async () => {} });",
    ),
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

test(
  `${ruleName}: ✅ Good - installed function calls captured delivery alias`,
  lintTest({
    code: assignedDelivery.replace(
      "    const setup = () => {",
      "    const send = ctx.sendActivity.bind(ctx);\n    const setup = () => {",
    ).replace(
      /await ctx\.sendActivity\([\s\S]*?\);/,
      'await send({ identifier: ctx.identifier }, "followers", activity);',
    ).replace("SETUP_AND_DELIVERY", "setup(); await target.deliver();"),
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - installed function shadows context but calls captured alias`,
  lintTest({
    code: assignedDelivery.replace(
      "    const setup = () => {",
      "    const send = ctx.sendActivity.bind(ctx);\n    const setup = () => {",
    ).replace(
      "target.deliver = async () => {",
      "target.deliver = async (ctx) => {",
    ).replace(
      /await ctx\.sendActivity\([\s\S]*?\);/,
      'await send({ identifier: "alice" }, "followers", activity);',
    ).replace("SETUP_AND_DELIVERY", "setup(); await target.deliver({});"),
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - setup and delivery in unconditional block`,
  lintTest({
    code: assignedDelivery.replace(
      "SETUP_AND_DELIVERY",
      "{ setup(); await target.deliver(); }",
    ),
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - inline callback assigns unrelated function`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
federation.setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const recipients = ["followers"];
    await Promise.all(recipients.map(async (recipient) => {
      const options = { onError: () => {} };
      options.onError = () => {};
      await ctx.sendActivity(
        { identifier: ctx.identifier }, recipient, activity,
      );
    }));
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - named callback assigns unrelated function`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
federation.setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const recipients = ["followers"];
    const deliver = async (recipient) => {
      const options = { onError: () => {} };
      options.onError = () => {};
      await ctx.sendActivity(
        { identifier: ctx.identifier }, recipient, activity,
      );
    };
    await Promise.all(recipients.map(deliver));
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - called helper inside try delivers directly`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
federation.setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const deliver = async () => {
      const options = { onError: () => {} };
      options.onError = () => {};
      await ctx.sendActivity(
        { identifier: ctx.identifier }, "followers", activity,
      );
    };
    try { await deliver(); } catch (error) { console.error(error); }
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ❌ Bad - uncalled setup with destructured context`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
federation.setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async ({ sendActivity, identifier }, activity) => {
    const target = { deliver: async () => {} };
    const setup = () => {
      target.deliver = async () => {
        await sendActivity({ identifier }, "followers", activity);
      };
    };
    await target.deliver();
  });
`,
    rule,
    ruleName,
    expectedError:
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
  }),
);

const aliasDelivery = assignedDelivery.replace(
  /await ctx\.sendActivity\([\s\S]*?\);/,
  'await send({ identifier: ctx.identifier }, "followers", activity);',
);

for (
  const [name, code] of [
    [
      "setup-local alias",
      aliasDelivery.replace(
        "    const setup = () => {",
        "    const setup = () => {\n      const send = ctx.sendActivity.bind(ctx);",
      ).replace("SETUP_AND_DELIVERY", "setup(); await target.deliver();"),
    ],
    [
      "bracketed context method alias",
      aliasDelivery.replace(
        "    const setup = () => {",
        '    const send = ctx["sendActivity"].bind(ctx);\n    const setup = () => {',
      ).replace("SETUP_AND_DELIVERY", "setup(); await target.deliver();"),
    ],
    [
      "destructured context method alias",
      aliasDelivery.replace(
        "    const setup = () => {",
        "    const { sendActivity: send } = ctx;\n    const setup = () => {",
      ).replace("SETUP_AND_DELIVERY", "setup(); await target.deliver();"),
    ],
    [
      "alias initialized after setup",
      aliasDelivery.replace(
        "SETUP_AND_DELIVERY",
        "setup(); const send = ctx.sendActivity.bind(ctx); await target.deliver();",
      ),
    ],
  ] as const
) {
  test(
    `${ruleName}: ✅ Good - ${name}`,
    lintTest({ code, rule, ruleName }),
  );
}

test(
  `${ruleName}: ✅ Good - called setup invokes captured alias directly`,
  lintTest({
    code: assignedDelivery.replace(
      "    const setup = () => {",
      "    const send = ctx.sendActivity.bind(ctx);\n    const setup = () => {",
    ).replace(
      "    };\n    SETUP_AND_DELIVERY",
      '      send({ identifier: ctx.identifier }, "followers", activity);\n    };\n    SETUP_AND_DELIVERY',
    ).replace("SETUP_AND_DELIVERY", "setup();"),
    rule,
    ruleName,
  }),
);

for (
  const [name, call, expectedError] of [
    ["called setup delivers directly", "setup();", undefined],
    [
      "uncalled setup with direct delivery",
      "",
      "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().",
    ],
  ] as const
) {
  test(
    `${ruleName}: ${name}`,
    lintTest({
      code: assignedDelivery.replace(
        "    };\n    SETUP_AND_DELIVERY",
        '      ctx.sendActivity({ identifier: ctx.identifier }, "followers", activity);\n    };\n    SETUP_AND_DELIVERY',
      ).replace("SETUP_AND_DELIVERY", call),
      rule,
      ruleName,
      expectedError,
    }),
  );
}

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
