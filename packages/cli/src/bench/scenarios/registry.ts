/**
 * The scenario-runner registry.
 *
 * Only `inbox` and `webfinger` have runners in this version; the other scenario
 * types are expressible in the format but not yet executable, so requesting one
 * fails with a clear message.
 * @since 2.3.0
 * @module
 */

import type { ScenarioType } from "../scenario/types.ts";
import { inboxRunner } from "./inbox.ts";
import type { ScenarioRunner } from "./runner.ts";
import { webfingerRunner } from "./webfinger.ts";

/** The scenario types that have runners in this version. */
export const IMPLEMENTED_SCENARIO_TYPES: readonly ScenarioType[] = [
  "inbox",
  "webfinger",
];

/**
 * Returns the runner for a scenario type.
 * @param type The scenario type.
 * @returns The runner.
 * @throws {Error} If the type has no runner in this version.
 */
export function runnerFor(type: ScenarioType): ScenarioRunner {
  switch (type) {
    case "inbox":
      return inboxRunner;
    case "webfinger":
      return webfingerRunner;
    default:
      throw new Error(
        `The "${type}" scenario type is not implemented in this version of ` +
          `fedify bench; supported types: ${
            IMPLEMENTED_SCENARIO_TYPES.join(", ")
          }.`,
      );
  }
}
