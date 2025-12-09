/**
 * ESLint rule factory for creating Fedify lint rules.
 * Adapts common rule logic to ESLint's API.
 */
import {
  filter,
  isArray,
  isEmpty,
  isNil,
  isObject,
  negate,
  pipe,
  pipeLazy,
  prop,
  some,
  toArray,
} from "@fxts/core";
import type { TSESLint, TSESTree } from "@typescript-eslint/utils";
import type { ASTNode, CallExpression, FunctionNode } from "./ast-types.ts";
import {
  allOf,
  hasIdentifierKey,
  hasIdentifierProperty,
  hasMemberExpressionCallee,
  hasMethodName,
  hasMinArguments,
  isASTNode,
  isFunction,
  isNodeName,
  isNodeType,
  isSetActorDispatcherCall,
} from "./common-pred.ts";
import { trackFederationVariables } from "./common-tracker.ts";
import {
  actorPropertyMismatch,
  actorPropertyRequired,
  COLLECTION_FILTERING_NOT_IMPLEMENTED_ERROR,
} from "./messages.ts";
import type { MethodCallContext, PropertyConfig } from "./types.ts";
import { eq } from "./utils.ts";

// ============================================================================
// Types
// ============================================================================

type ESLintRuleContext = TSESLint.RuleContext<string, unknown[]>;

interface ActorDispatcherInfo {
  node: CallExpression;
  dispatcherArg: FunctionNode;
}

// ============================================================================
// Property Checkers
// ============================================================================

/**
 * Checks if a value is a valid AST node object.
 */
const isASTNodeObj = (node: unknown): node is ASTNode =>
  isObject(node) && !isNil(node);

/**
 * Filters and casts array items to ASTNode.
 */
const filterASTNodes = (items: unknown[]): ASTNode[] =>
  pipe(
    items,
    filter(isObject),
    filter((p): p is ASTNode => !isNil(p)),
    toArray,
  );

const isIdentifierWithName =
  <T extends string>(name: T) =>
  <N extends ASTNode>(node: N): node is N & { type: "Identifier"; name: T } =>
    allOf(isNodeType("Identifier"), isNodeName(name))(node);

const isPropertyWithKeyName = (path: string) =>
(
  node: ASTNode,
): node is { type: "Property"; key: { name: string } & ASTNode } & ASTNode =>
  allOf(
    isNodeType("Property"),
    hasIdentifierKey,
    pipeLazy(
      prop("key")<{ key: { name: string } }>,
      prop("name"),
      eq(path),
    ) as (value: unknown) => boolean,
  )(node);

// ============================================================================
// Required Rule Property Checker
// ============================================================================

/**
 * Creates a predicate function that checks if a property has a specific name.
 */
const createPropertyChecker =
  <T extends string>(propertyName: T) => (node: unknown): boolean =>
    isASTNode(node) && isPropertyWithKeyName(propertyName)(node);

/**
 * Internal recursive checker for nested property paths.
 */
const checkNestedPropertyPath =
  (path: readonly string[]) => (node: unknown): boolean => {
    if (!isASTNode(node) || !isPropertyWithKeyName(path[0])(node)) return false;
    if (path.length === 1) return true;

    const value = (node as { value: ASTNode }).value;

    // Handle ObjectExpression: endpoints: { sharedInbox: ... }
    if (isNodeType("ObjectExpression")(value)) {
      return pipe(
        (value as { properties: unknown[] }).properties,
        filterASTNodes,
        some(checkNestedPropertyPath(path.slice(1))),
      );
    }

    // Handle NewExpression: endpoints: new Endpoints({ sharedInbox: ... })
    if (isNodeType("NewExpression")(value)) {
      const args = (value as { arguments: unknown[] }).arguments;
      if (!isArray(args) || args.length === 0) return false;
      const firstArg = args[0];
      if (
        !isASTNodeObj(firstArg) || !isNodeType("ObjectExpression")(firstArg)
      ) {
        return false;
      }
      return pipe(
        (firstArg as { properties: unknown[] }).properties,
        filterASTNodes,
        some(checkNestedPropertyPath(path.slice(1))),
      );
    }

    return false;
  };

/**
 * Creates a predicate function that checks if a nested property exists.
 */
const createNestedPropertyChecker =
  (path: readonly string[]) => (node: unknown): boolean =>
    checkNestedPropertyPath(path)(node);

/**
 * Checks if an ObjectExpression node contains a property.
 */
