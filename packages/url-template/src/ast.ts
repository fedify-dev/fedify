// AST for RFC 6570
export type Operator =
  | "" // simple
  | "+"
  | "#"
  | "."
  | "/"
  | ";"
  | "?"
  | "&";

export interface VarSpec {
  name: string;
  explode: boolean;
  prefix?: number; // :n
}

export type Node = Literal | Expression;

export interface Literal {
  kind: "Literal";
  value: string; // as-is literal (template text)
  start?: number; // optional raw slice for debugging
  end?: number;
}

export interface Expression {
  kind: "Expression";
  op: Operator;
  vars: VarSpec[];
  start?: number;
  end?: number;
}

export interface TemplateAST {
  nodes: Node[];
}
