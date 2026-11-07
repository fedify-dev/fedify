import { deepStrictEqual, ok } from "node:assert/strict";
import { test } from "node:test";
import { plugin as eslintPlugin } from "../index.ts";
import { properties, RULE_IDS } from "../lib/const.ts";
import { actorPropertyRequired } from "../lib/messages.ts";
import {
  createDirectActorPropertyRequiredRuleTests,
  createRequiredEdgeCaseTests,
  runTests,
} from "../lib/test-templates.ts";
import lintTest from "../lib/test.ts";
import denoPlugin from "../mod.ts";
import oxlintPlugin from "../oxlint.ts";
import * as rule from "../rules/actor-profile-url-required.ts";

const ruleName = RULE_IDS.actorProfileUrlRequired;
const config = { rule, ruleName };
const expectedError = actorPropertyRequired(properties.url);

const PROFILE_URL = "new URL(`/@${identifier}`, ctx.origin)";

const conciseBody = (expression: string) => `
federation.setActorDispatcher(
  "/users/{identifier}",
  (ctx, identifier) => ${expression},
);
`;

const blockBody = (body: string) => `
federation.setActorDispatcher(
  "/users/{identifier}",
  (ctx, identifier) => {
    ${body}
  },
);
`;

runTests(ruleName, {
  ...createDirectActorPropertyRequiredRuleTests(
    "url",
    {
      singular: PROFILE_URL,
      plural: `[${PROFILE_URL}]`,
    },
    config,
  ),
  ...createRequiredEdgeCaseTests("url", config),

  // ✅ Good - a bare return means no actor was found
  "bare return": [
    lintTest({
      code: blockBody(`return;`),
      rule,
      ruleName,
    }),
    true,
  ],

  // ✅ Good - an explicit undefined return means no actor was found
  "return undefined": [
    lintTest({
      code: blockBody(`return undefined;`),
      rule,
      ruleName,
    }),
    true,
  ],

  // ✅ Good - a void return means no actor was found
  "return void": [
    lintTest({
      code: blockBody(`return void 0;`),
      rule,
      ruleName,
    }),
    true,
  ],

  // ✅ Good - a ternary with an undefined branch and an actor with a URL
  "ternary with undefined and actor with url": [
    lintTest({
      code: blockBody(
        `return condition
      ? undefined
      : new Person({ url: ${PROFILE_URL}, name: "John Doe" });`,
      ),
      rule,
      ruleName,
    }),
    true,
  ],

  // ✅ Good - concise-body dispatcher returning undefined
  "concise-body dispatcher returning undefined": [
    lintTest({
      code: conciseBody(`undefined`),
      rule,
      ruleName,
    }),
    true,
  ],

  // ✅ Good - quoted property keys are still recognized
  "quoted url property": [
    lintTest({
      code: conciseBody(
        `new Person({ "url": ${PROFILE_URL}, name: "John Doe" })`,
      ),
      rule,
      ruleName,
    }),
    true,
  ],

  // ✅ Good - quoted plural key is still recognized
  "quoted plural urls property": [
    lintTest({
      code: conciseBody(
        `new Person({ "urls": [${PROFILE_URL}], name: "John Doe" })`,
      ),
      rule,
      ruleName,
    }),
    true,
  ],

  // ✅ Good - a computed string-literal key is statically known
  "computed quoted url property": [
    lintTest({
      code: conciseBody(
        `new Person({ ["url"]: ${PROFILE_URL}, name: "John Doe" })`,
      ),
      rule,
      ruleName,
    }),
    true,
  ],

  // ✅ Good - a computed string-literal plural key is statically known
  "computed quoted plural urls property": [
    lintTest({
      code: conciseBody(
        `new Person({ ["urls"]: [${PROFILE_URL}], name: "John Doe" })`,
      ),
      rule,
      ruleName,
    }),
    true,
  ],

  // ❌ Bad - a computed identifier key stays dynamic
  "computed identifier key is not resolved": [
    lintTest({
      code: blockBody(
        `const key = "url";
    return new Person({ [key]: ${PROFILE_URL}, name: "John Doe" });`,
      ),
      rule,
      ruleName,
      expectedError,
    }),
    false,
  ],

  // ❌ Bad - an explicitly undefined URL is not a profile URL
  "undefined url": [
    lintTest({
      code: conciseBody(`new Person({ url: undefined, name: "John Doe" })`),
      rule,
      ruleName,
      expectedError,
    }),
    false,
  ],

  // ❌ Bad - an explicitly undefined plural URL is not a profile URL
  "undefined urls": [
    lintTest({
      code: conciseBody(`new Person({ urls: undefined, name: "John Doe" })`),
      rule,
      ruleName,
      expectedError,
    }),
    false,
  ],

  // ❌ Bad - a void expression has no profile URL
  "void url": [
    lintTest({
      code: conciseBody(`new Person({ url: void 0, name: "John Doe" })`),
      rule,
      ruleName,
      expectedError,
    }),
    false,
  ],

  // ❌ Bad - a void plural expression has no profile URL
  "void urls": [
    lintTest({
      code: conciseBody(`new Person({ urls: void 0, name: "John Doe" })`),
      rule,
      ruleName,
      expectedError,
    }),
    false,
  ],

  // ❌ Bad - TypeScript assertions do not hide undefined
  "undefined url with TypeScript assertion": [
    lintTest({
      code: conciseBody(
        `new Person({ url: undefined as URL | undefined, name: "John Doe" })`,
      ),
      rule,
      ruleName,
      expectedError,
    }),
    false,
  ],

  // ❌ Bad - a null URL is not a profile URL
  "null url": [
    lintTest({
      code: conciseBody(`new Person({ url: null, name: "John Doe" })`),
      rule,
      ruleName,
      expectedError,
    }),
    false,
  ],

  // ❌ Bad - TypeScript assertions do not hide a null URL
  "null url with TypeScript assertion": [
    lintTest({
      code: conciseBody(
        `new Person({ url: null as URL | null, name: "John Doe" })`,
      ),
      rule,
      ruleName,
      expectedError,
    }),
    false,
  ],

  // ❌ Bad - an empty urls array has no profile URL
  "empty urls array": [
    lintTest({
      code: conciseBody(`new Person({ urls: [], name: "John Doe" })`),
      rule,
      ruleName,
      expectedError,
    }),
    false,
  ],

  // ❌ Bad - TypeScript assertions do not hide an empty urls array
  "empty urls array with TypeScript assertion": [
    lintTest({
      code: conciseBody(`new Person({ urls: [] as URL[], name: "John Doe" })`),
      rule,
      ruleName,
      expectedError,
    }),
    false,
  ],

  // ✅ Good - a shorthand url property still counts
  "shorthand url property": [
    lintTest({
      code: blockBody(
        `const url = ${PROFILE_URL};
    return new Person({ url, name: "John Doe" });`,
      ),
      rule,
      ruleName,
    }),
    true,
  ],

  // ✅ Good - concise-body dispatcher returning an actor with a singular URL
  "concise-body dispatcher with url": [
    lintTest({
      code: conciseBody(
        `new Person({ url: ${PROFILE_URL}, name: "John Doe" })`,
      ),
      rule,
      ruleName,
    }),
    true,
  ],

  // ✅ Good - concise-body dispatcher returning an actor with plural URLs
  "concise-body dispatcher with urls": [
    lintTest({
      code: conciseBody(
        `new Person({ urls: [${PROFILE_URL}], name: "John Doe" })`,
      ),
      rule,
      ruleName,
    }),
    true,
  ],

  // ❌ Bad - concise-body dispatcher returning an actor without a URL
  "concise-body dispatcher without url": [
    lintTest({
      code: conciseBody(`new Person({ name: "John Doe" })`),
      rule,
      ruleName,
      expectedError,
    }),
    false,
  ],

  // ❌ Bad - an instance-actor branch still needs its own URL
  "mixed Application and Person branches without url on the instance actor": [
    lintTest({
      code: `
federation.setActorDispatcher(
  "/users/{identifier}",
  (ctx, identifier) => identifier === "instance"
    ? new Application({
        id: ctx.getActorUri(identifier),
        preferredUsername: identifier,
        name: "Instance actor",
      })
    : new Person({
        id: ctx.getActorUri(identifier),
        preferredUsername: identifier,
        url: ${PROFILE_URL},
        name: "John Doe",
      }),
);
`,
      rule,
      ruleName,
      expectedError,
    }),
    false,
  ],
});

