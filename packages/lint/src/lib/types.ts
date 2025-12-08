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
 * Configuration for nested property wrappers.
 * Used when a property needs to be wrapped in a class instance (e.g., `new Endpoints({...})`).
 */
export interface NestedPropertyConfig {
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
  /** Full property path for lint rules (e.g., ["id"], ["endpoints", "sharedInbox"]) */
  path: readonly string[];
  /** Context method name to get the URI (e.g., "getActorUri", "getInboxUri") */
  getter: string;
  /** Dispatcher/Listener method name (e.g., "setActorDispatcher", "setInboxListeners") */
  setter: string;
  /** Whether the getter requires an identifier parameter (default: true) */
  requiresIdentifier: boolean;
  /** Nested property configuration, if this property is nested inside another */
  nested?: NestedPropertyConfig;
  /** Whether this is a key-related property (uses getActorKeyPairs) */
  isKeyProperty?: boolean;
}

export type ASTNode =
  & { "type": string }
  & (Deno.lint.Node | Deno.lint.Parameter);

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
