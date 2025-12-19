import {
  always,
  every,
  head,
  isEmpty,
  isObject,
  pipe,
  pipeLazy,
  prop,
  toArray,
  unless,
  when,
} from "@fxts/core";
import { allOf, isNodeType } from "./pred.ts";
import type {
  AssignmentPattern,
  BlockStatement,
  ConditionalExpression,
  Expression,
  NewExpression,
  Node,
  ObjectExpression,
  Property,
  PropertyChecker,
  ReturnStatement,
  SpreadElement,
  Statement,
  WithIdentifierKey,
} from "./types.ts";
import { cases, eq } from "./utils.ts";

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
 * @param path Array of property names forming the path
 *             (e.g., ["endpoints", "sharedInbox"])
 * @returns A predicate function that checks if the nested property exists
 */
export function createPropertyChecker(
  checker: (
    node:
      | Expression
      | AssignmentPattern,
  ) => boolean,
): (path: readonly string[]) => PropertyChecker {
  const inner =
    ([first, ...rest]: readonly string[]): PropertyChecker => (node) => {
      if (!isPropertyWithName(first)(node)) return false;

      // Base case: last property in path
      if (isEmpty(rest)) {
        return checker(node.value as Expression | AssignmentPattern);
      }

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
  (propertyChecker: PropertyChecker) => (obj: ObjectExpression): boolean =>
    obj.properties.some(propertyChecker);

/**
 * Checks if a ConditionalExpression (ternary operator) has the property in
 * both branches.
 * @param propertyChecker The predicate function to check properties
 * @returns A function that checks the ConditionalExpression
 */
const checkConditionalExpression =
  (propertyChecker: PropertyChecker) =>
  (node: ConditionalExpression): boolean =>
    [node.consequent, node.alternate].every(checkBranchWith(propertyChecker));

// Check if both branches have the property
const checkBranchWith =
  (propertyChecker: PropertyChecker) => (branch: Expression): boolean =>
    pipe(
      branch,
      cases(
        isNodeType("ConditionalExpression"),
        checkConditionalExpression(propertyChecker),
        pipeLazy(
          extractObjectExpression,
          cases(
            isObject,
            checkObjectExpression(propertyChecker),
            always(false) as (_: null) => boolean,
          ),
        ),
      ) as (node: Expression) => boolean,
    );

/**
 * Extracts the first argument if it's an ObjectExpression.
 */
const extractFirstObjectExpression = (node: NewExpression):
  | ObjectExpression
  | null =>
  pipe(
    node,
    prop("arguments"),
    head,
    unless(
      isNodeType("ObjectExpression"),
      always(null),
    ) as () => ObjectExpression | null,
  );

/**
 * Extracts ObjectExpression from NewExpression.
 */
const extractObjectExpression: (arg: Expression) => ObjectExpression | null =
  cases(
    isNodeType("NewExpression"),
    extractFirstObjectExpression,
    always(null),
  ) as (arg: Expression) => ObjectExpression | null;

/**
 * Checks if a ReturnStatement node contains a property.
 * @param propertyChecker The predicate function to check properties
 * @returns A function that checks the ReturnStatement
 */
const checkReturnStatement =
  (propertyChecker: PropertyChecker) => (node: ReturnStatement) =>
    pipe(
      node,
      prop("argument"),
      cases<Expression, null | undefined, boolean>(
        isObject,
        checkBranchWith(propertyChecker),
        always(false),
      ),
    );

/**
 * Creates a function that recursively checks for a property in an AST node.
 * @param propertyChecker The predicate function to check properties
 * @returns A recursive function that checks the AST node
 */
export const createPropertySearcher = (propertyChecker: PropertyChecker) => {
  return (
    node: Expression | BlockStatement | Statement,
  ): node is
    | ReturnStatement
    | BlockStatement
    | NewExpression => {
    switch (node.type) {
      case "ReturnStatement":
        return checkReturnStatement(propertyChecker)(node);

      case "BlockStatement":
        return checkAllReturnPaths(propertyChecker)(node);

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
};

const checkAllReturnPaths = (propertyChecker: PropertyChecker) =>
(
  node: Expression | BlockStatement | Statement,
): boolean =>
  pipe(
    node,
    collectReturnPaths,
    cases<ReturnStatement[], boolean>(
      isEmpty,
      always(false),
      every(checkReturnStatement(propertyChecker)),
    ),
  );

/**
 * Collects all return statements from a node, traversing control flow.
 * This handles if/else branches, loops, etc.
 */
const collectReturnPaths = (
  node: Expression | BlockStatement | Statement,
): ReturnStatement[] =>
  pipe(
    node,
    flatten,
    toArray,
  );

function* flatten(node: Node): Generator<ReturnStatement> {
  switch (node.type) {
    case "ReturnStatement":
      yield node;
      return;

    case "IfStatement":
      // Collect returns from both branches
      if (node.consequent) yield* flatten(node.consequent);
      if (node.alternate) yield* flatten(node.alternate);
      return;

    case "BlockStatement":
      for (const statement of node.body) {
        yield* flatten(statement);
      }
      return;

    case "SwitchStatement":
      for (const switchCase of node.cases) {
        for (const statement of switchCase.consequent) {
          yield* flatten(statement);
        }
      }
      return;

    case "TryStatement":
      yield* flatten(node.block);
      if (node.handler) yield* flatten(node.handler.body);
      if (node.finalizer) yield* flatten(node.finalizer);
      return;

    case "WhileStatement":
    case "DoWhileStatement":
    case "ForStatement":
    case "ForInStatement":
    case "ForOfStatement":
      yield* flatten(node.body);
      return;

    case "LabeledStatement":
      yield* flatten(node.body);
      return;

    case "WithStatement":
      yield* flatten(node.body);
      return;

    default:
      // For other node types (expressions, declarations, etc.),
      // we don't traverse deeper to avoid infinite recursion
      // from circular references like `parent`
      return;
  }
}
