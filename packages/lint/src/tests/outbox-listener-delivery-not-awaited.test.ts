import * as tsParser from "@typescript-eslint/parser";
import { Linter } from "eslint";
import { deepStrictEqual } from "node:assert/strict";
import { test } from "node:test";
import { FEDERATION_SETUP, RULE_IDS } from "../lib/const.ts";
import lintTest from "../lib/test.ts";
import * as rule from "../rules/outbox-listener-delivery-not-awaited.ts";

const ruleName = RULE_IDS.outboxListenerDeliveryNotAwaited;

const arrayHelperDelivery = "ctx.sendActivity(sender, inbox, activity)";
const arrayHelperMap = `inboxes.map((inbox) => ${arrayHelperDelivery})`;

for (const [producer, definition] of [
  ["map", `const deliverAll = () => ${arrayHelperMap};`],
  [
    "array IIFE",
    `const deliverAll = () => (() => [${arrayHelperDelivery}])();`,
  ],
  [
    "inline flatMap array",
    `const deliverAll = () => inboxes.flatMap(() => [${arrayHelperDelivery}]);`,
  ],
  [
    "named flatMap array",
    `const deliverOne = () => [${arrayHelperDelivery}]; const deliverAll = () => inboxes.flatMap(deliverOne);`,
  ],
  [
    "async map callback",
    `const deliverAll = () => inboxes.map(async () => { await ${arrayHelperDelivery}; });`,
  ],
  [
    "named map callback",
    `const deliverOne = () => ${arrayHelperDelivery}; const deliverAll = () => inboxes.map(deliverOne);`,
  ],
  [
    "named async map callback",
    `const deliverOne = async () => { await ${arrayHelperDelivery}; }; const deliverAll = () => inboxes.map(deliverOne);`,
  ],
  [
    "flatMap",
    `const deliverAll = () => inboxes.flatMap(() => ${arrayHelperDelivery});`,
  ],
  ["literal", `const deliverAll = () => [${arrayHelperDelivery}];`],
  ["block", `function deliverAll() { return ${arrayHelperMap}; }`],
  ["wrapper", `const deliverAll = () => ([${arrayHelperDelivery}] as const)!;`],
  [
    "conditional",
    `const deliverAll = () => condition ? [${arrayHelperDelivery}] : ${arrayHelperMap};`,
  ],
  [
    "branches",
    `function deliverAll() { if (condition) return [${arrayHelperDelivery}]; else return ${arrayHelperMap}; }`,
  ],
  [
    "chain",
    `const deliverAll = () => inner(); const inner = () => [${arrayHelperDelivery}];`,
  ],
  [
    "reverse chain",
    `const inner = () => [${arrayHelperDelivery}]; const deliverAll = () => inner();`,
  ],
  [
    "spread",
    `const inner = () => [${arrayHelperDelivery}]; const deliverAll = () => [...inner()];`,
  ],
  ["sequence", `const deliverAll = () => (log(), [${arrayHelperDelivery}]);`],
  [
    "empty branch",
    `const deliverAll = () => condition ? [] : [${arrayHelperDelivery}];`,
  ],
] as const) {
  for (const [consumer, code, dropped] of [
    ["bare", "deliverAll();", true],
    ["await", "await deliverAll();", true],
    ["intermediate await", "await Promise.all(await deliverAll());", false],
    [
      "stored intermediate await",
      "const pending = await deliverAll(); await Promise.all(pending);",
      false,
    ],
    ["return", "return deliverAll();", true],
    ["forgotten", "const pending = deliverAll();", true],
    ["dropped combinator", "Promise.all(deliverAll());", true],
    [
      "stored",
      "const pending = deliverAll(); await Promise.all(pending);",
      false,
    ],
    ["void", "void deliverAll();", false],
    ["unknown consumer", "own(deliverAll());", false],
    ...["all", "allSettled", "race", "any"].map(
      (method) =>
        [method, `await Promise.${method}(deliverAll());`, false] as const,
    ),
  ] as const) {
    test(
      `${ruleName}: array helper ${producer}, ${consumer}`,
      lintTest({
        code: `
import { Activity } from "@fedify/vocab";
federation.setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    ${definition}
    ${code}
  });
`,
        rule,
        ruleName,
        ...(dropped ? { expectedError: "Delivery is not awaited" } : {}),
      }),
    );
  }
}

