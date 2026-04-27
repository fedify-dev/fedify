/**
 * Symmetric RFC 6570 URI Template expansion and pattern matching.
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
