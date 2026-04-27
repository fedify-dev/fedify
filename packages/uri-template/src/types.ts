/**
 * Primitive value accepted by {@link Template.expand}.
 */
export type PrimitiveValue = string | number | boolean | null;

/**
 * Context object accepted by {@link Template.expand}.  Each variable resolves
 * to a primitive, an ordered list of primitives, or an associative map.
 */
export type ExpandContext = Record<
  string,
  | PrimitiveValue
  | PrimitiveValue[]
  | Record<string, PrimitiveValue | PrimitiveValue[]>
>;

/**
 * Compiled URI template that can be expanded against an {@link ExpandContext}.
 */
export interface Template {
  /**
   * Expands the template against the supplied context, returning the resolved
   * URI string.
   */
  expand(context: ExpandContext): string;
}

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
