/**
 * ESLint adapter types and utilities.
 * Provides compatibility layer between ESLint and our common AST types.
 */
import type { TSESLint, TSESTree } from "@typescript-eslint/utils";
import type {
  ASTNode,
  CallExpression,
  FunctionNode,
  VariableDeclarator,
} from "./ast-types.ts";
import type { PropertyConfig } from "./types.ts";

// ============================================================================
// ESLint Rule Types
// ============================================================================

/**
 * ESLint rule context type
 */
export type ESLintRuleContext = TSESLint.RuleContext<string, unknown[]>;

/**
 * ESLint rule module type
 */
export type ESLintRuleModule = TSESLint.RuleModule<string, unknown[]>;

/**
 * ESLint rule listener type
 */
export type ESLintRuleListener = TSESLint.RuleListener;

/**
 * ESLint fixer type
 */
export type ESLintFixer = TSESLint.RuleFixer;

// ============================================================================
// Report Descriptor Types
// ============================================================================

export interface ReportDescriptor {
  node: ASTNode;
  message: string;
}

// ============================================================================
// Unified Rule Context Interface
// ============================================================================

/**
 * Unified context interface for both Deno.lint and ESLint.
 */
export interface UnifiedRuleContext {
  report(descriptor: ReportDescriptor): void;
}

/**
 * Creates a unified context from an ESLint rule context.
 */
export const createUnifiedContext = (
  eslintContext: ESLintRuleContext,
  messageId: string,
): UnifiedRuleContext => ({
  report: ({ node, message }) => {
    eslintContext.report({
      node: node as unknown as TSESTree.Node,
      messageId,
      data: { message },
    });
  },
});

// ============================================================================
// Unified Rule Visitor Interface
// ============================================================================

export interface UnifiedRuleVisitor {
  VariableDeclarator?(node: VariableDeclarator): void;
  CallExpression?(node: CallExpression): void;
  "Program:exit"?(): void;
}

// ============================================================================
// Rule Factory Types
// ============================================================================

/**
 * Actor dispatcher info for tracking
 */
export interface ActorDispatcherInfo {
  node: CallExpression;
  dispatcherArg: FunctionNode;
}

/**
 * Factory function type for creating rules
 */
export type RuleFactory = (config: PropertyConfig) => {
  create(context: UnifiedRuleContext): UnifiedRuleVisitor;
};

// ============================================================================
// ESLint Plugin Types
// ============================================================================

/**
 * ESLint plugin configuration
 */
export interface ESLintPlugin {
  meta: {
    name: string;
    version: string;
  };
  rules: Record<string, ESLintRuleModule>;
  configs: Record<string, ESLintPluginConfig>;
}

/**
 * ESLint plugin config
 */
export interface ESLintPluginConfig {
  plugins?: string[];
  rules?: Record<string, unknown>;
}

// ============================================================================
// Node Type Guards (ESLint-specific)
// ============================================================================

/**
 * Converts TSESTree node to common ASTNode type.
 */
export const toASTNode = (node: TSESTree.Node): ASTNode =>
  node as unknown as ASTNode;

/**
 * Converts common ASTNode to TSESTree node type.
 */
export const toTSESTreeNode = (node: ASTNode): TSESTree.Node =>
  node as unknown as TSESTree.Node;
