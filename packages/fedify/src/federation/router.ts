// @ts-ignore TS7016
import { cloneDeep } from "es-toolkit";
import { Router as InnerRouter } from "uri-template-router";
import { parseTemplate, type Template } from "url-template";

/**
 * Options for the {@link Router}.
 * @since 0.12.0
 */
export interface RouterOptions {
  /**
   * Whether to ignore trailing slashes when matching paths.
   */
  trailingSlashInsensitive?: boolean;
}

/**
 * The result of {@link Router.route} method.
 * @since 1.3.0
 */
export interface RouterRouteResult {
  /**
   * The matched route name.
   */
  name: string;

  /**
   * The URL template of the matched route.
   */
  template: string;

  /**
   * The values extracted from the URL.
   */
  values: Record<string, string>;
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

/**
 * URL router and constructor based on URI Template
 * ([RFC 6570](https://tools.ietf.org/html/rfc6570)).
 */
export class Router {
  #router: InnerRouter;
  #templates: Record<string, Template>;
  #templateStrings: Record<string, string>;

  /**
   * Whether to ignore trailing slashes when matching paths.
   * @since 1.6.0
   */
  trailingSlashInsensitive: boolean;

  /**
   * Create a new {@link Router}.
   * @param options Options for the router.
   */
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

  /**
   * Checks if a path name exists in the router.
   * @param name The name of the path.
   * @returns `true` if the path name exists, otherwise `false`.
   */
  has(name: string): boolean {
    return name in this.#templates;
  }

  /**
   * Adds a new path rule to the router.
   * @param template The path pattern.
   * @param name The name of the path.
   * @returns The names of the variables in the path pattern.
   */
  add(template: string, name: string): Set<string> {
    if (!template.startsWith("/")) {
      throw new RouterError("Path must start with a slash.");
    }
    const rule = this.#router.addTemplate(template, {}, name);
    this.#templates[name] = parseTemplate(template);
    this.#templateStrings[name] = template;
    return new Set(rule.variables.map((v: { varname: string }) => v.varname));
  }

  /**
   * Resolves a path name and values from a URL, if any match.
   * @param url The URL to resolve.
   * @returns The name of the path and its values, if any match.  Otherwise,
   *          `null`.
   */
  route(url: string): RouterRouteResult | null {
    let match = this.#router.resolveURI(url);
    if (match == null) {
      if (!this.trailingSlashInsensitive) return null;
      url = url.endsWith("/") ? url.replace(/\/+$/, "") : `${url}/`;
      match = this.#router.resolveURI(url);
      if (match == null) return null;
    }
    return {
      name: match.matchValue,
      template: this.#templateStrings[match.matchValue],
      values: match.params,
    };
  }

  /**
   * Constructs a URL/path from a path name and values.
   * @param name The name of the path.
   * @param values The values to expand the path with.
   * @returns The URL/path, if the name exists.  Otherwise, `null`.
   */
  build(name: string, values: Record<string, string>): string | null {
    if (name in this.#templates) {
      return this.#templates[name].expand(values);
    }
    return null;
  }
}

/**
 * An error thrown by the {@link Router}.
 */
export class RouterError extends Error {
  /**
   * Create a new {@link RouterError}.
   * @param message The error message.
   */
  constructor(message: string) {
    super(message);
    this.name = "RouterError";
  }
}
