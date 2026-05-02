export type { Operator, OperatorSpec } from "./const.ts";
import type { Operator } from "./const.ts";

/**
 * Primitive value accepted by {@link Template.expand}.
 */
export type PrimitiveValue = string | number | boolean | null | undefined;

/**
 * Associative composite value accepted by {@link Template.expand}.
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
 * Context object accepted by {@link Template.expand}.  Each variable resolves
 * to a primitive, an ordered list of primitives, or an associative map.
 */
export type ExpandContext = Record<string, ExpandValue>;

/**
 * Variable specification produced when a template is added to a {@link Router}.
 */
export interface VariableSpec {
  varname: string;
}

/**
 * Route entry returned by {@link Router.addTemplate}.
 */
export interface Route {
  uriTemplate: string;
  matchValue: unknown;
  variables: VariableSpec[];
}

/**
 * Hierarchy node tracked internally by a {@link Router}, exposed as a mutable
 * field so that callers may clone routers via structural copy.
 */
export interface HierarchyNode {
  children: HierarchyNode[];
  node?: Route;
  uriTemplate?: string;
}

/**
 * Result returned by {@link Router.resolveURI} when a URI matches a registered
 * template.
 */
export interface Result {
  matchValue: string;
  params: Record<string, string>;
  uri: string;
  uriTemplate: string;
}

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
   * A function that will be called with any errors encountered while parsing.
   * By default, errors are ignored.  In strict mode, they are still thrown
   * after this reporter runs.
   * @param error The error that was encountered while parsing the template.
   * @returns The result of the report function.
   */
  report: Reporter;
}

/**
 * Callback used by the parser to report recoverable parse diagnostics.
 */
export type Reporter = (error: Error) => void;
