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
export { RouterError, RouteTemplatePathError } from "./router/errors.ts";
export { default as Router } from "./router/mod.ts";
export type {
  RouterOptions,
  RouterPathPattern,
  RouterRouteResult,
} from "./router/mod.ts";
export { default as Template } from "./template/mod.ts";
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
