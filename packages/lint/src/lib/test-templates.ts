import { properties, type PropertyConfig } from "./const.ts";
import { actorPropertyMismatch, actorPropertyRequired } from "./messages.ts";
import { testDenoLint } from "./test.ts";

// =============================================================================
// Types
// =============================================================================

type PropertyKey = keyof typeof properties;

interface TestConfig {
  rule: Rule;
  ruleName: string;
}

// =============================================================================
// Common Code Snippets
// =============================================================================

const createDispatcherCode = (content: string) => `
  federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
    ${content}
  });
`;

const createChainedDispatcherCode = (
  content: string,
  dispatcherMethod: string,
) => `
  federation
    .setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
      ${content}
    })
    .${dispatcherMethod}(async (ctx, identifier) => []);
`;

const createSeparateDispatcherCode = (
  content: string,
  dispatcherMethod: string,
  isBefore: boolean,
) => {
  const dispatcher =
    `federation.${dispatcherMethod}(async (ctx, identifier) => []);`;
  const actor = createDispatcherCode(content);
  return isBefore ? `${dispatcher}\n${actor}` : `${actor}\n${dispatcher}`;
};

// =============================================================================
// Property Code Generation Utilities
// =============================================================================

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
 * // Simple property: id: ctx.getActorUri(identifier),
 * // Nested property: endpoints: new Endpoints({ sharedInbox: ctx.getInboxUri() }),
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
    return `${prop.nested.parent}: new ${prop.nested.wrapper}({ ${prop.name}: ${methodCall} }),`;
  }
  return `${prop.name}: ${methodCall},`;
};

/**
 * Generates the expected method call string for error messages.
 */
const getExpectedMethodCall = (
  prop: PropertyConfig,
  ctxName = "ctx",
  idName = "identifier",
): string => {
  const requiresIdentifier = prop.requiresIdentifier ?? true;
  return createMethodCall(prop.getter, requiresIdentifier, ctxName, idName);
};

