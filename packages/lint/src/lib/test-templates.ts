import { consume, entries, map, pipe } from "@fxts/core";
import type { Rule } from "eslint";
import { test } from "node:test";
import { properties } from "./const.ts";
import { actorPropertyMismatch, actorPropertyRequired } from "./messages.ts";
import lintTest from "./test.ts";
import type { MethodCallContext, PropertyConfig } from "./types.ts";

type PropertyKey = keyof typeof properties;

interface TestConfig {
  rule: {
    deno: Deno.lint.Rule;
    eslint: Rule.RuleModule;
  };
  ruleName: string;
}

type TestEntry = [() => void, boolean];
type TestSuite = Record<string, TestEntry>;

const ID_PROP = "id: ctx.getActorUri(identifier),";

/**
 * Runs all tests in a test suite with proper formatting
 */
export const runTests = (ruleName: string, tests: TestSuite) =>
  pipe(
    tests,
    entries,
    map(([testName, [testFn, succeed]]) => {
      test(
        `${ruleName}: ${succeed ? "✅ Good" : "❌ Bad"} - ${testName}`,
        testFn,
      );
    }),
    consume,
  );

const createActorDispatcherCode = (content: string) => `
federation.setActorDispatcher(
  "/users/{identifier}",
  async (ctx, identifier) => {
    ${content}
});
`;

const createChainedDispatcherCode = (
  content: string,
  dispatcherMethod: string,
) => `
  federation
    .setActorDispatcher(
      "/users/{identifier}",
      async (ctx, identifier) => {
        ${content}
    })
    .${dispatcherMethod}(async (ctx, identifier) => []);
`;

const createDispatcherCode = (
  content: string,
  dispatcherMethod: string,
  isBefore?: boolean | undefined,
) => {
  const dispatcher =
    `federation.${dispatcherMethod}(async (ctx, identifier) => []);`;
  const actor = createActorDispatcherCode(content);
  return isBefore ? `${dispatcher}\n${actor}` : `${actor}\n${dispatcher}`;
};

/**
 * Generates the method call code for a property.
 * @param getter The getter method name
 * @param requiresIdentifier Whether the method requires an identifier parameter
 * @param ctxName The context variable name (default: "ctx")
 * @param idName The identifier variable name (default: "identifier")
 */
const createMethodCall = (
  getter: string,
  requiresIdentifier: boolean,
  ctxName = "ctx",
  idName = "identifier",
): string => {
  return requiresIdentifier
    ? `${ctxName}.${getter}(${idName})`
    : `${ctxName}.${getter}()`;
};

/**
 * Generates property assignment code for a given property configuration.
 * Handles both simple properties and nested properties with wrappers.
 *
 * @example
 * // Simple property: id: ctx.getActorUri(identifier)
 * // Nested property:
 * //   endpoints: new Endpoints({ sharedInbox: ctx.getInboxUri() }),
 */
const createPropertyAssignment = (
  prop: PropertyConfig,
  options: {
    getter?: string;
    ctxName?: string;
    idName?: string;
  } = {},
): string => {
  const getter = options.getter ?? prop.getter;
  const ctxName = options.ctxName ?? "ctx";
  const idName = options.idName ?? "identifier";
  const requiresIdentifier = prop.requiresIdentifier ?? true;

  const methodCall = createMethodCall(
    getter,
    requiresIdentifier,
    ctxName,
    idName,
  );

  if (prop.nested) {
    return `${prop.nested.parent}: \
    new ${prop.nested.wrapper}({ ${prop.name}: ${methodCall} }),`;
  }
  return `${prop.name}: ${methodCall},`;
};

/**
 * Creates a MethodCallContext for error message generation.
 */
const createMethodCallContext = (
  prop: PropertyConfig,
  ctxName = "ctx",
  idName = "identifier",
): MethodCallContext => ({
  path: prop.path.join("."),
  ctxName,
  idName,
  methodName: prop.getter,
  requiresIdentifier: prop.requiresIdentifier ?? true,
});

const createTestCode = (
  propertyKey: PropertyKey,
  includeProperty: boolean,
) => {
  const prop = properties[propertyKey];

  return `return new Person({
    ${ID_PROP}
    ${includeProperty ? createPropertyAssignment(prop) : ""}
    name: "John Doe",
  });`;
};

// =============================================================================
// Required Rule Tests (Standard Properties)
// =============================================================================

/**
 * Creates required rule tests for standard properties that use a dispatcher
 * (following, followers, outbox, liked, featured, featuredTags)
 */
export const createRequiredDispatcherRuleTests =
  requiredDispatcherRuleTestsFactory(createDispatcherCode, false);
export const createKeyRequiredDispatcherRuleTests =
  requiredDispatcherRuleTestsFactory(createChainedDispatcherCode, true);

