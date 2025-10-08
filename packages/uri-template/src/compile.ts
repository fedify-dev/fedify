import type { TemplateAst } from "./ast.ts";
import { expand, type Vars } from "./expand.ts";
import { type EncodingPolicy, match, type MatchOptions } from "./match.ts";
import { parse } from "./parser.ts";

/**
 * Options that control how a compiled template behaves during matching.
 *
 * ### encoding
 * Determines how percent-encoded sequences are handled.
 *
 * ### strict
 * If true (default), malformed percent triplets (e.g. "%GZ" or lone "%")
 * cause matching to fail immediately.
 * Disabling strict mode may allow more lenient parsing but can lead to ambiguity.
 */
export interface CompileOptions {
  encoding?: EncodingPolicy;
  strict?: boolean;
}

export interface CompiledTemplate<V = Record<string, unknown>> {
  ast(): TemplateAst;
  expand(vars: V & Vars): string;
  match(url: string, opts?: MatchOptions): null | { vars: V };
}

/**
 * Compile a template string once.
 * Returns a handle with:
 *  - `ast()`     -> the parsed AST (for diagnostics/introspection)
 *  - `expand()`  -> RFC 6570 expansion (L1–L4)
 *  - `match()`   -> symmetric pattern matching
 *
 * Rationale:
 * Compilation isolates parsing cost and allows future VM/bytecode backends
 * to optimize hot routes without changing the API.
 */
export function compile<V = Record<string, unknown>>(
  template: string,
): CompiledTemplate<V> {
  const ast = parse(template);
  return {
    ast: () => ast,
    expand: (vars: V & Vars) => expand(ast, vars),
    match: (url: string, mo?: MatchOptions) => {
      const result = match(ast, url, mo);
      return result ? { vars: result.vars as V } : null;
    },
  };
}
