export type { Operator, OperatorSpec } from "./const.ts";
import type { Operator } from "./const.ts";

/**
 * Path-shaped URI Template accepted by the router.
 *
 * The empty path is accepted so trailing-slash-insensitive routing can retry
 * the root path (`/`) as an empty path.
 */
export type Path = "" | `/${string}` | `{/${string}}${string}`;

/**
 * Primitive value accepted by {@link Template.expand}.
 */
export type PrimitiveValue = string | number | boolean | null | undefined;

/**
 * Associative composite value accepted by
 * {@link Template.expand}.
 *
 * Keys are expanded as URI Template associative names. Values may be primitive
 * values or primitive lists.
 */
export type AssociativeValue = Record<
  string,
  PrimitiveValue | readonly PrimitiveValue[]
>;

/**
 * Any value shape accepted for one template variable during expansion.
 */
export type ExpandValue =
  | PrimitiveValue
  | readonly PrimitiveValue[]
  | AssociativeValue;

/**
 * Context object accepted by {@link Template.expand}.
 * Each variable resolves to a primitive, an ordered list of primitives,
 * or an associative map.
 */
export type ExpandContext = Record<string, ExpandValue>;

/**
 * Parsed RFC 6570 variable specification inside an expression.
 *
 * Produced by the expression parser and consumed by the expansion module.
 */
export interface VarSpec {
  /** Variable name to look up in the expansion context. */
  name: string;
  /** Whether the varspec uses the Level 4 explode modifier (`*`). */
  explode: boolean;
  /** Prefix length from a Level 4 prefix modifier (`:N`), if present. */
  prefix?: number;
}

/**
 * Token produced by parsing a URI Template.
 *
 * Literal tokens are copied directly. Expression tokens are expanded with a
 * context object.
 */
export type Token =
  | { kind: "literal"; text: string }
  | { kind: "expression"; operator: Operator; vars: VarSpec[] };

/**
 * Options controlling URI Template parsing and expansion diagnostics.
 */
export interface TemplateOptions {
  /**
   * If `true`, the first parse or expansion error will be automatically
   * thrown after being reported. `true` is the default value. If `false`,
   * errors will be reported to by the `report` function, but none will be
   * thrown unless the `report` function itself throws.
   */
  strict: boolean;
  /**
   * A function that will be called with any errors encountered while parsing
   * or expanding.  Defaults to a no-op; pass a callback (for example, one
   * backed by your application's logger) to observe diagnostics. In strict
   * mode, errors are still thrown after this reporter runs.
   * @param error The error that was encountered while parsing or expanding the
   *              template.
   */
  report: Reporter;
}

/**
 * Callback used to report recoverable parse and expansion diagnostics.
 */
export type Reporter = (error: Error) => void;
