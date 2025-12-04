import {
  filter,
  isArray,
  isEmpty,
  isNil,
  isObject,
  negate,
  pipe,
  pipeLazy,
  prop,
  some,
  toArray,
} from "@fxts/core";
import { actorPropertyMismatch } from "./messages.ts";
import {
  allOf,
  hasIdentifierKey,
  hasMemberExpressionCallee,
  isFunction,
  isNodeName,
  isNodeType,
  isSetActorDispatcherCall,
} from "./pred.ts";
import { trackFederationVariables } from "./tracker.ts";
import type {
  ASTNode,
  FunctionNode,
  MethodCallContext,
  MismatchRuleConfig,
} from "./types.ts";
import { eq } from "./utils.ts";

/**
 * Checks if a value is a valid AST node object.
 */
const isASTNode = (node: unknown): node is ASTNode =>
  isObject(node) && !isNil(node);

/**
 * Filters and casts array items to ASTNode.
 */
const filterASTNodes = (items: unknown[]): ASTNode[] =>
  pipe(
    items,
    filter(isObject),
    filter((p): p is ASTNode => !isNil(p)),
    toArray,
  );

const isIdentifierWithName =
  <T extends string>(name: T) =>
  <N extends ASTNode>(node: N): node is N & {
    "type": "Identifier";
    "name": T;
  } => allOf(isNodeType("Identifier"), isNodeName(name))(node);

/**
 * Checks if a node is a CallExpression calling the expected context method.
 */
