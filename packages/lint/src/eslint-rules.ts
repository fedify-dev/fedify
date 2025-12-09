/**
 * ESLint rule factories for Fedify lint rules.
 * Uses TSESTree types from @typescript-eslint/utils.
 */
import type { TSESLint, TSESTree } from "@typescript-eslint/utils";
import {
  actorPropertyMismatch,
  actorPropertyRequired,
  COLLECTION_FILTERING_NOT_IMPLEMENTED_ERROR,
} from "./lib/messages.ts";
import {
  createPropertyExistenceChecker,
  createPropertyValueChecker,
  extractFunctionParams,
  hasMinParams,
  searchFunctionBody,
} from "./lib/property-checker-eslint.ts";
import type { MethodCallContext, PropertyConfig } from "./lib/types.ts";

// ============================================================================
// Types
// ============================================================================

type RuleContext = TSESLint.RuleContext<string, unknown[]>;
type RuleModule = TSESLint.RuleModule<string, unknown[]>;
type CallExpression = TSESTree.CallExpression;
type MemberExpression = TSESTree.MemberExpression;
type Identifier = TSESTree.Identifier;
type VariableDeclarator = TSESTree.VariableDeclarator;
type Expression = TSESTree.Expression;
type FunctionNode =
  | TSESTree.ArrowFunctionExpression
  | TSESTree.FunctionExpression;

// ============================================================================
// Federation Variable Tracker
// ============================================================================

const isCreateFederationCall = (node: CallExpression): boolean =>
  node.callee.type === "Identifier" &&
  /^create(Federation|FederationBuilder)$/i.test(node.callee.name);

interface FederationTracker {
  handleVariableDeclarator(node: VariableDeclarator): void;
  isFederationObject(node: Expression): boolean;
}

function createFederationTracker(): FederationTracker {
  const federationVariables = new Set<string>();

  const isFederationObject = (node: Expression): boolean => {
    switch (node.type) {
      case "Identifier":
        return federationVariables.has(node.name);
      case "CallExpression":
        if (isCreateFederationCall(node)) return true;
        if (node.callee.type === "MemberExpression") {
          return isFederationObject(node.callee.object);
        }
        return false;
      case "MemberExpression":
        return isFederationObject(node.object);
      default:
        return false;
    }
  };

  return {
    handleVariableDeclarator(node: VariableDeclarator): void {
      if (
        node.init?.type === "CallExpression" &&
        isCreateFederationCall(node.init) &&
        node.id.type === "Identifier"
      ) {
        federationVariables.add(node.id.name);
      }
    },
    isFederationObject,
  };
}

// ============================================================================
// CallExpression Helpers
// ============================================================================

interface CallMemberExpression extends CallExpression {
  callee: MemberExpression & { property: Identifier };
}

function isCallMemberExpression(
  node: CallExpression,
): node is CallMemberExpression {
  return (
    node.callee.type === "MemberExpression" &&
    node.callee.property.type === "Identifier"
  );
}

function hasMethodName(
  node: CallMemberExpression,
  name: string,
): boolean {
  return node.callee.property.name === name;
}

function isSetActorDispatcherCall(
  node: CallExpression,
): node is CallMemberExpression {
  return (
    isCallMemberExpression(node) &&
    hasMethodName(node, "setActorDispatcher") &&
    node.arguments.length >= 2
  );
}

function isSetFollowersDispatcherCall(
  node: CallExpression,
): node is CallMemberExpression {
  return (
    isCallMemberExpression(node) &&
    hasMethodName(node, "setFollowersDispatcher") &&
    node.arguments.length >= 2
  );
}

function isFunction(node: TSESTree.Node): node is FunctionNode {
  return (
    node.type === "ArrowFunctionExpression" ||
    node.type === "FunctionExpression"
  );
}

// ============================================================================
// Dispatcher Tracker
// ============================================================================

interface DispatcherTracker {
  isConfigured(): boolean;
  checkCall(node: CallExpression, tracker: FederationTracker): void;
}

