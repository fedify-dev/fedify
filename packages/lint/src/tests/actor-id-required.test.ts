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
    expectedError: actorPropertyRequired(properties.id.name),
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
    expectedError: actorPropertyRequired(properties.id.name),
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
    expectedError: actorPropertyRequired(properties.id.name),
  });
});
