import { test } from "node:test";
import { properties } from "../lib/const.ts";
import { actorPropertyRequired } from "../lib/messages.ts";
import { testDenoLint } from "../lib/test.ts";
import {
  ACTOR_ID_REQUIRED as ruleName,
  default as rule,
} from "../rules/actor-id-required.ts";

const expectedError = actorPropertyRequired(properties.id.name);

const actorProperties = [
  "id",
  "following",
  "followers",
  "outbox",
  "inbox",
  "liked",
  "featured",
  "featuredTags",
] as const satisfies (keyof typeof properties)[];

const createActorDispatcherCode = (
  name: keyof typeof properties,
  {
    returnCode,
    preReturnCode = "",
  }: {
    returnCode: string;
    preReturnCode?: string;
  },
): string => `
  federation.${properties.id.setter}("/users/{identifier}", async (ctx, identifier) => {
    ${preReturnCode}
    return ${returnCode};
  });
`;

const withId = (extra = "") =>
  `new Person({ id: ctx.getActorUri(identifier), name: "User"${extra} })`;
const withoutId = () => `new Person({ name: "User" })`;

const createTestCode = (
  returnCode: string,
  preReturnCode = "",
  error?: string,
) =>
() =>
  actorProperties.forEach((name) =>
    testDenoLint({
      code: createActorDispatcherCode(name, { returnCode, preReturnCode }),
      rule,
      ruleName,
      expectedError: error,
    })
  );

test(
  `${ruleName}: ✅ Good - multiple return statements - all have id`,
  createTestCode(
    `
    identifier === "admin"
      ? ${withId()}
      : ${withId()}
  `.trim().replace(/\n\s*/g, " "),
    `
    if (identifier === "admin") {
      return ${withId()};
    }
  `,
  ),
);

test(
  `${ruleName}: ✅ Good - multiple return statements - first missing id (known limitation)`,
  createTestCode(
    withId(),
    `
    if (identifier === "admin") {
      return ${withoutId()};
    }
  `,
  ),
);

test(
  `${ruleName}: ❌ Bad - multiple return statements - second missing id`,
  createTestCode(
    withoutId(),
    `
    if (identifier === "admin") {
      return ${withId()};
    }
  `,
    expectedError,
  ),
);

test(
  `${ruleName}: ✅ Good - if/else with else block (known limitation: else not checked)`,
  createTestCode(
    withId(),
    `
    if (identifier) {
      return ${withId()};
    } else {
      return ${withoutId()};
    }
  `,
  ),
);

test(
  `${ruleName}: ✅ Good - nested if with id`,
  createTestCode(
    withId(),
    `
    if (identifier) {
      if (identifier === "admin") {
        return ${withId()};
      }
      return ${withId()};
    }
  `,
  ),
);

test(
  `${ruleName}: ✅ Good - ternary operator with id in both branches`,
  createTestCode(`identifier ? ${withId()} : ${withId()}`, ""),
);

test(
  `${ruleName}: ❌ Bad - ternary operator without id in consequent`,
  createTestCode(
    `identifier ? ${withoutId()} : ${withId()}`,
    "",
    expectedError,
  ),
);

test(
  `${ruleName}: ❌ Bad - ternary operator without id in alternate`,
  createTestCode(
    `identifier ? ${withId()} : ${withoutId()}`,
    "",
    expectedError,
  ),
);

test(
  `${ruleName}: ✅ Good - spread operator with id property after spread`,
  createTestCode(
    `new Person({ ...base, id: ctx.getActorUri(identifier) })`,
    `const base = { name: "User" };`,
  ),
);

test(
  `${ruleName}: ❌ Bad - spread operator with id in spread source (known limitation)`,
  createTestCode(
    `new Person({ ...base })`,
    `const base = { id: ctx.getActorUri(identifier), name: "User" };`,
    expectedError,
  ),
);

test(
  `${ruleName}: ❌ Bad - variable assignment then return (known limitation)`,
  createTestCode(
    `actor`,
    `const actor = ${withId()};`,
    expectedError,
  ),
);

test(
  `${ruleName}: ❌ Bad - property assignment after construction (known limitation)`,
  createTestCode(
    `actor`,
    `const actor = ${withoutId()};\n    actor.id = ctx.getActorUri(identifier);`,
    expectedError,
  ),
);

test(`${ruleName}: ❌ Bad - arrow function direct return NewExpression (known limitation)`, () =>
  actorProperties.forEach((name) =>
    testDenoLint({
      code: `
        federation.${properties.id.setter}("/users/{identifier}", async (ctx, identifier) =>
          ${withId()}
        );
      `,
      rule,
      ruleName,
      expectedError,
    })
  ));

test(`${ruleName}: ✅ Good - arrow function direct return with object literal`, () =>
  actorProperties.forEach((name) =>
    testDenoLint({
      code: `
        federation.${properties.id.setter}("/users/{identifier}", async (ctx, identifier) => ({
          id: ctx.getActorUri(identifier),
          name: "User",
        }));
      `,
      rule,
      ruleName,
    })
  ));

test(
  `${ruleName}: ✅ Good - return null (no actor)`,
  createTestCode(withId(), `if (!identifier) return null;`),
);
