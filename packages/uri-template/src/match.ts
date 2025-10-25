import type { TemplateAst, VarSpec } from "./ast.ts";
import {
  looksLikePctTriplet,
  OP,
  type OperatorSpec,
  strictPercentDecode,
} from "./spec.ts";

/**
 * Encoding policy for variable values when matching URLs.
 *
 * Three modes are supported:
 * - `"opaque"` (default):
 *   - Treats `%XX` as opaque atoms.
 *   - No decoding is applied; raw bytes are preserved.
 *   - Guarantees byte-for-byte symmetry:
 *     `expand(match(url)) === url`.
 *   - Background: added to solve `uri-template-router#11` where
 *     sequences like "%30#" lost information.
 *
 * - `"cooked"`:
 *   - Decodes valid `%XX` sequences exactly once.
 *   - More convenient for application logic where you want
 *     human-readable values (`"a%20b"` → `"a b"`).
 *   - Guarantees semantic symmetry:
 *     `match(expand(vars)) === vars`.
 *   - Note: Name chosen to contrast with `"opaque"`: think of
 *     “cooked strings” (escaped string literals) in programming languages.
 *
 * - `"lossless"`:
 *   - Returns both raw and decoded forms:
 *     `{ raw: "a%2Fb", decoded: "a/b" }`.
 *   - Useful if you need to display the original URL while
 *     still working with decoded values.
 */
export type EncodingPolicy = "opaque" | "cooked" | "lossless";

/**
 * Options for matching URLs against templates.
 *
 * @remarks
 * These options control how percent-encoded sequences are handled during matching.
 */
export interface MatchOptions {
  /**
   * The encoding policy for variable values (default: "opaque").
   */
  encoding?: EncodingPolicy;

  /**
   * If true (default), malformed percent triplets cause matching to fail.
   * If false, allows more lenient parsing but may lead to ambiguity.
   */
  strict?: boolean;
}

type VarsOut = Record<string, unknown>;

function decodeAccordingToPolicy(s: string, policy: EncodingPolicy): unknown {
  if (policy === "opaque") return s;
  if (policy === "cooked") return strictPercentDecode(s);
  return { raw: s, decoded: strictPercentDecode(s) };
}

/**
 * consume a percent triplet or a single char; used to advance safely
 *
 * Percent triplet handling policies:
 * - When advancing, treat "%XX" as a single atom to avoid slicing inside a byte.
 * - In strict mode, a bare '%' or bad hex after '%' fails the match.
 */
function advanceOne(url: string, i: number): number {
  if (i < url.length && url[i] === "%" && looksLikePctTriplet(url, i)) {
    return i + 3;
  }
  return i + 1;
}

/**
 * Match a URL string against a compiled template and extract variables.
 *
 * @param ast - The parsed template AST to match against
 * @param url - The URL string to match
 * @param opts - Optional matching options
 * @returns An object with extracted variables if matched, null otherwise
 *
 * Encoding policies:
 * - "opaque"  -> return raw percent-encoded slices (byte-for-byte round-trip)
 * - "cooked"  -> decode %XX exactly once
 * - "lossless"-> { raw, decoded } pair
 *
 * Strictness:
 * - strict=true rejects bad percent triplets (e.g. "%GZ"), preventing
 *   ambiguous or lossy normalization early.
 *
 * @example
 * ```typescript
 * import { parse } from "./parser.ts";
 * import { match } from "./match.ts";
 *
 * const ast = parse("/repos{/owner,repo}{?q,lang}");
 * const result = match(ast, "/repos/alice/hello%2Fworld?q=a%20b&lang=en", { encoding: "opaque" });
 * // Returns: { vars: { owner: "alice", repo: "hello%2Fworld", q: "a%20b", lang: "en" } }
 * ```
 *
 * @example
 * ```typescript
 * import { parse } from "./parser.ts";
 * import { match } from "./match.ts";
 *
 * const ast = parse("/files{/path}");
 * const result = match(ast, "/files/a%2Fb", { encoding: "cooked" });
 * // Returns: { vars: { path: "a/b" } }
 * ```
 */
