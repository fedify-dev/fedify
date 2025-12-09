/**
 * Common predicate functions for AST node checking.
 * These functions work with TSESTree AST nodes from @typescript-eslint/utils.
 */
import { pipe, prop } from "@fxts/core";
import type { TSESTree } from "@typescript-eslint/utils";
import type {
  CallExpression,
  CallMemberExpression,
  CallMemberExpressionWithIdentifier,
  FunctionNode,
  Identifier,
  MemberExpression,
  Node,
} from "./ast-types.ts";
import { eq } from "./utils.ts";

/**
 * Combines multiple predicates with AND logic.
 */
export function allOf<T>(
  ...predicates: Array<(value: T) => boolean>
): (value: T) => boolean {
  return (value: T): boolean =>
    predicates.every((predicate) => predicate(value));
}

/**
 * Type guard to check if a value is a valid AST node.
 */
export const isNode = (value: unknown): value is Node =>
  typeof value === "object" &&
  value !== null &&
  "type" in value &&
  typeof (value as { type: unknown }).type === "string";

/**
 * Checks if a node is of a specific type.
 */
export const isNodeType =
  <T extends TSESTree.AST_NODE_TYPES>(type: T) =>
  (node: Node): node is Extract<Node, { type: T }> => node.type === type;

/**
 * Checks if a node has a specific name property (for Identifier nodes).
 */
export const isNodeName =
  <T extends string>(name: T) =>
  (node: Identifier): node is Identifier & { name: T } => node.name === name;

/**
 * Type guard for Identifier node.
 */
export const isIdentifier = (node: Node): node is Identifier =>
  node.type === "Identifier";

/**
 * Checks if a node's key is an Identifier (for Property nodes).
 */
export const hasIdentifierKey = (
  node: TSESTree.Property,
): node is TSESTree.Property & { key: Identifier } =>
  node.key.type === "Identifier";

/**
 * Checks if a node's callee is a MemberExpression.
 */
export const hasMemberExpressionCallee = (
  node: CallExpression,
): node is CallMemberExpression => node.callee.type === "MemberExpression";

/**
 * Checks if a node's callee property is an Identifier.
 */
export const hasIdentifierProperty = (
  node: CallMemberExpression,
): node is CallMemberExpressionWithIdentifier =>
  node.callee.property.type === "Identifier";

/**
 * Checks if a node's callee property name matches the given method name.
 */
export const hasMethodName =
  <T extends string>(methodName: T) =>
  (node: CallMemberExpressionWithIdentifier): boolean =>
    node.callee.property.name === methodName;

/**
 * Checks if a CallExpression has minimum required arguments.
 */
export const hasMinArguments =
  (min: number) => (node: CallExpression): boolean =>
    node.arguments.length >= min;

/**
 * Checks if an expression is an arrow function.
 */
export const isArrowFunction = (
  node: Node,
): node is TSESTree.ArrowFunctionExpression =>
  node.type === "ArrowFunctionExpression";

/**
 * Checks if an expression is a function expression.
 */
export const isFunctionExpression = (
  node: Node,
): node is TSESTree.FunctionExpression => node.type === "FunctionExpression";

/**
 * Checks if an expression is a function (arrow or regular).
 */
export const isFunction = (node: Node): node is FunctionNode =>
  isArrowFunction(node) || isFunctionExpression(node);

/**
 * Checks if a CallExpression is a setActorDispatcher call with proper structure.
 */
export const isSetActorDispatcherCall = (
  node: CallExpression,
): node is CallMemberExpressionWithIdentifier & {
  callee: MemberExpression & {
    property: Identifier & { name: "setActorDispatcher" };
  };
} => {
  if (!hasMemberExpressionCallee(node)) return false;
  if (!hasIdentifierProperty(node)) return false;
  if (!hasMethodName("setActorDispatcher")(node)) return false;
  if (!hasMinArguments(2)(node)) return false;
  return true;
};