for (const [scenario, definition] of [
  [
    "mixed array first",
    `function deliverAll() { if (condition) return [${arrayHelperDelivery}]; return ${arrayHelperDelivery}; }`,
  ],
  [
    "mixed promise first",
    `function deliverAll() { if (condition) return ${arrayHelperDelivery}; return [${arrayHelperDelivery}]; }`,
  ],
  [
    "mixed conditional",
    `const deliverAll = () => condition ? [${arrayHelperDelivery}] : ${arrayHelperDelivery};`,
  ],
  [
    "unknown first",
    `function deliverAll() { if (condition) return unknown(); return [${arrayHelperDelivery}]; }`,
  ],
  [
    "unknown last",
    `function deliverAll() { if (condition) return [${arrayHelperDelivery}]; return unknown(); }`,
  ],
  [
    "bare return",
    `function deliverAll() { if (condition) return; return [${arrayHelperDelivery}]; }`,
  ],
  [
    "fallthrough",
    `function deliverAll() { if (condition) return [${arrayHelperDelivery}]; }`,
  ],
  ["async array", `const deliverAll = async () => [${arrayHelperDelivery}];`],
  ["object", `const deliverAll = () => ({ pending: ${arrayHelperMap} });`],
  [
    "stored identifier",
    `const deliverAll = () => { const pending = [${arrayHelperDelivery}]; return pending; };`,
  ],
  [
    "named thisArg",
    `const deliverOne = () => ${arrayHelperDelivery}; const deliverAll = () => inboxes.map((inbox) => inbox, deliverOne);`,
  ],
  [
    "inline async thisArg",
    `const deliverAll = () => inboxes.map((inbox) => inbox, async () => { await ${arrayHelperDelivery}; });`,
  ],
  [
    "inline returning thisArg",
    `const deliverAll = () => inboxes.flatMap((inbox) => inbox, () => ${arrayHelperDelivery});`,
  ],
  [
    "self recursion",
    `const deliverAll = () => condition ? [${arrayHelperDelivery}] : deliverAll();`,
  ],
  [
    "mutual recursion",
    `const deliverAll = () => inner(); const inner = () => condition ? [${arrayHelperDelivery}] : deliverAll();`,
  ],
  [
    "conflicting bindings",
    `let deliverAll = () => [${arrayHelperDelivery}]; deliverAll = () => ${arrayHelperDelivery};`,
  ],
] as const) {
  test(
    `${ruleName}: opaque array helper ${scenario} stays quiet through callers and callbacks`,
    lintTest({
      code: `
import { Activity } from "@fedify/vocab";
federation.setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    ${definition}
    const outer = () => deliverAll();
    await deliverAll();
    deliverAll();
    outer();
    inboxes.forEach(deliverAll);
    inboxes.forEach(outer);
    await Promise.all(await deliverAll());
  });
`,
      rule,
      ruleName,
    }),
  );
}

for (const [scenario, definition, consumer, dropped] of [
  [
    "named flatMap aggregate completion",
    `const deliverOne = () => [${arrayHelperDelivery}]; const deliver = async () => { await Promise.all(inboxes.flatMap(deliverOne)); };`,
    "deliver();",
    true,
  ],
  [
    "named flatMap aggregate awaited",
    `const deliverOne = () => [${arrayHelperDelivery}]; const deliver = async () => { await Promise.all(inboxes.flatMap(deliverOne)); };`,
    "await deliver();",
    false,
  ],
  [
    "named flatMap aggregate returned",
    `const deliverOne = () => [${arrayHelperDelivery}]; const deliver = () => Promise.all(inboxes.flatMap(deliverOne));`,
    "deliver();",
    true,
  ],
  [
    "array IIFE directly awaited",
    "",
    `await (() => [${arrayHelperDelivery}])();`,
    true,
  ],
  [
    "array IIFE aggregated",
    "",
    `await Promise.all((() => [${arrayHelperDelivery}])());`,
    false,
  ],
  ["array IIFE bare", "", `(() => [${arrayHelperDelivery}])();`, true],
  [
    "async array IIFE",
    "",
    `await (async () => [${arrayHelperDelivery}])();`,
    false,
  ],
  [
    "mixed array IIFE",
    "",
    `await (() => condition ? [${arrayHelperDelivery}] : ${arrayHelperDelivery})();`,
    false,
  ],
  ["named array forEach", "", "inboxes.forEach(deliverAll);", true],
  ["named array flatMap dropped", "", "inboxes.flatMap(deliverAll);", true],
  [
    "named array flatMap aggregated",
    "",
    "await Promise.all(inboxes.flatMap(deliverAll));",
    false,
  ],
  [
    "named array map nested",
    "",
    "await Promise.all(inboxes.map(deliverAll));",
    false,
  ],
  [
    "named array forEach thisArg",
    "",
    "inboxes.forEach(() => {}, deliverAll);",
    false,
  ],
  [
    "named array flatMap thisArg",
    "",
    "await inboxes.flatMap(() => [], deliverAll);",
    false,
  ],
  [
    "inline array flatMap thisArg",
    "",
    "await inboxes.flatMap(() => [], () => [ctx.sendActivity(sender, inbox, activity)]);",
    false,
  ],
  [
    "inline array forEach",
    "",
    "inboxes.forEach(() => [ctx.sendActivity(sender, inbox, activity)]);",
    true,
  ],
  [
    "inline array map nested",
    "",
    "await Promise.all(inboxes.map(() => [ctx.sendActivity(sender, inbox, activity)]));",
    false,
  ],
  [
    "async array flatMap",
    "",
    "await inboxes.flatMap(async () => [ctx.sendActivity(sender, inbox, activity)]);",
    false,
  ],
  [
    "async array and returned completion bindings",
    `let deliver = async () => []; if (condition) { deliver = () => ${arrayHelperDelivery}; }`,
    "deliver();",
    true,
  ],
  [
    "async array and returned completion callback",
    `let deliver = async () => []; if (condition) { deliver = () => ${arrayHelperDelivery}; }`,
    "inboxes.forEach(deliver);",
    true,
  ],
  [
    "awaited async array and returned completion",
    `let deliver = async () => []; if (condition) { deliver = () => ${arrayHelperDelivery}; }`,
    "await deliver();",
    false,
  ],
  [
    "mixed sync and async completion bindings",
    `let deliver = async () => { await ${arrayHelperDelivery}; return []; }; if (condition) { deliver = () => ${arrayHelperDelivery}; }`,
    "deliver();",
    true,
  ],
  [
    "mixed completion callback bindings",
    `let deliver = async () => { await ${arrayHelperDelivery}; return []; }; if (condition) { deliver = () => ${arrayHelperDelivery}; }`,
    "inboxes.forEach(deliver);",
    true,
  ],
  [
    "awaited mixed completion bindings",
    `let deliver = async () => { await ${arrayHelperDelivery}; return []; }; if (condition) { deliver = () => ${arrayHelperDelivery}; }`,
    "await deliver();",
    false,
  ],
  [
    "async helper independently awaits delivery",
    `const deliver = async () => { await ${arrayHelperDelivery}; return []; };`,
    "deliver();",
    true,
  ],
  ...["return", "return await"].flatMap((returnSyntax) =>
    [
      ["dropped", "deliver();", true],
      ["awaited", "await deliver();", false],
      ["callback", "inboxes.forEach(deliver);", true],
      ["chain", "const forward = () => deliver(); forward();", true],
    ].map(
      ([label, use, reports]) =>
        [
          `async mixed array adopts delivery: ${returnSyntax} ${label}`,
          `async function deliver() { if (skip) return []; ${returnSyntax} ${arrayHelperDelivery}; }`,
          use,
          reports,
        ] as const,
    ),
  ),
  [
    "async completion through a sync helper",
    `const inner = async () => { await ${arrayHelperDelivery}; return []; }; const deliver = () => inner();`,
    "deliver();",
    true,
  ],
  [
    "awaited async helper independently awaits delivery",
    `const deliver = async () => { await ${arrayHelperDelivery}; return []; };`,
    "await deliver();",
    false,
  ],
  [
    "async callback independently awaits delivery",
    `const deliver = async () => { await ${arrayHelperDelivery}; return []; };`,
    "inboxes.forEach(deliver);",
    true,
  ],
  [
    "returned aggregate",
    `const deliver = () => Promise.all(deliverAll());`,
    "await deliver();",
    false,
  ],
  [
    "dropped returned aggregate",
    `const deliver = () => Promise.all(deliverAll());`,
    "deliver();",
    true,
  ],
  [
    "awaited aggregate",
    `const deliver = async () => { await Promise.all(deliverAll()); };`,
    "await deliver();",
    false,
  ],
  [
    "dropped awaited aggregate",
    `const deliver = async () => { await Promise.all(deliverAll()); };`,
    "deliver();",
    true,
  ],
  [
    "dead unknown return",
    `function deliver() { return deliverAll(); return unknown(); }`,
    "await deliver();",
    true,
  ],
  [
    "dead branch",
    `function deliver() { if (false) return unknown(); return deliverAll(); }`,
    "await deliver();",
    true,
  ],
  ["unused helper", "", "", false],
  ["dead call", "", "if (false) deliverAll();", false],
  [
    "named array callback",
    "",
    "await Promise.all(inboxes.map(deliverAll));",
    false,
  ],
  [
    "promise chain callback",
    "",
    "await Promise.resolve().then(deliverAll);",
    false,
  ],
] as const) {
  test(
    `${ruleName}: array helper ${scenario}`,
    lintTest({
      code: `
import { Activity } from "@fedify/vocab";
federation.setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const deliverAll = () => [${arrayHelperDelivery}];
    ${definition}
    ${consumer}
  });
`,
      rule,
      ruleName,
      ...(dropped ? { expectedError: "Delivery is not awaited" } : {}),
    }),
  );
}

