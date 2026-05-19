import type { Template } from "../template/mod.ts";
import type { Operator, Path, Token } from "../types.ts";

/**
 * Options for the {@link Router}.
 */
export interface RouterOptions {
  /**
   * Whether to ignore trailing slashes when matching paths.
   */
  trailingSlashInsensitive?: boolean;
}

/**
 * Fully-resolved per-variable matching constraint.  Every template variable
 * is constrained even when it is not listed in {@link RouteOptions.variables};
 * the listed entries only override the defaults.  All fields are required;
 * call sites pass a {@link Partial} and {@link fillRouteOptions} fills the
 * missing fields with their defaults.
 */
export interface VariableConstraint {
  /**
   * When `true`, an unbound or empty binding still matches (opt-out of the
   * non-empty requirement).  Defaults to `false`.
   */
  readonly nullable: boolean;

  /**
   * Whether the variable binds to a list of values rather than a single
   * scalar.  When omitted it is derived from the variable specification:
   * explode (`*`) implies `true`, a prefix modifier (`:N`) implies `false`,
   * and a plain variable defaults to `false` but may be set either way.
   * Specifying a value that contradicts the derived one is a registration
   * error.
   */
  readonly multiple: boolean;

  /**
   * Whether the variable may appear more than once in the route template.
   * Defaults to `false`: a variable that occurs in multiple variable
   * specifications is a registration error (`DuplicateRouteVariableError`).
   * Set to `true` to allow repeated occurrences (their bindings must still
   * agree at match time).
   */
  readonly duplicable: boolean;

  /**
   * Whether a variable specification may use the prefix modifier (`:N`).
   * Defaults to `false`: a `{var:N}` specification is a registration error
   * (`DisallowedVarSpecModifierError`).  Incompatible with `multiple: true`
   * (a prefix yields a single truncated scalar); that combination is
   * already rejected by the `multiple` derivation.
   */
  readonly prefixable: boolean;

  /**
   * Whether a variable specification may use the explode modifier (`*`).
   * Defaults to `false`: a `{var*}` specification is a registration error
   * (`DisallowedVarSpecModifierError`).  Only meaningful with
   * `multiple: true` (explode yields a list); the `multiple` derivation
   * already forces and checks that coupling.
   */
  readonly explodable: boolean;

  /**
   * Allow-list of expression operators the variable may be used with.
   * Defaults to `[]`, which permits every operator.  When non-empty, using
   * the variable under an operator outside this list is a registration
   * error (`DisallowedOperatorError`).
   */
  readonly operatables: readonly Operator[];
}

/**
 * Fully-resolved options attached to a registered route.  All fields are
 * required; {@link fillRouteOptions} resolves a {@link Partial} input against
 * a {@link RouterPathPattern} into this shape.
 */
export interface RouteOptions {
  /**
   * Per-variable constraint, keyed by variable name.  After resolution this
   * contains an entry for every template variable, not just the overridden
   * ones.
   */
  readonly variables: Readonly<Record<string, VariableConstraint>>;

  /**
   * When `true` (the default), the `variables` keys must exactly match the
   * template's variables: a key that is not an actual template variable is
   * a registration error (typo guard).  When `false`, such keys are
   * silently ignored.
   */
  readonly exact: boolean;
}

export interface MinimalConstraint {
  readonly multiple?: boolean;
  readonly nullable?: boolean;
}

/**
 * Computes the value type of a single matched variable from its constraint:
 * `multiple: true` yields `readonly string[]`, otherwise `string`;
 * `nullable: true` additionally admits `null`.
 *
 * The trailing `extends infer R ? R : never` is an identity that forces
 * TypeScript to evaluate the conditional union eagerly.
 */
export type ConstraintValue<C extends MinimalConstraint> = (
  | (C extends { multiple: true } ? readonly string[] : string)
  | (C extends { nullable: true } ? null : never)
) extends infer R ? R : never;

/**
 * Computes the `values` record type from a map of variable constraints.  An
 * empty map (the default) widens to `Record<string, string>` because the
 * matched route is not known at the type level.
 */
export type RouteValues<
  TConstraints extends Record<string, MinimalConstraint>,
> = [keyof TConstraints] extends [never]
  ? Record<string, ConstraintValue<{ multiple: false; nullable: false }>>
  : { [K in keyof TConstraints]: ConstraintValue<TConstraints[K]> };

/**
 * The result of {@link Router.route}.  The type argument is the per-variable
 * constraint map; pass it at the call site to narrow `values` (for example,
 * `router.route<{ tags: { nullable: false; multiple: true } }>(...)`).
 */
export interface RouterRouteResult<
  TConstraints extends Record<string, MinimalConstraint>,
> {
  /**
   * The matched route name.
   */
  name: string;

  /**
   * The URI template of the matched route.
   */
  template: Path;

  /**
   * The values extracted from the URI.
   */
  values: RouteValues<TConstraints>;
}

/**
 * Parsed path template ready to be registered in a {@link Router}.
 *
 * Instances returned by {@link Router.compile} are immutable and may be shared
 * safely between routers and router clones.
 */
export interface RouterPathPattern {
  /**
   * The original path template string.
   */
  readonly path: Path;

  /**
   * Parsed URI Template.
   */
  readonly template: Template;

  /**
   * Variable names found in the template.
   */
  readonly variables: ReadonlySet<string>;
}

/**
 * Resolved route definition produced internally and returned by
 * {@link Router#clone} round-trips.  Unlike {@link PartialRouterRoute}, the
 * path is already compiled and the options are fully resolved.
 */
export type RouterRoute = readonly [
  pathOrPattern: RouterPathPattern,
  name: string,
  options: RouteOptions,
];

/**
 * Route definition accepted by {@link Router#register}, the {@link Router}
 * constructor, and {@link Router.from}.  The first element is either a path
 * template string or a pre-parsed {@link RouterPathPattern} from
 * {@link Router.compile}; the second element is the route name; the optional
 * third element is the per-route options (missing fields are filled with
 * their defaults).
 */
export type PartialRouterRoute = readonly [
  pathOrPattern: Path | RouterPathPattern,
  name: string,
  options?: {
    readonly variables?: Readonly<Record<string, Partial<VariableConstraint>>>;
    readonly exact?: boolean;
  },
];

/**
 * Internal trie entry: a registered route plus the indexing metadata and
 * resolved constraints the matcher needs.
 */
export interface RouteEntry {
  readonly index: number;
  readonly name: string;
  readonly pattern: RouterPathPattern;
  readonly tokens: readonly Token[];
  readonly initialLiteralPrefix: string;
  readonly literalLength: number;
  readonly variableCount: number;
  /** Resolved per-route options, retained so {@link Router#clone} round-trips. */
  readonly options: RouteOptions;
  /** Resolved per-variable constraints for every template variable. */
  readonly constraints: ReadonlyMap<string, VariableConstraint>;
}
