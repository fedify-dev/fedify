import { isEmpty, negate, some } from "@fxts/core";
import type { TSESLint } from "@typescript-eslint/utils";
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
  AssignmentPattern,
  Expression,
  FunctionNode,
  Identifier,
  MethodCallContext,
  Parameter,
  PrivateIdentifier,
  PropertyConfig,
  SpreadElement,
  TSEmptyBodyFunctionExpression,
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
(
  node:
    | Expression
    | AssignmentPattern
    | TSEmptyBodyFunctionExpression,
): boolean => {
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
  isNodeType("Identifier")(node as Identifier)
    ? (node as Identifier).name
    : null;
/**
 * Creates a lint rule that checks if a property uses the correct context method.
 *
 * @param config Property configuration containing name, getter, setter, and nested info
 * @returns A Deno lint rule
 */
export const createMismatchRuleDeno = (
  { path, getter, requiresIdentifier = true }: PropertyConfig,
): Deno.lint.Rule => {
  return {
    create(context) {
      const tracker = trackFederationVariables();

      return {
        VariableDeclarator: tracker.VariableDeclarator,

        CallExpression(node) {
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
            path: path.join("."),
            ctxName,
            idName,
            methodName: getter,
            requiresIdentifier,
          };

          const existenceChecker = createPropertyChecker(Boolean);
          const hasProperty = createPropertySearcher(existenceChecker(path))(
            dispatcherArg.body,
          );

          // If property doesn't exist, don't report (that's for *-required rules)
          if (!hasProperty) return;

          // Property exists, now check if the value is correct
          const propertyChecker = createPropertyChecker(
            isExpectedMethodCall(methodCallContext),
          );
          const propertySearcher = createPropertySearcher(
            propertyChecker(path),
          );

          if (!propertySearcher(dispatcherArg.body)) {
            context.report({
              node: dispatcherArg,
              message: actorPropertyMismatch(methodCallContext),
            });
          }
        },
      };
    },
  };
};

export function createMismatchRuleEslint(
  { path, getter, requiresIdentifier = true }: PropertyConfig,
): TSESLint.RuleModule<string, unknown[]> {
  return {
    meta: {
      type: "problem",
      docs: {
        description: `Ensure actor's ${
          path.join(".")
        } property uses correct context method`,
      },
      schema: [],
      messages: {
        mismatch: "{{ message }}",
      },
    },
    defaultOptions: [],
    create(context) {
      const tracker = trackFederationVariables();

      return {
        VariableDeclarator: tracker.VariableDeclarator,

        CallExpression(node) {
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
            path: path.join("."),
            ctxName,
            idName,
            methodName: getter,
            requiresIdentifier,
          };

          // Property exists, now check if the value is correct
          const propertyChecker = createPropertyChecker(
            isExpectedMethodCall(methodCallContext),
          );
          const propertySearcher = createPropertySearcher(
            propertyChecker(path),
          );

          if (!propertySearcher(dispatcherArg.body)) {
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