for (const [returned, consumer, dropped] of [
  ["ctx.sendActivity(sender, inbox, activity)", "deliver();", true],
  ["ctx.sendActivity(sender, inbox, activity)", "await deliver();", false],
  ["[ctx.sendActivity(sender, inbox, activity)]", "await deliver();", true],
  [
    "[ctx.sendActivity(sender, inbox, activity)]",
    "await Promise.all(deliver());",
    false,
  ],
] as const) {
  test(
    `${ruleName}: helpers share switch case scope: ${returned} ${consumer}`,
    lintTest({
      code: `
import { Activity } from "@fedify/vocab";
federation.setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    switch (kind) {
      case 0:
        function deliver() { return ${returned}; }
      case 1:
        ${consumer}
    }
  });
`,
      rule,
      ruleName,
      ...(dropped ? { expectedError: "Delivery is not awaited" } : {}),
    }),
  );
}

for (const loop of [
  "for (let run of [finish])",
  "for (let [run] of [[finish]])",
  "for (let { run } of [{ run: finish }])",
  "for (let run in { key: true })",
]) {
  test(
    `${ruleName}: lexical loop inputs invalidate later helper shapes: ${loop}`,
    lintTest({
      code: `
import { Activity } from "@fedify/vocab";
federation.setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const finish = async () => { await ctx.sendActivity(sender, inbox, activity); };
    ${loop} {
      await run();
      run = () => [ctx.sendActivity(sender, inbox, activity)];
      await Promise.all(run());
    }
  });
`,
      rule,
      ruleName,
    }),
  );
}

for (const binding of [
  "let run = finish",
  "let { run } = { run: finish }",
  "let [run] = [finish]",
]) {
  test(
    `${ruleName}: initial lexical alias invalidates later helper inference: ${binding}`,
    lintTest({
      code: `
import { Activity } from "@fedify/vocab";
federation.setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const finish = async () => { await ctx.sendActivity(sender, inbox, activity); };
    ${binding};
    await run();
    run = () => [ctx.sendActivity(sender, inbox, activity)];
    await Promise.all(run());
  });
`,
      rule,
      ruleName,
    }),
  );
}

for (const declaration of [
  "var run = () => [ctx.sendActivity(sender, inbox, activity)];",
  "var run; run = () => [ctx.sendActivity(sender, inbox, activity)];",
  "var run; { run = () => [ctx.sendActivity(sender, inbox, activity)]; }",
]) {
  test(
    `${ruleName}: static block var helpers do not escape: ${declaration}`,
    lintTest({
      code: `
import { Activity } from "@fedify/vocab";
federation.setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const finish = async () => { await ctx.sendActivity(sender, inbox, activity); };
    const run = finish;
    const pending = [];
    const Holder = class {
      static {
        ${declaration}
        pending.push(...run());
      }
    };
    await Promise.all(pending);
    await run();
  });
`,
      rule,
      ruleName,
    }),
  );
}

