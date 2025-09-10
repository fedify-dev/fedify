import type { Expression, Operator, TemplateAST, VarSpec } from "./ast.ts";
import { encodeComponentIdempotent, OP } from "./spec.ts";

type Scalar = string | number | boolean;
type Dict = Record<string, Scalar | undefined>;
type List = (Scalar | undefined)[];
type MapLike = Record<string, Scalar | undefined>;

export type VarsValue = Scalar | List | MapLike | undefined;
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
  if (v.prefix !== undefined) s = s.slice(0, v.prefix);
  const e = enc(s);

  if (e.length === 0) {
    if (spec.named && spec.ifEmpty === "nameOnly") return [v.name];
    if (spec.named && spec.ifEmpty === "empty") {
      return [`${v.name}${spec.kvSep}`];
    }
    return [];
  }
  return [emitNamed(spec, v.name, e)];
}

export function expand(ast: TemplateAST, vars: Vars): string {
  let out = "";
  for (const node of ast.nodes) {
    if (node.kind === "Literal") {
      out += node.value;
    } else {
      const spec = OP[node.op];
      const pieces: string[] = [];
      for (const v of node.vars) {
        pieces.push(...expandVar(node.op, v, vars[v.name]));
      }
      if (pieces.length === 0) continue;
      if (spec.first) out += spec.first;
      out += pieces.join(spec.itemSep);
    }
  }
  return out;
}
