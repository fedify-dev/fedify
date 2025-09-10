import { err } from "./error.ts";

export type OperatorKey = "" | "+" | "#" | "/" | "?" | "&";

export interface TemplateAST {
  kind: "TemplateAST";
  source: string;
  parts: Part[]; // sequence of literals and expressions, in order
}

export type Part = LitNode | ExprNode;

export interface LitNode {
  kind: "Lit";
  // Slice into source string (avoid extra allocation until needed)
  start: number;
  end: number;
}

export interface ExprNode {
  kind: "Expr";
  start: number; // index of '{'
  end: number; // index after '}'
  op: OperatorKey;
  vars: VarSpec[];
}

export interface VarSpec {
  // name indexes into source string
  nameStart: number;
  nameEnd: number;
  // modifiers
  explode: boolean; // '*'
  prefixLen: number | 0; // ':n' (0 When absent)
}

export interface ParserOptions {
  /**
   * strict=true enforces RFC-leaning checks (valid varname charset, numeric prefix, non-empty varlist, etc.).
   * strict=false will accept more inputs and normalize where reasonable.
   */
  strict?: boolean;
}

export function parseTemplateFast(
  src: string,
  opts: ParserOptions = {},
): TemplateAST {
  const strict = opts.strict ?? true;
  const parts: Part[] = [];
  const n = src.length;

  let i = 0;
  let litStart = 0;

  while (i < n) {
    const ch = src.charCodeAt(i);
    if (ch !== 0x7b /* '{' */) {
      i++;
      continue;
    }

    // flush literal before '{'
    if (litStart < i) {
      parts.push({ kind: "Lit", start: litStart, end: i });
    }

    const exprStart = i;
    i++; // skip '{'
    if (i >= n) throw err(src, i - 1, "Unclosed expression");

    // operator detection
    let op: OperatorKey = "";
    const opCh = src.charCodeAt(i);
    if (
      opCh === 0x2b /* '+' */ || opCh === 0x23 /* '#' */ ||
      opCh === 0x2f /* '/' */ || opCh === 0x3f /* '?' */ ||
      opCh === 0x26 /* '&' */
    ) {
      op = src[i] as OperatorKey;
      i++;
    }

    if (i >= n) throw err(src, i, "Unexpected end inside expression");

    // parse varspec list
    //
    // ```
    // varspec ("," varspec)*
    // ```
    const vars: VarSpec[] = [];
    let expectVar = true;

    while (i < n) {
      const c = src.charCodeAt(i);
      if (c === 0x7d /* '}' */) { // end of expression
        if (strict && vars.length === 0) throw err(src, i, "Empty expression");
        i++; // consume '}'
        const exprEnd = i;
        parts.push({ kind: "Expr", start: exprStart, end: exprEnd, op, vars });
        litStart = i; // resume literal after '}'
        break;
      }

      if (!expectVar) {
        // We just consumed a varspec
        // now we expect either ',' or '}' handled above
        if (c === 0x2c /* ',' */) {
          i++;
          expectVar = true;
          continue;
        }
        throw err(src, i, "Expected ',' or '}' after varspec");
      }

      // Parse single varspec
      //
      // ```
      // name [ ':' digits ] [ '*' ] | name [ '*' ] [ ':' digits ]
      // ```
      //
      // We allow either order ('*' then ':n' or ':n' then '*') for leniency mode,
      // strict mode allows only RFC order.
      const nameStart = i;
      // name must have at least one char
      if (i >= n) throw err(src, i, "Unexpected end parsing varname");

      // name: allowed chars subset
      while (i < n) {
        const cc = src.charCodeAt(i);
        if (!isVarNameChar(cc)) break;
        i++;
      }
      const nameEnd = i;
      if (strict && nameEnd === nameStart) {
        throw err(src, i, "Empty variable name");
      }

      // modifiers
      let explode = false;
      let prefixLen = 0;

      // peek next token
      const peek = () => (i < n ? src.charCodeAt(i) : -1);

      // Try RFC order first:
      //  - ':' digits then optional '*'
      if (peek() === 0x3a /* ':' */) {
        i++; // skip ':'
        if (i >= n || !isDigit(src.charCodeAt(i))) {
          if (strict) throw err(src, i, "Expected digits after ':'");
          i--; // undo ':
        } else {
          let num = 0;
          while (i < n && isDigit(src.charCodeAt(i))) {
            num = num * 10 + (src.charCodeAt(i) - 48); // '0' = 48
            i++;
          }
          if (strict && num === 0) {
            throw err(src, i, "Prefix length must be > 0");
          }
          prefixLen = num;
        }
      }

      if (peek() === 0x2a /* '*' */) {
        i++;
        explode = true;
      }

      if (!strict) {
        // fallback: accept '*' then optional ':digits' order as well
        if (prefixLen === 0 && peek() === 0x3a /* ':' */) {
          i++;
          if (i < n && isDigit(src.charCodeAt(i))) {
            let num = 0;
            while (i < n && isDigit(src.charCodeAt(i))) {
              num = num * 10 + (src.charCodeAt(i) - 48);
              i++;
            }
            if (num > 0) prefixLen = num;
            else { /* ignore */ }
          } else {
            // ignore malformed
          }
        }
        if (!explode && peek() === 0x2a /* '*' */) {
          i++;
          explode = true;
        }
      }

      vars.push({ nameStart, nameEnd, explode, prefixLen });
      expectVar = false;
    }

    // if loop ended without encountering '}', it's an error
    if (i >= n) {
      const lastPart = parts[parts.length - 1];
      if (!lastPart || lastPart.end !== n) {
        throw err(src, n - 1, "Unclosed expression (missing '}')");
      }
    }
  }

  // flush trailing literal
  if (litStart < n) {
    parts.push({ kind: "Lit", start: litStart, end: n });
  }

  return { kind: "TemplateAST", source: src, parts };
}

function isVarNameChar(code: number): boolean {
  return (
    ((code - 48) >>> 0 < 10) || // 0-9, unsigned comparison
    ((code - 65) >>> 0 < 26) || // A-Z
    ((code - 97) >>> 0 < 26) || // a-z
    (code === 95) || // _
    (code === 46) // .
  );
}

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}
