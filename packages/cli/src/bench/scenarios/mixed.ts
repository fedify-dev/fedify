/**
 * The `mixed` scenario runner.
 * @since 2.3.0
 * @module
 */

import { actorRunner } from "./actor.ts";
import { failureRunner } from "./failure.ts";
import { fanoutRunner } from "./fanout.ts";
import { inboxRunner } from "./inbox.ts";
import { objectRunner } from "./object.ts";
import { webfingerRunner } from "./webfinger.ts";
import { LogLinearHistogram } from "../metrics/histogram.ts";
import type { LoadModel, ResolvedScenario } from "../scenario/normalize.ts";
import type { ErrorBucket, LatencyMs } from "../result/model.ts";
import type { ScenarioMeasurement } from "../result/build.ts";
import type { ScenarioType } from "../scenario/types.ts";
import type { RunContext, ScenarioRunner, ValidateContext } from "./runner.ts";

/** The `mixed` scenario runner. */
export const mixedRunner: ScenarioRunner = {
  validate(scenario, context?: ValidateContext): void {
    if (scenario.raw.mix == null || scenario.raw.mix.length < 1) {
      throw new Error(
        `Scenario "${scenario.name}": mixed requires at least one mix entry.`,
      );
    }
    for (const entry of scenario.raw.mix) {
      if (entry.weight <= 0) {
        throw new Error(
          `Scenario "${scenario.name}": mix entry ${entry.scenario} has a ` +
            `non-positive weight.`,
        );
      }
    }
    if (
      scenario.load.kind === "closed" &&
      scenario.load.concurrency < scenario.raw.mix.length
    ) {
      throw new Error(
        `Scenario "${scenario.name}": closed-loop mixed load needs at least ` +
          "one concurrency slot per mix entry.",
      );
    }
    if (context?.scenarios != null) {
      const children = childScenarios(scenario, context.scenarios);
      for (const child of children) {
        runnerForChild(child.type).validate?.(child, context);
      }
    }
  },

  async run(context: RunContext) {
    this.validate?.(context.scenario, { scenarios: context.scenarios });
    if (context.scenarios == null) {
      throw new Error(
        "The mixed scenario requires the resolved scenario list.",
      );
    }
    const children = childScenarios(context.scenario, context.scenarios);
    const fetchImpl = limitedFetch(
      context.fetch ?? fetch,
      context.scenario.load.maxInFlight,
    );
    const measurements = await Promise.all(
      children.map((child) =>
        runnerForChild(child.type).run({
          ...context,
          scenario: child,
          fetch: fetchImpl,
        })
      ),
    );
    return mergeMeasurements(measurements);
  },
};

function childScenarios(
  scenario: ResolvedScenario,
  scenarios: readonly ResolvedScenario[],
): ResolvedScenario[] {
  const entries = scenario.raw.mix ?? [];
  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
  const closedLoads = scenario.load.kind === "closed"
    ? scaledClosedConcurrencies(
      scenario.load.concurrency,
      entries.map((entry) => entry.weight),
    )
    : undefined;
  return entries.map((entry, index) => {
    const children = scenarios.filter((candidate) =>
      candidate.name === entry.scenario
    );
    const child = children[0];
    if (child == null) {
      throw new Error(
        `Scenario "${scenario.name}": unknown mixed child ` +
          `${JSON.stringify(entry.scenario)}.`,
      );
    }
    if (children.length > 1) {
      throw new Error(
        `Scenario "${scenario.name}": ambiguous mixed child ` +
          `${JSON.stringify(entry.scenario)} matches ${children.length} ` +
          "scenarios.",
      );
    }
    if (child.type === "mixed") {
      throw new Error(
        `Scenario "${scenario.name}": nested mixed scenarios are not ` +
          "supported.",
      );
    }
    const load = scaledLoad(
      scenario.load,
      entry.weight,
      totalWeight,
      closedLoads?.[index],
    );
    return {
      ...child,
      name: `${scenario.name}/${child.name}`,
      load,
      durationMs: scenario.durationMs,
      warmupMs: scenario.warmupMs,
      signing: scenario.signing,
      signatureTimeWindow: scenario.signatureTimeWindow,
      expect: {},
      raw: {
        ...child.raw,
        name: `${scenario.name}/${child.name}`,
        load: rawLoad(load),
        duration: `${scenario.durationMs}ms`,
        warmup: `${scenario.warmupMs}ms`,
        signing: scenario.signing,
        signatureTimeWindow: scenario.signatureTimeWindow,
        expect: {},
      },
    };
  });
}

function scaledLoad(
  load: LoadModel,
  weight: number,
  totalWeight: number,
  closedConcurrency?: number,
): LoadModel {
  // `maxInFlight` is a parent-wide safety cap for mixed scenarios; run()
  // enforces it with a shared limiter instead of copying it to each child.
  if (load.kind === "open") {
    return {
      kind: "open",
      ratePerSec: load.ratePerSec * (weight / totalWeight),
      arrival: load.arrival,
    };
  }
  return {
    kind: "closed",
    concurrency: closedConcurrency ??
      Math.max(1, Math.round(load.concurrency * weight / totalWeight)),
  };
}

function limitedFetch(fetchImpl: typeof fetch, maxInFlight?: number) {
  if (maxInFlight == null) return fetchImpl;
  const limiter = createLimiter(maxInFlight);
  const limited = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const release = await limiter.acquire();
    try {
      return await fetchImpl(input, init);
    } finally {
      release();
    }
  };
  return limited as typeof fetch;
}

