import type * as ESTree from "estree";

export type BlockStatement =
  | Deno.lint.BlockStatement
  | ESTree.BlockStatement;
export type CallExpression = Deno.lint.CallExpression | ESTree.CallExpression;
export type ConditionalExpression =
  | Deno.lint.ConditionalExpression
  | ESTree.ConditionalExpression;
export type Expression =
  | Deno.lint.Expression
  | ESTree.Expression
  | ESTree.Super;
export type Identifier = Deno.lint.Identifier | ESTree.Identifier;
export type MemberExpression =
  | Deno.lint.MemberExpression
  | ESTree.MemberExpression;
export type NewExpression = Deno.lint.NewExpression | ESTree.NewExpression;
export type Node = Deno.lint.Node | ESTree.Node;
export type ObjectExpression =
  | Deno.lint.ObjectExpression
  | ESTree.ObjectExpression;
export type ObjectPattern =
  | Deno.lint.ObjectPattern
  | ESTree.ObjectPattern;
export type Parameter = Deno.lint.Parameter | ESTree.Pattern;
export type PrivateIdentifier =
  | Deno.lint.PrivateIdentifier
  | ESTree.PrivateIdentifier;
export type Property = Deno.lint.Property | ESTree.Property;
export type ReturnStatement =
  | Deno.lint.ReturnStatement
  | ESTree.ReturnStatement;
export type SpreadElement = Deno.lint.SpreadElement | ESTree.SpreadElement;
export type Statement = Deno.lint.Statement | ESTree.Statement;
export type VariableDeclarator =
  | Deno.lint.VariableDeclarator
  | ESTree.VariableDeclarator;

export type AssignmentPattern =
  | Deno.lint.AssignmentPattern
  | ESTree.AssignmentPattern;

export type FunctionNode =
  | Deno.lint.ArrowFunctionExpression
  | Deno.lint.FunctionExpression
  | ESTree.ArrowFunctionExpression
  | ESTree.FunctionExpression;

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
  key: Identifier & { name: T };
}