for (const mutation of [
  "const holder = { get key() { run = finish; return 'key'; } }; const value = holder.key;",
  "const holder = { get key() { run = finish; return 'key'; } }; const { [holder.key]: value } = {};",
  "const holder = { get key() { run = finish; return 'key'; } }; const invoke = ({ [holder.key]: value }) => value; invoke({});",
  "const holder = { set current(value) { run = value; } }; ({ current: holder.current = finish } = {});",
  "const holder = { set current(value) { run = value; } }; [holder.current = finish] = [];",
  "const replace = () => { run = finish; }; function invoke(value = replace()) { const replace = () => {}; } invoke();",
  "const replace = () => { run = finish; }; function invoke(callback = replace) { const replace = () => {}; callback(); } invoke();",
  "const replace = () => { run = finish; }; function invoke({ [replace()]: value }) { const replace = () => {}; } invoke({});",
  "const holder = { set current(value) { run = value; } }; for (holder.current of [finish]) {}",
  "const holder = { set current(value) { run = finish; } }; for (holder.current in { key: true }) {}",
  "const holder = { set current(value) { run = value; } }; for ([holder.current] of [[finish]]) {}",
  "const replace = ({ [(() => { run = finish; return 'key'; })()]: value }) => value; replace({});",
  "const replace = ({ [(function () { run = finish; return 'key'; })()]: value }) => value; replace({});",
  "const { [(() => { run = finish; return 'key'; })()]: value } = {};",
  "try { throw {}; } catch ({ [(() => { run = finish; return 'key'; })()]: value }) {}",
  "const replace = () => { class Holder { static { var run; } } run = async () => { await ctx.sendActivity(sender, inbox, activity); }; }; replace();",
  "const invoke = (callback = () => { run = finish; }) => callback(); invoke();",
  "const invoke = (callback = function () { run = finish; }) => callback(); invoke();",
  "const { callback = () => { run = finish; } } = {}; callback();",
  "const [callback = () => { run = finish; }] = []; callback();",
  "try { throw {}; } catch ({ callback = () => { run = finish; } }) { callback(); }",
  "const holder = { set current(value) { run = value; } }; holder.current = finish;",
  "const holder = { set current(value) { run = value; } }; holder['current'] = finish;",
  "const replace = () => { run = finish; }; const invoke = (callback = replace) => callback(); invoke();",
  "const replace = () => { run = finish; }; const { callback = replace } = {}; callback();",
  "const replace = () => { run = finish; }; const [callback = replace] = []; callback();",
  "const replace = () => { run = finish; }; try { throw {}; } catch ({ callback = replace }) { callback(); }",
  "const replace = () => { run = finish; }; const { value = replace() } = {};",
  "const replace = () => { run = finish; }; const [value = replace()] = [];",
  "const replace = () => { run = finish; return 'value'; }; const { [replace()]: value } = {};",
  "const { value = (run = () => ctx.sendActivity(sender, inbox, activity)) } = {};",
  "try { throw {}; } catch ({ value = (run = finish) }) {}",
  "const replace = () => { run = finish; }; try { throw {}; } catch ({ value = replace() }) {}",
  "const replace = () => { run = finish; return 'value'; }; try { throw {}; } catch ({ [replace()]: value }) {}",
]) {
  test(
    `${ruleName}: executable binding patterns invalidate helper shapes: ${mutation}`,
    lintTest({
      code: `
import { Activity } from "@fedify/vocab";
federation.setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    let run = () => [ctx.sendActivity(sender, inbox, activity)];
    const finish = async () => { await ctx.sendActivity(sender, inbox, activity); };
    await Promise.all(run());
    ${mutation}
    await run();
  });
`,
      rule,
      ruleName,
    }),
  );
}

test(
  `${ruleName}: declaration self-write invalidates enclosing helper shape`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
federation.setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    function run() {
      run = () => ctx.sendActivity(sender, inbox, activity);
      return [ctx.sendActivity(sender, inbox, activity)];
    }
    await Promise.all(run());
    await run();
  });
`,
    rule,
    ruleName,
  }),
);

for (const replacement of [
  "([run!] = [finish]);",
  "({ run: run! } = { run: finish });",
]) {
  // Deno's AST omits these asserted destructuring targets. Exercise them
  // explicitly through ESLint, whose parser preserves the target nodes.
  test(`${ruleName}: ESLint wrapped destructuring write: ${replacement}`, () => {
    const code = `
import { Activity } from "@fedify/vocab";
federation.setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    let run = () => [ctx.sendActivity(sender, inbox, activity)];
    const finish = async () => { await ctx.sendActivity(sender, inbox, activity); };
    await Promise.all(run());
    ${replacement}
    await run();
  });`;
    const messages = new Linter().verify(
      `${FEDERATION_SETUP}\n\n${code}`,
      [
        {
          files: ["**/*.ts"],
          languageOptions: { parser: tsParser },
          plugins: { fedify: { rules: { [ruleName]: rule.eslint } } },
          rules: { [`fedify/${ruleName}`]: "error" },
        },
      ],
      "listener.ts",
    );
    deepStrictEqual(messages, []);
  });
}
for (const replace of [
  "run! = finish;",
  "(run as Runner) = finish;",
  "run! = () => ctx.sendActivity(sender, inbox, activity);",
  "const replace = () => { run = finish; }; const invoke = (value = replace()) => value; invoke();",
  "const replace = () => { run = () => ctx.sendActivity(sender, inbox, activity); }; const invoke = (value = replace()) => value; invoke();",
  "const replace = () => { run = finish; }; const middle = () => replace(); const invoke = (value = middle()) => value; invoke();",
  "const replace = () => { run = finish; }; const invoke = ({ value = replace() } = {}) => value; invoke();",
  "const replace = () => { run = finish; }; const middle = (value = replace()) => value; const invoke = (value = middle()) => value; invoke();",
]) {
  test(
    `${ruleName}: wrapped writes and default-invoked helpers invalidate arrays: ${replace}`,
    lintTest({
      code: `
