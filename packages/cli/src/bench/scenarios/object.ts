/**
 * The `object` scenario runner.
 * @since 2.3.0
 * @module
 */

import { objectUrlsFromSource } from "./object-discovery.ts";
import { runReadLoad } from "./read.ts";
import type { RunContext, ScenarioRunner } from "./runner.ts";

/** The `object` scenario runner. */
export const objectRunner: ScenarioRunner = {
  async run(context: RunContext) {
    const urls = await objectUrlsFromSource({
      source: context.scenario.source,
      target: context.target,
      fetch: context.fetch,
      assertReadDestinationAllowed: context.assertReadDestinationAllowed,
    });
    return await runReadLoad(context, {
      urls,
      authenticated: context.scenario.authenticated,
    });
  },
};
