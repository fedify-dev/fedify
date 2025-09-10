import type { Expression, Node, TemplateAST, VarSpec } from "./ast.ts";

export class ParseError extends Error {
  constructor(message: string, public index: number) {
    super(`${message} at ${index}`);
  }
}

export function parse(template: string): TemplateAST {
  const nodes: Node[] = [];
  let i = 0;
  const pushLiteral = (start: number, end: number) => {
    if (end > start) {
      nodes.push({
        kind: "Literal",
        value: template.slice(start, end),
        start,
        end,
      });
    }
  };

  while (i < template.length) {
    const litStart = i;
    while (i < template.length && template[i] !== "{") i++;
    pushLiteral(litStart, i);
    if (i >= template.length) break;
    // expression
    const exprStart = i;
    i++; // skip "{"
    if (i >= template.length) {
      throw new ParseError("Unclosed expression", exprStart);
    }
    const opChar = "+#./;?&".includes(template[i])
      ? template[i++] as Expression["op"]
      : "" as Expression["op"];
    const vars: VarSpec[] = [];
    const readName = (): string => {
      const start = i;
      while (
        i < template.length &&
        template[i] !== "}" &&
        template[i] !== "," &&
        template[i] !== ":" &&
        template[i] !== "*"
      ) i++;
      if (i === start) throw new ParseError("Empty variable name", i);
      return template.slice(start, i);
    };

    while (true) {
      const name = readName();
      let explode = false;
      let prefix: number | undefined;

      if (template[i] === ":") {
        i++;
        const start = i;
        while (i < template.length && /[0-9]/.test(template[i])) i++;
        if (i === start) throw new ParseError("Expected prefix length", i);
        prefix = parseInt(template.slice(start, i), 10);
        if (!(prefix >= 0)) {
          throw new ParseError("Invalid prefix length", start);
        }
      }
      if (template[i] === "*") {
        explode = true;
        i++;
      }
      vars.push({ name, explode, prefix });

      if (template[i] === ",") {
        i++;
        continue;
      }
      if (template[i] === "}") {
        i++;
        break;
      }
      throw new ParseError("Unexpected character in expression", i);
    }

    nodes.push(
      {
        kind: "Expression",
        op: opChar,
        vars,
        start: exprStart,
        end: i,
      } as Expression,
    );
  }

  return { nodes };
}
