/**
 * Shared number and assertion formatting used by the text and Markdown
 * renderers.
 * @since 2.3.0
 * @module
 */

import type { ExpectOp } from "../result/model.ts";

const OP_SYMBOLS: Readonly<Record<ExpectOp, string>> = {
  lt: "<",
  lte: "<=",
  gt: ">",
  gte: ">=",
  eq: "==",
};

/** Returns the symbolic form of a comparison operator. */
export function opSymbol(op: ExpectOp): string {
  return OP_SYMBOLS[op];
}

/** Formats a number with grouping and at most three fractional digits. */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const rounded = Math.round(value * 1000) / 1000;
  return rounded.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

/** Formats a ratio (0..1) as a percentage with at most two fractional digits. */
export function formatPercent(ratio: number): string {
  const pct = Math.round(ratio * 1_000_000) / 10_000;
  return `${pct.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

/**
 * Formats a normalized threshold back into its human-friendly unit.
 * @param threshold The normalized numeric threshold.
 * @param unit The threshold's unit (`"ms"`, `"%"`, `"/s"`, or `null`).
 */
export function formatThreshold(
  threshold: number,
  unit: string | null,
): string {
  switch (unit) {
    case "%":
      return formatPercent(threshold);
    case "ms":
      return `${formatNumber(threshold)}ms`;
    case "/s":
      return `${formatNumber(threshold)}/s`;
    default:
      return formatNumber(threshold);
  }
}

/**
 * Formats a measured value using the unit of the assertion it is compared to.
 * @param actual The measured value, or `null` if unmeasured.
 * @param unit The assertion's unit.
 */
export function formatActual(
  actual: number | null,
  unit: string | null,
): string {
  if (actual == null) return "n/a";
  return formatThreshold(actual, unit);
}
