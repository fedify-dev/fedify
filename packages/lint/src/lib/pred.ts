import { isNil, isObject, isString, negate, pipe, prop } from "@fxts/core";
import type {
  ASTNode,
  CallMemberExpression,
  CallMemberExpressionWithIdentified,
  FunctionNode,
} from "./types.ts";
import { eq } from "./utils.ts";

interface Predicate<T> {
  (value: unknown): value is T;
}

/**
 * Combines multiple predicates with AND logic.
 */
export function allOf<T, S extends T>(
  ...refinements: (((value: T) => boolean) | Predicate<S>)[]
): (v: T) => v is S;
export function allOf<T>(
  ...predicates: ((value: T) => boolean)[]
): (value: T) => boolean;
export function allOf<T>(
  ...predicates: Array<(value: T) => boolean>
): (value: T) => boolean {
  return (value: T): boolean =>
    predicates.every((predicate) => predicate(value));
}

/**
 * Type guard to check if a value is a valid AST node.
 */
export const isASTNode = (value: unknown): value is ASTNode =>
  allOf(isObject, negate(isNil), hasTypeProperty)(value);

const hasTypeProperty = <N>(node: N): node is N & { "type": string } =>
  pipe(node as { "type": unknown }, prop("type"), isString) as boolean;

/**
 * Checks if a node is of a specific type.
 */
export const isNodeType =
  <T extends string>(type: T) =>
  <N extends ASTNode>(node: N): node is { "type": T } & N =>
    pipe(
      node,
      prop("type"),
      eq<unknown, unknown>(type),
    ) as boolean;

/**
 * Checks if a node is of a specific name.
 */
export const isNodeName =
  <T extends string>(name: T) => <N>(node: N): node is N & { "name": T } =>
    pipe(
      node as { "name": string },
      prop("name"),
      eq(name),
    ) as boolean;

/**
 * Checks if a node has a key that is an AST node.
 */
export const hasASTNodeKey = <N>(node: N): node is N & { "key": ASTNode } =>
  pipe(node as { "key": ASTNode }, prop("key"), isASTNode);

/**
 * Checks if a node's key is an Identifier.
 */
export const hasIdentifierKey = <N>(
  node: N,
): node is N & { "key": ASTNode & { type: "Identifier" } } =>
  pipe(
    node as { "key": ASTNode },
    prop("key"),
    allOf(isASTNode, isNodeType("Identifier")),
  );

/**
 * Checks if a node's callee is a MemberExpression.
 */
export const hasMemberExpressionCallee = (
  node: Deno.lint.CallExpression,
): node is CallMemberExpression => node.callee.type === "MemberExpression";

/**
 * Checks if a node's callee property is an Identifier.
 */
export const hasIdentifierProperty = (
  node: CallMemberExpression,
): node is CallMemberExpressionWithIdentified =>
  node.callee.property.type === "Identifier";

/**
 * Checks if a node's callee property name matches the given method name.
 */
export const hasMethodName =
  <T extends string>(methodName: T) =>
  <N extends CallMemberExpressionWithIdentified>(node: N): node is N & {
    callee: { property: { name: T } };
  } => node.callee.property.name === methodName;

/**
 * Checks if a CallExpression has minimum required arguments.
 */
export const hasMinArguments =
  (min: number) => (node: Deno.lint.CallExpression): boolean =>
    node.arguments.length >= min;

/**
 * Checks if an expression is an arrow function.
 */
export const isArrowFunction = (
  expr: Deno.lint.Expression | Deno.lint.SpreadElement,
): expr is Deno.lint.ArrowFunctionExpression =>
  isNodeType("ArrowFunctionExpression")(expr);

/**
 * Checks if an expression is a function expression.
 */
export const isFunctionExpression = (
  expr: Deno.lint.Expression | Deno.lint.SpreadElement,
): expr is Deno.lint.FunctionExpression =>
  isNodeType("FunctionExpression")(expr);

/**
 * Checks if an expression is a function (arrow or regular).
 */
export const isFunction = (
  expr: Deno.lint.Expression | Deno.lint.SpreadElement,
): expr is FunctionNode => isArrowFunction(expr) || isFunctionExpression(expr);

/**
 * Checks if a CallExpression is a setActorDispatcher call with proper structure.
 */
export const isSetActorDispatcherCall = <N extends Deno.lint.CallExpression>(
  node: N,
): node is N & CallMemberExpressionWithIdentified & {
  callee: { property: Deno.lint.Identifier & { name: "setActorDispatcher" } };
} =>
  allOf(
    hasMemberExpressionCallee,
    hasIdentifierProperty as (node: unknown) => boolean,
    hasMethodName("setActorDispatcher") as (node: unknown) => boolean,
    hasMinArguments(2),
  )(node);
