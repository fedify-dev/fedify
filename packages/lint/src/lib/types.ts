import type { TSESTree } from "@typescript-eslint/utils";

export type BlockStatement = Deno.lint.BlockStatement | TSESTree.BlockStatement;
export type CallExpression = Deno.lint.CallExpression | TSESTree.CallExpression;
export type Expression = Deno.lint.Expression | TSESTree.Expression;
export type Identifier = Deno.lint.Identifier | TSESTree.Identifier;
export type MemberExpression =
  | Deno.lint.MemberExpression
  | TSESTree.MemberExpression;
export type NewExpression = Deno.lint.NewExpression | TSESTree.NewExpression;
export type Node = Deno.lint.Node | TSESTree.Node;
export type ObjectExpression =
  | Deno.lint.ObjectExpression
  | TSESTree.ObjectExpression;
export type Parameter = Deno.lint.Parameter | TSESTree.Parameter;
export type PrivateIdentifier =
  | Deno.lint.PrivateIdentifier
  | TSESTree.PrivateIdentifier;
export type Property = Deno.lint.Property | TSESTree.Property;
export type ReturnStatement =
  | Deno.lint.ReturnStatement
  | TSESTree.ReturnStatement;
export type SpreadElement = Deno.lint.SpreadElement | TSESTree.SpreadElement;
export type Statement = Deno.lint.Statement | TSESTree.Statement;

export type AssignmentPattern =
  | Deno.lint.AssignmentPattern
  | TSESTree.AssignmentPattern;
export type TSEmptyBodyFunctionExpression =
  | Deno.lint.TSEmptyBodyFunctionExpression
  | TSESTree.TSEmptyBodyFunctionExpression;

export type FunctionNode =
  | Deno.lint.ArrowFunctionExpression
  | Deno.lint.FunctionExpression
  | TSESTree.ArrowFunctionExpression
  | TSESTree.FunctionExpression;

export type CallMemberExpression = CallExpression & {
  callee: MemberExpression;
};

export type CallMemberExpressionWithIdentified = CallExpression & {
  callee: MemberExpression & {
    property: Identifier;
  };
};

export type PropertyChecker = (
  prop:
    | Property
    | SpreadElement,
) => boolean;

/**
 * Configuration for nested property wrappers.
 * Used when a property needs to be wrapped in a class instance
 * (e.g., `new Endpoints({...})`).
 */
interface NestedPropertyConfig {
  /** Parent property name (e.g., "endpoints") */
  parent: string;
  /** Wrapper class name (e.g., "Endpoints") */
  wrapper: string;
}

/**
 * Configuration for an actor property.
 */
export interface PropertyConfig {
  /** Property name (e.g., "id", "sharedInbox") */
  name: string;
  /**
   * Full property path for lint rules
   * (e.g., ["id"], ["endpoints", "sharedInbox"])
   */
  path: readonly string[];
  /** Context method name to get the URI (e.g., "getActorUri", "getInboxUri") */
  getter: string;
  /**
   * Dispatcher/Listener method name
   * (e.g., "setActorDispatcher", "setInboxListeners")
   */
  setter: string;
  /** Whether the getter requires an identifier parameter (default: true) */
  requiresIdentifier: boolean;
  /** Nested property configuration, if this property is nested inside another */
  nested?: NestedPropertyConfig;
  /** Whether this is a key-related property (uses getActorKeyPairs) */
  isKeyProperty?: boolean;
}

/**
 * Context for method call validation.
 */
export interface MethodCallContext {
  path: string;
  ctxName: string;
  idName: string;
  methodName: string;
  requiresIdentifier: boolean;
}

export interface WithIdentifierKey<T extends string> {
  key: {
    type: "Identifier" | TSESTree.AST_NODE_TYPES.Identifier;
    name: T;
  };
}