function requiredDispatcherRuleTestsFactory(
  createDispatcherCode: (
    content: string,
    dispatcherMethod: string,
    isBefore?: boolean,
  ) => string,
  isKeyRequired: false,
): (
  propertyKey: PropertyKey,
  config: TestConfig,
) => TestSuite;
function requiredDispatcherRuleTestsFactory(
  createDispatcherCode: (content: string, dispatcherMethod: string) => string,
  isKeyRequired: true,
): (
  propertyKey: PropertyKey,
  config: TestConfig,
) => TestSuite;
function requiredDispatcherRuleTestsFactory(
  createDispatcherCode: (
    content: string,
    dispatcherMethod: string,
    isBefore?: boolean,
  ) => string,
  isKeyRequired: boolean,
): (
  propertyKey: PropertyKey,
  config: TestConfig,
) => TestSuite {
  return function (
    propertyKey: PropertyKey,
    config: TestConfig,
  ): TestSuite {
    const { rule, ruleName } = config;
    const prop = properties[propertyKey];
    const expectedError = actorPropertyRequired(prop);

    return {
      // ✅ Good - non-Federation object
      "non-federation object": [
        lintTest({
          code: createDispatcherCode(
            createTestCode(propertyKey, false),
            prop.setter,
          ),
          rule,
          ruleName,
          federationSetup: `
          const federation = { setActorDispatcher: () => {} };
        `,
        }),
        true,
      ],

      // ✅ Good - dispatcher NOT configured
      "dispatcher not configured": [
        lintTest({
          code: createActorDispatcherCode(createTestCode(propertyKey, false)),
          rule,
          ruleName,
        }),
        true,
      ],
      ...(isKeyRequired ? {} : {
        // ✅ Good - dispatcher configured BEFORE
        "dispatcher before separate with property": [
          lintTest({
            code: createDispatcherCode(
              createTestCode(propertyKey, true),
              prop.setter,
              true,
            ),
            rule,
            ruleName,
          }),
          true,
        ],

        // ✅ Good - dispatcher configured AFTER
        "dispatcher after separate with property": [
          lintTest({
            code: createDispatcherCode(
              createTestCode(propertyKey, true),
              prop.setter,
              false,
            ),
            rule,
            ruleName,
          }),
          true,
        ],

        // ❌ Bad - dispatcher before, property missing
        "dispatcher before separate property missing": [
          lintTest({
            code: createDispatcherCode(
              createTestCode(propertyKey, false),
              prop.setter,
              true,
            ),
            rule,
            ruleName,
            expectedError,
          }),
          false,
        ],

        // ❌ Bad - dispatcher after, property missing
        "dispatcher after separate property missing": [
          lintTest({
            code: createDispatcherCode(
              createTestCode(propertyKey, false),
              prop.setter,
              false,
            ),
            rule,
            ruleName,
            expectedError,
          }),
          false,
        ],
      }),
    };
  };
}

/**
 * Creates required rule tests for actor id property (no dispatcher needed)
 */
export function createIdRequiredRuleTests(config: TestConfig): TestSuite {
  const { rule, ruleName } = config;
  const expectedError = actorPropertyRequired(properties.id);

  return {
    // ✅ Good - non-Federation object
    "non-federation object": [
      lintTest({
        code: createActorDispatcherCode(
          `return new Person({ name: "John Doe" });`,
        ),
        rule,
        ruleName,
        federationSetup: `
          const federation = { setActorDispatcher: () => {} };
        `,
      }),
      true,
    ],

    // ✅ Good - with id property (any value)
    "with id property any value": [
      lintTest({
        code: createActorDispatcherCode(`return new Person({
          id: "https://example.com/users/123",
          name: "John Doe",
        });`),
        rule,
        ruleName,
      }),
      true,
    ],

    // ✅ Good - with id property using ctx.getActorUri()
    "with id property using getActorUri": [
      lintTest({
        code: createActorDispatcherCode(`return new Person({
          ${ID_PROP}
          name: "John Doe",
        });`),
        rule,
        ruleName,
      }),
      true,
    ],

    // ✅ Good - BlockStatement with id
    "block statement with id": [
      lintTest({
        code: createActorDispatcherCode(`const name = "John Doe";
        return new Person({
          ${ID_PROP}
          name,
        });`),
        rule,
        ruleName,
      }),
      true,
    ],

    // ❌ Bad - without id property
    "without id property": [
      lintTest({
        code: createActorDispatcherCode(
          `return new Person({ name: "John Doe" });`,
        ),
        rule,
        ruleName,
        expectedError,
      }),
      false,
    ],

    // ❌ Bad - returning empty object
    "returning empty object": [
      lintTest({
        code: createActorDispatcherCode(`return new Person({});`),
        rule,
        ruleName,
        expectedError,
      }),
      false,
    ],

    // ✅ Good - multiple properties including id
    "multiple properties including id": [
      lintTest({
        code: createActorDispatcherCode(`return new Person({
          ${ID_PROP}
          name: "John Doe",
          inbox: ctx.getInboxUri(identifier),
          outbox: ctx.getOutboxUri(identifier),
        });`),
        rule,
        ruleName,
      }),
      true,
    ],

    // ❌ Bad - variable assignment without id
    "variable assignment without id": [
      lintTest({
        code: createActorDispatcherCode(
          `const actor = new Person({ name: "John Doe" });
        return actor;`,
        ),
        rule,
        ruleName,
        expectedError,
      }),
      false,
    ],
  };
}

