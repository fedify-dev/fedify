import Template from "../template/mod.ts";
import type { ExpandContext, Path, Token } from "../types.ts";
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
   * @param options Options for the router.
   */
  constructor(options: RouterOptions = {}) {
    this.#trie = new Trie();
    this.#routesByName = new Map();
    this.#nextIndex = 0;
    this.trailingSlashInsensitive = options.trailingSlashInsensitive ?? false;
  }

  clone(): Router {
    const clone = new Router({
      trailingSlashInsensitive: this.trailingSlashInsensitive,
    });

    for (const entry of this.#activeEntries()) {
      clone.add(entry.pattern.path, entry.name);
    }

    return clone;
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
   * @param pattern The compiled path pattern.
   * @param name The name of the path.
   */
  add = (template: Path, name: string): void => {
    const pattern = Router.compile(template);
    const entry = createRouteEntry({ index: this.#nextIndex++, name, pattern });

    this.#routesByName.set(name, entry);
    this.#trie.insert(entry);
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

  /**
   * Constructs a URL/path from a path name and values.
   * @param name The name of the path.
   * @param values The values to expand the path with.
   * @returns The URL/path, if the name exists.  Otherwise, `null`.
   */
  build = (name: string, values: Record<string, string>): Path | null =>
    (this.#routesByName.get(name)
      ?.pattern.template.expand(values) ?? null) as Path | null;

  #route(url: Path): RouterRouteResult | null {
    for (const entry of this.#trie.candidates(url, this.#isActiveEntry)) {
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

  #activeEntries = (): RouteEntry[] =>
    Array.from(this.#routesByName.values())
      .sort((left, right) => left.index - right.index);

  #isActiveEntry = (entry: RouteEntry): boolean =>
    this.#routesByName.get(entry.name) === entry;
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

const isExpression = <T extends { kind: string }>(
  token: T,
): token is Extract<T, { kind: "expression" }> => token.kind === "expression";

const getInitialLiteralPrefix = (tokens: readonly Token[]): string =>
  tokens[0]?.kind === "literal" ? tokens[0].text : "";

const getLiteralLength = (tokens: readonly Token[]): number =>
  tokens.reduce(
    (sum, token) => token.kind === "literal" ? sum + token.text.length : sum,
    0,
  );

const isPath = (path: string): path is Path =>
  path.startsWith("/") || /^\{\/[^}]+\}\//.test(path);

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
