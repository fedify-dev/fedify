/**
 * The load generator: drives requests against a send function and records
 * coordinated-omission-corrected latency samples.
 *
 * Open-loop (the default) launches requests on a fixed schedule regardless of
 * whether earlier responses returned, and measures each request's latency from
 * its *scheduled* time, not from when it was actually sent — so falling behind
 * schedule (a stalled target, or backpressure from the `maxInFlight` cap)
 * shows up as latency rather than being silently omitted.  Closed-loop runs a
 * fixed number of virtual users, each looping send-then-wait.
 * @since 2.3.0
 * @module
 */

import type { LoadModel } from "../scenario/normalize.ts";
import { scheduleArrivals } from "./arrival.ts";
import { type Clock, systemClock } from "./clock.ts";
import type { Rng } from "./arrival.ts";

/** The outcome of a single send. */
export interface SendOutcome {
  readonly ok: boolean;
  readonly status?: number;
  readonly errorKind?: string;
  readonly reason?: string;
}

/** Sends one request; receives the request's scheduled offset (ms). */
export type SendFunction = (scheduledAtMs: number) => Promise<SendOutcome>;

/** A recorded latency sample. */
export interface Sample {
  /** The request's scheduled offset from the run start, in milliseconds. */
  readonly scheduledAtMs: number;
  /** Latency in milliseconds (coordinated-omission corrected in open-loop). */
  readonly latencyMs: number;
  /** Whether the sample falls within the warm-up window (excluded later). */
  readonly warmup: boolean;
  /** The send outcome. */
  readonly outcome: SendOutcome;
}

/** The result of a load run. */
export interface LoadResult {
  readonly samples: Sample[];
  /**
   * Whether the `maxInFlight` cap caused backpressure — at least one dispatch
   * had to wait for a slot.  This is the saturation signal.
   */
  readonly saturated: boolean;
  /** The wall-clock duration of the run, in milliseconds. */
  readonly wallDurationMs: number;
}

/** A load plan derived from a resolved scenario. */
export interface LoadPlan {
  readonly load: LoadModel;
  readonly durationMs: number;
  readonly warmupMs: number;
  /** The RNG for Poisson arrivals (open-loop). */
  readonly rng?: Rng;
}

/**
 * Runs a load plan against a send function.
 * @param plan The load plan.
 * @param send The function that performs one send.
 * @param clock The clock (overridable for tests); defaults to the system clock.
 * @returns The recorded samples and run metadata.
 */
export function runLoad(
  plan: LoadPlan,
  send: SendFunction,
  clock: Clock = systemClock(),
): Promise<LoadResult> {
  return plan.load.kind === "open"
    ? runOpenLoop(plan, plan.load, send, clock)
    : runClosedLoop(plan, plan.load, send, clock);
}

async function runOpenLoop(
  plan: LoadPlan,
  load: Extract<LoadModel, { kind: "open" }>,
  send: SendFunction,
  clock: Clock,
): Promise<LoadResult> {
  const arrivals = scheduleArrivals({
    ratePerSec: load.ratePerSec,
    durationMs: plan.durationMs,
    arrival: load.arrival,
    rng: plan.rng,
  });
  const samples: Sample[] = [];
  const slots = createSemaphore(load.maxInFlight);
  let saturated = false;
  const start = clock.now();
  // Track only active dispatches, deleting each as it settles, so memory stays
  // bounded by the in-flight count rather than the total request count.
  const active = new Set<Promise<void>>();
  for (const offset of arrivals) {
    await clock.sleepUntil(start + offset);
    if (await slots.acquire()) saturated = true;
    const dispatched = dispatch(
      send,
      offset,
      start,
      plan.warmupMs,
      clock,
      samples,
    )
      .finally(() => {
        slots.release();
        active.delete(dispatched);
      });
    active.add(dispatched);
  }
  await Promise.all(active);
  return { samples, saturated, wallDurationMs: clock.now() - start };
}

async function runClosedLoop(
  plan: LoadPlan,
  load: Extract<LoadModel, { kind: "closed" }>,
  send: SendFunction,
  clock: Clock,
): Promise<LoadResult> {
  const samples: Sample[] = [];
  const slots = createSemaphore(load.maxInFlight);
  let saturated = false;
  const start = clock.now();
  const deadline = start + plan.durationMs;
  async function worker(): Promise<void> {
    while (clock.now() < deadline) {
      if (await slots.acquire()) saturated = true;
      if (clock.now() >= deadline) {
        slots.release();
        break;
      }
      const offset = clock.now() - start;
      try {
        await dispatch(send, offset, start, plan.warmupMs, clock, samples);
      } finally {
        slots.release();
      }
    }
  }
  await Promise.all(
    Array.from({ length: load.concurrency }, () => worker()),
  );
  return { samples, saturated, wallDurationMs: clock.now() - start };
}

async function dispatch(
  send: SendFunction,
  offset: number,
  start: number,
  warmupMs: number,
  clock: Clock,
  samples: Sample[],
): Promise<void> {
  let outcome: SendOutcome;
  try {
    outcome = await send(offset);
  } catch (error) {
    outcome = { ok: false, errorKind: "exception", reason: String(error) };
  }
  // Coordinated-omission correction: measure from the scheduled time, so a
  // request that could not be sent on time records the extra delay as latency.
  samples.push({
    scheduledAtMs: offset,
    latencyMs: clock.now() - (start + offset),
    warmup: offset < warmupMs,
    outcome,
  });
}

interface Semaphore {
  /** Acquires a slot; resolves `true` if it had to wait (backpressure). */
  acquire(): Promise<boolean>;
  /** Releases a slot, transferring it to the next waiter if any. */
  release(): void;
}

function createSemaphore(max: number | undefined): Semaphore {
  if (max == null) {
    return { acquire: () => Promise.resolve(false), release: () => {} };
  }
  let count = 0;
  const queue: Array<() => void> = [];
  return {
    acquire(): Promise<boolean> {
      if (count < max) {
        count++;
        return Promise.resolve(false);
      }
      // Wait in FIFO order; release() transfers the slot to us directly
      // (count is not decremented), so an active worker cannot barge ahead of
      // a queued one.
      return new Promise<boolean>((resolve) => queue.push(() => resolve(true)));
    },
    release(): void {
      const next = queue.shift();
      if (next != null) next();
      else count--;
    },
  };
}
