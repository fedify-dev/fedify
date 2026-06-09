/**
 * Shared helpers for read-only benchmark scenarios.
 * @since 2.3.0
 * @module
 */

import { signRequest } from "@fedify/fedify";
import { runLoad } from "../load/generator.ts";
import { aggregateSamples } from "../metrics/aggregate.ts";
import {
  diffSnapshots,
  fetchServerSnapshot,
  type ServerSnapshot,
  snapshotToMetrics,
} from "../metrics/stats-client.ts";
import type { SyntheticActor } from "../server/synthetic.ts";
import {
  loadPlanOf,
  measuredWindowMs,
  type RunContext,
  sendRequest,
  withMeasuredWindowStart,
} from "./runner.ts";

/** Options for {@link runReadLoad}. */
export interface ReadLoadOptions {
  /** URLs to GET during the measured load. */
  readonly urls: readonly URL[];
  /** Whether GETs should be authenticated with HTTP Signatures. */
  readonly authenticated?: boolean;
}

/**
 * Runs a read-only GET workload and aggregates client/server measurements.
 * @param context The scenario run context.
 * @param options Read workload options.
 * @returns The scenario measurement.
 */
export async function runReadLoad(
  context: RunContext,
  options: ReadLoadOptions,
) {
  if (options.urls.length < 1) {
    throw new Error(
      `Scenario "${context.scenario.name}" did not resolve any URLs to fetch.`,
    );
  }
  for (const url of options.urls) {
    await context.assertDestinationAllowed?.(url);
  }

  const fetchImpl = context.fetch ?? fetch;
  const actors = context.fleet?.actors ?? [];
  if (options.authenticated && actors.length < 1) {
    throw new Error(
      `Scenario "${context.scenario.name}" requires the synthetic actor server ` +
        "for authenticated fetches.",
    );
  }

  let index = 0;
  const rawSend = async () => {
    const i = index++;
    const url = options.urls[i % options.urls.length];
    let request = new Request(url, {
      headers: { accept: "application/activity+json, application/ld+json" },
      redirect: "manual",
    });
    if (options.authenticated) {
      request = await signGetRequest(request, actors[i % actors.length]);
    }
    return await sendRequest(request, fetchImpl);
  };

  let baseline: ServerSnapshot | null = null;
  let baselineTaken = false;
  const send = withMeasuredWindowStart(
    context.scenario.warmupMs,
    async () => {
      baseline = await fetchServerSnapshot(context.target, fetchImpl);
      baselineTaken = true;
    },
    rawSend,
  );
  const result = await runLoad(
    loadPlanOf(context.scenario, context.rng),
    send,
    context.clock,
  );
  const measurement = aggregateSamples(result.samples, {
    measuredWindowMs: measuredWindowMs(context.scenario),
    includeHistogram: true,
  });
  const end = await fetchServerSnapshot(context.target, fetchImpl);
  const server = baselineTaken && baseline != null && end != null
    ? snapshotToMetrics(diffSnapshots(baseline, end))
    : null;
  return { ...measurement, server };
}

async function signGetRequest(
  request: Request,
  actor: SyntheticActor,
): Promise<Request> {
  if (actor.keys.rsa == null || actor.rsaKeyId == null) {
    throw new TypeError(
      "Actor is missing the RSA key required for authenticated fetch signing.",
    );
  }
  return await signRequest(
    request,
    actor.keys.rsa.privateKey,
    actor.rsaKeyId,
    { spec: actor.httpStandard },
  );
}
