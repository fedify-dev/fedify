/**
 * [RFC 6570] URI Template expansion and round-trip pattern matching.
 *
 * [RFC 6570]: https://datatracker.ietf.org/doc/html/rfc6570
 *
 * @module
 */

export {
  ConflictingVarSpecError,
  DisallowedOperatorError,
  DisallowedVarSpecModifierError,
  DuplicateRouteVariableError,
  Router,
  RouterError,
  RouteTemplateOptionsNotMatchedError,
  RouteTemplatePathError,
} from "./router/mod.ts";
export type {
  ConstraintValue,
  RouteOptions,
  RouterOptions,
  RouterPathPattern,
  RouterRoute,
  RouterRouteResult,
  RouteValues,
  VariableConstraint,
} from "./router/mod.ts";
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
  VarSpec,
} from "./types.ts";
export { assertPath, isExpression, isPath } from "./utils.ts";
