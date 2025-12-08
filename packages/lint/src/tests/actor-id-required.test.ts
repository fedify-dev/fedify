import { test } from "node:test";
import { properties } from "../lib/const.ts";
import { actorPropertyRequired } from "../lib/messages.ts";
import { testDenoLint } from "../lib/test.ts";
import {
  ACTOR_ID_REQUIRED as ruleName,
  default as rule,
} from "../rules/actor-id-required.ts";

test(`${ruleName}: ✅ Good - \`setActorDispatcher\` called on non-Federation object`, () => {
  testDenoLint({
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
  });
});

test(`${ruleName}: ✅ Good - with \`id\` property (any value)`, () => {
  testDenoLint({
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
  });
});

test(`${ruleName}: ✅ Good - with \`id\` property using ctx.getActorUri()`, () => {
  testDenoLint({
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
  });
});

test(`${ruleName}: ✅ Good - BlockStatement with \`id\``, () => {
  testDenoLint({
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
  });
});

test(`${ruleName}: ❌ Bad - without \`id\` property`, () => {
  testDenoLint({
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
  });
});

test(`${ruleName}: ❌ Bad - returning empty object`, () => {
  testDenoLint({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        return new Person({});
      });
    `,
    rule,
    ruleName,
    expectedError: actorPropertyRequired(properties.id),
  });
});

test(`${ruleName}: ✅ Good - multiple properties including \`id\``, () => {
  testDenoLint({
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
  });
});

test(`${ruleName}: ❌ Bad - variable assignment without \`id\``, () => {
  testDenoLint({
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
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

const withId = (extra = "") =>
  `new Person({ id: ctx.getActorUri(identifier), name: "User"${extra} })`;
const withoutId = () => `new Person({ name: "User" })`;

test(`${ruleName}: ✅ Edge - multiple return statements - all have id`, () => {
  testDenoLint({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        if (identifier === "admin") {
          return ${withId()};
        }
        return identifier === "admin"
          ? ${withId()}
          : ${withId()};
      });
    `,
    rule,
    ruleName,
  });
});

test(`${ruleName}: ✅ Edge - multiple return statements - first missing id (known limitation)`, () => {
  testDenoLint({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        if (identifier === "admin") {
          return ${withoutId()};
        }
        return ${withId()};
      });
    `,
    rule,
    ruleName,
  });
});

test(`${ruleName}: ❌ Edge - multiple return statements - second missing id`, () => {
  testDenoLint({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        if (identifier === "admin") {
          return ${withId()};
        }
        return ${withoutId()};
      });
    `,
    rule,
    ruleName,
    expectedError: actorPropertyRequired(properties.id),
  });
});

test(`${ruleName}: ✅ Edge - if/else with else block (known limitation: else not checked)`, () => {
  testDenoLint({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        if (identifier) {
          return ${withId()};
        } else {
          return ${withoutId()};
        }
        return ${withId()};
      });
    `,
    rule,
    ruleName,
  });
});

test(`${ruleName}: ✅ Edge - nested if with id`, () => {
  testDenoLint({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        if (identifier) {
          if (identifier === "admin") {
            return ${withId()};
          }
          return ${withId()};
        }
        return ${withId()};
      });
    `,
    rule,
    ruleName,
  });
});

test(`${ruleName}: ✅ Edge - ternary operator with id in both branches`, () => {
  testDenoLint({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        return identifier ? ${withId()} : ${withId()};
      });
    `,
    rule,
    ruleName,
  });
});

test(`${ruleName}: ❌ Edge - ternary operator without id in consequent`, () => {
  testDenoLint({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        return identifier ? ${withoutId()} : ${withId()};
      });
    `,
    rule,
    ruleName,
    expectedError: actorPropertyRequired(properties.id),
  });
});

test(`${ruleName}: ❌ Edge - ternary operator without id in alternate`, () => {
  testDenoLint({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        return identifier ? ${withId()} : ${withoutId()};
      });
    `,
    rule,
    ruleName,
    expectedError: actorPropertyRequired(properties.id),
  });
});

test(`${ruleName}: ✅ Edge - spread operator with id property after spread`, () => {
  testDenoLint({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        const base = { name: "User" };
        return new Person({ ...base, id: ctx.getActorUri(identifier) });
      });
    `,
    rule,
    ruleName,
  });
});

test(`${ruleName}: ❌ Edge - spread operator with id in spread source (known limitation)`, () => {
  testDenoLint({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        const base = { id: ctx.getActorUri(identifier), name: "User" };
        return new Person({ ...base });
      });
    `,
    rule,
    ruleName,
    expectedError: actorPropertyRequired(properties.id),
  });
});

test(`${ruleName}: ❌ Edge - variable assignment then return (known limitation)`, () => {
  testDenoLint({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        const actor = ${withId()};
        return actor;
      });
    `,
    rule,
    ruleName,
    expectedError: actorPropertyRequired(properties.id),
  });
});

test(`${ruleName}: ❌ Edge - property assignment after construction (known limitation)`, () => {
  testDenoLint({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        const actor = ${withoutId()};
        actor.id = ctx.getActorUri(identifier);
        return actor;
      });
    `,
    rule,
    ruleName,
    expectedError: actorPropertyRequired(properties.id),
  });
});

test(`${ruleName}: ✅ Edge - arrow function direct return NewExpression`, () => {
  testDenoLint({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) =>
        ${withId()}
      );
    `,
    rule,
    ruleName,
  });
});

test(`${ruleName}: ✅ Edge - return null (no actor)`, () => {
  testDenoLint({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        if (!identifier) return null;
        return ${withId()};
      });
    `,
    rule,
    ruleName,
  });
});
