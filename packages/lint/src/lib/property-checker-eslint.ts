/**
 * Property checkers for ESLint rules.
 * Uses TSESTree types from @typescript-eslint/utils.
 */
import { pipe, some } from "@fxts/core";
import type { TSESTree } from "@typescript-eslint/utils";
import type { MethodCallContext } from "./types.ts";

// ============================================================================
// Type Aliases
// ============================================================================

type Node = TSESTree.Node;
type Property = TSESTree.Property;
type ObjectExpression = TSESTree.ObjectExpression;
type NewExpression = TSESTree.NewExpression;
type BlockStatement = TSESTree.BlockStatement;
type ReturnStatement = TSESTree.ReturnStatement;
type ConditionalExpression = TSESTree.ConditionalExpression;
type CallExpression = TSESTree.CallExpression;
type MemberExpression = TSESTree.MemberExpression;
type Identifier = TSESTree.Identifier;
type FunctionNode =
  | TSESTree.ArrowFunctionExpression
  | TSESTree.FunctionExpression;

// ============================================================================
// Basic Type Guards
// ============================================================================

const isProperty = (node: Node): node is Property => node.type === "Property";

const isObjectExpression = (node: Node): node is ObjectExpression =>
  node.type === "ObjectExpression";

const isNewExpression = (node: Node): node is NewExpression =>
  node.type === "NewExpression";

const isBlockStatement = (node: Node): node is BlockStatement =>
  node.type === "BlockStatement";

const isReturnStatement = (node: Node): node is ReturnStatement =>
  node.type === "ReturnStatement";

const isConditionalExpression = (node: Node): node is ConditionalExpression =>
  node.type === "ConditionalExpression";

const isCallExpression = (node: Node): node is CallExpression =>
  node.type === "CallExpression";

const isIdentifier = (node: Node): node is Identifier =>
  node.type === "Identifier";

const isMemberExpression = (node: Node): node is MemberExpression =>
  node.type === "MemberExpression";

// ============================================================================
// Property Name Checkers
// ============================================================================

/**
 * Checks if a Property node has an Identifier key with a specific name.
 */
const hasPropertyKeyName = (name: string) => (node: Property): boolean =>
  node.key.type === "Identifier" && node.key.name === name;

/**
 * Finds a property with a specific name in an ObjectExpression.
 */
const findPropertyByName =
  (name: string) => (obj: ObjectExpression): Property | undefined =>
    obj.properties.find(
      (p): p is Property => isProperty(p) && hasPropertyKeyName(name)(p),
    );

// ============================================================================
// ObjectExpression Extractors
// ============================================================================

/**
 * Extracts the first ObjectExpression argument from a NewExpression.
 */
const extractObjectFromNewExpression = (
  node: NewExpression,
): ObjectExpression | null => {
  const firstArg = node.arguments[0];
  if (firstArg && isObjectExpression(firstArg)) {
    return firstArg;
  }
  return null;
};

/**
 * Extracts ObjectExpression from a Property value.
 * Handles both direct ObjectExpression and NewExpression with ObjectExpression argument.
 */
const extractObjectFromPropertyValue = (
  prop: Property,
): ObjectExpression | null => {
  const value = prop.value;
  if (isObjectExpression(value)) {
    return value;
  }
  if (isNewExpression(value)) {
    return extractObjectFromNewExpression(value);
  }
  return null;
};

// ============================================================================
// Property Existence Checker
// ============================================================================

/**
 * Recursively checks if a property path exists in an ObjectExpression.
 */
const checkPropertyPathExists =
  (path: readonly string[]) => (obj: ObjectExpression): boolean => {
    if (path.length === 0) return true;

    const prop = findPropertyByName(path[0])(obj);
    if (!prop) return false;

    if (path.length === 1) return true;

    const nestedObj = extractObjectFromPropertyValue(prop);
    if (!nestedObj) return false;

    return checkPropertyPathExists(path.slice(1))(nestedObj);
  };

/**
 * Creates a checker that verifies a property path exists.
 */
export const createPropertyExistenceChecker =
  (path: readonly string[]) => (obj: ObjectExpression): boolean =>
    checkPropertyPathExists(path)(obj);