import { Activity } from "@fedify/vocab";
federation.setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    let run = () => [ctx.sendActivity(sender, inbox, activity)];
    const finish = async () => { await ctx.sendActivity(sender, inbox, activity); };
    await Promise.all(run());
    ${replace}
    await run();
  });
`,
      rule,
      ruleName,
    }),
  );
}

for (const replace of [
  "const replace = () => { run = () => ctx.sendActivity(sender, inbox, activity); }; replace();",
  "const replace = () => { run = async () => { await ctx.sendActivity(sender, inbox, activity); }; }; replace();",
  "const replace = () => { const inner = () => { run = () => ctx.sendActivity(sender, inbox, activity); }; inner(); }; replace();",
  "const replace = (value = (run = finish)) => value; replace();",
  "const replace = ({ value = (run = finish) } = {}) => value; replace();",
  "const replace = (value = (run = () => ctx.sendActivity(sender, inbox, activity))) => value; replace();",
]) {
  test(
    `${ruleName}: used helper writes invalidate enclosing array inference: ${replace}`,
    lintTest({
      code: `
import { Activity } from "@fedify/vocab";
federation.setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    let run = () => [ctx.sendActivity(sender, inbox, activity)];
    const finish = async () => { await ctx.sendActivity(sender, inbox, activity); };
    await Promise.all(run());
    ${replace}
    await run();
  });
`,
      rule,
      ruleName,
    }),
  );
}

for (const declaration of ["let deliver;", "var deliver;"]) {
  test(
    `${ruleName}: local literal assignments in used helpers retain inference: ${declaration}`,
    lintTest({
      code: `
import { Activity } from "@fedify/vocab";
federation.setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const outer = () => {
      ${declaration}
      deliver = () => ctx.sendActivity(sender, inbox, activity);
      deliver();
    };
    outer();
  });
`,
      rule,
      ruleName,
      expectedError: "Delivery is not awaited",
    }),
  );
}

for (const definition of [
  "{ var deliver = () => ctx.sendActivity(sender, inbox, activity); CONSUMER }",
  "for (var deliver = () => ctx.sendActivity(sender, inbox, activity); condition;) { CONSUMER }",
  "{ var deliver = async () => { await ctx.sendActivity(sender, inbox, activity); }; CONSUMER }",
  "{ var deliver = () => [ctx.sendActivity(sender, inbox, activity)]; CONSUMER }",
]) {
  for (const shadowed of [false, true]) {
    const consumer = shadowed
      ? "{ const deliver = external; await deliver(); }"
      : "deliver();";
    test(
      `${ruleName}: function-scoped var helper retains inference (${shadowed}): ${definition}`,
      lintTest({
        code: `
import { Activity } from "@fedify/vocab";
federation.setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    ${definition.replace("CONSUMER", consumer)}
  });
`,
        rule,
        ruleName,
        ...(shadowed ? {} : { expectedError: "Delivery is not awaited" }),
      }),
    );
  }
}

test(
  `${ruleName}: nested function var still shadows an outer helper`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
federation.setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    var deliver = () => [ctx.sendActivity(sender, inbox, activity)];
    await Promise.all(deliver());
    async function inner() {
      var deliver = external;
      await deliver();
    }
    await inner();
  });
`,
    rule,
    ruleName,
  }),
);

for (const replacement of [
  "var run = finish;",
  "{ var run = finish; }",
  "for (var run of [finish]) {}",
  "for (var { run } of [{ run: finish }]) {}",
  "for (var run in {}) {}",
]) {
  test(
    `${ruleName}: initialized var replacement invalidates array inference: ${replacement}`,
    lintTest({
      code: `
import { Activity } from "@fedify/vocab";
federation.setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const finish = async () => { await ctx.sendActivity(sender, inbox, activity); };
    var run = () => [ctx.sendActivity(sender, inbox, activity)];
    await Promise.all(run());
    ${replacement}
    await run();
  });
`,
      rule,
      ruleName,
    }),
  );
}

for (const local of [
  "{ let run; run = () => [ctx.sendActivity(sender, inbox, activity)]; await Promise.all(run()); }",
  "{ let run; { run = () => [ctx.sendActivity(sender, inbox, activity)]; } await Promise.all(run()); }",
  "for (let run of [null]) { run = () => [ctx.sendActivity(sender, inbox, activity)]; await Promise.all(run()); }",
]) {
  test(
    `${ruleName}: assignment helper does not escape its binding region: ${local}`,
    lintTest({
      code: `
import { Activity } from "@fedify/vocab";
federation.setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const finish = async () => { await ctx.sendActivity(sender, inbox, activity); };
    const run = finish;
    ${local}
    await run();
  });
`,
      rule,
      ruleName,
    }),
  );
}

