/**
 * Symmetric [RFC 6570] URI
 * Template expansion and pattern matching.
 *
 * [RFC 6570]: https://datatracker.ietf.org/doc/html/rfc6570
 *
 * @module
 */

export { Router, RouterError, RouteTemplatePathError } from "./router/mod.ts";
export type {
  RouterOptions,
  RouterPathPattern,
  RouterRouteResult,
} from "./router/router.ts";
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
  Template,
  TemplateExpansionError,
  TemplateParseError,
  TrailingCommaError,
  UnclosedExpressionError,
  UnexpectedCharacterError,
  UnknownOperatorError,
} from "./template/mod.ts";
export type {
  AssociativeValue,
  ExpandContext,
  ExpandValue,
  Operator,
  Path,
  PrimitiveValue,
  Reporter,
  TemplateOptions,
  Token,
  VariableSpec,
  VarSpec,
} from "./types.ts";