const isExpectedMethodCall = (
  node:
    | Deno.lint.Expression
    | Deno.lint.AssignmentPattern
    | Deno.lint.TSEmptyBodyFunctionExpression,
  { ctxName, idName, methodName, requiresIdentifier }: MethodCallContext,
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

const isPropertyWithKeyName = (path: string) =>
(
  node: ASTNode,
): node is { type: "Property"; key: { name: string } & ASTNode } & ASTNode =>
  allOf(
    isNodeType("Property"),
    hasIdentifierKey,
    pipeLazy(
      prop("key")<{ key: { name: string } }>,
      prop("name"),
      eq(path),
    ) as (value: unknown) => boolean,
  )(node);

/**
 * Creates a property existence checker for the given property path.
 * Only checks if the property exists, not its value.
 */
const createPropertyExistenceChecker = (propertyPath: string) => {
  const path = propertyPath.split(".");
  const checkPropertyExists = (path: string[]) => (node: ASTNode): boolean => {
    if (!isPropertyWithKeyName(path[0])(node)) return false;

    // Base case: last property in path
    if (path.length === 1) return true;

    // Nested case: check the nested object
    const value = node.value;
    if (!isNodeType("ObjectExpression")(value)) return false;

    return pipe(
      value.properties,
      filterASTNodes,
      some(checkPropertyExists(path.slice(1))),
    );
  };

  return (prop: ASTNode): boolean =>
    allOf(isASTNode, checkPropertyExists(path))(prop);
};

/**
 * Creates a property value checker for the given property path.
 * Handles both simple properties (e.g., "id") and nested properties (e.g., ["endpoints", "sharedInbox"]).
 */
const createPropertyValueChecker = (
  propertyPath: string,
  ctx: MethodCallContext,
) => {
  const path = propertyPath.split(".");
  const checkPropertyValue = (path: string[]) => (prop: ASTNode): boolean => {
    if (!isPropertyWithKeyName(path[0])(prop)) return false;

    // Base case: last property in path
    const value = prop.value;
    if (path.length === 1) {
      return isExpectedMethodCall(value, ctx);
    }

    // Nested case: check the nested object
    if (!isNodeType("ObjectExpression")(value)) {
      return false;
    }

    return pipe(
      value.properties,
      filterASTNodes,
      some(checkPropertyValue(path.slice(1))),
    );
  };

  return (prop: ASTNode): boolean =>
    allOf(isASTNode, checkPropertyValue(path))(prop);
};

/**
 * Checks if an ObjectExpression contains a property with the correct method call.
 */
const checkObjectExpression =
  (propertyChecker: (prop: ASTNode) => boolean) =>
  <N extends Deno.lint.ObjectExpression>(obj: N): boolean => {
    if (!isArray(obj.properties)) return false;
    return pipe(obj.properties, filterASTNodes, some(propertyChecker));
  };

/**
 * Checks if a ConditionalExpression (ternary operator) has the correct property value in both branches.
 */
const checkConditionalExpression =
  (propertyChecker: (prop: ASTNode) => boolean) =>
  (node: Deno.lint.ConditionalExpression): boolean => {
    const checkBranch = (branch: ASTNode): boolean => {
      // Handle nested ternary operators
      if (isNodeType("ConditionalExpression")(branch)) {
        return checkConditionalExpression(propertyChecker)(branch);
      }

      // Pattern: new Person({ property: ctx.method() })
      if (isNodeType("NewExpression")(branch)) {
        return branch.arguments.filter(isNodeType("ObjectExpression"))
          .some(checkObjectExpression(propertyChecker));
      }

      // Pattern: { property: ctx.method() }
      if (isNodeType("ObjectExpression")(branch)) {
        return checkObjectExpression(propertyChecker)(branch);
      }

      return false;
    };

    return checkBranch(node.consequent) && checkBranch(node.alternate);
  };

/**
 * Checks if a ReturnStatement contains the correct property value.
 */
const checkReturnStatement =
  (propertyChecker: (prop: ASTNode) => boolean) => (node: ASTNode): boolean => {
    const arg = prop("argument")(node);
    if (!isASTNode(arg)) return false;

    // Pattern: ternary operator
    if (isNodeType("ConditionalExpression")(arg)) {
      return checkConditionalExpression(propertyChecker)(arg);
    }

    // Pattern: new Person({ property: ctx.method() })
    if (isNodeType("NewExpression")(arg)) {
      return arg.arguments.filter(isNodeType("ObjectExpression"))
        .some(checkObjectExpression(propertyChecker));
    }

    // Pattern: { property: ctx.method() }
    if (isNodeType("ObjectExpression")(arg)) {
      return checkObjectExpression(propertyChecker)(arg);
    }

    return false;
  };

/**
 * Recursively checks if a function body contains the correct property value.
 */
const checkFunctionBody =
  (propertyChecker: (prop: ASTNode) => boolean) => (node: ASTNode): boolean => {
    if (!isASTNode(node)) return false;

    if (isNodeType("ReturnStatement")(node)) {
      return checkReturnStatement(propertyChecker)(node);
    }

    if (isNodeType("BlockStatement")(node) && Array.isArray(node.body)) {
      return node.body.some(checkFunctionBody(propertyChecker));
    }

    // Pattern: arrow function direct return with object literal
    // e.g., (ctx, identifier) => ({ id: ctx.getActorUri(identifier) })
    if (isNodeType("ObjectExpression")(node)) {
      return checkObjectExpression(propertyChecker)(node);
    }

    // Pattern: arrow function direct return with new expression
    // e.g., (ctx, identifier) => new Person({ id: ctx.getActorUri(identifier) })
    if (isNodeType("NewExpression")(node)) {
      return node.arguments.filter(isNodeType("ObjectExpression"))
        .some(checkObjectExpression(propertyChecker));
    }

    // Pattern: arrow function direct return with ternary
    if (isNodeType("ConditionalExpression")(node)) {
      return checkConditionalExpression(propertyChecker)(node);
    }

    return false;
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

const getNameIfIdentifier = (node: Deno.lint.Parameter): string | null =>
  isNodeType("Identifier")(node) ? prop("name")(node) : null;
/**
 * Creates a lint rule that checks if a property uses the correct context method.
 *
 * @param config Configuration object containing property path, method name, and identifier requirement
 * @returns A Deno lint rule
 */
export const createMismatchRule = (
  {
    propertyPath,
    methodName,
    requiresIdentifier = true,
  }: MismatchRuleConfig,
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
            ctxName,
            idName,
            methodName,
            requiresIdentifier,
          };

          // Check if the property exists first
          const existenceChecker = createPropertyExistenceChecker(propertyPath);
          const hasProperty = checkFunctionBody(existenceChecker)(
            dispatcherArg.body,
          );

          // If property doesn't exist, don't report (that's for *-required rules)
          if (!hasProperty) return;

          // Property exists, now check if the value is correct
          const valueChecker = createPropertyValueChecker(
            propertyPath,
            methodCallContext,
          );
          const hasCorrectValue = checkFunctionBody(valueChecker)(
            dispatcherArg.body,
          );

          if (!hasCorrectValue) {
            const expectedCall = requiresIdentifier
              ? `${ctxName}.${methodName}(${idName})`
              : `${ctxName}.${methodName}()`;

            context.report({
              node: dispatcherArg,
              message: actorPropertyMismatch(propertyPath, expectedCall),
            });
          }
        },
      };
    },
  };
};