test("actor-profile-url-required: diagnostic text", () => {
  deepStrictEqual(
    actorPropertyRequired(properties.url),
    "When `setActorDispatcher` is configured, the `url` property is " +
      "recommended because remote fediverse software uses it as the link to " +
      "the actor's profile page. Set `url` (or the plural `urls` " +
      "initializer) to the actor's human-readable profile URL.",
  );
});

test("actor-profile-url-required: preferredUsername diagnostic is unchanged", () => {
  deepStrictEqual(
    actorPropertyRequired(properties.preferredUsername),
    "When `setActorDispatcher` is configured, the `preferredUsername` " +
      "property is recommended. Set the `preferredUsername` property " +
      "directly on the actor object.",
  );
});

test("actor-profile-url-required: preset severities", () => {
  deepStrictEqual(
    eslintPlugin.configs.recommended.rules[`@fedify/lint/${ruleName}`],
    "warn",
  );
  deepStrictEqual(
    eslintPlugin.configs.strict.rules[`@fedify/lint/${ruleName}`],
    "error",
  );
});

test("actor-profile-url-required: registered in every plugin", () => {
  ok(
    eslintPlugin.rules?.[ruleName] != null,
    "ESLint plugin should register the rule",
  );
  ok(
    denoPlugin.rules[ruleName] != null,
    "Deno plugin should register the rule",
  );
  ok(
    oxlintPlugin.rules[ruleName] != null,
    "Oxlint plugin should register the rule",
  );
});
