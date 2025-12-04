import { test } from "node:test";
import { actorPropertyMismatch } from "../lib/messages.ts";
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
          id: "https://example.com/users/123",
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

test(`${ruleName}: ✅ Good - id uses ctx.getActorUri(identifier)`, () => {
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

test(`${ruleName}: ✅ Good - object literal with correct id`, () => {
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

test(`${ruleName}: ✅ Good - BlockStatement with correct id`, () => {
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

test(`${ruleName}: ❌ Bad - id uses hardcoded string instead of ctx.getActorUri()`, () => {
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
    expectedError: actorPropertyMismatch("id", "ctx.getActorUri(identifier)"),
  });
});

test(`${ruleName}: ❌ Bad - id uses wrong method (getInboxUri instead of getActorUri)`, () => {
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
    expectedError: actorPropertyMismatch("id", "ctx.getActorUri(identifier)"),
  });
});

test(`${ruleName}: ❌ Bad - id uses wrong identifier parameter`, () => {
  testDenoLint({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        return new Person({
          id: ctx.getActorUri("wrong"),
          name: "John Doe",
        });
      });
    `,
    rule,
    ruleName,
    expectedError: actorPropertyMismatch("id", "ctx.getActorUri(identifier)"),
  });
});

test(`${ruleName}: ❌ Bad - object literal with wrong id`, () => {
  testDenoLint({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        return {
          id: "https://example.com/users/123",
          name: "John Doe",
        };
      });
    `,
    rule,
    ruleName,
    expectedError: actorPropertyMismatch("id", "ctx.getActorUri(identifier)"),
  });
});

test(`${ruleName} Edge: ✅ multiple return statements - all correct`, () => {
  testDenoLint({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        if (identifier === "admin") {
          return new Person({ id: ctx.getActorUri(identifier), name: "Admin" });
        }
        return new Person({ id: ctx.getActorUri(identifier), name: "User" });
      });
    `,
    rule,
    ruleName,
  });
});

test(`${ruleName} Edge: ⚠️ multiple returns - known limitation`, () => {
  testDenoLint({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        if (identifier === "admin") {
          return new Person({ id: "hardcoded", name: "Admin" });
        }
        return new Person({ id: ctx.getActorUri(identifier), name: "User" });
      });
    `,
    rule,
    ruleName,
    // Known limitation: Once ANY return has correct id, the rule passes.
    // The first return with wrong id is not caught.
  });
});

test(`${ruleName} Edge: ✅ spread operator with correct id after spread`, () => {
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

test(`${ruleName} Edge: ❌ spread operator with wrong id after spread`, () => {
  testDenoLint({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        const base = { name: "User" };
        return new Person({ ...base, id: "hardcoded" });
      });
    `,
    rule,
    ruleName,
    expectedError: actorPropertyMismatch("id", "ctx.getActorUri(identifier)"),
  });
});

test(`${ruleName} Edge: ✅ arrow function direct return with correct id`, () => {
  testDenoLint({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => ({
        id: ctx.getActorUri(identifier),
        name: "User",
      }));
    `,
    rule,
    ruleName,
  });
});

test(`${ruleName} Edge: ❌ arrow function direct return with wrong id`, () => {
  testDenoLint({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => ({
        id: "hardcoded",
        name: "User",
      }));
    `,
    rule,
    ruleName,
    expectedError: actorPropertyMismatch("id", "ctx.getActorUri(identifier)"),
  });
});
