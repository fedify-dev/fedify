import { pipe, prop } from "@fxts/core";
import type { TSESTree } from "@typescript-eslint/utils";
import type {
  CallExpression,
  CallMemberExpression,
  CallMemberExpressionWithIdentified,
  Expression,
  FunctionNode,
  Node,
  SpreadElement,
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

export const anyOf =
  <T>(...predicates: ((value: T) => boolean)[]) => (value: T): boolean =>
    predicates.some((predicate) => predicate(value));

/**
 * Checks if a node is of a specific type.
 */
export const isNodeType =
  <T extends TSESTree.AST_NODE_TYPES | string>(type: T) =>
  (node: Node): node is { "type": T } & Node =>
    pipe(
      node,
      prop("type"),
      eq<string, string>(type),
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
 * Checks if a node's key is an Identifier.
 */
export const hasIdentifierKey = <T extends Deno.lint.Property>(
  node: T,
): node is T & { "key": Deno.lint.Identifier } =>
  pipe(node, prop("key"), isNodeType("Identifier")) as boolean;

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
  node: CallExpression,
): node is CallMemberExpressionWithIdentified =>
  "callee" in node &&
  "property" in node.callee &&
  "type" in node.callee.property &&
  node.callee.property.type === "Identifier";

/**
 * Checks if a node's callee property name matches the given method name.
 */
export const hasMethodName =
  <T extends string>(methodName: T) =>
  (node: CallExpression): node is CallExpression & {
    callee: { property: { name: T } };
  } =>
    "callee" in node &&
    "property" in node.callee &&
    "name" in node.callee.property &&
    node.callee.property.name === methodName;

/**
 * Checks if a CallExpression has minimum required arguments.
 */
export const hasMinArguments =
  (min: number) =>
  <T extends CallExpression>(node: T): node is Extract<T, {
    arguments: { length: number };
  }> => node.arguments.length >= min;

/**
 * Checks if an expression is a function (arrow or regular).
 */
export const isFunction = (
  expr:
    | Expression
    | SpreadElement,
): expr is FunctionNode =>
  anyOf(
    isNodeType("ArrowFunctionExpression"),
    isNodeType("FunctionExpression"),
  )(expr);

/**
 * Checks if a CallExpression is a setActorDispatcher call with proper structure.
 */
export const isSetActorDispatcherCall = (
  node: CallExpression,
): node is CallMemberExpressionWithIdentified & {
  callee: { property: Deno.lint.Identifier & { name: "setActorDispatcher" } };
} =>
  allOf(
    hasMemberExpressionCallee,
    hasIdentifierProperty,
    hasMethodName("setActorDispatcher"),
    hasMinArguments(2),
  )(node);

/**
 * Checks if an object has a specific property key.
 */
export const hasProp =
  <K extends string>(key: K) =>
  <T>(obj: T): obj is Extract<T, Record<K, unknown>> =>
    Object.prototype.hasOwnProperty.call(obj, key);

/**
 * Checks if a function has at least n parameters.
 */
export const hasMinParams = (min: number) => (fn: FunctionNode): boolean =>
  fn.params.length >= min;
