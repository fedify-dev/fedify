import {
  allOf,
  hasIdentifierProperty,
  hasMemberExpressionCallee,
  hasMethodName,
  isFunction,
  isSetActorDispatcherCall,
} from "./pred.ts";
import {
  createNestedPropertyChecker,
  createPropertyChecker,
  createPropertySearcher,
} from "./property-checker.ts";
import { trackFederationVariables } from "./tracker.ts";
import type {
  CallMemberExpression,
  CallMemberExpressionWithIdentified,
  FunctionNode,
} from "./types.ts";

/**
 * Checks if a CallExpression is a specific dispatcher method call.
 */
const isDispatcherMethodCall = (methodName: string) =>
(
  node: Deno.lint.CallExpression,
): node is CallMemberExpression =>
  allOf(
    hasMemberExpressionCallee,
    hasIdentifierProperty,
    hasMethodName(methodName),
  )(node as CallMemberExpressionWithIdentified);

/**
 * Tracks dispatcher method calls on federation objects.
 */
export const createDispatcherTracker = (
  dispatcherMethod: string,
  federationTracker: ReturnType<typeof trackFederationVariables>,
) => {
  let dispatcherConfigured = false;

  return {
    isDispatcherConfigured: () => dispatcherConfigured,
    checkDispatcherCall: (node: Deno.lint.CallExpression) => {
      if (
        isDispatcherMethodCall(dispatcherMethod)(node) &&
        federationTracker.isFederationObject(node.callee.object)
      ) {
        dispatcherConfigured = true;
      }
    },
  };
};

/**
 * Stores actor dispatcher info for later validation.
 */
interface ActorDispatcherInfo {
  node: Deno.lint.CallExpression;
  dispatcherArg: FunctionNode;
}

/**
 * Internal configuration for the unified rule factory.
 */
interface InternalRequiredConfig {
  propertyName: string;
  dispatcherMethod: string;
  errorMessage: string;
}

/**
 * Creates a required rule with the given configuration.
 */
export function createRequiredRule(
  config: InternalRequiredConfig,
): Deno.lint.Rule {
  const propertyPath = config.propertyName.split(".");
  const propertyChecker = propertyPath.length === 1
    ? createPropertyChecker(propertyPath[0])
    : createNestedPropertyChecker(propertyPath);
  const propertySearcher = createPropertySearcher(propertyChecker);

  return {
    create(context) {
      const federationTracker = trackFederationVariables();
      const dispatcherTracker = createDispatcherTracker(
        config.dispatcherMethod,
        federationTracker,
      );
      const actorDispatchers: ActorDispatcherInfo[] = [];

      return {
        VariableDeclarator: federationTracker.VariableDeclarator,

        CallExpression(node) {
          dispatcherTracker.checkDispatcherCall(node);

          if (!isSetActorDispatcherCall(node)) return;
          if (!federationTracker.isFederationObject(node.callee.object)) return;

          const dispatcherArg = node.arguments[1];
          if (isFunction(dispatcherArg)) {
            actorDispatchers.push({ node, dispatcherArg });
          }
        },

        "Program:exit"() {
          if (!dispatcherTracker.isDispatcherConfigured()) return;

          for (const { dispatcherArg } of actorDispatchers) {
            if (!propertySearcher(dispatcherArg.body)) {
              context.report({
                node: dispatcherArg,
                message: config.errorMessage,
              });
            }
          }
        },
      };
    },
  };
}
