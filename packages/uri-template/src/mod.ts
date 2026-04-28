/**
 * Symmetric [RFC 6570] URI
 * Template expansion and pattern matching.
 *
 * [RFC 6570]: https://www.rfc-editor.org/rfc/rfc6570.html
 *
 * @module
 */

export { Router } from "./router.ts";
export { parseTemplate } from "./template.ts";
export type {
  ExpandContext,
  HierarchyNode,
  PrimitiveValue,
  Result,
  Route,
  Template,
  VariableSpec,
} from "./types.ts";