const checkObjectExpression =
  (propertyChecker: (prop: unknown) => boolean) => (obj: ASTNode): boolean =>
    pipe(
      obj as { properties: unknown[] },
      prop("properties"),
      (properties) =>
        Array.isArray(properties)
          ? pipe(properties, filter(isASTNode), some(propertyChecker))
          : false,
    );

/**
 * Extracts the first argument if it's an ObjectExpression.
 */
const extractFirstArgument = (node: ASTNode): ASTNode | null =>
  pipe(
    node as { arguments: unknown[] },
    prop("arguments"),
    (args) => {
      if (!Array.isArray(args) || args.length === 0) return null;
      const firstArg = args[0];
      return isASTNode(firstArg) && isNodeType("ObjectExpression")(firstArg)
        ? firstArg
        : null;
    },
  );

/**
 * Extracts ObjectExpression from NewExpression.
 */
const extractObjectExpression = (arg: ASTNode): ASTNode | null => {
  if (isNodeType("NewExpression")(arg)) return extractFirstArgument(arg);
  return null;
};

/**
 * Checks if a ConditionalExpression has the property in both branches.
 */
const checkConditionalExpression =
  (propertyChecker: (prop: unknown) => boolean) => (node: ASTNode): boolean => {
    const consequent = (node as { consequent: ASTNode }).consequent;
    const alternate = (node as { alternate: ASTNode }).alternate;

    const checkBranch = (branch: ASTNode): boolean => {
      if (isNodeType("ConditionalExpression")(branch)) {
        return checkConditionalExpression(propertyChecker)(branch);
      }
      const objExpr = extractObjectExpression(branch);
      return objExpr ? checkObjectExpression(propertyChecker)(objExpr) : false;
    };

    return checkBranch(consequent) && checkBranch(alternate);
  };

/**
 * Checks if a ReturnStatement node contains a property.
 */
const checkReturnStatement =
  (propertyChecker: (prop: unknown) => boolean) => (node: ASTNode): boolean => {
    const arg = (node as { argument: ASTNode | null }).argument;
    if (!arg || !isASTNode(arg)) return false;

    if (isNodeType("ConditionalExpression")(arg)) {
      return checkConditionalExpression(propertyChecker)(arg);
    }

    const objExpr = extractObjectExpression(arg);
    return objExpr ? checkObjectExpression(propertyChecker)(objExpr) : false;
  };

/**
 * Creates a function that recursively checks for a property in an AST node.
 */
const createPropertySearcher =
  (propertyChecker: (prop: unknown) => boolean) => (node: unknown): boolean => {
    if (!isASTNode(node)) return false;

    if (isNodeType("ReturnStatement")(node)) {
      return checkReturnStatement(propertyChecker)(node);
    }

    if (isNodeType("BlockStatement")(node)) {
      return (node as { body: unknown[] }).body.some(
        createPropertySearcher(propertyChecker),
      );
    }

    // Handle arrow function with direct NewExpression body
    if (isNodeType("NewExpression")(node)) {
      const objExpr = extractFirstArgument(node);
      return objExpr ? checkObjectExpression(propertyChecker)(objExpr) : false;
    }

    return false;
  };

// ============================================================================
// Mismatch Rule Value Checker
// ============================================================================

/**
 * Checks if a node is a CallExpression calling the expected context method.
 */
const isExpectedMethodCall = (
  node: ASTNode,
  { ctxName, idName, methodName, requiresIdentifier }: MethodCallContext,
): boolean => {
  if (
    !isNodeType("CallExpression")(node) ||
    !hasMemberExpressionCallee(node as unknown as CallExpression) ||
    !isIdentifierWithName(ctxName)(
      ((node as unknown as CallExpression).callee as { object: ASTNode })
        .object,
    ) ||
    !isIdentifierWithName(methodName)(
      ((node as unknown as CallExpression).callee as { property: ASTNode })
        .property,
    )
  ) return false;

  const args = (node as unknown as CallExpression).arguments;
  if (!requiresIdentifier) {
    return isEmpty(args);
  }
  return !isEmpty(args) && some(isIdentifierWithName(idName))(args);
};

/**
 * Creates a property existence checker for the given property path.
 */
