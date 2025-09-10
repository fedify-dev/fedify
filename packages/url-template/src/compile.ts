import type { TemplateAST } from "./ast.ts";
import { parse } from "./parser.ts";
import { expand, type Vars } from "./expand.ts";
import { match, type MatchOptions } from "./match.ts";

export interface CompileOptions {
  encoding?: "opaque" | "cooked" | "lossless";
  strict?: boolean;
}

export interface CompiledTemplate<V = Record<string, unknown>> {
  ast(): TemplateAST;
  expand(vars: V & Vars): string;
  match(url: string, opts?: MatchOptions): null | { vars: V };
}

export function compile<V = Record<string, unknown>>(
  template: string,
  opts?: CompileOptions,
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
