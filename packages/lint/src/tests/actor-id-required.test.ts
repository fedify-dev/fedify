import { test } from "node:test";
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

test(`${ruleName}: ✅ Good - with \`id\` property`, () => {
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

test(`${ruleName}: ✅ Good - object literal with \`id\``, () => {
  testDenoLint({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        return {
          id: ctx.getActorUri(identifier),
          name: "John Doe",
        };
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
    expectedError:
      "Actor dispatcher must return an actor with an `id` property. Use `Context.getActorUri(identifier)` to set it.",
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
    expectedError:
      "Actor dispatcher must return an actor with an `id` property",
  });
});

test(`${ruleName}: ❌ Bad - object literal without \`id\``, () => {
  testDenoLint({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        return {
          name: "John Doe",
          followers: ctx.getFollowersUri(identifier),
        };
      });
    `,
    rule,
    ruleName,
    expectedError:
      "Actor dispatcher must return an actor with an `id` property",
  });
});

test(`${ruleName}: ❌ Bad - BlockStatement without \`id\``, () => {
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
    expectedError:
      "Actor dispatcher must return an actor with an `id` property",
  });
});
