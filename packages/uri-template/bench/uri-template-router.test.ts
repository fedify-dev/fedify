// deno-lint-ignore-file no-import-prefix
import { test } from "@fedify/fixture";
import { cloneDeep } from "es-toolkit";
import { Router as InnerRouter } from "npm:uri-template-router@^1.0.0";
import {
  parseTemplate,
  type Template as UrlTemplate,
} from "npm:url-template@^3.1.1";
import {
  createRouterAddTest,
  createRouterBuildTest,
  createRouterCloneTest,
  createRouterRouteTest,
  createRouterVariablesTest,
  routerBuildTestSuites,
  routerCloneTestSuites,
  routerRouteDefinitions,
  routerRouteTestSuites,
  routerVariablesCases,
} from "../src/tests/mod.ts";
import type { Path } from "../src/types.ts";

/**
 * Known failures for npm:uri-template-router@^1.0.0, checked with
 * `deno test --allow-env packages/uri-template/bench/uri-template-router.test.ts`.
 * These pct-encoding gaps are the main routing correctness issues that
 * motivated the @fedify/uri-template Router implementation.
 *
 * RFC 6570 treats pct-encoded triplets as valid literal and varname syntax.
 * It also distinguishes reserved characters from their pct-encoded forms
 * under reserved expansion (`+` and `#` allow sets).  The previous Router
 * loses that distinction when matching reserved expansions: `/files/a%2Fb`
 * becomes `a/b`, `/files/%30%23` becomes `0#`, and UTF-8 pct-encoded octets
 * are decoded to Unicode characters.  That makes route results fail to
 * round-trip the actual URI template value.
 *
 * The companion `url-template` expander has the opposite problem for named
 * variables: pct-encoded triplets in varnames such as `{?abc%20def}`,
 * `{;%41}`, and `{&abc%20def}` are double-encoded as `%2520` or `%2541`
 * when building URIs.  The new Router uses the same strict RFC 6570 parser
 * for building, matching, and variable extraction, so pct-encoded variable
 * names and reserved expansion values are preserved instead of decoded or
 * encoded a second time.
 *
 * The same compatibility run also records route-shape differences that matter
 * for Fedify routes.  The previous router rejects leading path expansion
 * templates such as `{/identifier}/inbox` when they partially overlap with
 * slash-prefixed routes, and it misses optional form-style query matches such
 * as `/search{?q,page}` with only one query variable present.
 */
export interface RouterOptions {
  trailingSlashInsensitive?: boolean;
}

export interface RouterRouteResult {
  name: string;
  template: Path;
  values: Record<string, string>;
}

export interface RouterPathPattern {
  readonly path: Path;
  readonly template: UrlTemplate;
  readonly variables: ReadonlySet<string>;
}

interface InnerRouteMatch {
  readonly matchValue: string;
  readonly params: Record<string, unknown>;
}

function cloneInnerRouter(router: InnerRouter): InnerRouter {
  const clone = new InnerRouter();
  clone.nid = router.nid;
  clone.fsm = cloneDeep(router.fsm);
  clone.routeSet = new Set(router.routeSet);
  clone.templateRouteMap = new Map(router.templateRouteMap);
  clone.valueRouteMap = new Map(router.valueRouteMap);
  clone.hierarchy = cloneDeep(router.hierarchy);
  return clone;
}

export class Router {
  #router: InnerRouter;
  #templates: Record<string, UrlTemplate>;
  #templateStrings: Record<string, Path>;

  trailingSlashInsensitive: boolean;

  constructor(options: RouterOptions = {}) {
    this.#router = new InnerRouter();
    this.#templates = {};
    this.#templateStrings = {};
    this.trailingSlashInsensitive = options.trailingSlashInsensitive ?? false;
  }

  clone(): Router {
    const clone = new Router({
      trailingSlashInsensitive: this.trailingSlashInsensitive,
    });
    clone.#router = cloneInnerRouter(this.#router);
    clone.#templates = { ...this.#templates };
    clone.#templateStrings = { ...this.#templateStrings };
    return clone;
  }

  static compile(path: Path): RouterPathPattern {
    const router = new InnerRouter();
    const rule = router.addTemplate(path, {}, "temp");
    return {
      path,
      template: parseTemplate(path),
      variables: new Set(
        rule.variables.map((v: { varname: string }) => v.varname),
      ),
    };
  }

  static variables(path: Path): Set<string> {
    return new Set(Router.compile(path).variables);
  }

  has(name: string): boolean {
    return name in this.#templates;
  }

  add(template: Path, name: string): void {
    this.#router.addTemplate(template, {}, name);
    this.#templates[name] = parseTemplate(template);
    this.#templateStrings[name] = template as Path;
  }

  route(url: Path): RouterRouteResult | null {
    let match = this.#router.resolveURI(url) as InnerRouteMatch | null;
    if (match == null) {
      if (!this.trailingSlashInsensitive) return null;
      const retryUrl = toggleTrailingSlash(url);
      if (retryUrl == null) return null;
      match = this.#router.resolveURI(retryUrl) as InnerRouteMatch | null;
      if (match == null) return null;
    }
    const values = toRouteValues(match.params);
    if (values == null) return null;

    return {
      name: match.matchValue,
      template: this.#templateStrings[match.matchValue],
      values,
    };
  }

  build(name: string, values: Record<string, string>): Path | null {
    if (name in this.#templates) {
      return this.#templates[name].expand(values) as Path;
    }
    return null;
  }
}

const isPath = (path: string): path is Path =>
  path.startsWith("/") || /^\{\/[^}]+\}\//.test(path);

const toggleTrailingSlash = (path: Path): Path | null => {
  if (!path.endsWith("/")) return `${path}/`;

  const trimmed = path.replace(/\/+$/, "");
  return isPath(trimmed) ? trimmed : null;
};

const toRouteValues = (
  params: Record<string, unknown>,
): Record<string, string> | null => {
  const values: Record<string, string> = {};

  for (const [key, value] of Object.entries(params)) {
    if (typeof value !== "string") return null;
    values[key] = value;
  }

  return values;
};

export class RouterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouterError";
  }
}

const runAddCases = createRouterAddTest(Router);
test("Router.add()", runAddCases(routerRouteDefinitions));

const runVariablesCases = createRouterVariablesTest(Router);
test("Router.variables()", runVariablesCases(routerVariablesCases));

const runCloneCases = createRouterCloneTest(Router);
test("Router.clone()", runCloneCases(routerCloneTestSuites));

const runRouteCases = createRouterRouteTest(Router);
for (
  const { name, options, routeDefinitions, cases } of routerRouteTestSuites
) {
  test(
    `Router.route(): ${name}`,
    runRouteCases(routeDefinitions, options)(cases),
  );
}

const runBuildCases = createRouterBuildTest(Router);
for (
  const { name, options, routeDefinitions, cases } of routerBuildTestSuites
) {
  test(
    `Router.build(): ${name}`,
    runBuildCases(routeDefinitions, options)(cases),
  );
}
