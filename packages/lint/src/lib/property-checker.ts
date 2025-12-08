import { filter, pipe, pipeLazy, prop, some } from "@fxts/core";
import {
  allOf,
  hasASTNodeKey,
  hasIdentifierKey,
  isASTNode,
  isNodeType,
} from "./pred.ts";
import type { ASTNode } from "./types.ts";
import { eq } from "./utils.ts";

/**
 * Checks if a node's key name matches the given property name.
 */
const keyNameMatches =
  <T extends string>(propertyName: T) =>
  <N>(node: N): node is N & { "key": ASTNode & { "name": T } } =>
    pipe(
      node as { "key": { "name": string } },
      prop("key"),
      allOf(
        isASTNode,
        pipeLazy(
          prop("name"),
          eq(propertyName),
        ) as (value: { name: string }) => boolean,
      ),
    ) as boolean;

/**
 * Checks if a node has a key with a specific name.
 */
const hasKeyName =
  <T extends string>(propertyName: T) =>
  <N>(node: N): node is N & { "key": ASTNode & { "name": T } } =>
    allOf(
      hasASTNodeKey,
      hasIdentifierKey,
      keyNameMatches(propertyName),
    )(node as { "key": ASTNode & { "name": T } });

/**
 * Checks if a node is a Property with an Identifier key of a specific name.
 */
const isPropertyWithName =
  <T extends string>(propertyName: T) =>
  <N extends ASTNode>(node: N): node is N & {
    "type": "Property";
    "key": ASTNode & { "name": T };
  } =>
    allOf(
      isNodeType("Property"),
      hasKeyName(propertyName),
    )(node);

/**
 * Creates a predicate function that checks if a property has a specific name.
 * @param propertyName The name of the property to check for
 * @returns A predicate function that checks if the property exists
 */
export const createPropertyChecker =
  <T extends string>(propertyName: T) =>
  (node: unknown): node is ASTNode & {
    "type": "Property";
    "key": ASTNode & { "name": T };
  } => allOf(isASTNode, isPropertyWithName(propertyName))(node as ASTNode);

/**
 * Checks if a node has an ObjectExpression value.
 */
const hasObjectExpressionValue = (
  node: Deno.lint.Property,
): node is Deno.lint.Property & { "value": Deno.lint.ObjectExpression } =>
  pipe(
    node as { "value": ASTNode },
    prop("value"),
    allOf(isASTNode, isNodeType("ObjectExpression")),
  );

/**
 * Type guard to check if a node is a Property.
 */
const isProperty = (node: ASTNode): node is Deno.lint.Property =>
  isNodeType("Property")(node);

/**
 * Internal recursive checker for nested property paths.
 * This avoids circular dependency between hasNestedProperty and createNestedPropertyChecker.
 */
const checkNestedPropertyPath =
  (path: string[]) => (node: unknown): boolean => {
    if (!isASTNode(node) || !hasKeyName(path[0])(node)) return false;

    // Base case: single property
    if (path.length === 1) {
      return isNodeType("Property")(node);
    }

    // Recursive case: check nested properties
    if (!isProperty(node)) return false;
    if (!hasObjectExpressionValue(node)) return false;

    const properties = node.value.properties;

    // Check if any property matches the remaining path
    return pipe(
      properties,
      filter(isASTNode),
      some(checkNestedPropertyPath(path.slice(1))),
    );
  };

/**
 * Creates a predicate function that checks if a nested property exists.
 * @param path Array of property names forming the path (e.g., ["endpoints", "sharedInbox"])
 * @returns A predicate function that checks if the nested property exists
 */
export const createNestedPropertyChecker =
  (path: string[]) => (node: unknown): boolean =>
    checkNestedPropertyPath(path)(node);

/**
 * Checks if an ObjectExpression node contains a property.
 * @param propertyChecker The predicate function to check properties
 * @returns A function that checks the ObjectExpression
 */
export const checkObjectExpression =
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
const extractFirstArgument = (node: ASTNode):
  | ASTNode & {
    type: "ObjectExpression";
  }
  | null =>
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
const extractObjectExpression = (
  arg: ASTNode,
): ASTNode & { type: "ObjectExpression" } | null => {
  if (isNodeType("NewExpression")(arg)) return extractFirstArgument(arg);
  return null;
};

/**
 * Checks if a ConditionalExpression (ternary operator) has the property in both branches.
 * @param propertyChecker The predicate function to check properties
 * @returns A function that checks the ConditionalExpression
 */
const checkConditionalExpression =
  (propertyChecker: (prop: unknown) => boolean) =>
  (node: Deno.lint.ConditionalExpression): boolean => {
    const consequent = node.consequent;
    const alternate = node.alternate;

    // Check if both branches have the property
    const checkBranch = (branch: ASTNode): boolean => {
      // Handle nested ternary operators
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
 * @param propertyChecker The predicate function to check properties
 * @returns A function that checks the ReturnStatement
 */
export const checkReturnStatement =
  (propertyChecker: (prop: unknown) => boolean) =>
  (
    node: ASTNode,
  ): node is ASTNode & { type: "ReturnStatement"; arg: unknown } => {
    const arg = pipe(node as { argument: unknown }, prop("argument"));
    if (!isASTNode(arg)) return false;

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
export const createPropertySearcher =
  (propertyChecker: (prop: unknown) => boolean) =>
  (node: unknown): node is
    | Deno.lint.ReturnStatement
    | Deno.lint.BlockStatement
    | Deno.lint.NewExpression => {
    if (!isASTNode(node)) return false;

    if (isNodeType("ReturnStatement")(node)) {
      return checkReturnStatement(propertyChecker)(node);
    }

    if (isNodeType("BlockStatement")(node)) {
      return node.body.some(createPropertySearcher(propertyChecker));
    }

    // Handle arrow function with direct NewExpression body: () => new SomeClass({...})
    if (isNodeType("NewExpression")(node)) {
      const objExpr = extractFirstArgument(node);
      return objExpr ? checkObjectExpression(propertyChecker)(objExpr) : false;
    }

    return false;
  };