for (const declaration of [
  "const deliverAll = () => [ctx.sendActivity(sender, inbox, activity)];",
  "function deliverAll() { return [ctx.sendActivity(sender, inbox, activity)]; }",
]) {
  for (const outside of [
    "await deliverAll(ctx, activity);",
    "inboxes.forEach(deliverAll);",
    "const outer = () => deliverAll(ctx, activity); await outer();",
  ]) {
    test(
      `${ruleName}: block-local array does not classify ${outside} (${declaration})`,
      lintTest({
        code: `
import { Activity } from "@fedify/vocab";
async function deliverAll(ctx, activity) { await ctx.sendActivity(sender, inbox, activity); }
federation.setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    { ${declaration} await Promise.all(deliverAll()); }
    ${outside}
  });
`,
        rule,
        ruleName,
      }),
    );
  }
}

test(
  `${ruleName}: block-local array helper still reports its own dropped call`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";
federation.setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    { const deliverAll = () => [ctx.sendActivity(sender, inbox, activity)];
      await deliverAll(); }
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

for (const consumer of [
  "{ const deliverAll = finish; await deliverAll(); }",
  "{ let deliverAll = finish; await deliverAll(); }",
  "{ const { run: deliverAll } = { run: finish }; await deliverAll(); }",
  "{ const [deliverAll] = [finish]; await deliverAll(); }",
  "for (const deliverAll of [finish]) { await deliverAll(); }",
  "for (let deliverAll = finish; condition;) { await deliverAll(); }",
  "try { throw finish; } catch (deliverAll) { await deliverAll(); }",
  "switch (condition) { case true: { const deliverAll = finish; await deliverAll(); } }",
  "{ const deliverAll = finish; inboxes.forEach(deliverAll); }",
]) {
  test(
    `${ruleName}: shadow binding does not use outer array helper: ${consumer}`,
    lintTest({
      code: `
import { Activity } from "@fedify/vocab";
federation.setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const deliverAll = () => [ctx.sendActivity(sender, inbox, activity)];
    const finish = async () => { await ctx.sendActivity(sender, inbox, activity); };
    await Promise.all(deliverAll());
    ${consumer}
  });
`,
      rule,
      ruleName,
    }),
  );
}

for (const declaration of [
  "const { run } = { run: finish, other: () => [ctx.sendActivity(sender, inbox, activity)] };",
  "const [run] = [finish, () => [ctx.sendActivity(sender, inbox, activity)]];",
  "const { run = finish } = { other: () => [ctx.sendActivity(sender, inbox, activity)] };",
]) {
  test(
    `${ruleName}: aggregate binding does not select an unrelated helper: ${declaration}`,
    lintTest({
      code: `
import { Activity } from "@fedify/vocab";
federation.setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const finish = async () => { await ctx.sendActivity(sender, inbox, activity); };
    ${declaration}
    await run();
  });
`,
      rule,
      ruleName,
    }),
  );
}

for (const declaration of [
  "var deliverAll = () => [ctx.sendActivity(sender, inbox, activity)];",
  "let deliverAll; deliverAll = () => [ctx.sendActivity(sender, inbox, activity)];",
]) {
  for (const shadowed of [true, false]) {
    test(
      `${ruleName}: var or assignment helper respects shadowing (${shadowed}): ${declaration}`,
      lintTest({
        code: `
import { Activity } from "@fedify/vocab";
federation.setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    ${declaration}
    await Promise.all(deliverAll());
    {
      ${shadowed ? "const deliverAll = external;" : ""}
      await deliverAll();
    }
  });
`,
        rule,
        ruleName,
        ...(shadowed ? {} : { expectedError: "Delivery is not awaited" }),
      }),
    );
  }
}

for (const replacement of [
  "deliverAll = finish;",
  "deliverAll = chooseHelper();",
  "({ run: deliverAll } = { run: finish });",
  "[deliverAll] = [finish];",
  "const replace = () => { deliverAll = finish; }; replace();",
  "for (deliverAll of [finish]) {}",
  "for ({ run: deliverAll } of [{ run: finish }]) {}",
  "for ([deliverAll] of [[finish]]) {}",
  "for (deliverAll in {}) {} deliverAll = finish;",
  "for (deliverAll in {}) {}",
]) {
  test(
    `${ruleName}: unclassified reassignment invalidates array inference: ${replacement}`,
    lintTest({
      code: `
import { Activity } from "@fedify/vocab";
federation.setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    let deliverAll = () => [ctx.sendActivity(sender, inbox, activity)];
    const finish = async () => { await ctx.sendActivity(sender, inbox, activity); };
    await Promise.all(deliverAll());
    ${replacement}
    await deliverAll();
  });
`,
      rule,
      ruleName,
    }),
  );
}

for (const invocation of [
  "(async () => { await ctx.sendActivity(sender, inbox, activity); })()",
  "(async function () { await ctx.sendActivity(sender, inbox, activity); })()",
  "((async () => { await ctx.sendActivity(sender, inbox, activity); }) as () => Promise<void>)()",
]) {
  test(`${ruleName}: dropped async IIFE reports once: ${invocation}`, () => {
    const code = `import { Activity } from "@fedify/vocab";
federation.setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    ${invocation};
  });`;
    const messages = new Linter().verify(
      `${FEDERATION_SETUP}\n\n${code}`,
      [
        {
          files: ["**/*.ts"],
          languageOptions: { parser: tsParser },
          plugins: { fedify: { rules: { [ruleName]: rule.eslint } } },
          rules: { [`fedify/${ruleName}`]: "error" },
        },
      ],
      "listener.ts",
    );
    deepStrictEqual(
      messages.map(({ ruleId, line }) => [ruleId, line]),
      [[`fedify/${ruleName}`, 4 + FEDERATION_SETUP.split("\n").length + 1]],
    );
  });
}

test(`${ruleName}: array helper diagnostics identify only discarded call sites`, () => {
  const code = `import { Activity } from "@fedify/vocab";
federation.setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const deliverAll = () => [ctx.sendActivity(sender, inbox, activity)];
    await Promise.all(deliverAll());
    deliverAll();
    await deliverAll();
    Promise.all(deliverAll());
    return deliverAll();
  });`;
  const messages = new Linter().verify(
    `${FEDERATION_SETUP}\n\n${code}`,
    [
      {
        files: ["**/*.ts"],
        languageOptions: { parser: tsParser },
        plugins: { fedify: { rules: { [ruleName]: rule.eslint } } },
        rules: { [`fedify/${ruleName}`]: "error" },
      },
    ],
    "listener.ts",
  );
  deepStrictEqual(
    messages.map(({ ruleId, line, column }) => [ruleId, line, column]),
    [6, 7, 8, 9].map((line) => [
      `fedify/${ruleName}`,
      line + FEDERATION_SETUP.split("\n").length + 1,
      line === 7 ? 11 : line === 8 ? 17 : line === 9 ? 12 : 5,
    ]),
  );
});

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
  `${ruleName}: ❌ Bad - delivery promise used as the test of a conditional expression`,
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
    expectedError: "Delivery is not awaited",
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

test(
  `${ruleName}: ❌ Bad - awaiting an object literal that holds a delivery promise`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    await { pending: ctx.sendActivity(sender, inbox, activity) };
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - returning an object literal that holds a delivery promise from the listener`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    return { pending: ctx.sendActivity(sender, inbox, activity) };
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - awaiting an object literal that holds a delivery promise deeper down`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    await { outer: { pending: ctx.sendActivity(sender, inbox, activity) } };
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - awaiting an object literal that holds an array of delivery promises`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    await { all: inboxes.map((target) => ctx.sendActivity(sender, target, activity)) };
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - delivery promise used as the test of an if statement`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    if (ctx.sendActivity(sender, inbox, activity)) {
      console.log("sent");
    }
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - delivery promise used as the test of a while loop`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    while (ctx.sendActivity(sender, inbox, activity)) {
      break;
    }
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - delivery promise used as the test of a do-while loop`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    do {
      console.log("once");
    } while (ctx.sendActivity(sender, inbox, activity));
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - delivery promise used as the test of a for loop`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    for (; ctx.sendActivity(sender, inbox, activity);) {
      break;
    }
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - delivery promise as an operand in the test of an if statement`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    if (activity != null && ctx.sendActivity(sender, inbox, activity)) {
      console.log("sent");
    }
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - helper that delivers, called as the test of an if statement`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    const deliver = () => ctx.sendActivity(sender, inbox, activity);
    if (deliver()) {
      console.log("sent");
    }
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ✅ Good - awaited delivery used as the test of an if statement`,
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
  `${ruleName}: ✅ Good - awaited delivery in a branch of a conditional expression`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    await (activity.id != null ? ctx.sendActivity(sender, inbox, activity) : null);
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - helper returning an object that holds a delivery promise`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    const deliver = () => ({ pending: ctx.sendActivity(sender, inbox, activity) });
    const { pending } = deliver();
    await pending;
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - object holding a delivery promise handed to an unknown function`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    queue.push({ pending: ctx.sendActivity(sender, inbox, activity) });
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - delivery promise taken out of an object literal and awaited`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    const sender = { identifier: ctx.identifier };
    const inbox = new URL("https://example.com/inbox");
    const { pending } = { pending: ctx.sendActivity(sender, inbox, activity) };
    await pending;
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - statically false while loop avoids unawaited delivery`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    while (false) {
      ctx.sendActivity(
        { identifier: ctx.identifier },
        new URL("https://example.com/inbox"),
        activity,
      );
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
  }),
);

