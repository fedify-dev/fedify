/**
 * A small clock abstraction so the load generator's timing can be driven by a
 * real monotonic clock in production and substituted in tests.
 * @since 2.3.0
 * @module
 */

/** A monotonic clock with a sleep primitive. */
export interface Clock {
  /** The current time in milliseconds (monotonic, not wall-clock). */
  now(): number;
  /** Resolves once the clock reaches `timeMs` (or immediately if already past). */
  sleepUntil(timeMs: number): Promise<void>;
}

/** Returns a clock backed by `performance.now()` and `setTimeout`. */
export function systemClock(): Clock {
  return {
    now: () => performance.now(),
    sleepUntil(timeMs: number): Promise<void> {
      const remaining = timeMs - performance.now();
      if (remaining <= 0) return Promise.resolve();
      return new Promise((resolve) => setTimeout(resolve, remaining));
    },
  };
}