// =============================================================================
// Mismatch Rule Tests
// =============================================================================

/**
 * Creates mismatch rule tests for standard properties
 */
export function createMismatchRuleTests(
  propertyKey: PropertyKey,
  config: TestConfig,
): TestSuite {
  const { rule, ruleName } = config;
  const prop = properties[propertyKey];

  // Build the expected method call context
  const expectedError = actorPropertyMismatch(createMethodCallContext(prop));

  // Find a wrong getter for testing
  const wrongGetters = Object.values(properties)
    .filter((p) => p.getter !== prop.getter)
    .map((p) => p.getter);
  const wrongGetter = wrongGetters[0] || "getWrongUri";
  const wrongSetter = Object.values(properties)
    .filter((p) => p.setter !== prop.setter)
    .map((p) => p.setter)[0] || "setWrongDispatcher";

  const createLocalPropertyCode = (getter: string) =>
    createPropertyAssignment(prop, { getter });

  const createActorCode = (getter: string) =>
    `return new Person({
    ${ID_PROP}
    ${createLocalPropertyCode(getter)}
    name: "John Doe",
  });`;

  return {
    // ✅ Good - non-Federation object
    "non-federation object": [
      lintTest({
        code: createDispatcherCode(createActorCode(wrongGetter), wrongSetter),
        rule,
        ruleName,
        federationSetup: `
          const federation = { setActorDispatcher: () => {} };
        `,
      }),
      true,
    ],

    // ✅ Good - correct getter used
    "correct getter used": [
      lintTest({
        code: createDispatcherCode(createActorCode(prop.getter), prop.setter),
        rule,
        ruleName,
      }),
      true,
    ],

    // ❌ Bad - wrong getter used
    "wrong getter used": [
      lintTest({
        code: createDispatcherCode(createActorCode(wrongGetter), wrongSetter),
        rule,
        ruleName,
        expectedError,
      }),
      false,
    ],

    // ❌ Bad - wrong identifier
    "wrong context": [
      lintTest({
        code: createActorDispatcherCode(`return new Person({
          ${ID_PROP}
          ${createPropertyAssignment(prop, { ctxName: "wrongContext" })}
          name: "John Doe",
        });`),
        rule,
        ruleName,
        expectedError,
      }),
      false,
    ],

    // ✅ Good - property not present (no error)
    "property not present": [
      lintTest({
        code: createActorDispatcherCode(`return new Person({
          ${ID_PROP}
          name: "John Doe",
        });`),
        rule,
        ruleName,
      }),
      true,
    ],
  };
}

/**
 * Creates mismatch rule tests for id property
 */
export function createIdMismatchRuleTests(config: TestConfig): TestSuite {
  const { rule, ruleName } = config;
  const expectedError = actorPropertyMismatch(
    createMethodCallContext(properties.id),
  );

  return {
    // ✅ Good - non-Federation object
    "non-federation object": [
      lintTest({
        code: createActorDispatcherCode(
          `return new Person({ id: ctx.getFollowingUri(identifier) });`,
        ),
        rule,
        ruleName,
        federationSetup: `
          const federation = { setActorDispatcher: () => {} };
        `,
      }),
      true,
    ],

    // ✅ Good - correct getter used
    "correct getter used": [
      lintTest({
        code: createActorDispatcherCode(
          `return new Person({ ${ID_PROP} });`,
        ),
        rule,
        ruleName,
      }),
      true,
    ],

    // ❌ Bad - literal string id
    "literal string id": [
      lintTest({
        code: createActorDispatcherCode(
          `return new Person({ id: "https://example.com/users/123" });`,
        ),
        rule,
        ruleName,
        expectedError,
      }),
      false,
    ],

    // ❌ Bad - new URL as id
    "new URL as id": [
      lintTest({
        code: createActorDispatcherCode(
          `return new Person({ id: new URL("https://example.com/users/123") });`,
        ),
        rule,
        ruleName,
        expectedError,
      }),
      false,
    ],

    // ❌ Bad - wrong getter used
    "wrong getter used": [
      lintTest({
        code: createActorDispatcherCode(
          `return new Person({ id: ctx.getFollowingUri(identifier) });`,
        ),
        rule,
        ruleName,
        expectedError,
      }),
      false,
    ],

    // ❌ Bad - wrong identifier
    "wrong context": [
      lintTest({
        code: createActorDispatcherCode(
          `return new Person({ id: wrongContext.getActorUri(identifier) });`,
        ),
        rule,
        ruleName,
        expectedError,
      }),
      false,
    ],
  };
}

// =============================================================================
// Edge Case Tests
// =============================================================================

/**
 * Creates common edge case tests for required rules
 */
export const createRequiredEdgeCaseTests = requiredEdgeCaseTestsFactory(
  createDispatcherCode,
);

/**
 * Creates edge case tests for key required rules (publicKey, assertionMethod)
 */
export const createKeyRequiredEdgeCaseTests = requiredEdgeCaseTestsFactory(
  createChainedDispatcherCode,
);

