/**
 * Arrival scheduling for open-loop load.
 *
 * `constant` arrivals are evenly spaced at `1 / rate`; `poisson` arrivals draw
 * exponentially distributed inter-arrival gaps with the same mean, modeling
 * realistic burstiness.  A seedable RNG keeps Poisson schedules reproducible.
 * @since 2.3.0
 * @module
 */

import type { ArrivalDistribution } from "../scenario/types.ts";

/** A pseudo-random number generator returning values in [0, 1). */
export type Rng = () => number;

/**
 * Creates a small deterministic RNG (mulberry32) from a numeric seed, for
 * reproducible Poisson schedules.
 * @param seed The seed value.
 * @returns A seeded RNG.
 */
export function createSeededRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Options for {@link scheduleArrivals}. */
export interface ScheduleOptions {
  /** The arrival rate in requests per second. */
  readonly ratePerSec: number;
  /** The total duration to schedule over, in milliseconds. */
  readonly durationMs: number;
  /** The arrival distribution. */
  readonly arrival: ArrivalDistribution;
  /** The RNG used for `poisson` arrivals; defaults to `Math.random`. */
  readonly rng?: Rng;
}

/**
 * Lazily yields the scheduled arrival offsets (milliseconds from the start) for
 * a load run.  Yielding rather than materializing keeps memory flat for long,
 * high-rate runs.
 * @param options The scheduling options.
 * @yields Arrival offsets within `[0, durationMs)`, in increasing order.
 */
export function* scheduleArrivals(
  options: ScheduleOptions,
): Generator<number> {
  const { ratePerSec, durationMs, arrival } = options;
  if (ratePerSec <= 0 || durationMs <= 0) return;
  const meanGapMs = 1000 / ratePerSec;
  if (arrival === "constant") {
    for (let t = 0; t < durationMs; t += meanGapMs) yield t;
    return;
  }
  const rng = options.rng ?? Math.random;
  let t = 0;
  for (;;) {
    // Exponential inter-arrival gap with mean meanGapMs.
    t += -Math.log(1 - rng()) * meanGapMs;
    if (t >= durationMs) break;
    yield t;
  }
}