// ============================================================================
// Property Value Checker
// ============================================================================

/**
 * Checks if a node is the expected method call.
 * e.g., ctx.getActorUri(identifier)
 */
const isExpectedMethodCall = (
  node: Node,
  ctx: MethodCallContext,
): boolean => {
  if (!isCallExpression(node)) return false;
  if (!isMemberExpression(node.callee)) return false;

  const { object, property } = node.callee;
  if (!isIdentifier(object) || object.name !== ctx.ctxName) return false;
  if (!isIdentifier(property) || property.name !== ctx.methodName) return false;

  if (!ctx.requiresIdentifier) {
    return node.arguments.length === 0;
  }

  return node.arguments.some(
    (arg) => isIdentifier(arg) && arg.name === ctx.idName,
  );
};

/**
 * Recursively checks if a property path has the correct method call value.
 */
const checkPropertyPathValue =
  (path: readonly string[], ctx: MethodCallContext) =>
  (obj: ObjectExpression): boolean => {
    if (path.length === 0) return false;

    const prop = findPropertyByName(path[0])(obj);
    if (!prop) return false;

    if (path.length === 1) {
      return isExpectedMethodCall(prop.value, ctx);
    }

    const nestedObj = extractObjectFromPropertyValue(prop);
    if (!nestedObj) return false;

    return checkPropertyPathValue(path.slice(1), ctx)(nestedObj);
  };

/**
 * Creates a checker that verifies a property has the correct method call value.
 */
export const createPropertyValueChecker =
  (path: readonly string[], ctx: MethodCallContext) =>
  (obj: ObjectExpression): boolean => checkPropertyPathValue(path, ctx)(obj);

// ============================================================================
// Function Body Checkers
// ============================================================================

/**
 * Extracts ObjectExpression from a node that might be a NewExpression.
 */
const extractObjectFromNode = (node: Node): ObjectExpression | null => {
  if (isNewExpression(node)) {
    return extractObjectFromNewExpression(node);
  }
  return null;
};

/**
 * Checks a conditional expression branch for a property.
 */
const checkConditionalBranch =
  (checker: (obj: ObjectExpression) => boolean) => (node: Node): boolean => {
    if (isConditionalExpression(node)) {
      return (
        checkConditionalBranch(checker)(node.consequent) &&
        checkConditionalBranch(checker)(node.alternate)
      );
    }

    const obj = extractObjectFromNode(node);
    return obj ? checker(obj) : false;
  };

/**
 * Searches a function body for ObjectExpressions and applies a checker.
 */
export const searchFunctionBody =
  (checker: (obj: ObjectExpression) => boolean) => (body: Node): boolean => {
    if (isBlockStatement(body)) {
      return body.body.some(searchFunctionBody(checker));
    }

    if (isReturnStatement(body)) {
      const arg = body.argument;
      if (!arg) return false;

      if (isConditionalExpression(arg)) {
        return checkConditionalBranch(checker)(arg);
      }

      const obj = extractObjectFromNode(arg);
      return obj ? checker(obj) : false;
    }

    // Arrow function with direct expression body
    if (isNewExpression(body)) {
      const obj = extractObjectFromNewExpression(body);
      return obj ? checker(obj) : false;
    }

    if (isConditionalExpression(body)) {
      return checkConditionalBranch(checker)(body);
    }

    return false;
  };

// ============================================================================
// Parameter Extraction
// ============================================================================

/**
 * Extracts the first two parameter names from a function.
 * Returns [ctxName, idName] or [null, null] if not enough parameters.
 */
export const extractFunctionParams = (
  fn: FunctionNode,
): [string | null, string | null] => {
  const params = fn.params;
  if (params.length < 2) return [null, null];

  const getName = (param: TSESTree.Parameter): string | null =>
    param.type === "Identifier" ? param.name : null;

  return [getName(params[0]), getName(params[1])];
};

/**
 * Checks if a function has at least n parameters.
 */
export const hasMinParams = (min: number) => (fn: FunctionNode): boolean =>
  fn.params.length >= min;
