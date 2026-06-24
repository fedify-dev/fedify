/**
 * The `webfinger` scenario runner: drives WebFinger handle-resolution lookups,
 * the discovery primitive every other scenario reuses.
 * @since 2.3.0
 * @module
 */

import { convertUrlIfHandle } from "../../webfinger/lib.ts";
import { runLoad } from "../load/generator.ts";
import { aggregateSamples } from "../metrics/aggregate.ts";
import {
  diffSnapshots,
  fetchServerSnapshot,
  type ServerSnapshot,
  snapshotToMetrics,
} from "../metrics/stats-client.ts";
import {
  loadPlanOf,
  measuredWindowMs,
  type RunContext,
  type ScenarioRunner,
  sendRequest,
  withMeasuredWindowStart,
} from "./runner.ts";

function webfingerUrl(target: URL, recipient: string): URL {
  const resource = convertUrlIfHandle(recipient).href;
  const url = new URL("/.well-known/webfinger", target);
  url.searchParams.set("resource", resource);
  return url;
}

/** The `webfinger` scenario runner. */
export const webfingerRunner: ScenarioRunner = {
  async run(context: RunContext) {
    const fetchImpl = context.fetch ?? fetch;
    const urls =
      (context.scenario.recipients.length > 0
        ? context.scenario.recipients
        // Fall back to the target's full URL (a valid URL), not its schemeless
        // host, which convertUrlIfHandle could not parse.
        : [context.target.href]).map((r) => webfingerUrl(context.target, r));
    let index = 0;
    const rawSend = () =>
      sendRequest(
        new Request(urls[index++ % urls.length], { redirect: "manual" }),
        fetchImpl,
      );
    // Snapshot the server's cumulative metrics at the measured-window boundary
    // so warm-up and earlier scenarios are diffed out of the reported numbers.
    // A few warm-up requests still in flight when the baseline is taken may be
    // attributed to the window; that residue is bounded by the in-flight count.
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
      context.signal,
    );
    const measurement = aggregateSamples(result.samples, {
      measuredWindowMs: measuredWindowMs(context.scenario),
      includeHistogram: true,
    });
    const end = await fetchServerSnapshot(context.target, fetchImpl);
    // Only report server metrics when both ends of the window were captured; a
    // missing baseline cannot be diffed (and falling back to the cumulative
    // snapshot would silently reintroduce warm-up and earlier-scenario load).
    const server = baselineTaken && baseline != null && end != null
      ? snapshotToMetrics(diffSnapshots(baseline, end))
      : null;
    return { ...measurement, server };
  },
};
