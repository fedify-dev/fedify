import { Template } from "../template/mod.ts";
import type { ExpandContext, ExpandValue, Path, Token } from "../types.ts";
import { isExpression, isLiteral, isPath } from "../utils.ts";
import { RouteTemplatePathError } from "./errors.ts";
import { fillRouteOptions } from "./fill.ts";
import Trie from "./trie/mod.ts";
import type {
  PartialRouterRoute,
  RouteEntry,
  RouteOptions,
  RouterOptions,
  RouterPathPattern,
  RouterRoute,
  RouterRouteResult,
  VariableConstraint,
} from "./types.ts";

/**
 * Router that resolves URIs against registered RFC 6570 templates.
 */
export default class Router {
  readonly #trie: Trie<RouteEntry>;
  readonly #routesByName: Map<string, RouteEntry>;
  #prevIndex: number = -1;

  /**
   * Whether to ignore trailing slashes when matching paths.
   */
  trailingSlashInsensitive: boolean;

  /**
   * Create a new {@link Router}.
   *
   * The first argument may be an iterable of routes, an options object, or
   * omitted.  When two arguments are passed, they are interpreted as
   * `(routes, options)`.
   *
   * @param routes Routes to register on the new router.
   * @param options Options for the router.
   */
  constructor(routes: Iterable<PartialRouterRoute>, options?: RouterOptions);
  constructor(options?: RouterOptions);
  constructor(
    routesOrOptions?: Iterable<PartialRouterRoute> | RouterOptions,
    maybeOptions?: RouterOptions,
  ) {
    const routes = isRoutesArgument(routesOrOptions)
      ? routesOrOptions
      : undefined;
    const options = isRoutesArgument(routesOrOptions)
      ? maybeOptions
      : routesOrOptions;

    this.#trie = new Trie();
    this.#routesByName = new Map();
    this.trailingSlashInsensitive = options?.trailingSlashInsensitive ?? false;

    if (routes != null) this.register(routes);
  }

  /**
   * Creates a new {@link Router}.  Mirrors the constructor argument
   * interface and is provided for ergonomic call sites that prefer a
   * static factory over `new`.
   */
  static from(
    routes: Iterable<PartialRouterRoute>,
    options?: RouterOptions,
  ): Router;
  static from(options?: RouterOptions): Router;
  static from(
    routesOrOptions?: Iterable<PartialRouterRoute> | RouterOptions,
    options?: RouterOptions,
  ): Router {
    return new Router(routesOrOptions as Iterable<RouterRoute>, options);
  }

  /**
   * Compiles a path template without registering it in a router.
   * @param path The path pattern.
   * @returns A parsed path pattern.
   */
  static compile(path: Path): RouterPathPattern {
    if (!isPath(path)) {
      throw new RouteTemplatePathError(path);
    }

    const template = Template.parse(path);
    return Object.freeze({
      path,
      template,
      variables: collectVariables(template.tokens),
    });
  }

  /**
   * Returns the variable names in a path template without registering it.
   * @param path The path pattern.
   * @returns The names of the variables in the path pattern.
   */
  static variables = (path: Path): Set<string> =>
    new Set(Router.compile(path).variables);

  /**
   * Checks if a path name exists in the router.
   * @param name The name of the path.
   * @returns `true` if the path name exists, otherwise `false`.
   */
  has = (name: string): boolean => this.#routesByName.has(name);

  /**
   * Adds a new path rule to the router.
   * @param pathOrPattern The path template, or a pre-parsed
   *                      {@link RouterPathPattern} produced by
   *                      {@link Router.compile}.
   * @param name The name of the path.
   * @param options Per-route options, including per-variable constraints.
   */
  add: (...args: PartialRouterRoute) => void = (
    pathOrPattern,
    name,
    options?,
  ): void => {
    const pattern = resolvePathPattern(pathOrPattern);
    const previous = this.#routesByName.get(name);
    if (previous != null) this.#trie.remove(previous);

    const entry = createRouteEntry({
      index: this.#index,
      name,
      pattern,
      options: fillRouteOptions(options, pattern),
    });

    this.#routesByName.set(name, entry);
    this.#trie.insert(entry);
  };

  /**
   * Registers multiple path rules at once.
   * @param routes Iterable of `[pathOrPattern, name]` pairs to register.
   */
  register = (routes: Iterable<PartialRouterRoute>): void => {
    const resolved = Iterator.from(routes)
      .map(([pathOrPattern, name, options]) =>
        [resolvePathPattern(pathOrPattern), name, options] as const
      ).map(([pattern, name, options]) =>
        [
          name,
          createRouteEntry({
            index: this.#index,
            name,
            pattern,
            options: fillRouteOptions(options, pattern),
          }),
        ] as const
      );

    const pending = new Map<string, RouteEntry>(resolved);

    for (const name of pending.keys()) {
      const committed = this.#routesByName.get(name);
      if (committed != null) this.#trie.remove(committed);
    }

    for (const [name, entry] of pending) this.#routesByName.set(name, entry);

    this.#trie.insertAll(pending.values());
  };

