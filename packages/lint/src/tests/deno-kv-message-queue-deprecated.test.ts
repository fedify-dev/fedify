import { test } from "node:test";
import { RULE_IDS } from "../lib/const.ts";
import lintTest from "../lib/test.ts";
import * as rule from "../rules/deno-kv-message-queue-deprecated.ts";

const ruleName = RULE_IDS.denoKvMessageQueueDeprecated;
const config = { rule, ruleName };
const expectedError =
  "`DenoKvMessageQueue` from `@fedify/denokv` is deprecated";

test(
  `${ruleName}: ❌ Bad - named import`,
  lintTest({
    ...config,
    code: `
import { DenoKvMessageQueue } from "@fedify/denokv";

console.log(DenoKvMessageQueue);
`,
    expectedError,
  }),
);

test(
  `${ruleName}: ❌ Bad - aliased import`,
  lintTest({
    ...config,
    code: `
import { DenoKvMessageQueue as Queue } from "@fedify/denokv";

console.log(Queue);
`,
    expectedError,
  }),
);

test(
  `${ruleName}: ❌ Bad - type-only import`,
  lintTest({
    ...config,
    code: `
import type { DenoKvMessageQueue } from "@fedify/denokv";

console.log(null as unknown as DenoKvMessageQueue);
`,
    expectedError,
  }),
);

test(
  `${ruleName}: ❌ Bad - versioned JSR specifier`,
  lintTest({
    ...config,
    code: `
import { DenoKvMessageQueue } from "jsr:@fedify/denokv@^2.5.0";

console.log(DenoKvMessageQueue);
`,
    expectedError,
  }),
);

test(
  `${ruleName}: ❌ Bad - namespace import`,
  lintTest({
    ...config,
    code: `
import * as denokv from "@fedify/denokv";

console.log(denokv);
`,
    expectedError,
  }),
);

test(
  `${ruleName}: ❌ Bad - re-export`,
  lintTest({
    ...config,
    code: `
export { DenoKvMessageQueue } from "@fedify/denokv";
`,
    expectedError,
  }),
);

test(
  `${ruleName}: ❌ Bad - both classes in one file`,
  lintTest({
    ...config,
    code: `
import { DenoKvMessageQueue, DenoKvStore } from "@fedify/denokv";

console.log(DenoKvMessageQueue, DenoKvStore);
`,
    expectedError,
  }),
);

test(
  `${ruleName}: ✅ Good - only the store from the same package`,
  lintTest({
    ...config,
    code: `
import { DenoKvStore } from "@fedify/denokv";

console.log(DenoKvStore);
`,
  }),
);

test(
  `${ruleName}: ✅ Good - same-named local class`,
  lintTest({
    ...config,
    code: `
class DenoKvMessageQueue {}

console.log(new DenoKvMessageQueue());
`,
  }),
);

test(
  `${ruleName}: ✅ Good - same-named export from another package`,
  lintTest({
    ...config,
    code: `
import { DenoKvMessageQueue } from "./local.ts";

console.log(DenoKvMessageQueue);
`,
  }),
);

test(
  `${ruleName}: ✅ Good - local object with the same name as a namespace`,
  lintTest({
    ...config,
    code: `
const denokv = { DenoKvMessageQueue: "value" };

console.log(denokv.DenoKvMessageQueue);
`,
  }),
);
