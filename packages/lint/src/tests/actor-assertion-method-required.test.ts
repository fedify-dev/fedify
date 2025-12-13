import { test } from "node:test";
import { properties, RULE_IDS } from "../lib/const.ts";
import { actorPropertyRequired } from "../lib/messages.ts";
import lintTest from "../lib/test.ts";
import * as rule from "../rules/actor-assertion-method-required.ts";

const ruleName = RULE_IDS.actorAssertionMethodRequired;

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
  `${ruleName}: ✅ Good - key pairs dispatcher NOT configured, property missing (no error)`,
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
  `${ruleName}: ✅ Good - key pairs dispatcher configured BEFORE setActorDispatcher, property present`,
  lintTest({
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
  }),
);

test(
  `${ruleName}: ✅ Good - key pairs dispatcher configured BEFORE setActorDispatcher (chained), property present`,
  lintTest({
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
  }),
);

test(
  `${ruleName}: ✅ Good - key pairs dispatcher configured AFTER setActorDispatcher, property present`,
  lintTest({
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
  }),
);

test(
  `${ruleName}: ✅ Good - key pairs dispatcher configured AFTER setActorDispatcher (chained), property present`,
  lintTest({
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
  }),
);

test(
  `${ruleName}: ❌ Bad - key pairs dispatcher configured BEFORE, property missing`,
  lintTest({
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
    expectedError: actorPropertyRequired(properties.assertionMethod),
  }),
);

test(
  `${ruleName}: ❌ Bad - key pairs dispatcher configured BEFORE (chained), property missing`,
  lintTest({
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
    expectedError: actorPropertyRequired(properties.assertionMethod),
  }),
);

test(
  `${ruleName}: ❌ Bad - key pairs dispatcher configured AFTER, property missing`,
  lintTest({
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
    expectedError: actorPropertyRequired(properties.assertionMethod),
  }),
);

test(
  `${ruleName}: ❌ Bad - key pairs dispatcher configured AFTER (chained), property missing`,
  lintTest({
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
    expectedError: actorPropertyRequired(properties.assertionMethod),
  }),
);
