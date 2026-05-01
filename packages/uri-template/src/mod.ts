/**
 * Symmetric [RFC 6570] URI
 * Template expansion and pattern matching.
 *
 * [RFC 6570]: https://datatracker.ietf.org/doc/html/rfc6570
 *
 * @module
 */

export {
  EmptyExpressionError,
  EmptyVarNameError,
  InvalidLiteralError,
  InvalidPrefixError,
  InvalidVarNameError,
  InvalidVarSpecError,
  NestedOpeningBraceError,
  PrefixModifierNotApplicableError,
  ReservedOperatorError,
  StrayClosingBraceError,
  TemplateExpansionError,
  TemplateParseError,
  TrailingCommaError,
  UnclosedExpressionError,
  UnexpectedCharacterError,
  UnknownOperatorError,
} from "./errors.ts";
export { Router } from "./router.ts";
export { default as Template } from "./template/mod.ts";
export type {
  AssociativeValue,
  ExpandContext,
  ExpandValue,
  HierarchyNode,
  Operator,
  PrimitiveValue,
  Reporter,
  Result,
  Route,
  TemplateOptions,
  Token,
  VariableSpec,
  VarSpec,
} from "./types.ts";
