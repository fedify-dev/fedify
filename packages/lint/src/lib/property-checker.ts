import {
  isEmpty,
  isNil,
  isObject,
  pipe,
  pipeLazy,
  prop,
  some,
  when,
} from "@fxts/core";
import { allOf, isNodeType } from "./pred.ts";
import type {
  AssignmentPattern,
  BlockStatement,
  Expression,
  NewExpression,
  Node,
  Property,
  PropertyChecker,
  ReturnStatement,
  SpreadElement,
  Statement,
  TSEmptyBodyFunctionExpression,
  WithIdentifierKey,
} from "./types.ts";
import { eq } from "./utils.ts";

/**
 * Checks if a node has a key with a specific name.
 */
const hasKeyName =
  <T extends string>(propertyName: T) =>
  (node: Property): node is Property & WithIdentifierKey<T> =>
    pipe(
      node,
      prop("key"),
      allOf(
        isNodeType("Identifier"),
        pipeLazy(prop("name"), eq(propertyName)) as (node: Node) => boolean,
      ),
    ) as boolean;

/**
 * Checks if a node is a Property with an Identifier key of a specific name.
 */
export const isPropertyWithName = <T extends string>(propertyName: T) =>
(
  node: Property | SpreadElement,
): node is Property & WithIdentifierKey<T> =>
  allOf(
    isNodeType("Property"),
    hasKeyName(propertyName),
  )(node as Expression & Property);

/**
 * Creates a predicate function that checks if a nested property exists.
 * @param path Array of property names forming the path (e.g., ["endpoints", "sharedInbox"])
 * @returns A predicate function that checks if the nested property exists
 */
export function createPropertyChecker(
  checker: (
    node:
      | Expression
      | AssignmentPattern
      | TSEmptyBodyFunctionExpression,
  ) => boolean,
): (path: readonly string[]) => PropertyChecker {
  const inner =
    ([first, ...rest]: readonly string[]): PropertyChecker => (node) => {
      if (!isPropertyWithName(first)(node)) return false;

      // Base case: last property in path
      if (isEmpty(rest)) return checker(node.value);

      // Handle NewExpression: endpoints: new Endpoints({ sharedInbox: ... })
      if (isNodeType("NewExpression")(node.value)) {
        if (node.value.arguments.length === 0) return false;
        const firstArg = node.value.arguments[0];
        if (!isNodeType("ObjectExpression")(firstArg)) return false;
        return firstArg.properties.some(inner(rest));
      }

      return false;
    };
  return inner;
}

/**
 * Checks if an ObjectExpression node contains a property.
 * @param propertyChecker The predicate function to check properties
 * @returns A function that checks the ObjectExpression
 */
const checkObjectExpression =
  (propertyChecker: PropertyChecker) =>
  (obj: Deno.lint.ObjectExpression): boolean =>
    obj.properties.some(propertyChecker);

/**
 * Checks if a ConditionalExpression (ternary operator) has the property in both branches.
 * @param propertyChecker The predicate function to check properties
 * @returns A function that checks the ConditionalExpression
 */
const checkConditionalExpression = (
  propertyChecker: PropertyChecker,
) =>
(node: Deno.lint.ConditionalExpression): boolean =>
  [node.consequent, node.alternate].every(checkBranchWith(propertyChecker));

// Check if both branches have the property
const checkBranchWith =
  (propertyChecker: PropertyChecker) => (branch: Expression): boolean => {
    // Handle nested ternary operators
    if (isNodeType("ConditionalExpression")(branch)) {
      return checkConditionalExpression(propertyChecker)(branch);
    }
    const objExpr = extractObjectExpression(branch);
    return objExpr ? checkObjectExpression(propertyChecker)(objExpr) : false;
  };

/**
 * Extracts ObjectExpression from NewExpression.
 */
const extractObjectExpression = (
  arg: Expression,
): Deno.lint.ObjectExpression | null => {
  if (isNodeType("NewExpression")(arg)) {
    return extractFirstObjectExpression(arg);
  }
  return null;
};

/**
 * Extracts the first argument if it's an ObjectExpression.
 */
const extractFirstObjectExpression = (node: Deno.lint.NewExpression):
  | Deno.lint.ObjectExpression
  | null => {
  const firstArg = node.arguments[0];
  return isNodeType("ObjectExpression")(firstArg) ? firstArg : null;
};

/**
 * Checks if a ReturnStatement node contains a property.
 * @param propertyChecker The predicate function to check properties
 * @returns A function that checks the ReturnStatement
 */
export const checkReturnStatement = (
  propertyChecker: PropertyChecker,
) =>
(node: Deno.lint.ReturnStatement) => {
  const arg = node.argument;
  if (isNil(arg)) return false;

  // Handle ConditionalExpression (ternary operator)
  if (isNodeType("ConditionalExpression")(arg)) {
    return checkConditionalExpression(propertyChecker)(arg);
  }

  const objExpr = extractObjectExpression(arg);
  return objExpr ? checkObjectExpression(propertyChecker)(objExpr) : false;
};

/**
 * Creates a function that recursively checks for a property in an AST node.
 * @param propertyChecker The predicate function to check properties
 * @returns A recursive function that checks the AST node
 */
export const createPropertySearcher = (propertyChecker: PropertyChecker) =>
(
  node:
    | Expression
    | BlockStatement
    | Statement,
): node is
  | ReturnStatement
  | BlockStatement
  | NewExpression => {
  switch (node.type) {
    case "ReturnStatement":
      return checkReturnStatement(propertyChecker)(node);
    case "BlockStatement":
      return node.body.some(createPropertySearcher(propertyChecker));
    case "NewExpression":
      return pipe(
        node,
        extractFirstObjectExpression,
        when(isObject, checkObjectExpression(propertyChecker)),
        Boolean,
      );
    default:
      return false;
  }
};
