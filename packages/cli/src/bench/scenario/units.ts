/**
 * Parsers for the human-friendly duration and rate units used in scenario
 * files.
 * @since 2.3.0
 * @module
 */

const DURATION_RE = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/;
const DURATION_UNITS: Readonly<Record<string, number>> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
};

const RATE_RE = /^(\d+(?:\.\d+)?)\s*\/\s*(s|m|h)$/;
const RATE_DIVISORS: Readonly<Record<string, number>> = {
  s: 1,
  m: 60,
  h: 3600,
};

/**
 * Parses a duration such as `"500ms"`, `"30s"`, `"2m"`, or `"1h"` into
 * milliseconds.
 * @param value The duration string.
 * @returns The duration in milliseconds.
 * @throws {RangeError} If the value cannot be parsed.
 */
export function parseDuration(value: string): number {
  const match = value.match(DURATION_RE);
  if (match == null) {
    throw new RangeError(`Invalid duration: ${JSON.stringify(value)}.`);
  }
  const ms = Number.parseFloat(match[1]) * DURATION_UNITS[match[2]];
  if (!Number.isFinite(ms)) {
    throw new RangeError(`Duration out of range: ${JSON.stringify(value)}.`);
  }
  return ms;
}

/**
 * Parses an open-loop arrival rate into requests per second.  A bare number is
 * interpreted as requests per second; a string such as `"200/s"`, `"60/m"`, or
 * `"3600/h"` carries an explicit time unit.
 * @param value The rate string or number.
 * @returns The rate in requests per second.
 * @throws {RangeError} If the value cannot be parsed or is not positive.
 */
export function parseRate(value: string | number): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError(`Invalid rate: ${value}.`);
    }
    return value;
  }
  const match = value.match(RATE_RE);
  if (match == null) {
    throw new RangeError(`Invalid rate: ${JSON.stringify(value)}.`);
  }
  const rate = Number.parseFloat(match[1]) / RATE_DIVISORS[match[2]];
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new RangeError(`Invalid rate: ${JSON.stringify(value)}.`);
  }
  return rate;
}
