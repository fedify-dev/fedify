import { test } from "node:test";
import { properties, RULE_IDS } from "../lib/const.ts";
import { actorPropertyRequired } from "../lib/messages.ts";
import { createKeyRequiredEdgeCaseTests } from "../lib/test-templates.ts";
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

// Edge case tests
const config = { rule, ruleName };
const edgeCases = createKeyRequiredEdgeCaseTests("assertionMethod", config);
test(
  `${ruleName}: ✅ Edge - ternary with property in both branches`,
  edgeCases["ternary with property in both branches"],
);
test(
  `${ruleName}: ❌ Edge - ternary missing property in consequent`,
  edgeCases["ternary missing property in consequent"],
);
test(
  `${ruleName}: ❌ Edge - ternary missing property in alternate`,
  edgeCases["ternary missing property in alternate"],
);
test(
  `${ruleName}: ❌ Edge - ternary missing property in both branches`,
  edgeCases["ternary missing property in both branches"],
);
test(
  `${ruleName}: ✅ Edge - nested ternary with property`,
  edgeCases["nested ternary with property"],
);
test(
  `${ruleName}: ✅ Edge - if/else with property in both branches`,
  edgeCases["if else with property in both branches"],
);
test(
  `${ruleName}: ❌ Edge - if/else missing property in if block`,
  edgeCases["if else missing property in if block"],
);
test(
  `${ruleName}: ❌ Edge - if/else missing property in else block`,
  edgeCases["if else missing property in else block"],
);
test(
  `${ruleName}: ❌ Edge - if/else missing property in both blocks`,
  edgeCases["if else missing property in both blocks"],
);
test(
  `${ruleName}: ✅ Edge - nested if with property`,
  edgeCases["nested if with property"],
);
test(
  `${ruleName}: ✅ Edge - if else if else with property in all branches`,
  edgeCases["if else if else with property in all branches"],
);
test(
  `${ruleName}: ❌ Edge - if else if else missing property in else if`,
  edgeCases["if else if else missing property in else if"],
);
test(
  `${ruleName}: ✅ Edge - if else if with final return property in all paths`,
  edgeCases["if else if with final return property in all paths"],
);
test(
  `${ruleName}: ❌ Edge - if else if with final return missing property in final return`,
  edgeCases["if else if with final return missing property in final return"],
);
