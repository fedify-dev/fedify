/**
 * Errors raised when an RFC 6570 URI template fails to parse or expand.
 *
 * Parse-time hierarchy:
 *
 * ~~~~
 * TemplateParseError
 * ├── UnclosedExpressionError
 * ├── StrayClosingBraceError
 * ├── NestedOpeningBraceError
 * ├── EmptyExpressionError
 * ├── ReservedOperatorError
 * ├── UnknownOperatorError
 * ├── InvalidLiteralError
 * ├── InvalidVarSpecError
 * │   ├── EmptyVarNameError
 * │   ├── InvalidVarNameError
 * │   ├── InvalidPrefixError
 * │   └── TrailingCommaError
 * └── UnexpectedCharacterError
 * ~~~~
 *
 * Expansion-time hierarchy:
 *
 * ~~~~
 * TemplateExpansionError
 * └── PrefixModifierNotApplicableError
 * ~~~~
 *
 * Parse errors carry the original `template` and the 0-based `position` where
 * the offending input was located. Expansion errors carry the runtime variable
 * name whose value cannot be expanded.
 *
 * @module
 */

/**
 * Common base class for every parse-time error produced by the RFC 6570 parser.
 */
export class TemplateParseError extends Error {
  /**
   * @param template     The full URI template string that was being parsed.
   * @param position     0-based index into `template` where the problem was
   *                     detected.  When the offending input spans a range,
   *                     this is the start of that range.
   * @param hint         Short, actionable instruction for the user.
   * @param message      Human-readable summary.
   */
  constructor(
    public readonly template: string,
    public readonly position: number,
    public readonly hint: string,
    message: string,
  ) {
    super(`${message} (at position ${position}): ${hint}`);
    this.name = "TemplateParseError";
  }
  throw(): never {
    throw this;
  }
}

/**
 * Raised when an opening `{` has no matching `}` before the template ends.
 *
 * Fix: close the expression with `}` or escape the literal `{` (RFC 6570
 * does not define an escape; remove the stray brace).
 */
export class UnclosedExpressionError extends TemplateParseError {
  constructor(template: string, position: number) {
    super(
      template,
      position,
      "Add the missing '}' to close the expression, or remove the stray '{'.",
      "Unclosed expression: '{' has no matching '}'",
    );
    this.name = "UnclosedExpressionError";
  }
}

/**
 * Raised when a `}` appears outside of any expression.
 *
 * Fix: remove the stray `}` or precede it with a matching `{`.
 */
export class StrayClosingBraceError extends TemplateParseError {
  constructor(template: string, position: number) {
    super(
      template,
      position,
      "Remove this stray '}' or add a matching '{' before it.",
      "Stray '}' outside of any expression",
    );
    this.name = "StrayClosingBraceError";
  }
}

/**
 * Raised when a `{` appears inside another expression before that expression
 * is closed.  RFC 6570 expressions cannot nest.
 *
 * Fix: close the outer expression with `}` before opening a new one.
 */
export class NestedOpeningBraceError extends TemplateParseError {
  constructor(template: string, position: number) {
    super(
      template,
      position,
      "RFC 6570 expressions cannot nest. Close the outer expression with " +
        "'}' before starting a new one.",
      "Nested '{' inside an unclosed expression",
    );
    this.name = "NestedOpeningBraceError";
  }
}

/**
 * Raised when a literal section of the template contains a character that is
 * outside the RFC 6570 `literals` set: CTL, SP, `"`, `'`, lone `%`, `<`, `>`,
 * `\\`, `^`, `` ` ``, `|`.
 *
 * Fix: pct-encode the offending character or remove it.
 */
export class InvalidLiteralError extends TemplateParseError {
  constructor(
    template: string,
    position: number,
    public readonly char: string,
  ) {
    super(
      template,
      position,
      `Pct-encode '${char}' (e.g. '%${
        char.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")
      }') or remove it. Literals may not contain CTL, SP, '\"', '\\'', lone ` +
        "'%', '<', '>', '\\\\', '^', '`', or '|'.",
      `Invalid literal character '${char}'`,
    );
    this.name = "InvalidLiteralError";
  }
}

/**
 * Raised for `{}` — an expression that contains neither operator nor varspec.
 *
 * Fix: insert at least one varname between the braces, e.g. `{var}`.
 */
export class EmptyExpressionError extends TemplateParseError {
  constructor(template: string, position: number) {
    super(
      template,
      position,
      "Provide at least one varname inside the braces, e.g. '{var}'.",
      "Empty expression '{}'",
    );
    this.name = "EmptyExpressionError";
  }
}

/**
 * Raised when the operator slot holds one of the characters reserved by
 * RFC 6570 §2.2 for future extensions: `=`, `,`, `!`, `@`, `|`.
 *
 * Fix: drop the reserved operator or replace it with one of the implemented
 * operators (`+`, `#`, `.`, `/`, `;`, `?`, `&`).
 */
export class ReservedOperatorError extends TemplateParseError {
  constructor(
    template: string,
    position: number,
    public readonly operator: string,
  ) {
    super(
      template,
      position,
      `Operator '${operator}' is reserved by RFC 6570 §2.2 for future ` +
        "extensions. Use one of '+', '#', '.', '/', ';', '?', '&' instead, " +
        "or remove the operator.",
      `Reserved operator '${operator}'`,
    );
    this.name = "ReservedOperatorError";
  }
}

