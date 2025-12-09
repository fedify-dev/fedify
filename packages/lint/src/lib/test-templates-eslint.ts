/**
 * ESLint test templates for generating test cases.
 * Reuses patterns from Deno lint test templates.
 */
import { properties, type PropertyConfig } from "./const.ts";
import type { ESLintInvalidTestCase, ESLintTestCase } from "./test-eslint.ts";
import { invalidCase, validCase } from "./test-eslint.ts";

// =============================================================================
// Types
// =============================================================================

type PropertyKey = keyof typeof properties;

// =============================================================================
// Common Code Snippets
// =============================================================================

const createDispatcherCode = (content: string): string => `
  federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
    ${content}
  });
`;

const createChainedDispatcherCode = (
  content: string,
  dispatcherMethod: string,
): string => `
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
): string => {
  const dispatcher =
    `federation.${dispatcherMethod}(async (ctx, identifier) => []);`;
  const actor = createDispatcherCode(content);
  return isBefore ? `${dispatcher}\n${actor}` : `${actor}\n${dispatcher}`;
};

// =============================================================================
// Property Code Generation Utilities
// =============================================================================

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

const createPropertyAssignment = (
  prop: PropertyConfig,
  ctxName = "ctx",
  idName = "identifier",
): string => {
  const methodCall = createMethodCall(
    prop.getter,
    prop.requiresIdentifier,
    ctxName,
    idName,
  );

  if (prop.path.length === 1) {
    return `${prop.path[0]}: ${methodCall},`;
  }

  // Handle nested properties like endpoints.sharedInbox
  if (prop.path.length === 2 && prop.path[0] === "endpoints") {
    return `endpoints: new Endpoints({ ${prop.path[1]}: ${methodCall} }),`;
  }

  return `${prop.path[prop.path.length - 1]}: ${methodCall},`;
};

const createReturnStatement = (properties: string): string =>
  `return new Person({ ${properties} });`;

// =============================================================================
// Required Rule Test Cases
// =============================================================================

export function createRequiredValidCases(
  propKey: PropertyKey,
): ESLintTestCase[] {
  const prop = properties[propKey];
  const propertyCode = createPropertyAssignment(prop);

  return [
    // Non-federation object
    validCase(
      "setActorDispatcher called on non-Federation object",
      `
        federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
          return new Person({ name: "John Doe" });
        });
      `,
      `const federation = { setActorDispatcher: () => {} };`,
    ),

    // With property using method
    validCase(
      `with ${prop.path.join(".")} property using ctx.${prop.getter}()`,
      createDispatcherCode(
        createReturnStatement(`name: "John Doe", ${propertyCode}`),
      ),
    ),

    // With property using hardcoded value (for required rules, any value is fine)
    validCase(
      `with ${prop.path.join(".")} property (any value)`,
      createDispatcherCode(
        createReturnStatement(
          `name: "John Doe", ${prop.path[prop.path.length - 1]}: "https://example.com/value"`,
        ),
      ),
    ),

    // BlockStatement with property
    validCase(
      `BlockStatement with ${prop.path.join(".")}`,
      createDispatcherCode(`
        const name = "John Doe";
        ${createReturnStatement(`name, ${propertyCode}`)}
      `),
    ),
  ];
}

export function createRequiredInvalidCases(
  propKey: PropertyKey,
  messageId: string,
): ESLintInvalidTestCase[] {
  const prop = properties[propKey];

  // For properties with setter !== setActorDispatcher, we need to add the
  // dispatcher call to trigger the rule
  if (prop.setter !== "setActorDispatcher") {
    const dispatcherMethod =
      prop.setter === "setInboxListeners" ? "setInboxListeners" : prop.setter;

    return [
      // Chained dispatcher case - this triggers the rule
      invalidCase(
        `chained ${dispatcherMethod} without ${prop.path.join(".")}`,
        createChainedDispatcherCode(
          createReturnStatement(`name: "John Doe"`),
          dispatcherMethod,
        ),
        messageId,
      ),

      // Separate dispatcher before
      invalidCase(
        `separate ${dispatcherMethod} before without ${prop.path.join(".")}`,
        createSeparateDispatcherCode(
          createReturnStatement(`name: "John Doe"`),
          dispatcherMethod,
          true,
        ),
        messageId,
      ),

      // Separate dispatcher after
      invalidCase(
        `separate ${dispatcherMethod} after without ${prop.path.join(".")}`,
        createSeparateDispatcherCode(
          createReturnStatement(`name: "John Doe"`),
          dispatcherMethod,
          false,
        ),
        messageId,
      ),
    ];
  }

  // For id property (setter === setActorDispatcher), use basic cases
  return [
    // Without property
    invalidCase(
      `without ${prop.path.join(".")} property`,
      createDispatcherCode(createReturnStatement(`name: "John Doe"`)),
      messageId,
    ),

    // Empty object
    invalidCase(
      "returning empty object",
      createDispatcherCode(createReturnStatement("")),
      messageId,
    ),
  ];
}

// =============================================================================
// Mismatch Rule Test Cases
// =============================================================================

export function createMismatchValidCases(
  propKey: PropertyKey,
): ESLintTestCase[] {
  const prop = properties[propKey];
  const propertyCode = createPropertyAssignment(prop);

  // Helper to create wrong property assignment for valid cases
  const createWrongPropertyCode = (value: string): string => {
    if (prop.path.length === 1) {
      return `${prop.path[0]}: ${value}`;
    }
    // Handle nested properties like endpoints.sharedInbox
    return `endpoints: new Endpoints({ ${prop.path[1]}: ${value} })`;
  };

  return [
    // Non-federation object
    validCase(
      "setActorDispatcher called on non-Federation object",
      createDispatcherCode(
        createReturnStatement(
          `name: "John Doe", ${createWrongPropertyCode('"https://example.com/wrong"')}`,
        ),
      ),
      `const federation = { setActorDispatcher: () => {} };`,
    ),

    // Correct method call
    validCase(
      `${prop.path.join(".")} uses ctx.${prop.getter}()`,
      createDispatcherCode(
        createReturnStatement(`name: "John Doe", ${propertyCode}`),
      ),
    ),

    // BlockStatement with correct method
    validCase(
      `BlockStatement with correct ${prop.path.join(".")}`,
      createDispatcherCode(`
        const name = "John Doe";
        ${createReturnStatement(`name, ${propertyCode}`)}
      `),
    ),

    // No property at all (let required rule handle this)
    validCase(
      `no ${prop.path.join(".")} property (required rule handles this)`,
      createDispatcherCode(createReturnStatement(`name: "John Doe"`)),
    ),
  ];
}

export function createMismatchInvalidCases(
  propKey: PropertyKey,
  messageId: string,
): ESLintInvalidTestCase[] {
  const prop = properties[propKey];

  // Helper to create wrong property assignment
  const createWrongPropertyAssignment = (value: string): string => {
    if (prop.path.length === 1) {
      return `${prop.path[0]}: ${value}`;
    }
    // Handle nested properties like endpoints.sharedInbox
    return `endpoints: new Endpoints({ ${prop.path[1]}: ${value} })`;
  };

  return [
    // Hardcoded string
    invalidCase(
      `${prop.path.join(".")} uses hardcoded string`,
      createDispatcherCode(
        createReturnStatement(
          `name: "John Doe", ${createWrongPropertyAssignment('"https://example.com/wrong"')}`,
        ),
      ),
      messageId,
    ),

    // Wrong method
    invalidCase(
      `${prop.path.join(".")} uses wrong method`,
      createDispatcherCode(
        createReturnStatement(
          `name: "John Doe", ${createWrongPropertyAssignment("ctx.getWrongMethod()")}`,
        ),
      ),
      messageId,
    ),
  ];
}

// =============================================================================
// Collection Filtering Test Cases
// =============================================================================

const createFollowersDispatcherCode = (
  {
    params = ["ctx", "identifier", "cursor", "filter"],
    async: isAsync = true,
    arrow = true,
  }: {
    params?: readonly string[];
    async?: boolean;
    arrow?: boolean;
  } = {},
): string => {
  const paramsString = params.join(", ");
  const asyncKeyword = isAsync ? "async" : "";
  const [funcKeyword, arrowSymbol] = arrow ? ["", "=>"] : ["function", ""];

  return `
    federation.setFollowersDispatcher(
      "/users/{identifier}/followers",
      ${asyncKeyword} ${funcKeyword}(${paramsString}) ${arrowSymbol} {
        return { items: [] };
      }
    );
  `;
};

const filterless = ["ctx", "identifier", "cursor"] as const;

export function createCollectionFilteringValidCases(): ESLintTestCase[] {
  return [
    validCase(
      "async arrow function with filter parameter",
      createFollowersDispatcherCode(),
    ),
    validCase(
      "async function expression with filter",
      createFollowersDispatcherCode({ arrow: false }),
    ),
    validCase(
      "sync arrow function with filter",
      createFollowersDispatcherCode({ async: false }),
    ),
    validCase(
      "sync function expression with filter",
      createFollowersDispatcherCode({ async: false, arrow: false }),
    ),
  ];
}

export function createCollectionFilteringInvalidCases(
  messageId: string,
): ESLintInvalidTestCase[] {
  return [
    invalidCase(
      "async arrow function without filter parameter",
      createFollowersDispatcherCode({ params: filterless }),
      messageId,
    ),
    invalidCase(
      "async function expression without filter",
      createFollowersDispatcherCode({ params: filterless, arrow: false }),
      messageId,
    ),
    invalidCase(
      "sync arrow function without filter",
      createFollowersDispatcherCode({ params: filterless, async: false }),
      messageId,
    ),
    invalidCase(
      "sync function expression without filter",
      createFollowersDispatcherCode({
        params: filterless,
        async: false,
        arrow: false,
      }),
      messageId,
    ),
  ];
}
