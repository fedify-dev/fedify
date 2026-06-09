/**
 * The `actor` scenario runner.
 * @since 2.3.0
 * @module
 */

import { actorUrlsFromRecipients } from "./object-discovery.ts";
import { runReadLoad } from "./read.ts";
import type { RunContext, ScenarioRunner } from "./runner.ts";

/** The `actor` scenario runner. */
export const actorRunner: ScenarioRunner = {
  async run(context: RunContext) {
    if (context.scenario.recipients.length < 1) {
      throw new Error("The actor scenario requires a recipient.");
    }
    const urls = await actorUrlsFromRecipients(context.scenario.recipients, {
      target: context.target,
      fetch: context.fetch,
    });
    return await runReadLoad(context, {
      urls,
      authenticated: context.scenario.authenticated,
    });
  },
};
