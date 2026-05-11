import { Template } from "../template/mod.ts";
import type { ExpandContext, Path, Token } from "../types.ts";
import { isExpression, isPath } from "../utils.ts";
import { RouteTemplatePathError } from "./errors.ts";
import Trie from "./trie.ts";

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
 * The result of {@link Router.route}.
 */
export interface RouterRouteResult {
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
  values: Record<string, string>;
}

/**
 * Parsed path template ready to be registered in a {@link Router}.
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
 * Route definition accepted by {@link Router#register}, the {@link Router}
 * constructor, and {@link Router.from}.  The first element is either a path
 * template string or a pre-parsed {@link RouterPathPattern} from
 * {@link Router.compile}; the second element is the route name.
 */
export type RouterRoute = readonly [
  pathOrPattern: Path | RouterPathPattern,
  name: string,
];

interface RouteEntry {
  readonly index: number;
  readonly name: string;
  readonly pattern: RouterPathPattern;
  readonly initialLiteralPrefix: string;
  readonly literalLength: number;
  readonly variableCount: number;
}

/**
 * Router that resolves URIs against registered RFC 6570 templates.
 */
export default class Router {
  readonly #trie: Trie<RouteEntry>;
  readonly #routesByName: Map<string, RouteEntry>;
  #nextIndex: number;

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
  constructor(routes: Iterable<RouterRoute>, options?: RouterOptions);
  constructor(options?: RouterOptions);
  constructor(
    routesOrOptions?: Iterable<RouterRoute> | RouterOptions,
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
    this.#nextIndex = 0;
    this.trailingSlashInsensitive = options?.trailingSlashInsensitive ?? false;

    if (routes != null) this.register(routes);
  }

  /**
   * Creates a new {@link Router}.  Mirrors the constructor argument
   * interface and is provided for ergonomic call sites that prefer a
   * static factory over `new`.
   */
  static from(routes: Iterable<RouterRoute>, options?: RouterOptions): Router;
  static from(options?: RouterOptions): Router;
  static from(
    routesOrOptions?: Iterable<RouterRoute> | RouterOptions,
    options?: RouterOptions,
  ): Router {
    return new Router(routesOrOptions as Iterable<RouterRoute>, options);
  }

  clone = (): Router =>
    new Router(
      this.#activeEntries(),
      { trailingSlashInsensitive: this.trailingSlashInsensitive },
    );

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
    return {
      path,
      template,
      variables: collectVariables(template.tokens),
    };
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
   */
  add = (pathOrPattern: Path | RouterPathPattern, name: string): void => {
    const pattern = resolvePathPattern(pathOrPattern);
    const previous = this.#routesByName.get(name);
    if (previous != null) this.#trie.remove(previous);

    const entry = createRouteEntry({ index: this.#nextIndex++, name, pattern });

    this.#routesByName.set(name, entry);
    this.#trie.insert(entry);
  };

  /**
   * Registers multiple path rules at once.  Compared to calling {@link add}
   * in a loop, this batches trie insertions into one sorted merge per
   * affected node, which lowers the asymptotic cost of bulk registration.
   * @param routes Iterable of `[pathOrPattern, name]` pairs to register.
   */
  register = (routes: Iterable<RouterRoute>): void => {
    const entries: RouteEntry[] = [];
    const pendingByName = new Map<string, RouteEntry>();

    for (const [pathOrPattern, name] of routes) {
      const pending = pendingByName.get(name);
      if (pending != null) {
        const index = entries.indexOf(pending);
        if (index >= 0) entries.splice(index, 1);
      } else {
        const committed = this.#routesByName.get(name);
        if (committed != null) this.#trie.remove(committed);
      }

      const pattern = resolvePathPattern(pathOrPattern);
      const entry = createRouteEntry({
        index: this.#nextIndex++,
        name,
        pattern,
      });

      this.#routesByName.set(name, entry);
      pendingByName.set(name, entry);
      entries.push(entry);
    }

    this.#trie.insertAll(entries);
  };

  /**
   * Resolves a path name and values from a URI, if any match.
   * @param url The URI to resolve.
   * @returns The name of the path and its values, if any match.  Otherwise,
   *          `null`.
   */
  route = (url: Path): RouterRouteResult | null => {
    const match = this.#route(url);
    if (match != null || !this.trailingSlashInsensitive) return match;

    const retryUrl = toggleTrailingSlash(url);
    return retryUrl == null ? null : this.#route(retryUrl);
  };

  #route(url: Path): RouterRouteResult | null {
    for (const entry of this.#trie.candidates(url)) {
      const context = entry.pattern.template.match(url);
      if (context == null) continue;

      const values = toRouteValues(context);
      if (values == null) continue;

      return {
        name: entry.name,
        template: entry.pattern.path,
        values,
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
  build = (name: string, values: Record<string, string>): Path | null =>
    (this.#routesByName.get(name)
      ?.pattern.template.expand(values) ?? null) as Path | null;

  #activeEntries = (): RouterRoute[] =>
    Array.from(this.#routesByName.values())
      .sort((left, right) => left.index - right.index)
      .map((entry): RouterRoute => [entry.pattern, entry.name]);
}

interface CreateRouteEntryOptions {
  readonly index: number;
  readonly name: string;
  readonly pattern: RouterPathPattern;
}

const createRouteEntry = ({
  index,
  name,
  pattern,
}: CreateRouteEntryOptions): RouteEntry => ({
  index,
  name,
  pattern,
  initialLiteralPrefix: getInitialLiteralPrefix(pattern.template.tokens),
  literalLength: getLiteralLength(pattern.template.tokens),
  variableCount: pattern.variables.size,
});

const resolvePathPattern = (
  value: Path | RouterPathPattern,
): RouterPathPattern =>
  typeof value === "string" ? Router.compile(value) : value;

const isRoutesArgument = (
  value: Iterable<RouterRoute> | RouterOptions | undefined,
): value is Iterable<RouterRoute> =>
  value != null &&
  typeof value === "object" &&
  Symbol.iterator in (value as object);

const toggleTrailingSlash = (path: Path): Path | null => {
  if (!path.endsWith("/")) return `${path}/`;

  const trimmed = path.replace(/\/+$/, "");
  return isPath(trimmed) ? trimmed : null;
};

const collectVariables = (tokens: readonly Token[]): Set<string> =>
  new Set(
    tokens
      .filter(isExpression)
      .flatMap((token) => token.vars.map((varSpec) => varSpec.name)),
  );

const getInitialLiteralPrefix = (tokens: readonly Token[]): string =>
  tokens[0]?.kind === "literal" ? tokens[0].text : "";

const getLiteralLength = (tokens: readonly Token[]): number =>
  tokens.reduce(
    (sum, token) => token.kind === "literal" ? sum + token.text.length : sum,
    0,
  );

const toRouteValues = (
  context: ExpandContext,
): Record<string, string> | null => {
  const values: Record<string, string> = {};

  for (const [key, value] of Object.entries(context)) {
    if (typeof value !== "string") return null;
    values[key] = value;
  }

  return values;
};