function requiredEdgeCaseTestsFactory(
  createDispatcherCode: (content: string, dispatcherMethod: string) => string,
) {
  return function (
    propertyKey: PropertyKey,
    config: TestConfig,
  ): TestSuite {
    const { rule, ruleName } = config;
    const prop = properties[propertyKey];
    const setter = prop.setter;
    const expectedError = actorPropertyRequired(prop);
    const propCode = createPropertyAssignment(prop);

    return {
      // ✅ Ternary with property in both branches
      "ternary with property in both branches": [
        lintTest({
          code: createDispatcherCode(
            `return condition
    ? new Person({ ${ID_PROP} ${propCode} name: "A" })
    : new Person({ ${ID_PROP} ${propCode} name: "B" });`,
            setter,
          ),
          rule,
          ruleName,
        }),
        true,
      ],

      // ❌ Ternary missing property in consequent
      "ternary missing property in consequent": [
        lintTest({
          code: createDispatcherCode(
            `return condition
    ? new Person({ ${ID_PROP} name: "A" })
    : new Person({ ${ID_PROP} ${propCode} name: "B" });`,
            setter,
          ),
          rule,
          ruleName,
          expectedError,
        }),
        false,
      ],

      // ❌ Ternary missing property in alternate
      "ternary missing property in alternate": [
        lintTest({
          code: createDispatcherCode(
            `return condition
    ? new Person({ ${ID_PROP} ${propCode} name: "A" })
    : new Person({ ${ID_PROP} name: "B" });`,
            setter,
          ),
          rule,
          ruleName,
          expectedError,
        }),
        false,
      ],

      // ❌ Ternary missing property in both
      "ternary missing property in both branches": [
        lintTest({
          code: createDispatcherCode(
            `return condition
            ? new Person({ ${ID_PROP} name: "A" })
            : new Person({ ${ID_PROP} name: "B" });`,
            setter,
          ),
          rule,
          ruleName,
          expectedError,
        }),
        false,
      ],

      // ✅ Nested ternary with property
      "nested ternary with property": [
        lintTest({
          code: createDispatcherCode(
            `return condition1
  ? (condition2
      ? new Person({ ${ID_PROP} ${propCode} name: "A" })
      : new Person({ ${ID_PROP} ${propCode} name: "B" }))
  : new Person({ ${ID_PROP} ${propCode} name: "C" });`,
            setter,
          ),
          rule,
          ruleName,
        }),
        true,
      ],

      // ✅ If/else with property in both branches
      "if else with property in both branches": [
        lintTest({
          code: createDispatcherCode(
            `\
if (condition) {
  return new Person({ ${ID_PROP} ${propCode} name: "A" });
} else {
  return new Person({ ${ID_PROP} ${propCode} name: "B" });
}`,
            setter,
          ),
          rule,
          ruleName,
        }),
        true,
      ],

      // ❌ If/else missing property in if block
      "if else missing property in if block": [
        lintTest({
          code: createDispatcherCode(
            `\
if (condition) {
  return new Person({ ${ID_PROP} name: "A" });
} else {
  return new Person({ ${ID_PROP} ${propCode} name: "B" });
}`,
            setter,
          ),
          rule,
          ruleName,
          expectedError,
        }),
        false,
      ],

      // ❌ If/else missing property in else block
      "if else missing property in else block": [
        lintTest({
          code: createDispatcherCode(
            `\
if (condition) {
  return new Person({ ${ID_PROP} ${propCode} name: "A" });
} else {
  return new Person({ ${ID_PROP} name: "B" });
}`,
            setter,
          ),
          rule,
          ruleName,
          expectedError,
        }),
        false,
      ],

      // ❌ If/else missing property in both blocks
      "if else missing property in both blocks": [
        lintTest({
          code: createDispatcherCode(
            `\
if (condition) {
  return new Person({ ${ID_PROP} name: "A" });
} else {
  return new Person({ ${ID_PROP} name: "B" });
}`,
            setter,
          ),
          rule,
          ruleName,
          expectedError,
        }),
        false,
      ],

      // ✅ Nested if with property
      "nested if with property": [
        lintTest({
          code: createDispatcherCode(
            `\
if (condition1) {
  if (condition2) {
    return new Person({ ${ID_PROP} ${propCode} name: "A" });
  } else {
    return new Person({ ${ID_PROP} ${propCode} name: "B" });
  }
} else {
  return new Person({ ${ID_PROP} ${propCode} name: "C" });
}`,
            setter,
          ),
          rule,
          ruleName,
        }),
        true,
      ],

      // ✅ If/else if/else with property in all branches
      "if else if else with property in all branches": [
        lintTest({
          code: createDispatcherCode(
            `\
if (condition1) {
  return new Person({ ${ID_PROP} ${propCode} name: "A" });
} else if (condition2) {
  return new Person({ ${ID_PROP} ${propCode} name: "B" });
} else {
  return new Person({ ${ID_PROP} ${propCode} name: "C" });
}`,
            setter,
          ),
          rule,
          ruleName,
        }),
        true,
      ],

      // ❌ If/else if/else missing property in else if
      "if else if else missing property in else if": [
        lintTest({
          code: createDispatcherCode(
            `\
if (condition1) {
  return new Person({ ${ID_PROP} ${propCode} name: "A" });
} else if (condition2) {
  return new Person({ ${ID_PROP} name: "B" });
} else {
  return new Person({ ${ID_PROP} ${propCode} name: "C" });
}`,
            setter,
          ),
          rule,
          ruleName,
          expectedError,
        }),
        false,
      ],

      // ✅ If/else if with final return, property in all paths
      "if else if with final return property in all paths": [
        lintTest({
          code: createDispatcherCode(
            `\
if (condition1) {
  return new Person({ ${ID_PROP} ${propCode} name: "A" });
} else if (condition2) {
  return new Person({ ${ID_PROP} ${propCode} name: "B" });
}
return new Person({ ${ID_PROP} ${propCode} name: "C" });`,
            setter,
          ),
          rule,
          ruleName,
        }),
        true,
      ],

      // ❌ If/else if with final return, missing property in final return
      "if else if with final return missing property in final return": [
        lintTest({
          code: createDispatcherCode(
            `\
if (condition1) {
  return new Person({ ${ID_PROP} ${propCode} name: "A" });
} else if (condition2) {
  return new Person({ ${ID_PROP} ${propCode} name: "B" });
}
return new Person({ ${ID_PROP} name: "C" });`,
            setter,
          ),
          rule,
          ruleName,
          expectedError,
        }),
        false,
      ],
    };
  };
}

