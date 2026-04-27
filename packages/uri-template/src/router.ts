import { NOT_IMPLEMENTED } from "./constants.ts";
import type { HierarchyNode, Result, Route } from "./types.ts";

/**
 * Router that resolves URIs against a set of registered RFC 6570 templates.
 */
export class Router {
  nid: number;
  fsm: unknown[];
  routeSet: Set<Route>;
  templateRouteMap: Map<string, Route>;
  valueRouteMap: Map<unknown, Route>;
  hierarchy: HierarchyNode;

  constructor() {
    this.nid = 0;
    this.fsm = [];
    this.routeSet = new Set();
    this.templateRouteMap = new Map();
    this.valueRouteMap = new Map();
    this.hierarchy = { children: [] };
  }

  /**
   * Registers a URI template under the given match value and returns the
   * resulting {@link Route}.
   */
  addTemplate(
    _uriTemplate: string,
    _options: Record<string, unknown>,
    _matchValue: unknown,
  ): Route {
    throw new Error(NOT_IMPLEMENTED);
  }

  /**
   * Resolves a URI against the registered templates, returning a
   * {@link Result} when a match is found, or `undefined` otherwise.
   */
  resolveURI(_uri: string): Result | undefined {
    throw new Error(NOT_IMPLEMENTED);
  }
}
