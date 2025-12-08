import { test } from "node:test";
import { actorKeyPropertyRequired } from "../lib/messages.ts";
import { testDenoLint } from "../lib/test.ts";
import {
  ACTOR_ASSERTION_METHOD_REQUIRED as ruleName,
  default as rule,
} from "../rules/actor-assertion-method-required.ts";

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
          name: "John Doe",
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
      federation.setKeyPairsDispatcher(async (ctx, identifier) => {
        return [];
      });

      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        return new Person({
          id: ctx.getActorUri(identifier),
          assertionMethod: ctx.getActorKeyPairs(identifier),
          name: "John Doe",
        });
      });
    `,
    rule,
    ruleName,
  });
});

test(`${ruleName}: ✅ Good - key pairs dispatcher configured BEFORE setActorDispatcher (chained), property present`, () => {
  testDenoLint({
    code: `
      federation
        .setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
          return new Person({
            id: ctx.getActorUri(identifier),
            assertionMethod: ctx.getActorKeyPairs(identifier),
            name: "John Doe",
          });
        })
        .setKeyPairsDispatcher(async (ctx, identifier) => []);
    `,
    rule,
    ruleName,
  });
});

test(`${ruleName}: ✅ Good - key pairs dispatcher configured AFTER setActorDispatcher, property present`, () => {
  testDenoLint({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        return new Person({
          id: ctx.getActorUri(identifier),
          assertionMethod: ctx.getActorKeyPairs(identifier),
          name: "John Doe",
        });
      });

      federation.setKeyPairsDispatcher(async (ctx, identifier) => {
        return [];
      });
    `,
    rule,
    ruleName,
  });
});

test(`${ruleName}: ✅ Good - key pairs dispatcher configured AFTER setActorDispatcher (chained), property present`, () => {
  testDenoLint({
    code: `
      federation
        .setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
          return new Person({
            id: ctx.getActorUri(identifier),
            assertionMethod: ctx.getActorKeyPairs(identifier),
            name: "John Doe",
          });
        })
        .setKeyPairsDispatcher(async (ctx, identifier) => []);
    `,
    rule,
    ruleName,
  });
});

test(`${ruleName}: ❌ Bad - key pairs dispatcher configured BEFORE, property missing`, () => {
  testDenoLint({
    code: `
      federation.setKeyPairsDispatcher(async (ctx, identifier) => {
        return [];
      });

      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        return new Person({
          id: ctx.getActorUri(identifier),
          name: "John Doe",
        });
      });
    `,
    rule,
    ruleName,
    expectedError: actorKeyPropertyRequired("assertionMethod"),
  });
});

test(`${ruleName}: ❌ Bad - key pairs dispatcher configured BEFORE (chained), property missing`, () => {
  testDenoLint({
    code: `
      federation
        .setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
          return new Person({
            id: ctx.getActorUri(identifier),
            name: "John Doe",
          });
        })
        .setKeyPairsDispatcher(async (ctx, identifier) => []);
    `,
    rule,
    ruleName,
    expectedError: actorKeyPropertyRequired("assertionMethod"),
  });
});

test(`${ruleName}: ❌ Bad - key pairs dispatcher configured AFTER, property missing`, () => {
  testDenoLint({
    code: `
      federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
        return new Person({
          id: ctx.getActorUri(identifier),
          name: "John Doe",
        });
      });

      federation.setKeyPairsDispatcher(async (ctx, identifier) => {
        return [];
      });
    `,
    rule,
    ruleName,
    expectedError: actorKeyPropertyRequired("assertionMethod"),
  });
});

test(`${ruleName}: ❌ Bad - key pairs dispatcher configured AFTER (chained), property missing`, () => {
  testDenoLint({
    code: `
      federation
        .setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
          return new Person({
            id: ctx.getActorUri(identifier),
            name: "John Doe",
          });
        })
        .setKeyPairsDispatcher(async (ctx, identifier) => []);
    `,
    rule,
    ruleName,
    expectedError: actorKeyPropertyRequired("assertionMethod"),
  });
});