const createPropertyExistenceChecker = (path: readonly string[]) => {
  const checkPropertyExists =
    (path: readonly string[]) => (node: ASTNode): boolean => {
      if (!isPropertyWithKeyName(path[0])(node)) return false;
      if (path.length === 1) return true;

      const value = (node as { value: ASTNode }).value;

      if (isNodeType("ObjectExpression")(value)) {
        return pipe(
          (value as { properties: unknown[] }).properties,
          filterASTNodes,
          some(checkPropertyExists(path.slice(1))),
        );
      }

      if (isNodeType("NewExpression")(value)) {
        const args = (value as { arguments: unknown[] }).arguments;
        if (!isArray(args) || args.length === 0) return false;
        const firstArg = args[0];
        if (
          !isASTNodeObj(firstArg) || !isNodeType("ObjectExpression")(firstArg)
        ) {
          return false;
        }
        return pipe(
          (firstArg as { properties: unknown[] }).properties,
          filterASTNodes,
          some(checkPropertyExists(path.slice(1))),
        );
      }

      return false;
    };

  return (prop: ASTNode): boolean =>
    allOf(isASTNodeObj, checkPropertyExists(path))(prop);
};

/**
 * Creates a property value checker for the given property path.
 */
const createPropertyValueChecker = (
  path: readonly string[],
  ctx: MethodCallContext,
) => {
  const checkPropertyValue =
    (path: readonly string[]) => (prop: ASTNode): boolean => {
      if (!isPropertyWithKeyName(path[0])(prop)) return false;

      const value = (prop as { value: ASTNode }).value;
      if (path.length === 1) {
        return isExpectedMethodCall(value, ctx);
      }

      if (isNodeType("ObjectExpression")(value)) {
        return pipe(
          (value as { properties: unknown[] }).properties,
          filterASTNodes,
          some(checkPropertyValue(path.slice(1))),
        );
      }

      if (isNodeType("NewExpression")(value)) {
        const args = (value as { arguments: unknown[] }).arguments;
        if (!isArray(args) || args.length === 0) return false;
        const firstArg = args[0];
        if (
          !isASTNodeObj(firstArg) || !isNodeType("ObjectExpression")(firstArg)
        ) {
          return false;
        }
        return pipe(
          (firstArg as { properties: unknown[] }).properties,
          filterASTNodes,
          some(checkPropertyValue(path.slice(1))),
        );
      }

      return false;
    };

  return (prop: ASTNode): boolean =>
    allOf(isASTNodeObj, checkPropertyValue(path))(prop);
};

/**
 * Checks if a function body contains the correct property value.
 */
const checkFunctionBody =
  (propertyChecker: (prop: ASTNode) => boolean) => (node: ASTNode): boolean => {
    if (!isASTNodeObj(node)) return false;

    if (isNodeType("ReturnStatement")(node)) {
      const arg = (node as { argument: ASTNode | null }).argument;
      if (!arg || !isASTNodeObj(arg)) return false;

      if (isNodeType("ConditionalExpression")(arg)) {
        const checkBranch = (branch: ASTNode): boolean => {
          if (isNodeType("ConditionalExpression")(branch)) {
            return checkFunctionBody(propertyChecker)(branch);
          }
          if (isNodeType("NewExpression")(branch)) {
            return (branch as { arguments: unknown[] }).arguments
              .filter(isNodeType("ObjectExpression"))
              .some(checkObjectExpression(propertyChecker));
          }
          return false;
        };
        return (
          checkBranch((arg as { consequent: ASTNode }).consequent) &&
          checkBranch((arg as { alternate: ASTNode }).alternate)
        );
      }

      if (isNodeType("NewExpression")(arg)) {
        return (arg as { arguments: unknown[] }).arguments
          .filter(isNodeType("ObjectExpression"))
          .some(checkObjectExpression(propertyChecker));
      }

      return false;
    }

    if (
      isNodeType("BlockStatement")(node) &&
      Array.isArray((node as { body: unknown[] }).body)
    ) {
      return (node as { body: ASTNode[] }).body.some(
        checkFunctionBody(propertyChecker),
      );
    }

    if (isNodeType("NewExpression")(node)) {
      return (node as { arguments: unknown[] }).arguments
        .filter(isNodeType("ObjectExpression"))
        .some(checkObjectExpression(propertyChecker));
    }

    if (isNodeType("ConditionalExpression")(node)) {
      const checkBranch = (branch: ASTNode): boolean => {
        if (isNodeType("ConditionalExpression")(branch)) {
          return checkFunctionBody(propertyChecker)(branch);
        }
        if (isNodeType("NewExpression")(branch)) {
          return (branch as { arguments: unknown[] }).arguments
            .filter(isNodeType("ObjectExpression"))
            .some(checkObjectExpression(propertyChecker));
        }
        return false;
      };
      return (
        checkBranch((node as { consequent: ASTNode }).consequent) &&
        checkBranch((node as { alternate: ASTNode }).alternate)
      );
    }

    return false;
  };