function createLimiter(maxInFlight: number): {
  acquire(): Promise<() => void>;
} {
  if (!Number.isInteger(maxInFlight) || maxInFlight < 1) {
    throw new RangeError(
      `maxInFlight must be a positive integer; got ${maxInFlight}.`,
    );
  }
  let active = 0;
  const waiters: Array<() => void> = [];
  function release(): void {
    const next = waiters.shift();
    if (next == null) active--;
    else next();
  }
  return {
    async acquire(): Promise<() => void> {
      if (active < maxInFlight) {
        active++;
        return release;
      }
      await new Promise<void>((resolve) => waiters.push(resolve));
      return release;
    },
  };
}

function scaledClosedConcurrencies(
  concurrency: number,
  weights: readonly number[],
): number[] {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const ideal = weights.map((weight) => concurrency * weight / totalWeight);
  const allocations = weights.map(() => 1);
  for (
    let remaining = concurrency - weights.length;
    remaining > 0;
    remaining--
  ) {
    let best = 0;
    for (let i = 1; i < allocations.length; i++) {
      if (ideal[i] - allocations[i] > ideal[best] - allocations[best]) {
        best = i;
      }
    }
    allocations[best]++;
  }
  return allocations;
}

function rawLoad(
  load: LoadModel,
): NonNullable<ResolvedScenario["raw"]["load"]> {
  if (load.kind === "open") {
    return {
      rate: load.ratePerSec,
      arrival: load.arrival,
      maxInFlight: load.maxInFlight,
    };
  }
  return { concurrency: load.concurrency, maxInFlight: load.maxInFlight };
}

function runnerForChild(type: ScenarioType): ScenarioRunner {
  switch (type) {
    case "inbox":
      return inboxRunner;
    case "webfinger":
      return webfingerRunner;
    case "actor":
      return actorRunner;
    case "object":
      return objectRunner;
    case "fanout":
      return fanoutRunner;
    case "failure":
      return failureRunner;
    default:
      throw new Error(
        `The "${type}" scenario type cannot be used inside a mixed scenario.`,
      );
  }
}

export function mergeMeasurements(
  measurements: readonly ScenarioMeasurement[],
): ScenarioMeasurement {
  const total = measurements.reduce((sum, m) => sum + m.requests.total, 0);
  const ok = measurements.reduce((sum, m) => sum + m.requests.ok, 0);
  const histogram = mergeHistograms(measurements);
  const deliveryThroughputs = measurements
    .map((m) => m.deliveryThroughputPerSec)
    .filter((value): value is number => value != null);
  return {
    requests: {
      total,
      ok,
      failed: total - ok,
      successRate: total === 0 ? 1 : ok / total,
    },
    throughputPerSec: measurements.reduce(
      (sum, m) => sum + m.throughputPerSec,
      0,
    ),
    ...(deliveryThroughputs.length < 1 ? {} : {
      deliveryThroughputPerSec: deliveryThroughputs.reduce(
        (sum, value) => sum + value,
        0,
      ),
    }),
    client: {
      latencyMs: histogram == null
        ? mergeLatencyFallback(measurements)
        : latencyFromHistogram(histogram),
    },
    server: null,
    errors: mergeErrors(measurements),
    ...(histogram == null ? {} : { histogram: histogram.toJSON() }),
  };
}

function mergeHistograms(
  measurements: readonly ScenarioMeasurement[],
): LogLinearHistogram | null {
  let merged: LogLinearHistogram | null = null;
  for (const measurement of measurements) {
    if (measurement.histogram == null) return null;
    const histogram = LogLinearHistogram.fromJSON(measurement.histogram);
    if (merged == null) merged = histogram;
    else merged.merge(histogram);
  }
  return merged;
}

function latencyFromHistogram(histogram: LogLinearHistogram): LatencyMs {
  return {
    p50: histogram.percentile(50),
    p95: histogram.percentile(95),
    p99: histogram.percentile(99),
    mean: histogram.mean,
    max: histogram.max,
  };
}

function mergeLatencyFallback(
  measurements: readonly ScenarioMeasurement[],
): LatencyMs {
  const total = measurements.reduce((sum, m) => sum + m.requests.total, 0);
  if (measurements.length < 1) {
    return { p50: 0, p95: 0, p99: 0, mean: 0, max: 0 };
  }
  return {
    p50: Math.max(...measurements.map((m) => m.client.latencyMs.p50)),
    p95: Math.max(...measurements.map((m) => m.client.latencyMs.p95)),
    p99: Math.max(...measurements.map((m) => m.client.latencyMs.p99)),
    mean: total === 0 ? 0 : measurements.reduce(
      (sum, m) => sum + m.client.latencyMs.mean * m.requests.total,
      0,
    ) / total,
    max: Math.max(...measurements.map((m) => m.client.latencyMs.max)),
  };
}

function mergeErrors(
  measurements: readonly ScenarioMeasurement[],
): ErrorBucket[] {
  const buckets = new Map<string, ErrorBucket>();
  for (const measurement of measurements) {
    for (const error of measurement.errors) {
      const key = `${error.kind}|${error.status ?? ""}|${error.reason}`;
      const existing = buckets.get(key);
      buckets.set(key, {
        ...error,
        count: (existing?.count ?? 0) + error.count,
      });
    }
  }
  return [...buckets.values()].sort((a, b) => b.count - a.count);
}