export function match(
  ast: TemplateAst,
  url: string,
  opts?: MatchOptions,
): null | { vars: VarsOut } {
  const policy: EncodingPolicy = opts?.encoding ?? "opaque";
  const strict = opts?.strict ?? true;

  let i = 0;
  const varsOut: Record<string, unknown> = {};

  // Comsume a literal exactly
  const readLiteral = (lit: string): boolean => {
    if (url.slice(i, i + lit.length) !== lit) return false;
    i += lit.length;
    return true;
  };

  // URL:    /users/foo/hello%2Fworld?q=a%20b&lang=en
  // Tmpl:   /users{/owner,repo}{?q,lang}
  // Phases: LIT----^  EXPR(owner,repo)   EXPR(q,lang)
  //            i-> after literal
  //      [capture until itemSep or next literal/operator.first]
  const nextIs = (s: string) => url.slice(i, i + s.length) === s;

  for (const node of ast.nodes) {
    if (node.kind === "literal") {
      if (!readLiteral(node.value)) return null;
      continue;
    }
    const spec = OP[node.op];
    if (spec.first) {
      // Operators starting with a distinct char must appear in URL
      if (!readLiteral(spec.first)) return null;
    }

    // Greedy capture for each var until separator or upcoming literal.
    // We respect %XX boundaries to avoid splitting in the middle of bytes.
    //
    // For each variable (or entry) separated by itemSep, we capture greedily until:
    //  - next literal (if any) starts
    //  - or next separator occurs
    const takeUntil = (stopPred: (j: number) => boolean): string => {
      const start = i;
      while (i < url.length && !stopPred(i)) {
        // advance by pct or char, but if strict and raw '%' without triplet => fail
        if (strict && url[i] === "%" && !looksLikePctTriplet(url, i)) return "";
        i = advanceOne(url, i);
      }
      return url.slice(start, i);
    };

    const emitScalar = (v: VarSpec, raw: string) => {
      varsOut[v.name] = decodeAccordingToPolicy(raw, policy);
    };

    const splitItems = (raw: string): string[] => {
      if (raw.length === 0) return [""];
      const sep = spec.itemSep;
      // split on itemSep but keep %XX intact
      const out: string[] = [];
      let start = 0;
      for (let j = 0; j <= raw.length;) {
        if (j === raw.length || raw.slice(j, j + sep.length) === sep) {
          out.push(raw.slice(start, j));
          j += sep.length;
          start = j;
          continue;
        }
        j = advanceOne(raw, j);
      }
      return out;
    };

    const captureOneVar = (
      v: VarSpec,
      last: boolean,
      nextLiteral: string | null,
    ): boolean => {
      const stopPred = (j: number) => {
        if (
          nextLiteral && url.slice(j, j + nextLiteral.length) === nextLiteral
        ) return true;
        // otherwise stop on itemSep if not last
        if (
          !last && spec.itemSep &&
          url.slice(j, j + spec.itemSep.length) === spec.itemSep
        ) return true;
        return false;
      };
      const raw = takeUntil(stopPred);
      if (
        raw === "" &&
        (strict && i < url.length && url[i] !== spec.itemSep &&
          nextLiteral === null)
      ) {
        // invalid % or nothing captured when something expected
        return false;
      }
      // explode / map-like detection: we only parse structurally if v.explode OR there is '=' present with named
      if (v.explode) {
        const parts = splitItems(raw);
        if (spec.named) {
          varsOut[v.name] = parseExplodeNamedParts(v, parts, spec, policy);
        } else {
          // non-named explode: list/map compact form to be enhanced later
          varsOut[v.name] = parts.map((p) =>
            decodeAccordingToPolicy(p, policy)
          );
        }
      } else {
        if (spec.named) {
          const [ok, val] = captureNamedNonExplode(v, raw, spec, policy);
          if (!ok) return false;
          varsOut[v.name] = val;
        } else {
          emitScalar(v, raw);
        }
      }
      // consume itemSep if present and not last
      if (!last && spec.itemSep && nextIs(spec.itemSep)) {
        i += spec.itemSep.length;
      }
      return true;
    };

    // Named operators ( ; ? & ):
    // - Non-explode: "name[=value]" -> store VALUE only (not "name=")
    // - Explode:     ";x=a;x=b" or "?k=v&..." -> list or map
    // Decision rule for explode named parts:
    //   if every piece starts with "varName=" => list
    //   else => map (k=v)
    for (let idx = 0; idx < node.vars.length; idx++) {
      const v = node.vars[idx];
      const last = idx === node.vars.length - 1;

      // Determine the next literal after this expression to bound greedy capture
      let nextLiteral: string | null = null;
      // look ahead in AST: find the next literal node
      const nodeIndex = ast.nodes.indexOf(node);
      for (let k = nodeIndex + 1; k < ast.nodes.length; k++) {
        const n = ast.nodes[k];
        if (n.kind === "literal" && n.value.length > 0) {
          nextLiteral = n.value;
          break;
        }
        if (n.kind === "expression" && OP[n.op].first) {
          nextLiteral = OP[n.op].first!;
          break;
        }
      }

      if (!captureOneVar(v, last, nextLiteral)) return null;
    }
    // done with this expression
  }
  // fully consumed? for router-like matching we allow trailing chars only if next literal enforces them
  return { vars: varsOut };
}

// In named operators, non-explode variables decompose the name[=value] form
function captureNamedNonExplode(
  v: VarSpec,
  raw: string,
  spec: OperatorSpec,
  policy: EncodingPolicy,
): [ok: boolean, val: unknown] {
  // ; operator: name or name=value (empty value nameOnly allowed)
  // ?/& operators: must be name[=value] (empty value is name=)
  const eq = raw.indexOf(spec.kvSep);
  if (eq === -1) {
    if (spec.first === ";") {
      // ";x" → empty value
      if (raw === v.name) return [true, decodeAccordingToPolicy("", policy)];
    }
    return [false, null];
  }
  const lhs = raw.slice(0, eq), rhs = raw.slice(eq + spec.kvSep.length);
  if (lhs !== v.name) return [false, null];
  return [true, decodeAccordingToPolicy(rhs, policy)];
}

function parseExplodeNamedParts(
  v: VarSpec,
  parts: string[],
  spec: OperatorSpec,
  policy: EncodingPolicy,
): unknown {
  // List vs Map determination:
  // If all items are in "varName=…" format, it's a list
  const allVarName = parts.every((p) => p.startsWith(v.name + spec.kvSep));
  if (allVarName) {
    return parts.map((p) => {
      const rhs = p.slice((v.name + spec.kvSep).length);
      return decodeAccordingToPolicy(rhs, policy);
    });
  }
  // Otherwise it's a map (k=v)
  const obj: Record<string, unknown> = {};
  for (const p of parts) {
    const i = p.indexOf(spec.kvSep);
    if (i < 0) {
      obj[decodeAccordingToPolicy(p, policy) as string] = "";
      continue;
    }
    const k = p.slice(0, i), val = p.slice(i + spec.kvSep.length);
    obj[decodeAccordingToPolicy(k, policy) as string] = decodeAccordingToPolicy(
      val,
      policy,
    );
  }
  return obj;
}
