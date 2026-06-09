/**
 * The `object` scenario runner.
 * @since 2.3.0
 * @module
 */

import { convertUrlIfHandle } from "../../webfinger/lib.ts";
import { asList } from "../scenario/coerce.ts";
import { objectUrlsFromSource } from "./object-discovery.ts";
import { runReadLoad } from "./read.ts";
import type { RunContext, ScenarioRunner } from "./runner.ts";

/** The `object` scenario runner. */
export const objectRunner: ScenarioRunner = {
  validate(scenario): void {
    const { source } = scenario;
    if (source == null) return;
    if (typeof source === "string" || Array.isArray(source)) {
      for (const url of asList(source)) {
        try {
          new URL(url);
        } catch {
          throw new Error(
            `Scenario "${scenario.name}": invalid object source URL ` +
              `${JSON.stringify(url)}.`,
          );
        }
      }
      return;
    }
    for (const seed of asList(source.seed)) {
      try {
        convertUrlIfHandle(seed);
      } catch {
        throw new Error(
          `Scenario "${scenario.name}": invalid object source seed URL ` +
            `${JSON.stringify(seed)}.`,
        );
      }
    }
  },

  async run(context: RunContext) {
    this.validate?.(context.scenario);
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
