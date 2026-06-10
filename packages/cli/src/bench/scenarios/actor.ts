/**
 * The `actor` scenario runner.
 * @since 2.3.0
 * @module
 */

import { convertUrlIfHandle } from "../../webfinger/lib.ts";
import { actorUrlsFromRecipients } from "./object-discovery.ts";
import { runReadLoad } from "./read.ts";
import type { RunContext, ScenarioRunner } from "./runner.ts";

/** The `actor` scenario runner. */
export const actorRunner: ScenarioRunner = {
  validate(scenario): void {
    if (scenario.recipients.length < 1) {
      throw new Error("The actor scenario requires a recipient.");
    }
    for (const recipient of scenario.recipients) {
      try {
        convertUrlIfHandle(recipient);
      } catch {
        throw new Error(
          `Scenario "${scenario.name}": invalid actor recipient ` +
            `${JSON.stringify(recipient)}.`,
        );
      }
    }
  },

  async run(context: RunContext) {
    this.validate?.(context.scenario);
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