  get #index(): number {
    return this.#prevIndex++;
  }

  /**
   * Resolves a path name and values from a URI, if any match.
   * @param url The URI to resolve.
   * @returns The name of the path and its values, if any match.  Otherwise,
   *          `null`.
   */
  route = <
    TConstraints extends Record<string, VariableConstraint> = Record<
      never,
      never
    >,
  >(url: Path): RouterRouteResult<TConstraints> | null =>
    this.#route(url) ??
      (this.trailingSlashInsensitive
        ? this.#route(toggleTrailingSlash(url))
        : null);

  #route<
    TConstraints extends Record<string, VariableConstraint>,
  >(url: Path): RouterRouteResult<TConstraints> | null {
    for (const entry of this.#trie.candidates(url)) {
      const context = entry.pattern.template.match(url);
      if (context == null) continue;

      const values = resolveValues(context, entry);
      if (values == null) continue;

      return {
        name: entry.name,
        template: entry.pattern.path,
        values: values as RouterRouteResult<TConstraints>["values"],
      };
    }

    return null;
  }

  /**
   * Constructs a URL/path from a path name and values.
   * @param name The name of the path.
   * @param values The values to expand the path with.
   * @returns The URL/path, if the name exists.  Otherwise, `null`.
   */
  build = <
    TConstraints extends Record<string, VariableConstraint> = Record<
      never,
      never
    >,
  >(
    name: string,
    values: RouterRouteResult<TConstraints>["values"],
  ): Path | null =>
    (this.#routesByName.get(name)
      ?.pattern.template.expand(values) ?? null) as Path | null;

  /**
   * Creates a shallow clone of the router.  The clone shares immutable
   * registered path patterns with the original, but changes to the route set
   * (adding, removing, or re-registering routes) do not affect the other
   * router.
   * @returns A new router with the same routes and options as this one.
   */
  clone = (): Router =>
    new Router(
      this.#activeEntries(),
      { trailingSlashInsensitive: this.trailingSlashInsensitive },
    );

  #activeEntries = (): RouterRoute[] =>
    Array.from(this.#routesByName.values())
      .sort((left, right) => left.index - right.index)
      .map((entry) => [entry.pattern, entry.name, entry.options]);
}

const createRouteEntry = ({
  index,
  name,
  pattern,
  options,
}: {
  readonly index: number;
  readonly name: string;
  readonly pattern: RouterPathPattern;
  readonly options: RouteOptions;
}): RouteEntry => ({
  index,
  name,
  pattern,
  tokens: pattern.template.tokens,
  initialLiteralPrefix: getInitialLiteralPrefix(pattern.template.tokens),
  literalLength: getLiteralLength(pattern.template.tokens),
  variableCount: pattern.variables.size,
  options,
  constraints: new Map(Object.entries(options.variables)),
});

const resolvePathPattern = (
  value: Path | RouterPathPattern,
): RouterPathPattern =>
  typeof value === "string" ? Router.compile(value) : value;

const isRoutesArgument = (
  value: Iterable<PartialRouterRoute> | RouterOptions | undefined,
): value is Iterable<PartialRouterRoute> =>
  value != null &&
  typeof value === "object" &&
  Symbol.iterator in (value as object);

const toggleTrailingSlash = (path: Path): Path =>
  path.endsWith("/") ? (path.replace(/\/+$/, "") as Path) : `${path}/`;

const collectVariables = (tokens: readonly Token[]): ImmutableSet<string> =>
  new ImmutableSet(
    tokens
      .filter(isExpression)
      .flatMap((token) => token.vars.map((varSpec) => varSpec.name)),
  );

class ImmutableSet<T> extends Set<T> implements ReadonlySet<T> {
  constructor(values?: Iterable<T>) {
    super();
    if (values != null) { for (const value of values) super.add(value); }
  }

  override add(_value: T): this {
    throw new TypeError("ImmutableSet cannot be mutated.");
  }

  override delete(_value: T): boolean {
    throw new TypeError("ImmutableSet cannot be mutated.");
  }

  override clear(): void {
    throw new TypeError("ImmutableSet cannot be mutated.");
  }
}

const getInitialLiteralPrefix = (tokens: readonly Token[]): string =>
  tokens[0] != null && isLiteral(tokens[0]) ? tokens[0].text : "";

const getLiteralLength = (tokens: readonly Token[]): number =>
  tokens.reduce(
    (sum, token) => isLiteral(token) ? sum + token.text.length : sum,
    0,
  );

/**
 * Applies the resolved per-variable constraints to a matched context,
 * producing the route values or `null` when a constraint rejects the match
 * (so the caller falls back to the next candidate).
 */
const resolveValues = (
  context: ExpandContext,
  entry: RouteEntry,
): Record<string, string | readonly string[]> | null => {
  const values: Record<string, string | readonly string[]> = {};

  for (const [name, constraint] of entry.constraints) {
    const raw: ExpandValue | undefined = context[name];

    if (constraint.multiple) {
      const list = toStringList(raw);
      if (list == null) return null;
      const empty = list.length < 1 || list.every((item) => item === "");
      if (empty && !constraint.nullable) return null;
      values[name] = list;
      continue;
    }

    if (typeof raw === "string") {
      if (raw === "" && !constraint.nullable) return null;
      values[name] = raw;
    } else if (!constraint.nullable) {
      // Unbound, or bound to a list/associative value: not a scalar match.
      return null;
    }
  }

  return values;
};

const toStringList = (
  value: ExpandValue | undefined,
): readonly string[] | null => {
  if (value === undefined) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    return value.every((item) => typeof item === "string")
      ? (value as readonly string[])
      : null;
  }
  return null;
};