/**
 * Extracts parameter names from a function.
 */
const extractParams = (
  fn: FunctionNode,
): [string | null, string | null] => {
  const params = (fn as { params: ASTNode[] }).params;
  if (params.length < 2) return [null, null];

  return params.slice(0, 2).map((node) =>
    isNodeType("Identifier")(node) ? (node as { name: string }).name : null
  ) as [string | null, string | null];
};

// ============================================================================
// Dispatcher Tracker
// ============================================================================

/**
 * Tracks dispatcher method calls on federation objects.
 */
const createDispatcherTracker = (
  dispatcherMethod: string,
  federationTracker: ReturnType<typeof trackFederationVariables>,
) => {
  let dispatcherConfigured = false;

  const isDispatcherMethodCall = (node: CallExpression): boolean =>
    allOf(
      hasMemberExpressionCallee,
      hasIdentifierProperty,
      hasMethodName(dispatcherMethod),
    )(
      node as unknown as {
        callee: { property: { name: string }; object: ASTNode };
      } & CallExpression,
    );

  return {
    isDispatcherConfigured: () => dispatcherConfigured,
    checkDispatcherCall: (node: CallExpression) => {
      if (
        isDispatcherMethodCall(node) &&
        federationTracker.isFederationObject(
          (node.callee as { object: ASTNode }).object,
        )
      ) {
        dispatcherConfigured = true;
      }
    },
  };
};

// ============================================================================
// ESLint Rule Factory: Required Rules
// ============================================================================

/**
 * Creates an ESLint rule that checks if a property is required.
 */
export function createESLintRequiredRule(
  ruleId: string,
  config: PropertyConfig,
): TSESLint.RuleModule<string, unknown[]> {
  const propertyChecker = config.path.length === 1
    ? createPropertyChecker(config.path[0])
    : createNestedPropertyChecker(config.path);
  const propertySearcher = createPropertySearcher(propertyChecker);

  return {
    meta: {
      type: "suggestion",
      docs: {
        description: `Ensure actor dispatcher returns ${
          config.path.join(".")
        } property`,
      },
      schema: [],
      messages: {
        required: "{{ message }}",
      },
    },
    defaultOptions: [],
    create(context: ESLintRuleContext) {
      const federationTracker = trackFederationVariables();
      const dispatcherTracker = createDispatcherTracker(
        config.setter,
        federationTracker,
      );
      const actorDispatchers: ActorDispatcherInfo[] = [];

      return {
        VariableDeclarator(node: TSESTree.VariableDeclarator) {
          federationTracker.VariableDeclarator(
            node as unknown as ASTNode & {
              id: ASTNode;
              init: ASTNode | null;
            },
          );
        },

        CallExpression(node: TSESTree.CallExpression) {
          const callNode = node as unknown as CallExpression;
          dispatcherTracker.checkDispatcherCall(callNode);

          if (!isSetActorDispatcherCall(callNode)) return;
          if (
            !federationTracker.isFederationObject(
              (callNode.callee as { object: ASTNode }).object,
            )
          ) return;

          const dispatcherArg = callNode.arguments[1] as unknown as ASTNode;
          if (isFunction(dispatcherArg)) {
            actorDispatchers.push({
              node: callNode,
              dispatcherArg: dispatcherArg as FunctionNode,
            });
          }
        },

        "Program:exit"() {
          if (!dispatcherTracker.isDispatcherConfigured()) return;

          for (const { dispatcherArg } of actorDispatchers) {
            const body = (dispatcherArg as { body: ASTNode }).body;
            if (!propertySearcher(body)) {
              context.report({
                node: dispatcherArg as unknown as TSESTree.Node,
                messageId: "required",
                data: { message: actorPropertyRequired(config) },
              });
            }
          }
        },
      };
    },
  };
}

// ============================================================================
// ESLint Rule Factory: Mismatch Rules
// ============================================================================

/**
 * Creates an ESLint rule that checks if a property uses the correct context method.
 */
