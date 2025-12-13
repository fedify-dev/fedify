import type { TSESLint, TSESTree } from "@typescript-eslint/utils";
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

/**
 * Stores actor dispatcher info for later validation.
 */
interface ActorDispatcherInfoDeno {
  node: Deno.lint.CallExpression;
  dispatcherArg:
    | Deno.lint.ArrowFunctionExpression
    | Deno.lint.FunctionExpression;
}

function createRequiredRule<
  Context = Deno.lint.RuleContext | TSESLint.RuleContext<string, unknown[]>,
  /* CallExpression = Context extends Deno.lint.RuleContext
    ? Deno.lint.CallExpression
    : TSESTree.CallExpression, */
  ActorDispatcherInfo = Context extends Deno.lint.RuleContext
    ? ActorDispatcherInfoDeno
    : ActorDispatcherInfoEslint,
>(
  config: PropertyConfig,
  describe: (
    config: PropertyConfig,
  ) => Context extends Deno.lint.RuleContext ? {
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
    const actorDispatchers: ActorDispatcherInfo[] = [];

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

        const dispatcherArg = node.arguments[1];
        if (isFunction(dispatcherArg)) {
          actorDispatchers.push({ node, dispatcherArg } as ActorDispatcherInfo);
        }
      },

      "Program:exit"() {
        if (!dispatcherTracker.isDispatcherConfigured()) return;

        for (
          const { dispatcherArg }
            of actorDispatchers as ActorDispatcherInfoDeno[]
        ) {
          if (!propertySearcher(dispatcherArg.body)) {
            (context as { report: (arg: unknown) => void }).report({
              node: dispatcherArg,
              ...describe(config),
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
    create(context) {
      const federationTracker = trackFederationVariables();
      const dispatcherTracker = createDispatcherTracker(
        config.setter,
        federationTracker,
      );
      const actorDispatchers: ActorDispatcherInfoDeno[] = [];

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

          const propertyChecker = createPropertyChecker(Boolean)(config.path);
          const propertySearcher = createPropertySearcher(propertyChecker);

          for (const { dispatcherArg } of actorDispatchers) {
            if (!propertySearcher(dispatcherArg.body)) {
              context.report({
                node: dispatcherArg,
                message: actorPropertyRequired(config),
              });
            }
          }
        },
      };
    },
  };
}

interface ActorDispatcherInfoEslint {
  node: TSESTree.CallExpression;
  dispatcherArg:
    | TSESTree.ArrowFunctionExpression
    | TSESTree.FunctionExpression;
}

/**
 * Creates a required ESLint rule with the given property configuration.
 */

export function createRequiredRuleEslint(
  config: PropertyConfig,
): TSESLint.RuleModule<string, unknown[]> {
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
    create(context: TSESLint.RuleContext<string, unknown[]>) {
      const federationTracker = trackFederationVariables();
      const dispatcherTracker = createDispatcherTracker(
        config.setter,
        federationTracker,
      );
      const actorDispatchers: ActorDispatcherInfoEslint[] = [];

      return {
        VariableDeclarator: federationTracker.VariableDeclarator,

        CallExpression(node): void {
          dispatcherTracker.checkDispatcherCall(node);

          if (!isSetActorDispatcherCall(node)) return;
          if (!federationTracker.isFederationObject(node.callee.object)) return;

          const dispatcherArg = node.arguments[1];
          if (isFunction(dispatcherArg)) {
            actorDispatchers.push({ node, dispatcherArg });
          }
        },

        "Program:exit"(): void {
          if (!dispatcherTracker.isDispatcherConfigured()) return;

          const propertyChecker = createPropertyChecker(Boolean)(config.path);
          const propertySearcher = createPropertySearcher(propertyChecker);

          for (const { dispatcherArg } of actorDispatchers) {
            if (!propertySearcher(dispatcherArg.body)) {
              context.report({
                node: dispatcherArg,
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
