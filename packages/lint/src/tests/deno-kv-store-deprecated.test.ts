import { test } from "node:test";
import { RULE_IDS } from "../lib/const.ts";
import lintTest from "../lib/test.ts";
import * as rule from "../rules/deno-kv-store-deprecated.ts";

const ruleName = RULE_IDS.denoKvStoreDeprecated;
const config = { rule, ruleName };
const expectedError = "`DenoKvStore` from `@fedify/denokv` is deprecated";

test(
  `${ruleName}: ❌ Bad - named import`,
  lintTest({
    ...config,
    code: `
import { DenoKvStore } from "@fedify/denokv";

console.log(DenoKvStore);
`,
    expectedError,
  }),
);

test(
  `${ruleName}: ❌ Bad - aliased import`,
  lintTest({
    ...config,
    code: `
import { DenoKvStore as Store } from "@fedify/denokv";

console.log(Store);
`,
    expectedError,
  }),
);

test(
  `${ruleName}: ❌ Bad - type-only import`,
  lintTest({
    ...config,
    code: `
import type { DenoKvStore } from "@fedify/denokv";

console.log(null as unknown as DenoKvStore);
`,
    expectedError,
  }),
);

test(
  `${ruleName}: ❌ Bad - inline type import`,
  lintTest({
    ...config,
    code: `
import { type DenoKvStore } from "@fedify/denokv";

console.log(null as unknown as DenoKvStore);
`,
    expectedError,
  }),
);

test(
  `${ruleName}: ❌ Bad - versioned JSR specifier`,
  lintTest({
    ...config,
    code: `
import { DenoKvStore } from "jsr:@fedify/denokv@^2.5.0";

console.log(DenoKvStore);
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
export { DenoKvStore } from "@fedify/denokv";
`,
    expectedError,
  }),
);

test(
  `${ruleName}: ✅ Good - other export from the same package`,
  lintTest({
    ...config,
    code: `
import { DenoKvMessageQueue } from "@fedify/denokv";

console.log(DenoKvMessageQueue);
`,
  }),
);

test(
  `${ruleName}: ✅ Good - same-named local class`,
  lintTest({
    ...config,
    code: `
class DenoKvStore {}

console.log(new DenoKvStore());
`,
  }),
);

test(
  `${ruleName}: ✅ Good - same-named export from another package`,
  lintTest({
    ...config,
    code: `
import { DenoKvStore } from "./local.ts";

console.log(DenoKvStore);
`,
  }),
);

test(
  `${ruleName}: ✅ Good - local object with the same name as a namespace`,
  lintTest({
    ...config,
    code: `
const denokv = { DenoKvStore: "value" };

console.log(denokv.DenoKvStore);
`,
  }),
);
