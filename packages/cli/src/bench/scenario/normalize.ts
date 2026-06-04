/**
 * Normalizes a validated scenario suite into a fully resolved form the engine
 * can execute: defaults applied, top-level scalar-or-list fields (`recipient`,
 * `collection`, `fault`) coerced to arrays, durations and rates parsed to
 * numbers, and the load model determined.  Nested specs (`activity`, `source`)
 * are passed through and coerced where they are consumed.
 *
 * It also enforces the cross-field rules that the JSON Schema cannot express,
 * notably that the buffered signing modes require the target's signature time
 * window to be off.
 * @since 2.3.0
 * @module
 */

import { asList } from "./coerce.ts";
import type {
  ActivitySpec,
  ActorGroup,
  ArrivalDistribution,
  ExpectBlock,
  ObjectSource,
  Scenario,
  ScenarioType,
  SigningMode,
  Suite,
} from "./types.ts";
import { parseDuration, parseRate } from "./units.ts";

const DEFAULT_DURATION_MS = 60_000;
const DEFAULT_WARMUP_MS = 0;
const DEFAULT_RATE_PER_SEC = 50;
const DEFAULT_SIGNING: SigningMode = "pipeline";
const DEFAULT_RUNS = 1;

/** The resolved load model for a scenario. */
export type LoadModel =
  | {
    readonly kind: "open";
    readonly ratePerSec: number;
    readonly arrival: ArrivalDistribution;
    readonly maxInFlight?: number;
  }
  | {
    readonly kind: "closed";
    readonly concurrency: number;
    readonly maxInFlight?: number;
  };

/** A scenario with all defaults applied and all units parsed. */
export interface ResolvedScenario {
  readonly name: string;
  readonly type: ScenarioType;
  readonly load: LoadModel;
  readonly durationMs: number;
  readonly warmupMs: number;
  readonly signing: SigningMode;
  readonly signatureTimeWindow: boolean;
  readonly runs: number;
  readonly recipients: string[];
  readonly inbox?: string;
  readonly activity?: ActivitySpec;
  readonly authenticated: boolean;
  readonly collections: string[];
  readonly source?: ObjectSource;
  readonly sender?: string;
  readonly followers?: number;
  readonly queueDrainTimeoutMs?: number;
  readonly faults: string[];
  readonly expect: ExpectBlock;
  /** The original scenario, for any field not lifted onto this view. */
  readonly raw: Scenario;
}

/** A suite with its target resolved and every scenario normalized. */
export interface ResolvedSuite {
  readonly target: URL;
  readonly actors: ActorGroup[];
  readonly scenarios: ResolvedScenario[];
}

/** Options for {@link normalizeSuite}. */
export interface NormalizeOptions {
  /** A target URL that overrides the suite's `target`. */
  readonly target?: string;
}

/** An error raised when a suite cannot be normalized. */
export class SuiteNormalizeError extends Error {}

/**
 * Normalizes a validated suite into resolved form.
 * @param suite The validated suite.
 * @param options Normalization options, such as a target override.
 * @returns The resolved suite.
 * @throws {SuiteNormalizeError} If the target is missing or a cross-field rule
 *         is violated.
 */
export function normalizeSuite(
  suite: Suite,
  options: NormalizeOptions = {},
): ResolvedSuite {
  const targetString = options.target ?? suite.target;
  if (targetString == null || targetString.trim() === "") {
    throw new SuiteNormalizeError(
      "No target URL: set `target` in the suite or pass --target.",
    );
  }
  let target: URL;
  try {
    target = new URL(targetString);
  } catch {
    throw new SuiteNormalizeError(`Invalid target URL: ${targetString}.`);
  }
  return {
    target,
    actors: suite.actors ?? [],
    scenarios: suite.scenarios.map((scenario) =>
      resolveScenario(scenario, suite)
    ),
  };
}

function resolveScenario(scenario: Scenario, suite: Suite): ResolvedScenario {
  const defaults = suite.defaults ?? {};
  const load = resolveLoad(defaults.load, scenario.load);
  const signing = scenario.signing ?? defaults.signing ?? DEFAULT_SIGNING;
  const signatureTimeWindow = scenario.signatureTimeWindow ??
    defaults.signatureTimeWindow ?? false;
  if (signing !== "jit" && signatureTimeWindow) {
    throw new SuiteNormalizeError(
      `Scenario "${scenario.name}": ${signing} signing pre-signs requests, ` +
        "which requires the target's signature time window to be off; use " +
        "signing: jit for a time-windowed target.",
    );
  }
  if (signing === "presign" && load.kind === "closed") {
    throw new SuiteNormalizeError(
      `Scenario "${scenario.name}": presign signing needs a fixed request ` +
        "count, which a closed-loop (concurrency) load does not have; use an " +
        "open-loop rate, or signing: pipeline or jit.",
    );
  }
  return {
    name: scenario.name,
    type: scenario.type,
    load,
    durationMs: resolveDuration(
      scenario.duration ?? defaults.duration,
      DEFAULT_DURATION_MS,
    ),
    warmupMs: resolveDuration(
      scenario.warmup ?? defaults.warmup,
      DEFAULT_WARMUP_MS,
    ),
    signing,
    signatureTimeWindow,
    runs: scenario.runs ?? defaults.runs ?? DEFAULT_RUNS,
    recipients: asList(scenario.recipient),
    inbox: scenario.inbox,
    activity: scenario.activity,
    authenticated: scenario.authenticated ?? false,
    collections: asList(scenario.collection),
    source: scenario.source,
    sender: scenario.sender,
    followers: scenario.followers,
    queueDrainTimeoutMs: scenario.queueDrainTimeout == null
      ? undefined
      : parseDuration(scenario.queueDrainTimeout),
    faults: asList(scenario.fault),
    expect: scenario.expect ?? {},
    raw: scenario,
  };
}

/**
 * Resolves the load model from suite defaults and a scenario override.  The
 * scenario's choice of `rate`/`concurrency` wins outright (it selects the
 * model), while compatible fields such as `arrival` and `maxInFlight` are
 * inherited from the defaults when the scenario does not set them.
 */
function resolveLoad(
  defaults: Scenario["load"] | undefined,
  scenario: Scenario["load"] | undefined,
): LoadModel {
  const arrival = scenario?.arrival ?? defaults?.arrival ?? "constant";
  const maxInFlight = scenario?.maxInFlight ?? defaults?.maxInFlight;
  if (scenario?.concurrency != null) {
    return { kind: "closed", concurrency: scenario.concurrency, maxInFlight };
  }
  if (scenario?.rate != null) {
    return {
      kind: "open",
      ratePerSec: parseRate(scenario.rate),
      arrival,
      maxInFlight,
    };
  }
  if (defaults?.concurrency != null) {
    return { kind: "closed", concurrency: defaults.concurrency, maxInFlight };
  }
  if (defaults?.rate != null) {
    return {
      kind: "open",
      ratePerSec: parseRate(defaults.rate),
      arrival,
      maxInFlight,
    };
  }
  return {
    kind: "open",
    ratePerSec: DEFAULT_RATE_PER_SEC,
    arrival,
    maxInFlight,
  };
}

function resolveDuration(
  value: string | undefined,
  fallback: number,
): number {
  return value == null ? fallback : parseDuration(value);
}
