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
import type { LoadPlan, SendOutcome } from "../load/generator.ts";
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
}

/** A runner for one scenario type. */
export interface ScenarioRunner {
  run(context: RunContext): Promise<ScenarioMeasurement>;
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
