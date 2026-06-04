/**
 * The `webfinger` scenario runner: drives WebFinger handle-resolution lookups,
 * the discovery primitive every other scenario reuses.
 * @since 2.3.0
 * @module
 */

import { convertUrlIfHandle } from "../../webfinger/lib.ts";
import { runLoad } from "../load/generator.ts";
import { aggregateSamples } from "../metrics/aggregate.ts";
import { fetchServerMetrics } from "../metrics/stats-client.ts";
import {
  loadPlanOf,
  measuredWindowMs,
  type RunContext,
  type ScenarioRunner,
  sendRequest,
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
        : [context.target.host]).map((r) => webfingerUrl(context.target, r));
    let index = 0;
    const send = () =>
      sendRequest(new Request(urls[index++ % urls.length]), fetchImpl);
    const result = await runLoad(
      loadPlanOf(context.scenario, context.rng),
      send,
      context.clock,
    );
    const measurement = aggregateSamples(result.samples, {
      measuredWindowMs: measuredWindowMs(context.scenario),
      includeHistogram: true,
    });
    const server = await fetchServerMetrics(context.target, fetchImpl);
    return { ...measurement, server };
  },
};
