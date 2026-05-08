// @ts-ignore TS7016
import { cloneDeep } from "es-toolkit";
import { Router as InnerRouter } from "uri-template-router";
import { parseTemplate, type Template } from "url-template";

/**
 * Options for the {@link Router}.
 * @since 0.12.0
 * @deprecated Import `RouterOptions` from `@fedify/uri-template` instead.
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
 * @deprecated Import `RouterRouteResult` from `@fedify/uri-template` instead.
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
 *
 * @deprecated Import `Router` from `@fedify/uri-template` instead.  This class
 *             remains only for compatibility with older Fedify code.  The
 *             `@fedify/uri-template` router is the replacement implementation
 *             and should be used directly in new code.
 */
export class Router {
  #router: InnerRouter;
  #templates: Record<string, Template>;
  #templateStrings: Record<string, string>;

  /**
   * Whether to ignore trailing slashes when matching paths.
   * @since 1.6.0
   * @deprecated Use `Router` from `@fedify/uri-template` instead.
   */
  trailingSlashInsensitive: boolean;

  /**
   * Create a new {@link Router}.
   * @param options Options for the router.
   * @deprecated Use `new Router(options)` from `@fedify/uri-template`
   *             instead.
   */
  constructor(options: RouterOptions = {}) {
    this.#router = new InnerRouter();
    this.#templates = {};
    this.#templateStrings = {};
    this.trailingSlashInsensitive = options.trailingSlashInsensitive ?? false;
  }

  /**
   * Clones this router.
   * @deprecated Use `Router` from `@fedify/uri-template` instead.
   */
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
   * @deprecated Use `Router` from `@fedify/uri-template` instead.
   */
  has(name: string): boolean {
    return name in this.#templates;
  }

  /**
   * Adds a new path rule to the router.
   * @param template The path pattern.
   * @param name The name of the path.
   * @returns The names of the variables in the path pattern.
   * @deprecated Use `Router` from `@fedify/uri-template` instead.  In this
   *             compatibility class, `add()` both registers the route and
   *             returns the variables in the path pattern.  In
   *             `@fedify/uri-template`, these two responsibilities are split:
   *             `router.add(template, name)` registers the route and returns
   *             `void`, while the pure static method
   *             `Router.variables(template)` returns the variable names.  To
   *             migrate, call `Router.variables(template)` when variables are
   *             needed, then call `router.add(template, name)` to register the
   *             route.
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
   * @deprecated Use `Router` from `@fedify/uri-template` instead.
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
   * @deprecated Use `Router` from `@fedify/uri-template` instead.
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
 * @deprecated Import `RouterError` from `@fedify/uri-template` instead.
 */
export class RouterError extends Error {
  /**
   * Create a new {@link RouterError}.
   * @param message The error message.
   * @deprecated Import `RouterError` from `@fedify/uri-template` instead.
   */
  constructor(message: string) {
    super(message);
    this.name = "RouterError";
  }
}
