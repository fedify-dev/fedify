import { test } from "node:test";
import { properties, RULE_IDS } from "../lib/const.ts";
import { actorPropertyRequired } from "../lib/messages.ts";
import lintTest from "../lib/test.ts";
import * as rule from "../rules/actor-id-required.ts";

const ruleName = RULE_IDS.actorIdRequired;

test(
  `${ruleName}: ✅ Good - \`setActorDispatcher\` called on non-Federation object`,
  lintTest({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        return new Person({
          name: "John Doe",
        });
      });
    `,
    rule,
    ruleName,
    federationSetup: `
      const federation = {
        setActorDispatcher: () => {}
      };
    `,
  }),
);

test(
  `${ruleName}: ✅ Good - with \`id\` property (any value)`,
  lintTest({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        return new Person({
          id: "https://example.com/users/123",
          name: "John Doe",
        });
      });
    `,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - with \`id\` property using ctx.getActorUri()`,
  lintTest({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        return new Person({
          id: ctx.getActorUri(identifier),
          name: "John Doe",
        });
      });
    `,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - BlockStatement with \`id\``,
  lintTest({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        const name = "John Doe";
        return new Person({
          id: ctx.getActorUri(identifier),
          name,
        });
      });
    `,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ❌ Bad - without \`id\` property`,
  lintTest({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        return new Person({
          name: "John Doe",
        });
      });
    `,
    rule,
    ruleName,
    expectedError: actorPropertyRequired(properties.id),
  }),
);

test(
  `${ruleName}: ❌ Bad - returning empty object`,
  lintTest({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        return new Person({});
      });
    `,
    rule,
    ruleName,
    expectedError: actorPropertyRequired(properties.id),
  }),
);

test(
  `${ruleName}: ✅ Good - multiple properties including \`id\``,
  lintTest({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        return new Person({
          id: ctx.getActorUri(identifier),
          name: "John Doe",
          inbox: ctx.getInboxUri(identifier),
          outbox: ctx.getOutboxUri(identifier),
        });
      });
    `,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ❌ Bad - variable assignment without \`id\``,
  lintTest({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        const actor = new Person({
          name: "John Doe",
        });
        return actor;
      });
    `,
    rule,
    ruleName,
    expectedError: actorPropertyRequired(properties.id),
  }),
);
const withId = 'new Person({ id: ctx.getActorUri(identifier), name: "User" })';
const withoutId = 'new Person({ name: "User" })';

test(
  `${ruleName}: ✅ Edge - multiple return statements - all have id`,
  lintTest({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        if (identifier === "admin") {
          return ${withId};
        }
        return identifier === "admin"
          ? ${withId}
          : ${withId};
      });
    `,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Edge - multiple return statements - first missing id (known limitation)`,
  lintTest({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        if (identifier === "admin") {
          return ${withoutId};
        }
        return ${withId};
      });
    `,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ❌ Edge - multiple return statements - second missing id`,
  lintTest({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        if (identifier === "admin") {
          return ${withId};
        }
        return ${withoutId};
      });
    `,
    rule,
    ruleName,
    expectedError: actorPropertyRequired(properties.id),
  }),
);

test(
  `${ruleName}: ✅ Edge - if/else with else block (known limitation: else not checked)`,
  lintTest({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        if (identifier) {
          return ${withId};
        } else {
          return ${withoutId};
        }
        return ${withId};
      });
    `,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Edge - nested if with id`,
  lintTest({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        if (identifier) {
          if (identifier === "admin") {
            return ${withId};
          }
          return ${withId};
        }
        return ${withId};
      });
    `,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Edge - ternary operator with id in both branches`,
  lintTest({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        return identifier ? ${withId} : ${withId};
      });
    `,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ❌ Edge - ternary operator without id in consequent`,
  lintTest({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        return identifier ? ${withoutId} : ${withId};
      });
    `,
    rule,
    ruleName,
    expectedError: actorPropertyRequired(properties.id),
  }),
);

test(
  `${ruleName}: ❌ Edge - ternary operator without id in alternate`,
  lintTest({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        return identifier ? ${withId} : ${withoutId};
      });
    `,
    rule,
    ruleName,
    expectedError: actorPropertyRequired(properties.id),
  }),
);

test(
  `${ruleName}: ✅ Edge - spread operator with id property after spread`,
  lintTest({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        const base = { name: "User" };
        return new Person({ ...base, id: ctx.getActorUri(identifier) });
      });
    `,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ❌ Edge - spread operator with id in spread source (known limitation)`,
  lintTest({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        const base = { id: ctx.getActorUri(identifier), name: "User" };
        return new Person({ ...base });
      });
    `,
    rule,
    ruleName,
    expectedError: actorPropertyRequired(properties.id),
  }),
);

test(
  `${ruleName}: ❌ Edge - variable assignment then return (known limitation)`,
  lintTest({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        const actor = ${withId};
        return actor;
      });
    `,
    rule,
    ruleName,
    expectedError: actorPropertyRequired(properties.id),
  }),
);

test(
  `${ruleName}: ❌ Edge - property assignment after construction (known limitation)`,
  lintTest({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        const actor = ${withoutId};
        actor.id = ctx.getActorUri(identifier);
        return actor;
      });
    `,
    rule,
    ruleName,
    expectedError: actorPropertyRequired(properties.id),
  }),
);

test(
  `${ruleName}: ✅ Edge - arrow function direct return NewExpression`,
  lintTest({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) =>
        ${withId}
      );
    `,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Edge - return null (no actor)`,
  lintTest({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        if (!identifier) return null;
        return ${withId};
      });
    `,
    rule,
    ruleName,
  }),
);