test(
  `${ruleName}: ✅ Good - statically false for loop avoids unawaited delivery`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    for (; false;) {
      ctx.sendActivity(
        { identifier: ctx.identifier },
        new URL("https://example.com/inbox"),
        activity,
      );
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
  }),
);

test(
  `${ruleName}: ❌ Bad - unawaited delivery in do while loop`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    do {
      ctx.sendActivity(
        { identifier: ctx.identifier },
        new URL("https://example.com/inbox"),
        activity,
      );
    } while (false);
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - unawaited delivery in loop binding pattern`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    for (const { id = ctx.sendActivity(
      { identifier: ctx.identifier },
      new URL("https://example.com/inbox"),
      activity,
    ) } of [{}]) {}
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - unawaited delivery in loop binding computed key`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    for (const { [ctx.sendActivity(
      { identifier: ctx.identifier },
      new URL("https://example.com/inbox"),
      activity,
    ) as unknown as string]: id } of [{}]) {}
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - unawaited delivery in loop binding computed member key`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    let target: Record<string, unknown> = {};
    for ({ id: target[ctx.sendActivity(
      { identifier: ctx.identifier },
      new URL("https://example.com/inbox"),
      activity,
    ) as unknown as string] } of [{}]) {}
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - unawaited delivery in for-in loop binding computed member key`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    let target: Record<string, unknown> = {};
    for (target[ctx.sendActivity(
      { identifier: ctx.identifier },
      new URL("https://example.com/inbox"),
      activity,
    ) as unknown as string] in { a: 1 }) {}
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - delivery promise as the left operand of &&`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    await (ctx.sendActivity(
      { identifier: ctx.identifier },
      new URL("https://example.com/inbox"),
      activity,
    ) && Promise.resolve());
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - unused id in assignment-form destructuring`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    let id;
    for ({ id = ctx.sendActivity(
      { identifier: ctx.identifier },
      new URL("https://example.com/inbox"),
      activity,
    ) } of [{}]) {}
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ✅ Good - id awaited in the loop body`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    let id;
    for ({ id = ctx.sendActivity(
      { identifier: ctx.identifier },
      new URL("https://example.com/inbox"),
      activity,
    ) } of [{}]) {
      await id;
    }
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - unused default function in assignment-form destructuring`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    for (const { deliver = () => { ctx.sendActivity(ctx.identifier, new URL("https://example.com"), activity); } } of [{}]) {}
  });
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ❌ Bad - used default function in assignment-form destructuring`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    for (const { deliver = () => { ctx.sendActivity(ctx.identifier, new URL("https://example.com"), activity); } } of [{}]) {
      deliver();
    }
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

test(
  `${ruleName}: ❌ Bad - immediately invoked function in default expression`,
  lintTest({
    code: `
