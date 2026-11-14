/**
 * Structural AST helpers shared by rules that analyze a whole program.  A
 * structural view keeps the analysis independent of the three AST providers:
 * typescript-eslint (ESLint), Oxlint, and Deno Lint.
 * @module
 */

/** A structural view of an AST node from any of the supported providers. */
export type Ast = { type: string; [key: string]: unknown };
/** TypeScript and parenthesis wrappers that pass a value through unchanged. */
export const expressionWrappers: ReadonlySet<string> = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
  "ParenthesizedExpression",
]);
/** Returns `value` as a node if it looks like one. */
export function ast(value: unknown): Ast | undefined {
  return value != null &&
    typeof value === "object" &&
    typeof (value as Ast).type === "string"
    ? (value as Ast)
    : undefined;
}
/** Strips {@link expressionWrappers} around an expression. */
export function unwrap(node: Ast | undefined): Ast | undefined {
  while (node && expressionWrappers.has(node.type)) node = ast(node.expression);
  return node;
}
/** The name of an identifier, or the value of a string literal. */
export function name(value: unknown): string | undefined {
  const node = ast(value);
  return node?.type === "Identifier"
    ? (node.name as string)
    : typeof node?.value === "string"
      ? node.value
      : undefined;
}
/**
 * The child nodes of `node`, never following parent pointers.  Deno exposes
 * AST fields through non-enumerable getters, so the standard child fields are
 * listed explicitly; type annotations are not traversed.
 */
export function children(node: Ast): Ast[] {
  const result: Ast[] = [];
  // Deno exposes AST fields through non-enumerable getters.  Include its
  // standard child fields explicitly, while retaining parser-specific fields
  // from ESTree providers.  Never follow parent pointers.
  const keys = new Set([
    ...Object.keys(node),
    "declaration",
    "openingElement",
    "closingElement",
    "attributes",
    "decorators",
    "parameter",
    "body",
    "expression",
    "expressions",
    "declarations",
    "id",
    "init",
    "params",
    "param",
    "callee",
    "arguments",
    "object",
    "property",
    "key",
    "value",
    "properties",
    "elements",
    "left",
    "right",
    "argument",
    "test",
    "consequent",
    "alternate",
    "block",
    "handler",
    "finalizer",
    "cases",
    "discriminant",
    "update",
    "specifiers",
    "local",
    "imported",
    "source",
    "superClass",
    "tag",
    "quasi",
    "quasis",
    "children",
    "members",
    "initializer",
  ]);
  for (const key of keys) {
    // ESTree providers attach the token and comment arrays to Program:
    if (key === "parent" || key === "tokens" || key === "comments") continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        const child = ast(item);
        if (child) result.push(child);
      }
    } else {
      const child = ast(value);
      if (child) result.push(child);
    }
  }
  return result;
}
/**
 * Whether `source` is an import specifier of Fedify's built-in vocabulary
 * module: `@fedify/vocab`, or the deprecated `@fedify/fedify/vocab`
 * re-export, including `jsr:`/`npm:` prefixed and versioned forms.
 */
export function isVocabularySource(source: string): boolean {
  return (
    /^(?:jsr:|npm:)?@fedify\/vocab(?:@[^/]+)?$/.test(source) ||
    /^(?:jsr:|npm:)?@fedify\/fedify(?:@[^/]+)?\/vocab$/.test(source)
  );
}
