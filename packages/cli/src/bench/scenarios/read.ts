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
  createSigningPipeline,
  type SigningPipeline,
} from "../signing/pipeline.ts";
import {
  assertBareHttpUrl,
  estimateTotal,
  loadPlanOf,
  measuredWindowMs,
  type RunContext,
  sendRequest,
  withMeasuredWindowStart,
} from "./runner.ts";

const READ_GATE_CONCURRENCY = 16;

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
  const fetchImpl = context.fetch ?? fetch;
  const actors = context.fleet?.actors ?? [];
  if (options.authenticated && actors.length < 1) {
    throw new Error(
      `Scenario "${context.scenario.name}" requires the synthetic actor server ` +
        "for authenticated fetches.",
    );
  }
  for (const url of options.urls) {
    assertBareHttpUrl(context.scenario.name, "read URL", url);
  }
  await mapWithConcurrency(options.urls, READ_GATE_CONCURRENCY, async (url) => {
    if (options.authenticated) {
      await context.assertDestinationAllowed?.(url);
    } else {
      await context.assertReadDestinationAllowed?.(url);
    }
  });

  function unsignedRequest(index: number): Request {
    const url = options.urls[index % options.urls.length];
    return new Request(url, {
      headers: { accept: "application/activity+json, application/ld+json" },
      redirect: "manual",
    });
  }

  let pipeline: SigningPipeline | null = null;
  if (options.authenticated) {
    let signIndex = 0;
    pipeline = createSigningPipeline(context.scenario.signing, async () => {
      const i = signIndex++;
      return await signGetRequest(
        unsignedRequest(i),
        actors[i % actors.length],
      );
    }, { total: estimateTotal(context.scenario) });
  }

  let index = 0;
  const rawSend = async () => {
    let request: Request;
    if (pipeline != null) {
      try {
        request = await pipeline.next();
      } catch (error) {
        return { ok: false, errorKind: "client", reason: String(error) };
      }
    } else {
      request = unsignedRequest(index++);
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
  try {
    await pipeline?.prime();
    const result = await runLoad(
      loadPlanOf(context.scenario, context.rng),
      send,
      context.clock,
      context.signal,
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
  } finally {
    await pipeline?.close();
  }
}

async function mapWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  callback: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  let firstError: unknown;
  let hasError = false;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (next < items.length && !hasError) {
        const item = items[next++];
        try {
          await callback(item);
        } catch (error) {
          if (!hasError) {
            hasError = true;
            firstError = error;
          }
        }
      }
    },
  );
  await Promise.all(workers);
  if (hasError) throw firstError;
}

async function signGetRequest(
  request: Request,
  actor: SyntheticActor,
): Promise<Request> {
  if (actor.keys?.rsa == null || actor.rsaKeyId == null) {
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