function createDispatcherTracker(methodName: string): DispatcherTracker {
  let configured = false;

  return {
    isConfigured: () => configured,
    checkCall(node: CallExpression, tracker: FederationTracker): void {
      if (
        isCallMemberExpression(node) &&
        hasMethodName(node, methodName) &&
        tracker.isFederationObject(node.callee.object)
      ) {
        configured = true;
      }
    },
  };
}

// ============================================================================
// Actor Dispatcher Info
// ============================================================================

interface ActorDispatcherInfo {
  node: CallMemberExpression;
  dispatcherFn: FunctionNode;
}

// ============================================================================
// ESLint Rule Factory: Required Rules
// ============================================================================

export function createRequiredRule(
  _ruleId: string,
  config: PropertyConfig,
): RuleModule {
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
    create(context: RuleContext) {
      const federationTracker = createFederationTracker();
      const dispatcherTracker = createDispatcherTracker(config.setter);
      const actorDispatchers: ActorDispatcherInfo[] = [];

      const propertyChecker = createPropertyExistenceChecker(config.path);

      return {
        VariableDeclarator(node: VariableDeclarator): void {
          federationTracker.handleVariableDeclarator(node);
        },

        CallExpression(node: CallExpression): void {
          dispatcherTracker.checkCall(node, federationTracker);

          if (!isSetActorDispatcherCall(node)) return;
          if (!federationTracker.isFederationObject(node.callee.object)) return;

          const dispatcherArg = node.arguments[1];
          if (isFunction(dispatcherArg)) {
            actorDispatchers.push({
              node,
              dispatcherFn: dispatcherArg,
            });
          }
        },

        "Program:exit"(): void {
          if (!dispatcherTracker.isConfigured()) return;

          for (const { dispatcherFn } of actorDispatchers) {
            const hasProperty = searchFunctionBody(propertyChecker)(
              dispatcherFn.body,
            );

            if (!hasProperty) {
              context.report({
                node: dispatcherFn,
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

export function createMismatchRule(
  _ruleId: string,
  config: PropertyConfig,
): RuleModule {
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
    create(context: RuleContext) {
      const federationTracker = createFederationTracker();

      return {
        VariableDeclarator(node: VariableDeclarator): void {
          federationTracker.handleVariableDeclarator(node);
        },

        CallExpression(node: CallExpression): void {
          if (!isSetActorDispatcherCall(node)) return;
          if (!federationTracker.isFederationObject(node.callee.object)) return;

          const dispatcherArg = node.arguments[1];
          if (!isFunction(dispatcherArg)) return;

          const [ctxName, idName] = extractFunctionParams(dispatcherArg);
          if (!ctxName || !idName) return;

          const methodCallContext: MethodCallContext = {
            path: config.path.join("."),
            ctxName,
            idName,
            methodName: config.getter,
            requiresIdentifier: config.requiresIdentifier,
          };

          // Check if property exists
          const existenceChecker = createPropertyExistenceChecker(config.path);
          const hasProperty = searchFunctionBody(existenceChecker)(
            dispatcherArg.body,
          );

          if (!hasProperty) return; // Let required rule handle this

          // Check if property has correct value
          const valueChecker = createPropertyValueChecker(
            config.path,
            methodCallContext,
          );
          const hasCorrectValue = searchFunctionBody(valueChecker)(
            dispatcherArg.body,
          );

          if (!hasCorrectValue) {
            context.report({
              node: dispatcherArg,
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

export function createCollectionFilteringRule(_ruleId: string): RuleModule {
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
    create(context: RuleContext) {
      const federationTracker = createFederationTracker();

      return {
        VariableDeclarator(node: VariableDeclarator): void {
          federationTracker.handleVariableDeclarator(node);
        },

        CallExpression(node: CallExpression): void {
          if (!isSetFollowersDispatcherCall(node)) return;
          if (!federationTracker.isFederationObject(node.callee.object)) return;

          const dispatcherArg = node.arguments[1];
          if (!isFunction(dispatcherArg)) return;

          // Filter is the 4th parameter (index 3)
          if (!hasMinParams(4)(dispatcherArg)) {
            context.report({
              node: dispatcherArg,
              messageId: "filterRequired",
            });
          }
        },
      };
    },
  };
}
