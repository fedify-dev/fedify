import type {
  RouterOptions as _RouterOptions,
  RouterRouteResult as _RouterRouteResult,
} from "@fedify/uri-template";
import {
  assertPath,
  Router as _Router,
  RouterError as _RouterError,
} from "@fedify/uri-template";
import { getLogger } from "@logtape/logtape";

const logger = getLogger(["fedify", "federation", "router", "deprecated"]);

/**
 * Options for the {@link Router}.
 * @since 0.12.0
 * @deprecated Import `RouterOptions` from `@fedify/uri-template` instead.
 */
export interface RouterOptions extends _RouterOptions {}

/**
 * The result of {@link Router.route} method.
 * @since 1.3.0
 * @deprecated Import `RouterRouteResult` from `@fedify/uri-template` instead.
 */
export interface RouterRouteResult extends _RouterRouteResult {}

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
  #router: _Router;
  /**
   * Create a new {@link Router}.
   * @param options Options for the router.
   * @deprecated Use `new Router(options)` from `@fedify/uri-template`
   *             instead.
   */
  constructor(options?: _RouterOptions) {
    this.#router = convertRouterError(() => new _Router(options));
  }

  /**
   * Whether to ignore trailing slashes when matching paths.
   * @deprecated Use `Router` from `@fedify/uri-template` instead.  This
   *             accessor forwards to the underlying `@fedify/uri-template`
   *             router so that post-construction mutation keeps working as
   *             in older Fedify code.
   */
  get trailingSlashInsensitive(): boolean {
    return this.#router.trailingSlashInsensitive;
  }

  set trailingSlashInsensitive(value: boolean) {
    this.#router.trailingSlashInsensitive = value;
  }

  /**
   * Clones this router.
   * @deprecated Use `Router` from `@fedify/uri-template` instead.
   */
  clone(): Router {
    return convertRouterError(() => {
      const clone = new Router();
      clone.#router = this.#router.clone();
      return clone;
    });
  }

  /**
   * Checks if a path name exists in the router.
   * @param name The name of the path.
   * @returns `true` if the path name exists, otherwise `false`.
   * @deprecated Use `Router` from `@fedify/uri-template` instead.
   */
  has(name: string): boolean {
    return convertRouterError(() => this.#router.has(name));
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
    return convertRouterError(() => {
      assertPath(template);
      this.#router.add(template, name);
      return _Router.variables(template);
    });
  }

  /**
   * Resolves a path name and values from a URL, if any match.
   * @param url The URL to resolve.
   * @returns The name of the path and its values, if any match.  Otherwise,
   *          `null`.
   * @deprecated Use `Router` from `@fedify/uri-template` instead.
   */
  route(url: string): RouterRouteResult | null {
    return convertRouterError(() => {
      assertPath(url);
      return this.#router.route(url);
    });
  }

  /**
   * Constructs a URL/path from a path name and values.
   * @param name The name of the path.
   * @param values The values to expand the path with.
   * @returns The URL/path, if the name exists.  Otherwise, `null`.
   * @deprecated Use `Router` from `@fedify/uri-template` instead.
   */
  build(name: string, values: Record<string, string>): string | null {
    return convertRouterError(() => this.#router.build(name, values));
  }
}

/**
 * An error thrown by the {@link Router}.
 * @deprecated Import `RouterError` from `@fedify/uri-template` instead.
 */
export class RouterError extends _RouterError {
  /**
   * Create a new {@link RouterError}.
   * @param message The error message.
   * @deprecated Import `RouterError` from `@fedify/uri-template` instead.
   */
  constructor(message: string) {
    super(message);
    logger.warn(
      "The `RouterError` class from `@fedify/fedify` is deprecated." +
        " Please use `Router` from `@fedify/uri-template` instead.",
    );
  }
}

function convertRouterError<T>(func: () => T): T {
  try {
    logger.warn(
      "The `Router` class from `@fedify/fedify` is deprecated." +
        " Please use `Router` from `@fedify/uri-template` instead.",
    );
    return func();
  } catch (error) {
    if (error instanceof _RouterError) {
      throw new RouterError(error.message);
    }
    throw error;
  }
}
