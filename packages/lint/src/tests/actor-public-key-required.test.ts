import { test } from "node:test";
import { properties } from "../lib/const.ts";
import { actorPropertyRequired } from "../lib/messages.ts";
import { testDenoLint } from "../lib/test.ts";
import {
  ACTOR_PUBLIC_KEY_REQUIRED as ruleName,
  default as rule,
} from "../rules/actor-public-key-required.ts";

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

test(`${ruleName}: ✅ Good - key pairs dispatcher NOT configured, property missing (no error)`, () => {
  testDenoLint({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        return new Person({
          id: ctx.getActorUri(identifier),
          name: "Alice",
          inbox: ctx.getInboxUri(identifier),
        });
      });
    `,
    rule,
    ruleName,
  });
});

test(`${ruleName}: ✅ Good - key pairs dispatcher configured BEFORE setActorDispatcher, property present`, () => {
  testDenoLint({
    code: `
      federation
        .setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
          const keyPairs = await ctx.getActorKeyPairs(identifier);
          return new Person({
            id: ctx.getActorUri(identifier),
            publicKey: keyPairs[0].cryptographicKey,
          });
        })
        .setKeyPairsDispatcher(async (ctx, identifier) => []);
    `,
    rule,
    ruleName,
  });
});

test(`${ruleName}: ✅ Good - key pairs dispatcher configured BEFORE setActorDispatcher (separate calls), property present`, () => {
  testDenoLint({
    code: `
      federation.setKeyPairsDispatcher(async (ctx, identifier) => []);

      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        const keyPairs = await ctx.getActorKeyPairs(identifier);
        return new Person({
          id: ctx.getActorUri(identifier),
          publicKey: keyPairs[0].cryptographicKey,
        });
      });
    `,
    rule,
    ruleName,
  });
});

test(`${ruleName}: ✅ Good - key pairs dispatcher configured AFTER setActorDispatcher, property present`, () => {
  testDenoLint({
    code: `
      federation
        .setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
          const keyPairs = await ctx.getActorKeyPairs(identifier);
          return new Person({
            id: ctx.getActorUri(identifier),
            publicKey: keyPairs[0].cryptographicKey,
          });
        })
        .setKeyPairsDispatcher(async (ctx, identifier) => []);
    `,
    rule,
    ruleName,
  });
});

test(`${ruleName}: ✅ Good - key pairs dispatcher configured AFTER setActorDispatcher (separate calls), property present`, () => {
  testDenoLint({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        const keyPairs = await ctx.getActorKeyPairs(identifier);
        return new Person({
          id: ctx.getActorUri(identifier),
          publicKey: keyPairs[0].cryptographicKey,
        });
      });

      federation.setKeyPairsDispatcher(async (ctx, identifier) => []);
    `,
    rule,
    ruleName,
  });
});

test(`${ruleName}: ❌ Bad - key pairs dispatcher configured BEFORE, property missing`, () => {
  testDenoLint({
    code: `
      federation
        .setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
          return new Person({
            id: ctx.getActorUri(identifier),
            name: "Alice",
          });
        })
        .setKeyPairsDispatcher(async (ctx, identifier) => []);
    `,
    rule,
    ruleName,
    expectedError: actorPropertyRequired(properties.publicKey),
  });
});

test(`${ruleName}: ❌ Bad - key pairs dispatcher configured BEFORE (separate calls), property missing`, () => {
  testDenoLint({
    code: `
      federation.setKeyPairsDispatcher(async (ctx, identifier) => []);

      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        return new Person({
          id: ctx.getActorUri(identifier),
          name: "Alice",
        });
      });
    `,
    rule,
    ruleName,
    expectedError: actorPropertyRequired(properties.publicKey),
  });
});

test(`${ruleName}: ❌ Bad - key pairs dispatcher configured AFTER, property missing`, () => {
  testDenoLint({
    code: `
      federation
        .setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
          return new Person({
            id: ctx.getActorUri(identifier),
          });
        })
        .setKeyPairsDispatcher(async (ctx, identifier) => []);
    `,
    rule,
    ruleName,
    expectedError: actorPropertyRequired(properties.publicKey),
  });
});

test(`${ruleName}: ❌ Bad - key pairs dispatcher configured AFTER (separate calls), property missing`, () => {
  testDenoLint({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        return new Person({
          id: ctx.getActorUri(identifier),
        });
      });

      federation.setKeyPairsDispatcher(async (ctx, identifier) => []);
    `,
    rule,
    ruleName,
    expectedError: actorPropertyRequired(properties.publicKey),
  });
});