export function createESLintMismatchRule(
  ruleId: string,
  config: PropertyConfig,
): TSESLint.RuleModule<string, unknown[]> {
  return {
    meta: {
      type: "problem",
      docs: {
        description: `Ensure actor's ${
          config.path.join(".")
        } property uses correct context method`,
      },
      schema: [],
      messages: {
        mismatch: "{{ message }}",
      },
    },
    defaultOptions: [],
    create(context: ESLintRuleContext) {
      const tracker = trackFederationVariables();

      return {
        VariableDeclarator(node: TSESTree.VariableDeclarator) {
          tracker.VariableDeclarator(
            node as unknown as ASTNode & {
              id: ASTNode;
              init: ASTNode | null;
            },
          );
        },

        CallExpression(node: TSESTree.CallExpression) {
          const callNode = node as unknown as CallExpression;

          if (
            !isSetActorDispatcherCall(callNode) ||
            !hasMemberExpressionCallee(callNode) ||
            !tracker.isFederationObject(
              (callNode.callee as { object: ASTNode }).object,
            )
          ) return;

          const dispatcherArg = callNode.arguments[1] as unknown as ASTNode;
          if (!isFunction(dispatcherArg)) return;

          const [ctxName, idName] = extractParams(
            dispatcherArg as FunctionNode,
          );
          if (!ctxName || !idName) return;

          const methodCallContext: MethodCallContext = {
            path: config.path.join("."),
            ctxName,
            idName,
            methodName: config.getter,
            requiresIdentifier: config.requiresIdentifier,
          };

          const body = (dispatcherArg as { body: ASTNode }).body;
          const existenceChecker = createPropertyExistenceChecker(config.path);
          const hasProperty = checkFunctionBody(existenceChecker)(body);

          if (!hasProperty) return;

          const valueChecker = createPropertyValueChecker(
            config.path,
            methodCallContext,
          );
          const hasCorrectValue = checkFunctionBody(valueChecker)(body);

          if (!hasCorrectValue) {
            context.report({
              node: dispatcherArg as unknown as TSESTree.Node,
              messageId: "mismatch",
              data: { message: actorPropertyMismatch(methodCallContext) },
            });
          }
        },
      };
    },
  };
}

// ============================================================================
// ESLint Rule Factory: Collection Filtering
// ============================================================================

const FOLLOWERS_DISPATCHER_METHOD = "setFollowersDispatcher" as const;

/**
 * Checks if a node is a setFollowersDispatcher call.
 */
const isFollowersDispatcherCall = (node: CallExpression): boolean =>
  allOf(
    hasMemberExpressionCallee,
    hasIdentifierProperty,
    hasMinArguments(2),
    hasMethodName(FOLLOWERS_DISPATCHER_METHOD),
  )(
    node as unknown as {
      callee: { property: { name: string }; object: ASTNode };
    } & CallExpression,
  );

/**
 * Checks if a function node has the filter parameter (4th parameter).
 */
const hasFilterParameter = (fn: FunctionNode): boolean =>
  (fn as { params: unknown[] }).params.length >= 4;

/**
 * Creates the collection-filtering-not-implemented ESLint rule.
 */
export function createESLintCollectionFilteringRule(
  ruleId: string,
): TSESLint.RuleModule<string, unknown[]> {
  return {
    meta: {
      type: "suggestion",
      docs: {
        description: "Ensure followers dispatcher implements filtering",
      },
      schema: [],
      messages: {
        filterRequired: COLLECTION_FILTERING_NOT_IMPLEMENTED_ERROR,
      },
    },
    defaultOptions: [],
    create(context: ESLintRuleContext) {
      const federationTracker = trackFederationVariables();

      return {
        VariableDeclarator(node: TSESTree.VariableDeclarator) {
          federationTracker.VariableDeclarator(
            node as unknown as ASTNode & {
              id: ASTNode;
              init: ASTNode | null;
            },
          );
        },

        CallExpression(node: TSESTree.CallExpression) {
          const callNode = node as unknown as CallExpression;

          if (!isFollowersDispatcherCall(callNode)) return;
          if (
            !federationTracker.isFederationObject(
              (callNode.callee as { object: ASTNode }).object,
            )
          ) return;

          const dispatcherArg = callNode.arguments[1] as unknown as ASTNode;
          if (!isFunction(dispatcherArg)) return;

          if (!hasFilterParameter(dispatcherArg as FunctionNode)) {
            context.report({
              node: dispatcherArg as unknown as TSESTree.Node,
              messageId: "filterRequired",
            });
          }
        },
      };
    },
  };
}
