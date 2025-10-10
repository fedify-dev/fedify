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

/**
 * A compiled URI template that can efficiently expand and match URLs.
 * 
 * @typeParam V - The type of variables expected by this template
 * 
 * @example
 * ```typescript
 * const t = compile("{+path}/here");
 * const url = t.expand({ path: "/foo/bar" }); // "/foo/bar/here"
 * const match = t.match("/foo/bar/here"); // { vars: { path: "/foo/bar" } }
 * ```
 * 
 * @example
 * ```typescript
 * const t = compile("/repos{/owner,repo}{?q,lang}");
 * const url = t.expand({ owner: "alice", repo: "hello%2Fworld", q: "a b", lang: "en" });
 * // "/repos/alice/hello%252Fworld?q=a%20b&lang=en"
 * ```
 */
export interface CompiledTemplate<V = Record<string, unknown>> {
  /**
   * Get the parsed AST of this template.
   * Useful for diagnostics and introspection.
   * 
   * @returns The parsed template AST
   */
  ast(): TemplateAst;
  
  /**
   * Expand the template with the given variables according to RFC 6570.
   * 
   * @param vars - Variables to substitute into the template
   * @returns The expanded URL string
   */
  expand(vars: V & Vars): string;
  
  /**
   * Match a URL against this template and extract variables.
   * 
   * @param url - The URL to match against the template
   * @param opts - Optional matching options
   * @returns An object with extracted variables if matched, null otherwise
   */
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
