const DECIMAL_PATTERN = /^(\+|-)?([0-9]+(\.[0-9]*)?|\.[0-9]+)$/;
const XML_SCHEMA_WHITESPACE_PATTERN = /[\t\n\r ]+/g;

function collapseXmlSchemaWhitespace(value: string): string {
  return value.replace(XML_SCHEMA_WHITESPACE_PATTERN, " ").trim();
}

/**
 * A branded string representing an `xsd:decimal` value.
 *
 * Unlike JavaScript's `number`, `xsd:decimal` is intended for exact decimal
 * values such as prices, quantities, and measurements where binary
 * floating-point rounding would be inappropriate.  Fedify therefore represents
 * these values as validated strings at runtime while preserving a distinct
 * TypeScript type.
 *
 * Values of this type must be created through {@link parseDecimal}, which
 * validates that the string matches the XML Schema `xsd:decimal` lexical form.
 *
 * The runtime representation is still a plain string.  The brand exists only
 * at the type level so APIs can distinguish arbitrary strings from validated
 * decimal literals without introducing a decimal arithmetic dependency.
 *
 * Supported lexical forms include signed and unsigned integers and decimal
 * fractions such as `"-1.23"`, `"+100000.00"`, `"210"`, `".5"`, and `"5."`.
 * Scientific notation such as `"1e3"` and special values like `"NaN"` are
 * rejected.  Strings with surrounding XML Schema whitespace can be normalized
 * by {@link parseDecimal}, but values of this type are always stored in their
 * normalized lexical form.
 *
 * This representation is designed to be forward-compatible with a future
 * native decimal type if JavaScript eventually gains one, while keeping the
 * public API semantically precise today.
 *
 * @since 2.1.0
 */
export type Decimal = string & { readonly __brand: "Decimal" };

/**
 * Checks whether a string is a valid `xsd:decimal` lexical form.
 *
 * This predicate checks the lexical form strictly, without applying XML Schema
 * whitespace normalization first.  It is useful as a type guard for values
 * that are already expected to be normalized decimal strings.
 *
 * @param value A candidate `xsd:decimal` lexical form.
 * @returns `true` if the string matches the XML Schema `xsd:decimal` lexical
 *          form, or `false` otherwise.
 * @since 2.1.0
 */
export function isDecimal(value: string): value is Decimal {
  return DECIMAL_PATTERN.test(value);
}

/**
 * Checks whether a string can be parsed as an `xsd:decimal` lexical form.
 *
 * Unlike {@link isDecimal}, this predicate first applies the XML Schema
 * `whiteSpace="collapse"` normalization step and then validates the
 * normalized string.  This means values like `" 12.50 "` are parseable even
 * though they are not already normalized decimal literals.
 *
 * @param value A candidate `xsd:decimal` lexical form.
 * @returns `true` if the normalized string matches the XML Schema
 *          `xsd:decimal` lexical form, or `false` otherwise.
 * @since 2.1.0
 */
export function canParseDecimal(value: string): boolean {
  return isDecimal(collapseXmlSchemaWhitespace(value));
}

/**
 * Parses a string as an `xsd:decimal` lexical form and returns it as a
 * branded {@link Decimal}.
 *
 * This function validates the input against the XML Schema `xsd:decimal`
 * lexical space after applying the XML Schema `whiteSpace="collapse"`
 * normalization step.  It returns the normalized string without any further
 * canonicalization.
 *
 * @param value A candidate `xsd:decimal` lexical form.
 * @returns The normalized string branded as {@link Decimal}.
 * @throws {TypeError} Thrown when the value is not a valid `xsd:decimal`
 *                     lexical form.
 * @example
 * ```typescript
 * const price = parseDecimal("12.50");
 * ```
 * @example
 * ```typescript
 * const price = parseDecimal(" 12.50 ");
 * console.assert(price === "12.50");
 * ```
 * @example
 * ```typescript
 * try {
 *   parseDecimal("1e3");
 * } catch (error) {
 *   console.assert(error instanceof TypeError);
 * }
 * ```
 * @since 2.1.0
 */
export function parseDecimal(value: string): Decimal {
  const normalized = collapseXmlSchemaWhitespace(value);
  if (!isDecimal(normalized)) {
    throw new TypeError(
      `${JSON.stringify(value)} is not a valid xsd:decimal lexical form.`,
    );
  }
  return normalized as Decimal;
}
