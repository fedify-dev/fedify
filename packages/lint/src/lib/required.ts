import type { Rule } from "eslint";
import { actorPropertyRequired } from "./messages.ts";
import {
  allOf,
  hasIdentifierProperty,
  hasMemberExpressionCallee,
  hasMethodName,
  isFunction,
  isSetActorDispatcherCall,
} from "./pred.ts";
import {
  createPropertyChecker,
  createPropertySearcher,
} from "./property-checker.ts";
import { trackFederationVariables } from "./tracker.ts";
import type {
  CallExpression,
  CallMemberExpressionWithIdentified,
  FunctionNode,
  PropertyConfig,
} from "./types.ts";

/**
 * Checks if a CallExpression is a specific dispatcher method call.
 */
const isDispatcherMethodCall =
  (methodName: string) =>
  (node: CallExpression): node is CallMemberExpressionWithIdentified =>
    allOf(
      hasMemberExpressionCallee,
      hasIdentifierProperty,
      hasMethodName(methodName),
    )(node);

/**
 * Tracks dispatcher method calls on federation objects.
 */
const createDispatcherTracker = (
  dispatcherMethod: string,
  federationTracker: ReturnType<typeof trackFederationVariables>,
) => {
  let dispatcherConfigured = false;

  return {
    isDispatcherConfigured: () => dispatcherConfigured,
    checkDispatcherCall: (
      node: CallExpression,
    ) => {
      if (
        isDispatcherMethodCall(dispatcherMethod)(node) &&
        federationTracker.isFederationObject(node.callee.object)
      ) {
        dispatcherConfigured = true;
      }
    },
  };
};

function createRequiredRule<Context = Deno.lint.RuleContext | Rule.RuleContext>(
  config: PropertyConfig,
  description: Context extends Deno.lint.RuleContext ? {
      message: string;
    }
    : {
      messageId: string;
      data: { message: string };
    },
) {
  return (context: Context) => {
    const federationTracker = trackFederationVariables();
    const dispatcherTracker = createDispatcherTracker(
      config.setter,
      federationTracker,
    );
    const actorDispatchers: FunctionNode[] = [];

    const propertyChecker = createPropertyChecker(Boolean)(
      config.path,
    );
    const propertySearcher = createPropertySearcher(propertyChecker);

    return {
      VariableDeclarator: federationTracker.VariableDeclarator,

      CallExpression(node: CallExpression) {
        dispatcherTracker.checkDispatcherCall(node);

        if (!isSetActorDispatcherCall(node)) return;
        if (!federationTracker.isFederationObject(node.callee.object)) return;

        const dispatcher = node.arguments[1];
        if (isFunction(dispatcher)) {
          actorDispatchers.push(dispatcher);
        }
      },

      "Program:exit"() {
        if (!dispatcherTracker.isDispatcherConfigured()) return;

        for (const dispatcher of actorDispatchers) {
          if (!propertySearcher(dispatcher.body)) {
            (context as { report: (arg: unknown) => void }).report({
              node: dispatcher,
              ...description,
            });
          }
        }
      },
    };
  };
}

/**
 * Creates a required rule with the given property configuration.
 */
export function createRequiredRuleDeno(
  config: PropertyConfig,
): Deno.lint.Rule {
  return {
    create: createRequiredRule(
      config,
      { message: actorPropertyRequired(config) },
    ),
  };
}

/**
 * Creates a required ESLint rule with the given property configuration.
 */
export function createRequiredRuleEslint(
  config: PropertyConfig,
): Rule.RuleModule {
  return {
    meta: {
      type: "suggestion",
      docs: {
        description: `Ensure actor dispatcher returns ${
          config.path.join(".")
        } property.`,
      },
      schema: [],
      messages: {
        required: "{{ message }}",
      },
    },
    create: createRequiredRule(
      config,
      {
        messageId: "required",
        data: { message: actorPropertyRequired(config) },
      },
    ),
  };
}