const createTestCode = (
  propertyKey: PropertyKey,
  includeProperty: boolean,
) => {
  const prop = properties[propertyKey];

  let propertyCode = "";
  if (includeProperty) {
    propertyCode = createPropertyAssignment(prop);
  }

  return `return new Person({
    id: ctx.getActorUri(identifier),
    ${propertyCode}
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
export function createRequiredDispatcherRuleTests(
  propertyKey: PropertyKey,
  config: TestConfig,
) {
  const { rule, ruleName } = config;
  const prop = properties[propertyKey];
  const expectedError = actorPropertyRequired(prop.name);

  return {
    // ✅ Good - non-Federation object
    "non-federation object": () => {
      testDenoLint({
        code: createDispatcherCode(createTestCode(propertyKey, false)),
        rule,
        ruleName,
        federationSetup: `
          const federation = { setActorDispatcher: () => {} };
        `,
      });
    },

    // ✅ Good - dispatcher NOT configured
    "dispatcher not configured": () => {
      testDenoLint({
        code: createDispatcherCode(createTestCode(propertyKey, false)),
        rule,
        ruleName,
      });
    },

    // ✅ Good - dispatcher configured BEFORE (chained)
    "dispatcher before chained with property": () => {
      testDenoLint({
        code: createChainedDispatcherCode(
          createTestCode(propertyKey, true),
          prop.setter,
        ),
        rule,
        ruleName,
      });
    },

    // ✅ Good - dispatcher configured BEFORE (separate)
    "dispatcher before separate with property": () => {
      testDenoLint({
        code: createSeparateDispatcherCode(
          createTestCode(propertyKey, true),
          prop.setter,
          true,
        ),
        rule,
        ruleName,
      });
    },

    // ✅ Good - dispatcher configured AFTER (chained)
    "dispatcher after chained with property": () => {
      testDenoLint({
        code: createChainedDispatcherCode(
          createTestCode(propertyKey, true),
          prop.setter,
        ),
        rule,
        ruleName,
      });
    },

    // ✅ Good - dispatcher configured AFTER (separate)
    "dispatcher after separate with property": () => {
      testDenoLint({
        code: createSeparateDispatcherCode(
          createTestCode(propertyKey, true),
          prop.setter,
          false,
        ),
        rule,
        ruleName,
      });
    },

    // ❌ Bad - dispatcher configured, property missing
    "dispatcher configured property missing": () => {
      testDenoLint({
        code: createChainedDispatcherCode(
          createTestCode(propertyKey, false),
          prop.setter,
        ),
        rule,
        ruleName,
        expectedError,
      });
    },

    // ❌ Bad - dispatcher before (separate), property missing
    "dispatcher before separate property missing": () => {
      testDenoLint({
        code: createSeparateDispatcherCode(
          createTestCode(propertyKey, false),
          prop.setter,
          true,
        ),
        rule,
        ruleName,
        expectedError,
      });
    },

    // ❌ Bad - dispatcher after (separate), property missing
    "dispatcher after separate property missing": () => {
      testDenoLint({
        code: createSeparateDispatcherCode(
          createTestCode(propertyKey, false),
          prop.setter,
          false,
        ),
        rule,
        ruleName,
        expectedError,
      });
    },

    // ❌ Bad - variable assignment without property
    "variable assignment without property": () => {
      testDenoLint({
        code: createChainedDispatcherCode(
          `const actor = new Person({
            id: ctx.getActorUri(identifier),
            name: "John Doe",
          });
          return actor;`,
          prop.setter,
        ),
        rule,
        ruleName,
        expectedError,
      });
    },
  };
}

/**
 * Creates required rule tests for inbox/sharedInbox properties
 */
export function createRequiredListenerRuleTests(
  propertyKey: "inbox" | "sharedInbox",
  config: TestConfig,
) {
  const { rule, ruleName } = config;
  const prop = properties[propertyKey];
  const expectedError = actorPropertyRequired(prop.name);

  const createLocalPropertyCode = (include: boolean) => {
    if (!include) return "";
    return createPropertyAssignment(prop);
  };

  const createActorCode = (includeProperty: boolean) => {
    const propCode = createLocalPropertyCode(includeProperty);
    return `return new Person({
      id: ctx.getActorUri(identifier),
      ${propCode}
      name: "John Doe",
    });`;
  };

  return {
    // ✅ Good - non-Federation object
    "non-federation object": () => {
      testDenoLint({
        code: createDispatcherCode(createActorCode(false)),
        rule,
        ruleName,
        federationSetup: `
          const federation = { setActorDispatcher: () => {} };
        `,
      });
    },

    // ✅ Good - listeners NOT configured
    "listeners not configured": () => {
      testDenoLint({
        code: createDispatcherCode(createActorCode(false)),
        rule,
        ruleName,
      });
    },

    // ✅ Good - listeners configured BEFORE (chained)
    "listeners before chained with property": () => {
      testDenoLint({
        code: createChainedDispatcherCode(
          createActorCode(true),
          "setInboxListeners",
        ),
        rule,
        ruleName,
      });
    },

    // ✅ Good - listeners configured BEFORE (separate)
    "listeners before separate with property": () => {
      testDenoLint({
        code: createSeparateDispatcherCode(
          createActorCode(true),
          "setInboxListeners",
          true,
        ),
        rule,
        ruleName,
      });
    },

    // ✅ Good - listeners configured AFTER (chained)
    "listeners after chained with property": () => {
      testDenoLint({
        code: createChainedDispatcherCode(
          createActorCode(true),
          "setInboxListeners",
        ),
        rule,
        ruleName,
      });
    },

    // ✅ Good - listeners configured AFTER (separate)
    "listeners after separate with property": () => {
      testDenoLint({
        code: createSeparateDispatcherCode(
          createActorCode(true),
          "setInboxListeners",
          false,
        ),
        rule,
        ruleName,
      });
    },

    // ❌ Bad - listeners configured, property missing
    "listeners configured property missing": () => {
      testDenoLint({
        code: createChainedDispatcherCode(
          createActorCode(false),
          "setInboxListeners",
        ),
        rule,
        ruleName,
        expectedError,
      });
    },

    // ❌ Bad - listeners before (separate), property missing
    "listeners before separate property missing": () => {
      testDenoLint({
        code: createSeparateDispatcherCode(
          createActorCode(false),
          "setInboxListeners",
          true,
        ),
        rule,
        ruleName,
        expectedError,
      });
    },

    // ❌ Bad - listeners after (separate), property missing
    "listeners after separate property missing": () => {
      testDenoLint({
        code: createSeparateDispatcherCode(
          createActorCode(false),
          "setInboxListeners",
          false,
        ),
        rule,
        ruleName,
        expectedError,
      });
    },

    // ❌ Bad - variable assignment without property
    "variable assignment without property": () => {
      testDenoLint({
        code: createChainedDispatcherCode(
          `const actor = new Person({
            id: ctx.getActorUri(identifier),
            name: "John Doe",
          });
          return actor;`,
          "setInboxListeners",
        ),
        rule,
        ruleName,
        expectedError,
      });
    },
  };
}

/**
 * Creates required rule tests for actor id property (no dispatcher needed)
 */
export function createIdRequiredRuleTests(config: TestConfig) {
  const { rule, ruleName } = config;
  const expectedError = actorPropertyRequired(properties.id.name);

  return {
    // ✅ Good - non-Federation object
    "non-federation object": () => {
      testDenoLint({
        code: createDispatcherCode(`return new Person({ name: "John Doe" });`),
        rule,
        ruleName,
        federationSetup: `
          const federation = { setActorDispatcher: () => {} };
        `,
      });
    },

    // ✅ Good - with id property (any value)
    "with id property any value": () => {
      testDenoLint({
        code: createDispatcherCode(`return new Person({
          id: "https://example.com/users/123",
          name: "John Doe",
        });`),
        rule,
        ruleName,
      });
    },

    // ✅ Good - with id property using ctx.getActorUri()
    "with id property using getActorUri": () => {
      testDenoLint({
        code: createDispatcherCode(`return new Person({
          id: ctx.getActorUri(identifier),
          name: "John Doe",
        });`),
        rule,
        ruleName,
      });
    },

    // ✅ Good - BlockStatement with id
    "block statement with id": () => {
      testDenoLint({
        code: createDispatcherCode(`const name = "John Doe";
        return new Person({
          id: ctx.getActorUri(identifier),
          name,
        });`),
        rule,
        ruleName,
      });
    },

    // ❌ Bad - without id property
    "without id property": () => {
      testDenoLint({
        code: createDispatcherCode(`return new Person({ name: "John Doe" });`),
        rule,
        ruleName,
        expectedError,
      });
    },

    // ❌ Bad - returning empty object
    "returning empty object": () => {
      testDenoLint({
        code: createDispatcherCode(`return new Person({});`),
        rule,
        ruleName,
        expectedError,
      });
    },

    // ✅ Good - multiple properties including id
    "multiple properties including id": () => {
      testDenoLint({
        code: createDispatcherCode(`return new Person({
          id: ctx.getActorUri(identifier),
          name: "John Doe",
          inbox: ctx.getInboxUri(identifier),
          outbox: ctx.getOutboxUri(identifier),
        });`),
        rule,
        ruleName,
      });
    },

    // ❌ Bad - variable assignment without id
    "variable assignment without id": () => {
      testDenoLint({
        code: createDispatcherCode(
          `const actor = new Person({ name: "John Doe" });
        return actor;`,
        ),
        rule,
        ruleName,
        expectedError,
      });
    },
  };
}

/**
 * Creates required rule tests for key-related properties (publicKey, assertionMethod)
 */
export function createKeyRequiredRuleTests(
  propertyName: "publicKey" | "assertionMethod",
  config: TestConfig,
) {
  const { rule, ruleName } = config;
  const expectedError = actorPropertyRequired(propertyName);

  const createActorWithKey = (includeProperty: boolean) => {
    const propCode = includeProperty
      ? `${propertyName}: ctx.getActorKeyPairs(identifier),`
      : "";
    return `return new Person({
      id: ctx.getActorUri(identifier),
      ${propCode}
      name: "John Doe",
    });`;
  };

  return {
    // ✅ Good - non-Federation object
    "non-federation object": () => {
      testDenoLint({
        code: createDispatcherCode(`return new Person({ name: "John Doe" });`),
        rule,
        ruleName,
        federationSetup: `
          const federation = { setActorDispatcher: () => {} };
        `,
      });
    },

    // ✅ Good - key pairs dispatcher NOT configured
    "key pairs dispatcher not configured": () => {
      testDenoLint({
        code: createDispatcherCode(createActorWithKey(false)),
        rule,
        ruleName,
      });
    },

    // ✅ Good - key pairs dispatcher configured BEFORE (separate)
    "key pairs before separate with property": () => {
      testDenoLint({
        code: createSeparateDispatcherCode(
          createActorWithKey(true),
          "setKeyPairsDispatcher",
          true,
        ),
        rule,
        ruleName,
      });
    },

    // ✅ Good - key pairs dispatcher configured BEFORE (chained)
    "key pairs before chained with property": () => {
      testDenoLint({
        code: createChainedDispatcherCode(
          createActorWithKey(true),
          "setKeyPairsDispatcher",
        ),
        rule,
        ruleName,
      });
    },

    // ✅ Good - key pairs dispatcher configured AFTER (separate)
    "key pairs after separate with property": () => {
      testDenoLint({
        code: createSeparateDispatcherCode(
          createActorWithKey(true),
          "setKeyPairsDispatcher",
          false,
        ),
        rule,
        ruleName,
      });
    },

    // ✅ Good - key pairs dispatcher configured AFTER (chained)
    "key pairs after chained with property": () => {
      testDenoLint({
        code: createChainedDispatcherCode(
          createActorWithKey(true),
          "setKeyPairsDispatcher",
        ),
        rule,
        ruleName,
      });
    },

    // ❌ Bad - key pairs dispatcher configured BEFORE (separate), property missing
    "key pairs before separate property missing": () => {
      testDenoLint({
        code: createSeparateDispatcherCode(
          createActorWithKey(false),
          "setKeyPairsDispatcher",
          true,
        ),
        rule,
        ruleName,
        expectedError,
      });
    },

    // ❌ Bad - key pairs dispatcher configured BEFORE (chained), property missing
    "key pairs before chained property missing": () => {
      testDenoLint({
        code: createChainedDispatcherCode(
          createActorWithKey(false),
          "setKeyPairsDispatcher",
        ),
        rule,
        ruleName,
        expectedError,
      });
    },

    // ❌ Bad - key pairs dispatcher configured AFTER (separate), property missing
    "key pairs after separate property missing": () => {
      testDenoLint({
        code: createSeparateDispatcherCode(
          createActorWithKey(false),
          "setKeyPairsDispatcher",
          false,
        ),
        rule,
        ruleName,
        expectedError,
      });
    },

    // ❌ Bad - key pairs dispatcher configured AFTER (chained), property missing
    "key pairs after chained property missing": () => {
      testDenoLint({
        code: createChainedDispatcherCode(
          createActorWithKey(false),
          "setKeyPairsDispatcher",
        ),
        rule,
        ruleName,
        expectedError,
      });
    },
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
) {
  const { rule, ruleName } = config;
  const prop = properties[propertyKey];

  // Build the expected method call string
  const expectedMethodCall = getExpectedMethodCall(prop);
  const expectedError = actorPropertyMismatch(
    prop.path.join("."),
    expectedMethodCall,
  );

  // Find a wrong getter for testing
  const wrongGetters = Object.values(properties)
    .filter((p) => p.getter !== prop.getter)
    .map((p) => p.getter);
  const wrongGetter = wrongGetters[0] || "getWrongUri";

  const createLocalPropertyCode = (getter: string) =>
    createPropertyAssignment(prop, { getter });

  const createActorCode = (getter: string) =>
    `return new Person({
    id: ctx.getActorUri(identifier),
    ${createLocalPropertyCode(getter)}
    name: "John Doe",
  });`;

  return {
    // ✅ Good - non-Federation object
    "non-federation object": () => {
      testDenoLint({
        code: createDispatcherCode(createActorCode(wrongGetter)),
        rule,
        ruleName,
        federationSetup: `
          const federation = { setActorDispatcher: () => {} };
        `,
      });
    },

    // ✅ Good - correct getter used
    "correct getter used": () => {
      testDenoLint({
        code: createDispatcherCode(createActorCode(prop.getter)),
        rule,
        ruleName,
      });
    },

    // ❌ Bad - wrong getter used
    "wrong getter used": () => {
      testDenoLint({
        code: createDispatcherCode(createActorCode(wrongGetter)),
        rule,
        ruleName,
        expectedError,
      });
    },

    // ❌ Bad - wrong identifier
    "wrong identifier": () => {
      const propCode = createPropertyAssignment(prop, {
        ctxName: "wrongContext",
      });
      testDenoLint({
        code: createDispatcherCode(`return new Person({
          id: ctx.getActorUri(identifier),
          ${propCode}
          name: "John Doe",
        });`),
        rule,
        ruleName,
        expectedError,
      });
    },

    // ✅ Good - property not present (no error)
    "property not present": () => {
      testDenoLint({
        code: createDispatcherCode(`return new Person({
          id: ctx.getActorUri(identifier),
          name: "John Doe",
        });`),
        rule,
        ruleName,
      });
    },
  };
}

/**
 * Creates mismatch rule tests for id property
 */
export function createIdMismatchRuleTests(config: TestConfig) {
  const { rule, ruleName } = config;
  const expectedError = actorPropertyMismatch(
    properties.id.name,
    properties.id.getter,
  );

  return {
    // ✅ Good - non-Federation object
    "non-federation object": () => {
      testDenoLint({
        code: createDispatcherCode(
          `return new Person({ id: ctx.getFollowingUri(identifier) });`,
        ),
        rule,
        ruleName,
        federationSetup: `
          const federation = { setActorDispatcher: () => {} };
        `,
      });
    },

    // ✅ Good - correct getter used
    "correct getter used": () => {
      testDenoLint({
        code: createDispatcherCode(
          `return new Person({ id: ctx.getActorUri(identifier) });`,
        ),
        rule,
        ruleName,
      });
    },

    // ✅ Good - literal string id
    "literal string id": () => {
      testDenoLint({
        code: createDispatcherCode(
          `return new Person({ id: "https://example.com/users/123" });`,
        ),
        rule,
        ruleName,
      });
    },

    // ✅ Good - new URL as id
    "new URL as id": () => {
      testDenoLint({
        code: createDispatcherCode(
          `return new Person({ id: new URL("https://example.com/users/123") });`,
        ),
        rule,
        ruleName,
      });
    },

    // ❌ Bad - wrong getter used
    "wrong getter used": () => {
      testDenoLint({
        code: createDispatcherCode(
          `return new Person({ id: ctx.getFollowingUri(identifier) });`,
        ),
        rule,
        ruleName,
        expectedError,
      });
    },

    // ❌ Bad - wrong method in object literal
    "wrong method in object literal": () => {
      testDenoLint({
        code: createDispatcherCode(
          `return { id: ctx.getInboxUri(identifier) };`,
        ),
        rule,
        ruleName,
        expectedError,
      });
    },

    // ❌ Bad - wrong identifier
    "wrong identifier": () => {
      testDenoLint({
        code: createDispatcherCode(
          `return new Person({ id: wrongContext.getActorUri(identifier) });`,
        ),
        rule,
        ruleName,
        expectedError,
      });
    },
  };
}

// =============================================================================
// Edge Case Tests
// =============================================================================

/**
 * Creates common edge case tests for required rules
 */
export function createRequiredEdgeCaseTests(
  propertyKey: PropertyKey,
  config: TestConfig,
  dispatcherMethod: string,
) {
  const { rule, ruleName } = config;
  const prop = properties[propertyKey];
  const expectedError = actorPropertyRequired(prop.name);

  const createLocalPropertyCode = () => createPropertyAssignment(prop);

  return {
    // ✅ Ternary with property in both branches
    "ternary with property in both branches": () => {
      const propCode = createLocalPropertyCode();
      testDenoLint({
        code: createChainedDispatcherCode(
          `return condition
            ? new Person({ id: ctx.getActorUri(identifier), ${propCode} name: "A" })
            : new Person({ id: ctx.getActorUri(identifier), ${propCode} name: "B" });`,
          dispatcherMethod,
        ),
        rule,
        ruleName,
      });
    },

    // ❌ Ternary missing property in consequent
    "ternary missing property in consequent": () => {
      const propCode = createLocalPropertyCode();
      testDenoLint({
        code: createChainedDispatcherCode(
          `return condition
            ? new Person({ id: ctx.getActorUri(identifier), name: "A" })
            : new Person({ id: ctx.getActorUri(identifier), ${propCode} name: "B" });`,
          dispatcherMethod,
        ),
        rule,
        ruleName,
        expectedError,
      });
    },

    // ❌ Ternary missing property in alternate
    "ternary missing property in alternate": () => {
      const propCode = createLocalPropertyCode();
      testDenoLint({
        code: createChainedDispatcherCode(
          `return condition
            ? new Person({ id: ctx.getActorUri(identifier), ${propCode} name: "A" })
            : new Person({ id: ctx.getActorUri(identifier), name: "B" });`,
          dispatcherMethod,
        ),
        rule,
        ruleName,
        expectedError,
      });
    },

    // ❌ Ternary missing property in both
    "ternary missing property in both branches": () => {
      testDenoLint({
        code: createChainedDispatcherCode(
          `return condition
            ? new Person({ id: ctx.getActorUri(identifier), name: "A" })
            : new Person({ id: ctx.getActorUri(identifier), name: "B" });`,
          dispatcherMethod,
        ),
        rule,
        ruleName,
        expectedError,
      });
    },

    // ✅ Nested ternary with property
    "nested ternary with property": () => {
      const propCode = createLocalPropertyCode();
      testDenoLint({
        code: createChainedDispatcherCode(
          `return condition1
            ? (condition2
                ? new Person({ id: ctx.getActorUri(identifier), ${propCode} name: "A" })
                : new Person({ id: ctx.getActorUri(identifier), ${propCode} name: "B" }))
            : new Person({ id: ctx.getActorUri(identifier), ${propCode} name: "C" });`,
          dispatcherMethod,
        ),
        rule,
        ruleName,
      });
    },
  };
}

/**
 * Creates common edge case tests for mismatch rules
 */
export function createMismatchEdgeCaseTests(
  propertyKey: PropertyKey,
  config: TestConfig,
) {
  const { rule, ruleName } = config;
  const prop = properties[propertyKey];

  // Build the expected method call string
  const expectedMethodCall = getExpectedMethodCall(prop);
  const expectedError = actorPropertyMismatch(
    prop.path.join("."),
    expectedMethodCall,
  );

  // Find a wrong getter for testing
  const wrongGetters = Object.values(properties)
    .filter((p) => p.getter !== prop.getter)
    .map((p) => p.getter);
  const wrongGetter = wrongGetters[0] || "getWrongUri";

  const createLocalPropertyCode = (getter: string) =>
    createPropertyAssignment(prop, { getter });

  return {
    // ✅ Ternary with correct getter in both branches
    "ternary with correct getter in both branches": () => {
      const propCode = createLocalPropertyCode(prop.getter);
      testDenoLint({
        code: createDispatcherCode(
          `return condition
            ? new Person({ id: ctx.getActorUri(identifier), ${propCode} name: "A" })
            : new Person({ id: ctx.getActorUri(identifier), ${propCode} name: "B" });`,
        ),
        rule,
        ruleName,
      });
    },

    // ❌ Ternary with wrong getter in consequent
    "ternary with wrong getter in consequent": () => {
      const correctPropCode = createLocalPropertyCode(prop.getter);
      const wrongPropCode = createLocalPropertyCode(wrongGetter);
      testDenoLint({
        code: createDispatcherCode(
          `return condition
            ? new Person({ id: ctx.getActorUri(identifier), ${wrongPropCode} name: "A" })
            : new Person({ id: ctx.getActorUri(identifier), ${correctPropCode} name: "B" });`,
        ),
        rule,
        ruleName,
        expectedError,
      });
    },

    // ❌ Ternary with wrong getter in alternate
    "ternary with wrong getter in alternate": () => {
      const correctPropCode = createLocalPropertyCode(prop.getter);
      const wrongPropCode = createLocalPropertyCode(wrongGetter);
      testDenoLint({
        code: createDispatcherCode(
          `return condition
            ? new Person({ id: ctx.getActorUri(identifier), ${correctPropCode} name: "A" })
            : new Person({ id: ctx.getActorUri(identifier), ${wrongPropCode} name: "B" });`,
        ),
        rule,
        ruleName,
        expectedError,
      });
    },

    // ❌ Ternary with wrong getter in both
    "ternary with wrong getter in both branches": () => {
      const wrongPropCode = createLocalPropertyCode(wrongGetter);
      testDenoLint({
        code: createDispatcherCode(
          `return condition
            ? new Person({ id: ctx.getActorUri(identifier), ${wrongPropCode} name: "A" })
            : new Person({ id: ctx.getActorUri(identifier), ${wrongPropCode} name: "B" });`,
        ),
        rule,
        ruleName,
        expectedError,
      });
    },

    // ✅ Nested ternary with correct getter
    "nested ternary with correct getter": () => {
      const propCode = createLocalPropertyCode(prop.getter);
      testDenoLint({
        code: createDispatcherCode(
          `return condition1
            ? (condition2
                ? new Person({ id: ctx.getActorUri(identifier), ${propCode} name: "A" })
                : new Person({ id: ctx.getActorUri(identifier), ${propCode} name: "B" }))
            : new Person({ id: ctx.getActorUri(identifier), ${propCode} name: "C" });`,
        ),
        rule,
        ruleName,
      });
    },
  };
}

/**
 * Creates edge case tests for id required rule
 */
export function createIdRequiredEdgeCaseTests(config: TestConfig) {
  const { rule, ruleName } = config;
  const expectedError = actorPropertyRequired(properties.id.name);

  return {
    // ✅ Ternary with id in both branches
    "ternary with id in both branches": () => {
      testDenoLint({
        code: createDispatcherCode(
          `return condition
            ? new Person({ id: ctx.getActorUri(identifier), name: "A" })
            : new Person({ id: ctx.getActorUri(identifier), name: "B" });`,
        ),
        rule,
        ruleName,
      });
    },

    // ❌ Ternary missing id in consequent
    "ternary missing id in consequent": () => {
      testDenoLint({
        code: createDispatcherCode(
          `return condition
            ? new Person({ name: "A" })
            : new Person({ id: ctx.getActorUri(identifier), name: "B" });`,
        ),
        rule,
        ruleName,
        expectedError,
      });
    },

    // ❌ Ternary missing id in alternate
    "ternary missing id in alternate": () => {
      testDenoLint({
        code: createDispatcherCode(
          `return condition
            ? new Person({ id: ctx.getActorUri(identifier), name: "A" })
            : new Person({ name: "B" });`,
        ),
        rule,
        ruleName,
        expectedError,
      });
    },

    // ❌ Ternary missing id in both
    "ternary missing id in both branches": () => {
      testDenoLint({
        code: createDispatcherCode(
          `return condition
            ? new Person({ name: "A" })
            : new Person({ name: "B" });`,
        ),
        rule,
        ruleName,
        expectedError,
      });
    },

    // ✅ Nested ternary with id
    "nested ternary with id": () => {
      testDenoLint({
        code: createDispatcherCode(
          `return condition1
            ? (condition2
                ? new Person({ id: ctx.getActorUri(identifier), name: "A" })
                : new Person({ id: ctx.getActorUri(identifier), name: "B" }))
            : new Person({ id: ctx.getActorUri(identifier), name: "C" });`,
        ),
        rule,
        ruleName,
      });
    },
  };
}

/**
 * Creates edge case tests for id mismatch rule
 */
export function createIdMismatchEdgeCaseTests(config: TestConfig) {
  const { rule, ruleName } = config;
  const expectedError = actorPropertyMismatch(
    properties.id.name,
    properties.id.getter,
  );

  return {
    // ✅ Ternary with correct getter in both branches
    "ternary with correct getter in both branches": () => {
      testDenoLint({
        code: createDispatcherCode(
          `return condition
            ? new Person({ id: ctx.getActorUri(identifier), name: "A" })
            : new Person({ id: ctx.getActorUri(identifier), name: "B" });`,
        ),
        rule,
        ruleName,
      });
    },

    // ❌ Ternary with wrong getter in consequent
    "ternary with wrong getter in consequent": () => {
      testDenoLint({
        code: createDispatcherCode(
          `return condition
            ? new Person({ id: ctx.getFollowingUri(identifier), name: "A" })
            : new Person({ id: ctx.getActorUri(identifier), name: "B" });`,
        ),
        rule,
        ruleName,
        expectedError,
      });
    },

    // ❌ Ternary with wrong getter in alternate
    "ternary with wrong getter in alternate": () => {
      testDenoLint({
        code: createDispatcherCode(
          `return condition
            ? new Person({ id: ctx.getActorUri(identifier), name: "A" })
            : new Person({ id: ctx.getFollowingUri(identifier), name: "B" });`,
        ),
        rule,
        ruleName,
        expectedError,
      });
    },

    // ❌ Ternary with wrong getter in both
    "ternary with wrong getter in both branches": () => {
      testDenoLint({
        code: createDispatcherCode(
          `return condition
            ? new Person({ id: ctx.getFollowingUri(identifier), name: "A" })
            : new Person({ id: ctx.getFollowingUri(identifier), name: "B" });`,
        ),
        rule,
        ruleName,
        expectedError,
      });
    },

    // ✅ Nested ternary with correct getter
    "nested ternary with correct getter": () => {
      testDenoLint({
        code: createDispatcherCode(
          `return condition1
            ? (condition2
                ? new Person({ id: ctx.getActorUri(identifier), name: "A" })
                : new Person({ id: ctx.getActorUri(identifier), name: "B" }))
            : new Person({ id: ctx.getActorUri(identifier), name: "C" });`,
        ),
        rule,
        ruleName,
      });
    },
  };
}

/**
 * Creates edge case tests for key required rules (publicKey, assertionMethod)
 */
export function createKeyRequiredEdgeCaseTests(
  propertyName: "publicKey" | "assertionMethod",
  config: TestConfig,
) {
  const { rule, ruleName } = config;
  const expectedError = actorPropertyRequired(propertyName);

  const createPropertyCode = () =>
    `${propertyName}: ctx.getActorKeyPairs(identifier),`;

  return {
    // ✅ Ternary with property in both branches
    "ternary with property in both branches": () => {
      const propCode = createPropertyCode();
      testDenoLint({
        code: createChainedDispatcherCode(
          `return condition
            ? new Person({ id: ctx.getActorUri(identifier), ${propCode} name: "A" })
            : new Person({ id: ctx.getActorUri(identifier), ${propCode} name: "B" });`,
          "setKeyPairsDispatcher",
        ),
        rule,
        ruleName,
      });
    },

    // ❌ Ternary missing property in consequent
    "ternary missing property in consequent": () => {
      const propCode = createPropertyCode();
      testDenoLint({
        code: createChainedDispatcherCode(
          `return condition
            ? new Person({ id: ctx.getActorUri(identifier), name: "A" })
            : new Person({ id: ctx.getActorUri(identifier), ${propCode} name: "B" });`,
          "setKeyPairsDispatcher",
        ),
        rule,
        ruleName,
        expectedError,
      });
    },

    // ❌ Ternary missing property in alternate
    "ternary missing property in alternate": () => {
      const propCode = createPropertyCode();
      testDenoLint({
        code: createChainedDispatcherCode(
          `return condition
            ? new Person({ id: ctx.getActorUri(identifier), ${propCode} name: "A" })
            : new Person({ id: ctx.getActorUri(identifier), name: "B" });`,
          "setKeyPairsDispatcher",
        ),
        rule,
        ruleName,
        expectedError,
      });
    },

    // ❌ Ternary missing property in both
    "ternary missing property in both branches": () => {
      testDenoLint({
        code: createChainedDispatcherCode(
          `return condition
            ? new Person({ id: ctx.getActorUri(identifier), name: "A" })
            : new Person({ id: ctx.getActorUri(identifier), name: "B" });`,
          "setKeyPairsDispatcher",
        ),
        rule,
        ruleName,
        expectedError,
      });
    },

    // ✅ Nested ternary with property
    "nested ternary with property": () => {
      const propCode = createPropertyCode();
      testDenoLint({
        code: createChainedDispatcherCode(
          `return condition1
            ? (condition2
                ? new Person({ id: ctx.getActorUri(identifier), ${propCode} name: "A" })
                : new Person({ id: ctx.getActorUri(identifier), ${propCode} name: "B" }))
            : new Person({ id: ctx.getActorUri(identifier), ${propCode} name: "C" });`,
          "setKeyPairsDispatcher",
        ),
        rule,
        ruleName,
      });
    },
  };
}

// =============================================================================
// Test Runner Utilities
// =============================================================================

/**
 * Runs all tests from a test object
 */
export function runTests(
  tests: Record<string, () => void>,
  ruleName: string,
  prefix: string,
) {
  const { test } = require("node:test");
  for (const [name, testFn] of Object.entries(tests)) {
    test(`${ruleName}: ${prefix} - ${name}`, testFn);
  }
}
