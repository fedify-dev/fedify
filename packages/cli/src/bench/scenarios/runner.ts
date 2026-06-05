/**
 * The scenario runner interface and the shared plumbing every runner uses:
 * turning a Response into a send outcome, deriving a load plan, and the
 * measured window for throughput.
 * @since 2.3.0
 * @module
 */

import type { DocumentLoader } from "@fedify/vocab-runtime";
import type { Rng } from "../load/arrival.ts";
import type { Clock } from "../load/clock.ts";
import type { LoadPlan, SendFunction, SendOutcome } from "../load/generator.ts";
import type { ResolvedScenario } from "../scenario/normalize.ts";
import type { ScenarioMeasurement } from "../result/build.ts";
import type { SyntheticServer } from "../server/synthetic.ts";

/** The context a scenario runner needs to execute. */
export interface RunContext {
  readonly scenario: ResolvedScenario;
  readonly target: URL;
  readonly documentLoader: DocumentLoader;
  readonly contextLoader: DocumentLoader;
  readonly allowPrivateAddress: boolean;
  /** The synthetic actor/key server, required by signed scenarios (inbox). */
  readonly fleet: SyntheticServer | null;
  /** Clock override for deterministic tests. */
  readonly clock?: Clock;
  /** RNG override for Poisson arrivals. */
  readonly rng?: Rng;
  /** Fetch implementation (overridable for tests). */
  readonly fetch?: typeof fetch;
  /**
   * Gates a resolved load destination (a discovered or explicit inbox URL)
   * before any load is sent to it, throwing if it is not allowed.  The suite
   * `target` is gated by the orchestrator; this covers destinations that differ
   * from it.  Optional so direct runner tests need not supply it.
   */
  readonly assertDestinationAllowed?: (url: URL) => void;
}

/** A runner for one scenario type. */
export interface ScenarioRunner {
  run(context: RunContext): Promise<ScenarioMeasurement>;
  /**
   * Optionally rejects a resolved scenario the runner cannot honor, before any
   * probe or load.  Called during preflight; throwing here surfaces as a
   * configuration error (exit 2) with the thrown message.
   */
  validate?(scenario: ResolvedScenario): void;
}

/** Performs one HTTP send and classifies the result as a send outcome. */
export async function sendRequest(
  request: Request,
  fetchImpl: typeof fetch,
): Promise<SendOutcome> {
  try {
    const response = await fetchImpl(request);
    // Drain the body so the connection can be reused.
    await response.arrayBuffer().catch(() => {});
    if (response.ok) return { ok: true, status: response.status };
    return {
      ok: false,
      status: response.status,
      reason: `status_${response.status}`,
    };
  } catch (error) {
    return { ok: false, errorKind: "network", reason: String(error) };
  }
}

/** Builds the load plan for a resolved scenario. */
export function loadPlanOf(scenario: ResolvedScenario, rng?: Rng): LoadPlan {
  return {
    load: scenario.load,
    durationMs: scenario.durationMs,
    warmupMs: scenario.warmupMs,
    rng,
  };
}

/** The measured window (excluding warm-up) used for throughput, in ms. */
export function measuredWindowMs(scenario: ResolvedScenario): number {
  return Math.max(scenario.durationMs - scenario.warmupMs, 1);
}

/** Estimates the total request count, for presigning open-loop runs. */
export function estimateTotal(scenario: ResolvedScenario): number | undefined {
  if (scenario.load.kind !== "open") return undefined;
  return Math.ceil(scenario.load.ratePerSec * (scenario.durationMs / 1000));
}

/**
 * Wraps a send function so that `onMeasuredWindowStart` runs exactly once, at
 * the warm-up boundary, and *every* measured request waits for it to settle
 * before being sent.  Runners use this to snapshot a server-side baseline so
 * reported server metrics cover only the measured window rather than the
 * target's cumulative lifetime; awaiting it on every measured send guarantees
 * the baseline is taken before any measured traffic reaches the target, so no
 * measured request can leak into the baseline.
 *
 * The barrier is cheap: only the handful of requests scheduled while the
 * baseline snapshot is in flight wait for it (recording that wait as their own
 * latency, the coordinated-omission-correct outcome); once it settles, later
 * waits resolve immediately.
 * @param warmupMs The warm-up window length, in milliseconds.
 * @param onMeasuredWindowStart The one-shot callback, run at the boundary.
 * @param send The underlying send function.
 * @returns A send function that gates measured sends on the callback.
 */
export function withMeasuredWindowStart(
  warmupMs: number,
  onMeasuredWindowStart: () => void | Promise<void>,
  send: SendFunction,
): SendFunction {
  let started: Promise<void> | undefined;
  return (scheduledAtMs: number) => {
    if (scheduledAtMs < warmupMs) return send(scheduledAtMs);
    started ??= Promise.resolve(onMeasuredWindowStart());
    return started.then(() => send(scheduledAtMs));
  };
}