import { Activity } from "@fedify/vocab";

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Activity, async (ctx, activity) => {
    for (const { deliver = (() => { ctx.sendActivity(ctx.identifier, new URL("https://example.com"), activity); })() } of [{}]) {}
  });
`,
    rule,
    ruleName,
    expectedError: "Delivery is not awaited",
  }),
);

for (const [kind, pattern, member, readsTarget] of [
  ["object", "{ deliver: target.deliver = DEFAULT }", "target.deliver", false],
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
] as const) {
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
    for (${pattern.replace(
      "DEFAULT",
      `() => {
      ctx.sendActivity(
        { identifier: ctx.identifier },
        new URL("https://example.com/inbox"),
        activity,
      );
    }`,
    )} of [${kind === "array" ? "[]" : "{}"}]) {
      ${used ? `${member}();` : ""}
    }
  });
`,
        rule,
        ruleName,
        expectedError:
          used || readsTarget ? "Delivery is not awaited" : undefined,
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
      expectedError: shadowed ? undefined : "Delivery is not awaited",
    }),
  );
}

for (const [kind, pattern, existingValues] of [
  ["object", "{ deliver = DEFAULT }", "[{ deliver }]"],
  ["array", "[deliver = DEFAULT]", "[[deliver]]"],
  [
    "nested object",
    "{ handler: { deliver } = { deliver: DEFAULT } }",
    "[{ handler: { deliver } }]",
  ],
  ["nested array", "[[deliver] = [DEFAULT]]", "[[[deliver]]]"],
] as const) {
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
      for (${pattern.replace(
        "DEFAULT",
        "async () => {}",
      )} of ${existingValues}) {}
      await deliver();
    };
    await run();
  });
`,
        rule,
        ruleName,
        expectedError: dropped ? "Delivery is not awaited" : undefined,
      }),
    );
  }
}

for (const [kind, pattern, missingValues] of [
  ["object", "{ deliver = DEFAULT }", "[{}]"],
  ["array", "[deliver = DEFAULT]", "[[]]"],
] as const) {
  for (const [declaration, prefix, setup, parameter] of [
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
  ] as const) {
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
      for (${prefix}${pattern.replace(
        "DEFAULT",
        "async () => {}",
      )} of ${missingValues}) {
        await deliver();
      }
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
      for (${pattern.replace(
        "DEFAULT",
        `async () => {
        ctx.sendActivity({ identifier: ctx.identifier }, "followers", activity);
      }`,
      )} of ${missingValues}) {}
      ${used ? "await deliver();" : ""}
    };
    await run();
  });
`,
        rule,
        ruleName,
        expectedError: used ? "Delivery is not awaited" : undefined,
      }),
    );
  }
}

for (const [kind, block] of [
  [
    "nested block",
    'if (dryRun) { const deliver = "skipped"; console.log(deliver); }',
  ],
  ["for initializer", "for (let deliver = 0; deliver < 1; deliver++) {}"],
] as const) {
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
        expectedError: dropped ? "Delivery is not awaited" : undefined,
      }),
    );
  }
}

for (const [kind, declaration] of [
  ["block let", "{ let deliver; }"],
  ["block const", "{ const deliver = 0; }"],
  ["for initializer", "for (let deliver = 0; deliver < 1; deliver++) {}"],
  ["for binding", "for (const deliver of [0]) {}"],
  ["class static block", "const C = class { static { var deliver; } };"],
  [
    "class static block assignment default",
    "const C = class { static { for ({ deliver = async () => {} } of [{ deliver }]); } };",
  ],
] as const) {
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
        expectedError: dropped ? "Delivery is not awaited" : undefined,
      }),
    );
  }
}

const expectNotAwaited = (reaches: boolean, dropped: boolean) =>
  reaches && dropped ? "Delivery is not awaited" : undefined;

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

for (const [kind, write] of [
  ["property", "target.fallback = () => {};"],
  ["computed literal", 'target["fallback"] = () => {};'],
  ["computed key", "target[key] = () => {};"],
  ["nested property", "target.handlers.fallback = () => {};"],
] as const) {
  for (const [scenario, read, call] of [
    ["called", "await target.deliver();", "await run();"],
    ["uncalled", "await target.deliver();", ""],
    ["write-only", "", "await run();"],
  ] as const) {
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
          expectedError: expectNotAwaited(scenario === "called", dropped),
        }),
      );
    }
  }
}

for (const [kind, reaches, helper] of [
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
] as const) {
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
        expectedError: expectNotAwaited(reaches, dropped),
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
        ctx.sendActivity(
          { identifier: ctx.identifier }, "followers", activity,
        );
      };
    };
    await run();
  });
`,
    rule,
    ruleName,
    expectedError: undefined,
  }),
);
