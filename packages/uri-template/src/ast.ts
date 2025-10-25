/**
 * RFC 6570 operator set. Keep in sync with {@link OperatorSpec} in spec.ts.
 * The operator controls separators, first-char prefix, and reserved char handling.
 */
export type Operator =
  | "" // simple
  | "+"
  | "#"
  | "."
  | "/"
  | ";"
  | "?"
  | "&";

/**
 * A variable specification inside an expression
 * - `explode` (`*`) and `prefix` (`:n`) modifies are Level 4 features.
 * - Parser guarentees: if `prefix` is present, it is a positive integer.
 */
export interface VarSpec {
  name: string;
  explode: boolean;
  prefix?: number; // :n
}

export type Node = Literal | Expression;

export interface Literal {
  kind: "literal";
  value: string; // as-is literal (template text)
  start?: number; // optional raw slice for debugging
  end?: number;
}

export interface Expression {
  kind: "expression";
  op: Operator;
  vars: VarSpec[];
  start?: number;
  end?: number;
}

/**
 * Template AST root. Expansion and matching both consume this structure.
 * @note Literals are kept as-is to avoid re-encoding surprises.
 */
export interface TemplateAst {
  nodes: Node[];
}