/**
 * Creates common edge case tests for mismatch rules
 */
export function createMismatchEdgeCaseTests(
  propertyKey: PropertyKey,
  config: TestConfig,
): TestSuite {
  const { rule, ruleName } = config;
  const prop = properties[propertyKey];

  // Build the expected method call context
  const expectedError = actorPropertyMismatch(createMethodCallContext(prop));

  // Find a wrong getter for testing
  const wrongGetters = Object.values(properties)
    .filter((p) => p.getter !== prop.getter)
    .map((p) => p.getter);
  const wrongGetter = wrongGetters[0] || "getWrongUri";

  const createLocalPropertyCode = (getter: string) =>
    createPropertyAssignment(prop, { getter });
  const propCode = createLocalPropertyCode(prop.getter);
  const wrongPropCode = createLocalPropertyCode(wrongGetter);
  return {
    // ✅ Ternary with correct getter in both branches
    "ternary with correct getter in both branches": [
      lintTest({
        code: createActorDispatcherCode(nestedTernaryCode(propCode, propCode)),
        rule,
        ruleName,
      }),
      true,
    ],

    // ❌ Ternary with wrong getter in consequent
    "ternary with wrong getter in consequent": [
      lintTest({
        code: createActorDispatcherCode(
          nestedTernaryCode(wrongPropCode, propCode),
        ),
        rule,
        ruleName,
        expectedError,
      }),
      false,
    ],

    // ❌ Ternary with wrong getter in alternate
    "ternary with wrong getter in alternate": [
      lintTest({
        code: createActorDispatcherCode(
          nestedTernaryCode(propCode, wrongPropCode),
        ),
        rule,
        ruleName,
        expectedError,
      }),
      false,
    ],

    // ❌ Ternary with wrong getter in both
    "ternary with wrong getter in both branches": [
      lintTest({
        code: createActorDispatcherCode(
          nestedTernaryCode(wrongPropCode, wrongPropCode),
        ),
        rule,
        ruleName,
        expectedError,
      }),
      false,
    ],

    // ✅ Nested ternary with correct getter
    "nested ternary with correct getter": [
      lintTest({
        code: createActorDispatcherCode(
          `\
return condition1
  ? (condition2
      ? new Person({ ${ID_PROP} ${propCode} name: "A" })
      : new Person({ ${ID_PROP} ${propCode} name: "B" }))
  : new Person({ ${ID_PROP} ${propCode} name: "C" });`,
        ),
        rule,
        ruleName,
      }),
      true,
    ],

    // ✅ If/else with correct getter in both branches
    "if else with correct getter in both branches": [
      lintTest({
        code: createActorDispatcherCode(
          `\
if (condition) {
  return new Person({ ${ID_PROP} ${propCode} name: "A" });
} else {
  return new Person({ ${ID_PROP} ${propCode} name: "B" });
}`,
        ),
        rule,
        ruleName,
      }),
      true,
    ],

    // ❌ If/else with wrong getter in if block
    "if else with wrong getter in if block": [
      lintTest({
        code: createActorDispatcherCode(
          `\
if (condition) {
  return new Person({ ${ID_PROP} ${wrongPropCode} name: "A" });
} else {
  return new Person({ ${ID_PROP} ${propCode} name: "B" });
}`,
        ),
        rule,
        ruleName,
        expectedError,
      }),
      false,
    ],

    // ❌ If/else with wrong getter in else block
    "if else with wrong getter in else block": [
      lintTest({
        code: createActorDispatcherCode(
          `\
if (condition) {
  return new Person({ ${ID_PROP} ${propCode} name: "A" });
} else {
  return new Person({ ${ID_PROP} ${wrongPropCode} name: "B" });
}`,
        ),
        rule,
        ruleName,
        expectedError,
      }),
      false,
    ],

    // ❌ If/else with wrong getter in both blocks
    "if else with wrong getter in both blocks": [
      lintTest({
        code: createActorDispatcherCode(
          `\
if (condition) {
  return new Person({ ${ID_PROP} ${wrongPropCode} name: "A" });
} else {
  return new Person({ ${ID_PROP} ${wrongPropCode} name: "B" });
}`,
        ),
        rule,
        ruleName,
        expectedError,
      }),
      false,
    ],

    // ✅ Nested if with correct getter
    "nested if with correct getter": [
      lintTest({
        code: createActorDispatcherCode(
          `\
if (condition1) {
  if (condition2) {
    return new Person({ ${ID_PROP} ${propCode} name: "A" });
  } else {
    return new Person({ ${ID_PROP} ${propCode} name: "B" });
  }
} else {
  return new Person({ ${ID_PROP} ${propCode} name: "C" });
}`,
        ),
        rule,
        ruleName,
      }),
      true,
    ],

    // ✅ If/else if/else with correct getter in all branches
    "if else if else with correct getter in all branches": [
      lintTest({
        code: createActorDispatcherCode(
          `\
if (condition1) {
  return new Person({ ${ID_PROP} ${propCode} name: "A" });
} else if (condition2) {
  return new Person({ ${ID_PROP} ${propCode} name: "B" });
} else {
  return new Person({ ${ID_PROP} ${propCode} name: "C" });
}`,
        ),
        rule,
        ruleName,
      }),
      true,
    ],

    // ❌ If/else if/else with wrong getter in else if
    "if else if else with wrong getter in else if": [
      lintTest({
        code: createActorDispatcherCode(
          `\
if (condition1) {
  return new Person({ ${ID_PROP} ${propCode} name: "A" });
} else if (condition2) {
  return new Person({ ${ID_PROP} ${wrongPropCode} name: "B" });
} else {
  return new Person({ ${ID_PROP} ${propCode} name: "C" });
}`,
        ),
        rule,
        ruleName,
        expectedError,
      }),
      false,
    ],

    // ✅ If/else if with final return, correct getter in all paths
    "if else if with final return correct getter in all paths": [
      lintTest({
        code: createActorDispatcherCode(
          `\
if (condition1) {
  return new Person({ ${ID_PROP} ${propCode} name: "A" });
} else if (condition2) {
  return new Person({ ${ID_PROP} ${propCode} name: "B" });
}
return new Person({ ${ID_PROP} ${propCode} name: "C" });`,
        ),
        rule,
        ruleName,
      }),
      true,
    ],

    // ❌ If/else if with final return, wrong getter in final return
    "if else if with final return wrong getter in final return": [
      lintTest({
        code: createActorDispatcherCode(
          `\
if (condition1) {
  return new Person({ ${ID_PROP} ${propCode} name: "A" });
} else if (condition2) {
  return new Person({ ${ID_PROP} ${propCode} name: "B" });
}
return new Person({ ${ID_PROP} ${wrongPropCode} name: "C" });`,
        ),
        rule,
        ruleName,
        expectedError,
      }),
      false,
    ],
  };
}

