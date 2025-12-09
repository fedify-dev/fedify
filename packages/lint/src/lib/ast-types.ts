/**
 * Common AST type definitions for ESLint rules.
 * Uses TSESTree types from @typescript-eslint/utils.
 */
import type { TSESTree } from "@typescript-eslint/utils";

// ============================================================================
// Re-export TSESTree types with aliases for convenience
// ============================================================================

export type Node = TSESTree.Node;
export type Expression = TSESTree.Expression;
export type Statement = TSESTree.Statement;
export type Parameter = TSESTree.Parameter;
export type Pattern = TSESTree.BindingName;

export type Identifier = TSESTree.Identifier;
export type MemberExpression = TSESTree.MemberExpression;
export type CallExpression = TSESTree.CallExpression;
export type ObjectExpression = TSESTree.ObjectExpression;
export type Property = TSESTree.Property;
export type NewExpression = TSESTree.NewExpression;
export type ConditionalExpression = TSESTree.ConditionalExpression;
export type SpreadElement = TSESTree.SpreadElement;
export type ArrowFunctionExpression = TSESTree.ArrowFunctionExpression;
export type FunctionExpression = TSESTree.FunctionExpression;
export type BlockStatement = TSESTree.BlockStatement;
export type ReturnStatement = TSESTree.ReturnStatement;
export type VariableDeclarator = TSESTree.VariableDeclarator;
export type Program = TSESTree.Program;

// ============================================================================
// Custom Union Types
// ============================================================================

export type FunctionNode = ArrowFunctionExpression | FunctionExpression;

// ============================================================================
// CallExpression with MemberExpression callee
// ============================================================================

export interface CallMemberExpression extends Omit<CallExpression, "callee"> {
  callee: MemberExpression;
}

export interface CallMemberExpressionWithIdentifier
  extends Omit<CallExpression, "callee"> {
  callee: MemberExpression & {
    property: Identifier;
  };
}
