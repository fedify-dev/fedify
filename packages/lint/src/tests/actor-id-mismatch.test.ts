import { test } from "node:test";
import { testDenoLint } from "../lib/test.ts";
import {
  ACTOR_ID_MISMATCH as ruleName,
  default as rule,
} from "../rules/actor-id-mismatch.ts";

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

test(`${ruleName}: ✅ Good - \`id\` from \`ctx.getActorUri(identifier)\``, () => {
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

test(`${ruleName}: ❌ Bad - \`id\` from not using \`ctx.getActorUri(identifier)\``, () => {
  testDenoLint({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        return new Person({
          id: new URL("https://example.com/user/john"),
          name: "John Doe",
        });
      });
    `,
    rule,
    ruleName,
    expectedError:
      "Actor's `id` property must match `ctx.getActorUri(identifier)`",
  });
  testDenoLint({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        const someOtherVariable = new URL("https://example.com/user/john");
        return new Person({
          id: someOtherVariable,
          name: "John Doe",
        });
      });
    `,
    rule,
    ruleName,
    expectedError:
      "Actor's `id` property must match `ctx.getActorUri(identifier)`",
  });
});

test(`${ruleName}: ❌ Bad - \`id\` using wrong context method`, () => {
  testDenoLint({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        return new Person({
          id: ctx.getInboxUri(identifier),
          name: "John Doe",
        });
      });
    `,
    rule,
    ruleName,
    expectedError:
      "Actor's `id` property must match `ctx.getActorUri(identifier)`",
  });
});
