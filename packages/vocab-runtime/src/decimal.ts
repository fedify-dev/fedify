const DECIMAL_PATTERN = /^(\+|-)?([0-9]+(\.[0-9]*)?|\.[0-9]+)$/;

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
 * Scientific notation such as `"1e3"`, special values like `"NaN"`, and
 * strings with surrounding whitespace are rejected.
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
 * This predicate performs the same validation as {@link parseDecimal}
 * without throwing an exception.  It is useful for generated guards and other
 * boolean validation paths where callers need to branch instead of handling an
 * exception.
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
 * Parses a string as an `xsd:decimal` lexical form and returns it as a
 * branded {@link Decimal}.
 *
 * This function validates the input against the XML Schema `xsd:decimal`
 * lexical space and returns the original string unchanged when it is valid.
 * It does not trim whitespace, collapse spaces, or canonicalize the decimal
 * representation.
 *
 * @param value A candidate `xsd:decimal` lexical form.
 * @returns The original string branded as {@link Decimal}.
 * @throws {TypeError} Thrown when the value is not a valid `xsd:decimal`
 *                     lexical form.
 * @example
 * ```typescript
 * const price = parseDecimal("12.50");
 * ```
 * @example
 * ```typescript
 * parseDecimal("1e3"); // throws TypeError
 * ```
 * @since 2.1.0
 */
export function parseDecimal(value: string): Decimal {
  if (!isDecimal(value)) {
    throw new TypeError(
      `${JSON.stringify(value)} is not a valid xsd:decimal lexical form.`,
    );
  }
  return value as Decimal;
}
