/**
 * Parsing of `expect` assertion strings such as `">= 99%"`, `"< 100ms"`, or
 * `"== 0"` into a comparison operator and a normalized numeric threshold.
 *
 * The input stays human-friendly; the parsed threshold is machine-clean: a
 * percentage becomes a ratio, a duration becomes milliseconds, and a rate stays
 * per second.
 * @since 2.3.0
 * @module
 */

import type { ExpectOp } from "../model.ts";

/** A parsed assertion. */
export interface ParsedAssertion {
  readonly op: ExpectOp;
  /** The normalized numeric threshold. */
  readonly threshold: number;
  /** The normalized unit (`"ms"`, `"%"`, `"/s"`), or `null` for a count. */
  readonly unit: string | null;
}

const ASSERT_RE = /^\s*(<=|>=|==|=|<|>)\s*(\d+(?:\.\d+)?)\s*(%|ms|s|\/s)?\s*$/;

const OP_MAP: Readonly<Record<string, ExpectOp>> = {
  "<": "lt",
  "<=": "lte",
  ">": "gt",
  ">=": "gte",
  "==": "eq",
  "=": "eq",
};

/** An error raised when an `expect` assertion cannot be parsed. */
export class AssertionParseError extends Error {}

/**
 * Parses an `expect` assertion string.
 * @param text The assertion, e.g. `">= 99%"`.
 * @returns The parsed operator, normalized threshold, and unit.
 * @throws {AssertionParseError} If the assertion cannot be parsed.
 */
export function parseAssertion(text: string): ParsedAssertion {
  const match = text.match(ASSERT_RE);
  if (match == null) {
    throw new AssertionParseError(
      `Invalid expect assertion: ${JSON.stringify(text)}.`,
    );
  }
  const op = OP_MAP[match[1]];
  const value = Number.parseFloat(match[2]);
  switch (match[3]) {
    case "%":
      return { op, threshold: value / 100, unit: "%" };
    case "ms":
      return { op, threshold: value, unit: "ms" };
    case "s":
      return { op, threshold: value * 1000, unit: "ms" };
    case "/s":
      return { op, threshold: value, unit: "/s" };
    default:
      return { op, threshold: value, unit: null };
  }
}

/**
 * Compares a measured value against a threshold using a comparison operator.
 * @param actual The measured value.
 * @param op The comparison operator.
 * @param threshold The threshold.
 * @param tolerant Whether `eq` allows a small floating-point tolerance.  Pass
 *                 `false` for exact (count) metrics; defaults to `true` so
 *                 float-normalized thresholds (e.g. `"99.4%"` ->
 *                 `0.9940000000000001`) still match a measured `0.994`.
 * @returns Whether the comparison holds.
 */
export function compare(
  actual: number,
  op: ExpectOp,
  threshold: number,
  tolerant = true,
): boolean {
  switch (op) {
    case "lt":
      return actual < threshold;
    case "lte":
      return actual <= threshold;
    case "gt":
      return actual > threshold;
    case "gte":
      return actual >= threshold;
    case "eq":
      return tolerant
        ? Math.abs(actual - threshold) <= 1e-9 + 1e-9 * Math.abs(threshold)
        : actual === threshold;
  }
}