const nestedTernaryCode = (prop1: string, prop2: string) =>
  `return condition
  ? new Person({ ${ID_PROP} ${prop1} name: "A" })
  : new Person({ ${ID_PROP} ${prop2} name: "B" });`;

/**
 * Creates edge case tests for id required rule
 */
export function createIdRequiredEdgeCaseTests(config: TestConfig): TestSuite {
  const { rule, ruleName } = config;
  const expectedError = actorPropertyRequired(properties.id);

  return {
    // ✅ Ternary with id in both branches
    "ternary with id in both branches": [
      lintTest({
        code: createActorDispatcherCode(
          `return condition
            ? new Person({ ${ID_PROP} name: "A" })
            : new Person({ ${ID_PROP} name: "B" });`,
        ),
        rule,
        ruleName,
      }),
      true,
    ],

    // ❌ Ternary missing id in consequent
    "ternary missing id in consequent": [
      lintTest({
        code: createActorDispatcherCode(
          `return condition
            ? new Person({ name: "A" })
            : new Person({ ${ID_PROP} name: "B" });`,
        ),
        rule,
        ruleName,
        expectedError,
      }),
      false,
    ],

    // ❌ Ternary missing id in alternate
    "ternary missing id in alternate": [
      lintTest({
        code: createActorDispatcherCode(
          `return condition
            ? new Person({ ${ID_PROP} name: "A" })
            : new Person({ name: "B" });`,
        ),
        rule,
        ruleName,
        expectedError,
      }),
      false,
    ],

    // ❌ Ternary missing id in both
    "ternary missing id in both branches": [
      lintTest({
        code: createActorDispatcherCode(
          `return condition
            ? new Person({ name: "A" })
            : new Person({ name: "B" });`,
        ),
        rule,
        ruleName,
        expectedError,
      }),
      false,
    ],

    // ✅ Nested ternary with id
    "nested ternary with id": [
      lintTest({
        code: createActorDispatcherCode(
          `return condition1
            ? (condition2
                ? new Person({ ${ID_PROP} name: "A" })
                : new Person({ ${ID_PROP} name: "B" }))
            : new Person({ ${ID_PROP} name: "C" });`,
        ),
        rule,
        ruleName,
      }),
      true,
    ],

    // ✅ If/else with id in both branches
    "if else with id in both branches": [
      lintTest({
        code: createActorDispatcherCode(
          `\
if (condition) {
  return new Person({ ${ID_PROP} name: "A" });
} else {
  return new Person({ ${ID_PROP} name: "B" });
}`,
        ),
        rule,
        ruleName,
      }),
      true,
    ],

    // ❌ If/else missing id in if block
    "if else missing id in if block": [
      lintTest({
        code: createActorDispatcherCode(
          `\
if (condition) {
  return new Person({ name: "A" });
} else {
  return new Person({ ${ID_PROP} name: "B" });
}`,
        ),
        rule,
        ruleName,
        expectedError,
      }),
      false,
    ],

    // ❌ If/else missing id in else block
    "if else missing id in else block": [
      lintTest({
        code: createActorDispatcherCode(
          `\
if (condition) {
  return new Person({ ${ID_PROP} name: "A" });
} else {
  return new Person({ name: "B" });
}`,
        ),
        rule,
        ruleName,
        expectedError,
      }),
      false,
    ],

    // ❌ If/else missing id in both blocks
    "if else missing id in both blocks": [
      lintTest({
        code: createActorDispatcherCode(
          `\
if (condition) {
  return new Person({ name: "A" });
} else {
  return new Person({ name: "B" });
}`,
        ),
        rule,
        ruleName,
        expectedError,
      }),
      false,
    ],

    // ✅ Nested if with id
    "nested if with id": [
      lintTest({
        code: createActorDispatcherCode(
          `\
if (condition1) {
  if (condition2) {
    return new Person({ ${ID_PROP} name: "A" });
  } else {
    return new Person({ ${ID_PROP} name: "B" });
  }
} else {
  return new Person({ ${ID_PROP} name: "C" });
}`,
        ),
        rule,
        ruleName,
      }),
      true,
    ],

    // ✅ If/else if/else with id in all branches
    "if else if else with id in all branches": [
      lintTest({
        code: createActorDispatcherCode(
          `\
if (condition1) {
  return new Person({ ${ID_PROP} name: "A" });
} else if (condition2) {
  return new Person({ ${ID_PROP} name: "B" });
} else {
  return new Person({ ${ID_PROP} name: "C" });
}`,
        ),
        rule,
        ruleName,
      }),
      true,
    ],

    // ❌ If/else if/else missing id in else if
    "if else if else missing id in else if": [
      lintTest({
        code: createActorDispatcherCode(
          `\
if (condition1) {
  return new Person({ ${ID_PROP} name: "A" });
} else if (condition2) {
  return new Person({ name: "B" });
} else {
  return new Person({ ${ID_PROP} name: "C" });
}`,
        ),
        rule,
        ruleName,
        expectedError,
      }),
      false,
    ],

    // ✅ If/else if with final return, id in all paths
    "if else if with final return id in all paths": [
      lintTest({
        code: createActorDispatcherCode(
          `\
if (condition1) {
  return new Person({ ${ID_PROP} name: "A" });
} else if (condition2) {
  return new Person({ ${ID_PROP} name: "B" });
}
return new Person({ ${ID_PROP} name: "C" });`,
        ),
        rule,
        ruleName,
      }),
      true,
    ],

    // ❌ If/else if with final return, missing id in final return
    "if else if with final return missing id in final return": [
      lintTest({
        code: createActorDispatcherCode(
          `\
if (condition1) {
  return new Person({ ${ID_PROP} name: "A" });
} else if (condition2) {
  return new Person({ ${ID_PROP} name: "B" });
}
return new Person({ name: "C" });`,
        ),
        rule,
        ruleName,
        expectedError,
      }),
      false,
    ],
  };
}

