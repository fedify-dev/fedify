import type { Expression, Node, TemplateAst, VarSpec } from "./ast.ts";
import { ParseError } from "./error.ts";

/**
 * Parse a RFC 6570 URI template string into an AST.
 *
 * @param template - The URI template string to parse
 * @returns The parsed template AST
 * @throws {ParseError} If the template syntax is invalid
 *
 * @remarks
 * Parser guarantees:
 * - Balanced braces: every '{' has a matching '}' or throws ParseError
 * - Operator is one of "", "+", "#", ".", "/", ";", "?", "&"
 * - VarSpec list: "name[:prefix][*]" items separated by ','
 *
 * We avoid regex for correctness and slice the source directly to keep
 * raw segments intact for later matching.
 *
 * @example
 * ```typescript
 * const ast = parse("{+path}/here");
 * // Returns AST with expression (op: "+", vars: [{name: "path"}]) and literal ("/here") nodes
 * ```
 *
 * @example
 * ```typescript
 * const ast = parse("/repos{/owner,repo}{?q,lang}");
 * // Returns AST with literal and two expression nodes
 * ```
 */
export function parse(template: string): TemplateAst {
  const nodes: Node[] = [];
  let i = 0;
  const pushLiteral = (start: number, end: number) => {
    if (end > start) {
      nodes.push({
        kind: "literal",
        value: template.slice(start, end),
        start,
        end,
      });
    }
  };

  // We collect [literal] chunks until '{', then parse an [expression],
  // then continue scanning for the next '{'.
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
    // Read operator (optional). If next char in "+#./;?&", consume as operator.
    // Otherwise use "" (simple operator).
    const opChar = "+#./;?&".includes(template[i])
      ? template[i++] as Expression["op"]
      : "" as Expression["op"];
    const vars: VarSpec[] = [];
    // Read variable name; stop at ':', '*', ',', or '}'.
    // Note: Empty names are illegal per RFC 6570.
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

      // Handle modifiers:
      //  - :n  -> prefix length (integer >= 0)
      //  - *   -> explode
      // Enforce ordering: name [ ":" digits ] [ "*" ]
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
      // Close '}' or throw.
      if (template[i] === "}") {
        i++;
        break;
      }
      throw new ParseError("Unexpected character in expression", i);
    }

    nodes.push(
      {
        kind: "expression",
        op: opChar,
        vars,
        start: exprStart,
        end: i,
      } as Expression,
    );
  }

  return { nodes };
}
