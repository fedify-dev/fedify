import { isEmpty, negate, some } from "@fxts/core";
import type { Rule } from "eslint";
import { actorPropertyMismatch } from "./messages.ts";
import {
  allOf,
  hasMemberExpressionCallee,
  isFunction,
  isNodeName,
  isNodeType,
  isSetActorDispatcherCall,
} from "./pred.ts";
import {
  createPropertyChecker,
  createPropertySearcher,
} from "./property-checker.ts";
import { trackFederationVariables } from "./tracker.ts";
import type {
  CallExpression,
  Expression,
  FunctionNode,
  Identifier,
  MethodCallContext,
  Node,
  Parameter,
  PrivateIdentifier,
  PropertyConfig,
  SpreadElement,
} from "./types.ts";

const isIdentifierWithName = <T extends string>(name: T) =>
(
  node: Expression | SpreadElement | PrivateIdentifier,
): node is Identifier & { "name": T } =>
  allOf(isNodeType("Identifier"), isNodeName(name))(node);

/**
 * Checks if a node is a CallExpression calling the expected context method.
 */
const isExpectedMethodCall = (
  {
    ctxName,
    idName,
    methodName,
    requiresIdentifier,
  }: MethodCallContext,
) =>
(node: Node): boolean => {
  if (
    !isNodeType("CallExpression")(node) ||
    !hasMemberExpressionCallee(node) ||
    !isIdentifierWithName(ctxName)(node.callee.object) ||
    !isIdentifierWithName(methodName)(node.callee.property)
  ) return false;

  if (!requiresIdentifier) return isEmpty(node.arguments);
  return allOf<typeof node.arguments>(
    negate(isEmpty),
    some(isIdentifierWithName(idName)),
  )(node.arguments);
};

/**
 * Extracts parameter names from a function.
 */
const extractParams = (
  fn: FunctionNode,
): [string | null, string | null] => {
  const params = fn.params;
  if (params.length < 2) return [null, null];

  return params.slice(0, 2).map(getNameIfIdentifier) as [
    string | null,
    string | null,
  ];
};

const getNameIfIdentifier = (node: Parameter): string | null =>
  node?.type === "Identifier" ? node.name : null;

function createMismatchRule<Context = Deno.lint.RuleContext | Rule.RuleContext>(
  config: PropertyConfig,
  describe: (
    methodCallContext: MethodCallContext,
  ) => Context extends Deno.lint.RuleContext ? {
      message: string;
    }
    : {
      messageId: string;
      data: { message: string };
    },
) {
  return (context: Context) => {
    const tracker = trackFederationVariables();

    return {
      VariableDeclarator: tracker.VariableDeclarator,

      CallExpression(node: CallExpression) {
        if (
          !isSetActorDispatcherCall(node) ||
          !hasMemberExpressionCallee(node) ||
          !tracker.isFederationObject(node.callee.object)
        ) return;

        const dispatcherArg = node.arguments[1];
        if (!isFunction(dispatcherArg)) return;

        const [ctxName, idName] = extractParams(dispatcherArg);
        if (!ctxName || !idName) return;

        const methodCallContext: MethodCallContext = {
          path: config.path.join("."),
          ctxName,
          idName,
          methodName: config.getter,
          requiresIdentifier: config.requiresIdentifier,
        };

        const existenceChecker = createPropertyChecker(Boolean)(config.path);
        const hasProperty = createPropertySearcher(existenceChecker)(
          dispatcherArg.body,
        );

        // If property doesn't exist, don't report (that's for *-required rules)
        if (!hasProperty) return;

        // Property exists, now check if the value is correct
        const propertyChecker = createPropertyChecker(
          isExpectedMethodCall(methodCallContext),
        )(config.path);
        const propertySearcher = createPropertySearcher(
          propertyChecker,
        );

        if (!propertySearcher(dispatcherArg.body)) {
          (context as { report: (arg: unknown) => void }).report({
            node: dispatcherArg,
            ...describe(methodCallContext),
          });
        }
      },
    };
  };
}

/**
 * Creates a lint rule that checks if a property uses the correct context method.
 *
 * @param config Property configuration containing name, getter, setter, and nested info
 * @returns A Deno lint rule
 */
export const createMismatchRuleDeno = (
  config: PropertyConfig,
): Deno.lint.Rule => ({
  create: createMismatchRule(
    config,
    (context) => ({
      message: actorPropertyMismatch(context),
    }),
  ),
});

export const createMismatchRuleEslint = (
  config: PropertyConfig,
): Rule.RuleModule => ({
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
  create: createMismatchRule(
    config,
    (context) => ({
      messageId: "mismatch",
      data: { message: actorPropertyMismatch(context) },
    }),
  ),
});
