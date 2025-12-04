interface CallExpressionWithoutCallee {
  type: "CallExpression";
  range: Deno.lint.Range;
  optional: boolean;
  typeArguments: Deno.lint.TSTypeParameterInstantiation | null;
  arguments: Array<Deno.lint.Expression | Deno.lint.SpreadElement>;
  parent: Deno.lint.Node;
}
export interface CallMemberExpression extends CallExpressionWithoutCallee {
  callee: Deno.lint.MemberExpression;
}

export interface CallMemberExpressionWithIdentified
  extends CallExpressionWithoutCallee {
  callee: Deno.lint.MemberExpression & {
    property: Deno.lint.Identifier;
  };
}

export type FunctionNode =
  | Deno.lint.ArrowFunctionExpression
  | Deno.lint.FunctionExpression;

/**
 * Configuration for property mismatch rules.
 * These rules check if a property uses the correct `ctx.get*()` method.
 */
export interface MismatchRuleConfig {
  /** Property path to check. Can be a single property name or an array for nested properties. */
  propertyPath: string;
  /** Expected context method name (e.g., "getActorUri", "getInboxUri") */
  methodName: string;
  /** Whether the method requires identifier parameter (default: true) */
  requiresIdentifier?: boolean;
}

export type ASTNode =
  & { "type": string }
  & (Deno.lint.Node | Deno.lint.Parameter);

/**
 * Context for method call validation.
 */
export interface MethodCallContext {
  ctxName: string;
  idName: string;
  methodName: string;
  requiresIdentifier: boolean;
}