/**
 * Creates edge case tests for id mismatch rule
 */
export function createIdMismatchEdgeCaseTests(config: TestConfig): TestSuite {
  const { rule, ruleName } = config;
  const expectedError = actorPropertyMismatch(
    createMethodCallContext(properties.id),
  );

  return {
    // ✅ Ternary with correct getter in both branches
    "ternary with correct getter in both branches": [
      lintTest({
        code: createActorDispatcherCode(
          `return condition
            ? new Person({ ${ID_PROP} name: "A" })
            : new Person({ ${ID_PROP} name: "B" });`,
        ),
        rule,
        ruleName,
      }),
      true,
    ],

    // ❌ Ternary with wrong getter in consequent
    "ternary with wrong getter in consequent": [
      lintTest({
        code: createActorDispatcherCode(
          `return condition
            ? new Person({ id: ctx.getFollowingUri(identifier), name: "A" })
            : new Person({ ${ID_PROP} name: "B" });`,
        ),
        rule,
        ruleName,
        expectedError,
      }),
      false,
    ],

    // ❌ Ternary with wrong getter in alternate
    "ternary with wrong getter in alternate": [
      lintTest({
        code: createActorDispatcherCode(
          `return condition
            ? new Person({ ${ID_PROP} name: "A" })
            : new Person({ id: ctx.getFollowingUri(identifier), name: "B" });`,
        ),
        rule,
        ruleName,
        expectedError,
      }),
      false,
    ],

    // ❌ Ternary with wrong getter in both
    "ternary with wrong getter in both branches": [
      lintTest({
        code: createActorDispatcherCode(
          `return condition
            ? new Person({ id: ctx.getFollowingUri(identifier), name: "A" })
            : new Person({ id: ctx.getFollowingUri(identifier), name: "B" });`,
        ),
        rule,
        ruleName,
        expectedError,
      }),
      false,
    ],

    // ✅ Nested ternary with correct getter
    "nested ternary with correct getter": [
      lintTest({
        code: createActorDispatcherCode(
          `return condition1
            ? (condition2
                ? new Person({ ${ID_PROP} name: "A" })
                : new Person({ ${ID_PROP} name: "B" }))
            : new Person({ ${ID_PROP} name: "C" });`,
        ),
        rule,
        ruleName,
      }),
      true,
    ],

    // ✅ If/else with correct getter in both branches
    "if else with correct getter in both branches": [
      lintTest({
        code: createActorDispatcherCode(
          `\
if (condition) {
  return new Person({ ${ID_PROP} name: "A" });
} else {
  return new Person({ ${ID_PROP} name: "B" });
}`,
        ),
        rule,
        ruleName,
      }),
      true,
    ],

    // ❌ If/else with wrong getter in if block
    "if else with wrong getter in if block": [
      lintTest({
        code: createActorDispatcherCode(
          `\
if (condition) {
  return new Person({ id: ctx.getFollowingUri(identifier), name: "A" });
} else {
  return new Person({ ${ID_PROP} name: "B" });
}`,
        ),
        rule,
        ruleName,
        expectedError,
      }),
      false,
    ],

    // ❌ If/else with wrong getter in else block
    "if else with wrong getter in else block": [
      lintTest({
        code: createActorDispatcherCode(
          `\
if (condition) {
  return new Person({ ${ID_PROP} name: "A" });
} else {
  return new Person({ id: ctx.getFollowingUri(identifier), name: "B" });
}`,
        ),
        rule,
        ruleName,
        expectedError,
      }),
      false,
    ],

    // ❌ If/else with wrong getter in both blocks
    "if else with wrong getter in both blocks": [
      lintTest({
        code: createActorDispatcherCode(
          `\
if (condition) {
  return new Person({ id: ctx.getFollowingUri(identifier), name: "A" });
} else {
  return new Person({ id: ctx.getFollowingUri(identifier), name: "B" });
}`,
        ),
        rule,
        ruleName,
        expectedError,
      }),
      false,
    ],

    // ✅ Nested if with correct getter
    "nested if with correct getter": [
      lintTest({
        code: createActorDispatcherCode(
          `\
if (condition1) {
  if (condition2) {
    return new Person({ ${ID_PROP} name: "A" });
  } else {
    return new Person({ ${ID_PROP} name: "B" });
  }
} else {
  return new Person({ ${ID_PROP} name: "C" });
}`,
        ),
        rule,
        ruleName,
      }),
      true,
    ],

    // ✅ If/else if/else with correct getter in all branches
    "if else if else with correct getter in all branches": [
      lintTest({
        code: createActorDispatcherCode(
          `\
if (condition1) {
  return new Person({ ${ID_PROP} name: "A" });
} else if (condition2) {
  return new Person({ ${ID_PROP} name: "B" });
} else {
  return new Person({ ${ID_PROP} name: "C" });
}`,
        ),
        rule,
        ruleName,
      }),
      true,
    ],

    // ❌ If/else if/else with wrong getter in else if
    "if else if else with wrong getter in else if": [
      lintTest({
        code: createActorDispatcherCode(
          `\
if (condition1) {
  return new Person({ ${ID_PROP} name: "A" });
} else if (condition2) {
  return new Person({ id: ctx.getFollowingUri(identifier), name: "B" });
} else {
  return new Person({ ${ID_PROP} name: "C" });
}`,
        ),
        rule,
        ruleName,
        expectedError,
      }),
      false,
    ],

    // ✅ If/else if with final return, correct getter in all paths
    "if else if with final return correct getter in all paths": [
      lintTest({
        code: createActorDispatcherCode(
          `\
if (condition1) {
  return new Person({ ${ID_PROP} name: "A" });
} else if (condition2) {
  return new Person({ ${ID_PROP} name: "B" });
}
return new Person({ ${ID_PROP} name: "C" });`,
        ),
        rule,
        ruleName,
      }),
      true,
    ],

    // ❌ If/else if with final return, wrong getter in final return
    "if else if with final return wrong getter in final return": [
      lintTest({
        code: createActorDispatcherCode(
          `\
if (condition1) {
  return new Person({ ${ID_PROP} name: "A" });
} else if (condition2) {
  return new Person({ ${ID_PROP} name: "B" });
}
return new Person({ id: ctx.getFollowingUri(identifier), name: "C" });`,
        ),
        rule,
        ruleName,
        expectedError,
      }),
      false,
    ],
  };
}
