/**
 * Scalar-or-list coercion used throughout the scenario format, where many
 * fields (`recipient`, `seed`, `collection`, `type`, and so on) accept either a
 * single value or a list of values so the common single-value case stays terse.
 * @since 2.3.0
 * @module
 */

/**
 * Normalizes a scalar-or-list value into an array.
 *
 * A single value becomes a one-element array, an array is shallow-copied, and
 * `null`/`undefined` becomes an empty array.
 * @typeParam T The element type.
 * @param value A single value, a list of values, or nothing.
 * @returns A new array of values.
 */
export function asList<T>(
  value: T | readonly T[] | null | undefined,
): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? [...value] : [value as T];
}