/**
 * Raised when the operator slot holds a character that is neither a defined
 * RFC 6570 operator nor part of the varname grammar.
 *
 * Fix: use one of the implemented operators (`+`, `#`, `.`, `/`, `;`, `?`,
 * `&`) or remove the character.
 */
export class UnknownOperatorError extends TemplateParseError {
  constructor(
    template: string,
    position: number,
    public readonly operator: string,
  ) {
    super(
      template,
      position,
      `Replace '${operator}' with one of '+', '#', '.', '/', ';', '?', '&' ` +
        "or remove it.",
      `Unknown operator '${operator}'`,
    );
    this.name = "UnknownOperatorError";
  }
}

/**
 * Common base for malformed varspec errors so users can `instanceof`-filter.
 */
export class InvalidVarSpecError extends TemplateParseError {
  constructor(
    template: string,
    position: number,
    hint: string,
    message: string,
    public readonly varSpec: string,
  ) {
    super(template, position, hint, message);
    this.name = "InvalidVarSpecError";
  }
}

/**
 * Raised when a varspec contains no varname (e.g. `{,foo}` or `{foo,}`).
 */
export class EmptyVarNameError extends InvalidVarSpecError {
  constructor(template: string, position: number) {
    super(
      template,
      position,
      "Remove the stray comma or insert a varname before/after it.",
      "Empty varname in variable-list",
      "",
    );
    this.name = "EmptyVarNameError";
  }
}

/**
 * Raised when a varname contains characters outside the RFC 6570 varchar set
 * (`ALPHA / DIGIT / "_" / pct-encoded`, optionally separated by `.`).
 */
export class InvalidVarNameError extends InvalidVarSpecError {
  constructor(
    template: string,
    position: number,
    varSpec: string,
    public readonly offendingChar: string,
  ) {
    super(
      template,
      position,
      "Varnames may only contain ALPHA, DIGIT, '_', '.', or pct-encoded " +
        `triplets. Replace '${offendingChar}' or pct-encode it.`,
      `Invalid character '${offendingChar}' in varname`,
      varSpec,
    );
    this.name = "InvalidVarNameError";
  }
}

/**
 * Raised when a prefix modifier (`:N`) is malformed: missing digits, leading
 * zero, or `N` outside the range `1..9999`.
 */
export class InvalidPrefixError extends InvalidVarSpecError {
  constructor(
    template: string,
    position: number,
    varSpec: string,
    public readonly prefix: string,
  ) {
    super(
      template,
      position,
      "Prefix modifiers must be ':N' where N is a positive integer in " +
        "1..9999 with no leading zero (e.g. ':3').",
      `Invalid prefix modifier ':${prefix}'`,
      varSpec,
    );
    this.name = "InvalidPrefixError";
  }
}

/**
 * Raised when a varspec ends with a trailing comma followed by `}` or end of
 * variable-list (e.g. `{a,b,}`).
 */
export class TrailingCommaError extends InvalidVarSpecError {
  constructor(template: string, position: number) {
    super(
      template,
      position,
      "Remove the trailing comma, or add a varspec after it.",
      "Trailing ',' in variable-list",
      "",
    );
    this.name = "TrailingCommaError";
  }
}

/**
 * Raised when an unexpected character appears between a varspec and the next
 * separator (`,` or `}`), e.g. `{a b}` or `{a:3x}`.
 */
export class UnexpectedCharacterError extends TemplateParseError {
  constructor(
    template: string,
    position: number,
    public readonly char: string,
  ) {
    super(
      template,
      position,
      "Expected ',' or '}' here. Remove the unexpected character or " +
        "pct-encode it if it belongs in the varname.",
      `Unexpected character '${char}' in expression`,
    );
    this.name = "UnexpectedCharacterError";
  }
}

/**
 * Common base class for runtime expansion errors.
 */
export class TemplateExpansionError extends Error {
  /**
   * @param variableName The variable whose resolved value cannot be expanded.
   * @param hint Short, actionable instruction for the user.
   * @param message Human-readable summary.
   */
  constructor(
    public readonly variableName: string,
    public readonly hint: string,
    message: string,
  ) {
    super(`${message} for '${variableName}': ${hint}`);
    this.name = "TemplateExpansionError";
  }
}

/**
 * Raised when a prefix modifier is applied to a composite value.
 *
 * RFC 6570 §2.4.1 defines prefix modifiers for string values only; lists and
 * associative arrays must use normal or explode expansion instead.
 */
export class PrefixModifierNotApplicableError extends TemplateExpansionError {
  constructor(
    variableName: string,
    public readonly prefix: number,
    public readonly valueType: "list" | "associative",
  ) {
    super(
      variableName,
      "Remove the prefix modifier from this varspec, or provide a string " +
        "value instead of a composite value.",
      `Prefix modifier ':${prefix}' is not applicable to ${valueType} values`,
    );
    this.name = "PrefixModifierNotApplicableError";
  }
}
