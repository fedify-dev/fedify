/**
 * A logic-less GitHub-Actions-style `${{ ... }}` template engine for scenario
 * files.
 *
 * Expressions are intentionally restricted to property access on a context
 * object (`${{ target.host }}`) and whitelisted helper calls
 * (`${{ uuid() }}`).  There are no operators, conditionals, or loops, so a
 * scenario file cannot turn into a programming language.  The `$` prefix also
 * sidesteps the YAML gotcha where a value beginning with `{` is parsed as a
 * flow mapping.
 * @since 2.3.0
 * @module
 */

/** A helper function callable from a `${{ ... }}` expression. */
export type TemplateHelper = (...args: unknown[]) => unknown;

/**
 * The evaluation context for {@link renderTemplates}.
 * @since 2.3.0
 */
export interface TemplateContext {
  /** Named values resolvable by dotted path, e.g. `target.host`. */
  readonly values?: Readonly<Record<string, unknown>>;
  /** Named helper functions callable as `name(args)`. */
  readonly helpers?: Readonly<Record<string, TemplateHelper>>;
}

/** An error raised while rendering a `${{ ... }}` template expression. */
export class TemplateError extends Error {}

const EXPR_RE = /\$\{\{([\s\S]*?)\}\}/g;
const CALL_RE = /^([A-Za-z_]\w*)\s*\(([\s\S]*)\)$/;
const IDENT_RE = /^[A-Za-z_]\w*$/;

/** Property names that must never be resolved, to avoid prototype access. */
const FORBIDDEN = new Set(["__proto__", "prototype", "constructor"]);

/** A guard against unbounded recursion on pathologically nested input. */
const MAX_DEPTH = 100;

/**
 * Recursively renders every `${{ ... }}` expression in a value.
 *
 * When a string consists of a single expression, the raw evaluated value is
 * returned (so `${{ count }}` can yield a number).  When an expression is
 * embedded in surrounding text, its result is stringified and interpolated.
 * Objects and arrays are walked recursively; other scalars pass through.
 * @typeParam T The value type.
 * @param value The value to render.
 * @param context The evaluation context.
 * @returns The rendered value, of the same shape as the input.
 */
export function renderTemplates<T>(value: T, context: TemplateContext = {}): T {
  return renderValue(value, context) as T;
}

function renderValue(
  value: unknown,
  ctx: TemplateContext,
  depth = 0,
): unknown {
  if (depth > MAX_DEPTH) {
    throw new TemplateError("Maximum template nesting depth exceeded.");
  }
  if (typeof value === "string") return renderString(value, ctx);
  // Walk arrays and objects copy-on-write: allocate a new container only once a
  // child actually changes (back-filling the unchanged prefix), so an unchanged
  // subtree is returned by reference with no cloning at all.
  if (Array.isArray(value)) {
    let out: unknown[] | undefined;
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      const rendered = renderValue(item, ctx, depth + 1);
      if (out == null && rendered !== item) out = value.slice(0, i);
      if (out != null) out.push(rendered);
    }
    return out ?? value;
  }
  if (value != null && typeof value === "object") {
    const entries = Object.entries(value);
    let out: Record<string, unknown> | undefined;
    for (let i = 0; i < entries.length; i++) {
      const [key, item] = entries[i];
      const rendered = renderValue(item, ctx, depth + 1);
      if (out == null && rendered !== item) {
        out = {};
        for (let j = 0; j < i; j++) out[entries[j][0]] = entries[j][1];
      }
      if (out != null) out[key] = rendered;
    }
    return out ?? value;
  }
  return value;
}

function renderString(str: string, ctx: TemplateContext): unknown {
  const matches = [...str.matchAll(EXPR_RE)];
  // Every `${{` must have a matching `}}`; an unclosed delimiter is a typo.
  if (str.split("${{").length - 1 !== matches.length) {
    throw new TemplateError(`Unclosed \${{ }} expression: ${str}`);
  }
  if (matches.length === 0) return str;
  // A string is a "whole expression" only when the single match spans the
  // entire string apart from surrounding whitespace; otherwise interpolate so
  // trailing text is not silently discarded.
  const only = matches[0];
  if (
    matches.length === 1 &&
    str.slice(0, only.index).trim() === "" &&
    str.slice(only.index + only[0].length).trim() === ""
  ) {
    return evalExpr(only[1], ctx);
  }
  return str.replace(EXPR_RE, (_match, expr) => stringify(evalExpr(expr, ctx)));
}

function evalExpr(source: string, ctx: TemplateContext): unknown {
  const expr = source.trim();
  if (expr === "") throw new TemplateError("Empty ${{ }} expression.");
  const call = expr.match(CALL_RE);
  if (call != null) {
    const name = call[1];
    const helper = FORBIDDEN.has(name) || ctx.helpers == null ||
        !Object.hasOwn(ctx.helpers, name)
      ? undefined
      : ctx.helpers[name];
    if (typeof helper !== "function") {
      throw new TemplateError(`Unknown helper: ${name}.`);
    }
    return helper(...parseArgs(call[2], ctx));
  }
  return resolvePath(expr, ctx.values ?? {});
}

function parseArgs(source: string, ctx: TemplateContext): unknown[] {
  const trimmed = source.trim();
  if (trimmed === "") return [];
  return splitTopLevel(trimmed).map((arg) => parseArg(arg.trim(), ctx));
}

function splitTopLevel(source: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (const char of source) {
    if (quote != null) {
      if (char === quote) quote = null;
      current += char;
    } else if (char === "'" || char === '"') {
      quote = char;
      current += char;
    } else if (char === ",") {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (quote != null) {
    throw new TemplateError("Unbalanced quote in helper arguments.");
  }
  parts.push(current);
  return parts;
}

function parseArg(arg: string, ctx: TemplateContext): unknown {
  const str = arg.match(/^'([^']*)'$/) ?? arg.match(/^"([^"]*)"$/);
  if (str != null) return str[1];
  if (/^-?\d+(?:\.\d+)?$/.test(arg)) return Number(arg);
  if (arg === "true") return true;
  if (arg === "false") return false;
  if (arg === "null") return null;
  return resolvePath(arg, ctx.values ?? {});
}

function resolvePath(
  path: string,
  values: Readonly<Record<string, unknown>>,
): unknown {
  let current: unknown = values;
  for (const part of path.split(".")) {
    if (!IDENT_RE.test(part) || FORBIDDEN.has(part)) {
      throw new TemplateError(`Invalid reference: ${path}.`);
    }
    if (
      current == null || typeof current !== "object" ||
      !Object.hasOwn(current as Record<string, unknown>, part)
    ) {
      throw new TemplateError(`Unknown reference: ${path}.`);
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function stringify(value: unknown): string {
  return value == null ? "" : String(value);
}
