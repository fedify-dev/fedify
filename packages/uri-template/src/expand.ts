import type { Expression, Operator, TemplateAst, VarSpec } from "./ast.ts";
import { encodeComponentIdempotent, OP } from "./spec.ts";

/**
 * A scalar value that can be used in template expansion.
 */
type Scalar = string | number | boolean;

/**
 * A list of scalar values that can be used in template expansion.
 */
type List = (Scalar | undefined)[];

/**
 * A map-like object with scalar values.
 */
type MapLike = Record<string, Scalar | undefined>;

/**
 * Valid value types for template variables.
 */
type VarsValue = Scalar | List | MapLike | undefined;

/**
 * A collection of variables for template expansion.
 * Maps variable names to their values.
 * 
 * @example
 * ```typescript
 * const vars: Vars = {
 *   var: "value",
 *   list: ["red", "green", "blue"],
 *   keys: { semi: ";", dot: ".", comma: "," }
 * };
 * ```
 */
export type Vars = Record<string, VarsValue>;

function emitNamed(
  spec: typeof OP[Operator],
  name: string,
  raw: string,
): string {
  return spec.named
    ? (raw === "" && spec.ifEmpty === "empty"
      ? `${name}${spec.kvSep}`
      : `${name}${spec.kvSep}${raw}`)
    : raw;
}

function expandVar(
  op: Expression["op"],
  v: VarSpec,
  value: VarsValue,
): string[] {
  const spec = OP[op];
  const enc = (str: string) =>
    encodeComponentIdempotent(str, spec.allowReserved, spec.reservedSet);

  // undefined/null
  if (value === undefined || value === null) {
    // 1. For operators with undefined values: must be completely omitted (not even the name)
    // 2. For operators with empty string values: should output only the name without = (nameOnly behavior)
    return [];
  }

  // Array
  if (Array.isArray(value)) {
    const items = value.filter((x) => x !== undefined).map((x) =>
      enc(String(x))
    );
    if (items.length === 0) {
      if (spec.first === ".") return [""]; // empty label still emits the dot
      if (spec.named && spec.ifEmpty === "nameOnly") return [v.name];
      if (spec.named && spec.ifEmpty === "empty") {
        return [`${v.name}${spec.kvSep}`];
      }
      return [];
    }
    if (v.explode) return items.map((it) => emitNamed(spec, v.name, it));
    return [emitNamed(spec, v.name, items.join(","))];
  }

  // Map
  if (typeof value === "object" && value && !Array.isArray(value)) {
    const entries = Object.entries(value as MapLike).filter(([, vv]) =>
      vv !== undefined
    );
    if (entries.length === 0) {
      if (spec.named && spec.ifEmpty === "nameOnly") return [v.name];
      if (spec.named && spec.ifEmpty === "empty") {
        return [`${v.name}${spec.kvSep}`];
      }
      return [];
    }
    if (v.explode) {
      return entries.map(([k, vv]) =>
        `${enc(k)}${spec.kvSep}${enc(String(vv as Scalar))}`
      );
    }
    const joined = entries.map(([k, vv]) =>
      `${enc(k)},${enc(String(vv as Scalar))}`
    ).join(",");
    return [emitNamed(spec, v.name, joined)];
  }

  // Scalar
  let s = String(value as Scalar);
  // Prefix `:n` applies BEFORE encoding; then we encode the substring.
  // Do not slice encoded output.
  if (v.prefix !== undefined) s = s.slice(0, v.prefix);
  const e = enc(s);

  if (e.length === 0) {
    // Label '.' must still print the dot even if the value is empty.
    // We return [""] so caller pints `first="."` + empty piece -> "."
    if (spec.first === ".") return [""];
    if (spec.named && spec.ifEmpty === "nameOnly") return [v.name];
    if (spec.named && spec.ifEmpty === "empty") {
      return [`${v.name}${spec.kvSep}`];
    }
    return [];
  }
  return [emitNamed(spec, v.name, e)];
}

/**
 * Expand a parsed template with variables according to RFC 6570 (Level 1-4).
 * 
 * @param ast - The parsed template AST to expand
 * @param vars - Variables to substitute into the template
 * @returns The expanded URL string
 * 
 * @remarks
 * - Idempotent percent encoding (existing `%XX` kept)
 * - Operator-specific empty/undefined rules:
 *   - ";"  empty -> `nameOnly` (";x")
 *   - "?" "&" empty -> "key=" ("?x=")
 *   - `undefined` -> `omit` (all operators)
 * - Label "." emits the dot even if empty ("X{.y}" with y="" -> "X.")
 * 
 * @example
 * ```typescript
 * const ast = parse("{+x,hello,y}");
 * const url = expand(ast, { x: "1024", hello: "Hello World!", y: "768" });
 * // Returns: "1024,Hello%20World!,768"
 * ```
 * 
 * @example
 * ```typescript
 * const ast = parse("{+path}/here");
 * const url = expand(ast, { path: "/foo/bar" });
 * // Returns: "/foo/bar/here"
 * ```
 */
export function expand(ast: TemplateAst, vars: Vars): string {
  let out = "";
  for (const node of ast.nodes) {
    // no need to encode literals, append as-is
    if (node.kind === "literal") {
      out += node.value;
    } else {
      const spec = OP[node.op];
      const pieces: string[] = [];

      for (const v of node.vars) {
        // Expand a single `VarSpec` into 0..n pieces per operator rules.
        // For explode lists/maps we may produce multiple times.
        pieces.push(...expandVar(node.op, v, vars[v.name]));
      }

      // If this expr produced no output, nothing to prepend
      if (pieces.length === 0) continue;

      // Prepend operator 1st char (e.g. "#", ".", "/", ";", "?", "&")
      if (spec.first) out += spec.first;

      // Join with operator item separator (",", ".", "/", "&", ";")
      out += pieces.join(spec.itemSep);
    }
  }
  return out;
}
