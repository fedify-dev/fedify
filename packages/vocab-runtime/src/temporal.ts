/**
 * Type guards for `Temporal` namespace objects.
 *
 * Fedify accepts both runtime polyfills (e.g. `@js-temporal/polyfill`,
 * `temporal-polyfill`) and the host's native `Temporal` implementation
 * (Node.js 26+, Bun, Deno). The guards below rely on `Symbol.toStringTag`,
 * which is mandated by the Temporal specification, so they accept any
 * spec-conformant implementation regardless of which class produced the
 * value.
 *
 * @module
 */

/**
 * Checks whether the given value is a `Temporal.Instant` object, regardless
 * of whether it came from a polyfill or the host's native implementation.
 *
 * The guard verifies the spec-mandated `Symbol.toStringTag`, that the
 * `epochNanoseconds` accessor exposes a `bigint`, and that `toString` is
 * not the default inherited from `Object.prototype`.  Together they reject
 * bare objects whose tag was set to `"Temporal.Instant"` without exposing
 * the rest of the shape; the `toString` check in particular prevents a
 * spoof from reaching the JSON-LD serializer (which calls `toString()`)
 * and emitting `"[object Temporal.Instant]"` instead of an RFC 3339
 * timestamp.
 *
 * @param value The value to test.
 * @returns `true` if the value reports `Temporal.Instant` via
 *          `Symbol.toStringTag`, exposes a `bigint`-valued
 *          `epochNanoseconds`, and overrides `toString`; `false` otherwise.
 */
export function isTemporalInstant(value: unknown): value is Temporal.Instant {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.prototype.toString.call(value) === "[object Temporal.Instant]" &&
    "epochNanoseconds" in value &&
    typeof value.epochNanoseconds === "bigint" &&
    "toString" in value &&
    typeof value.toString === "function" &&
    value.toString !== Object.prototype.toString
  );
}

/**
 * Checks whether the given value is a `Temporal.Duration` object, regardless
 * of whether it came from a polyfill or the host's native implementation.
 *
 * The guard verifies the spec-mandated `Symbol.toStringTag`, that the
 * `sign` accessor returns one of the three spec-valid values (`-1`, `0`,
 * or `1`), and that `toString` is not the default inherited from
 * `Object.prototype`.  Together they reject bare objects whose tag was set
 * to `"Temporal.Duration"` without exposing the rest of the shape; the
 * `toString` check in particular prevents a spoof from reaching the
 * JSON-LD serializer (which calls `toString()`) and emitting
 * `"[object Temporal.Duration]"` instead of an ISO 8601 duration.
 *
 * @param value The value to test.
 * @returns `true` if the value reports `Temporal.Duration` via
 *          `Symbol.toStringTag`, exposes a `sign` of `-1`, `0`, or `1`,
 *          and overrides `toString`; `false` otherwise.
 */
export function isTemporalDuration(value: unknown): value is Temporal.Duration {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.prototype.toString.call(value) === "[object Temporal.Duration]" &&
    "sign" in value &&
    (value.sign === -1 || value.sign === 0 || value.sign === 1) &&
    "toString" in value &&
    typeof value.toString === "function" &&
    value.toString !== Object.prototype.toString
  );
}
