/**
 * The scenario-runner registry.
 *
 * Only `collection` is still reserved but not executable in this version.
 * @since 2.3.0
 * @module
 */

import type { ScenarioType } from "../scenario/types.ts";
import { actorRunner } from "./actor.ts";
import { fanoutRunner } from "./fanout.ts";
import { inboxRunner } from "./inbox.ts";
import { objectRunner } from "./object.ts";
import type { ScenarioRunner } from "./runner.ts";
import { webfingerRunner } from "./webfinger.ts";

/** The scenario types that have runners in this version. */
export const IMPLEMENTED_SCENARIO_TYPES: readonly ScenarioType[] = [
  "inbox",
  "webfinger",
  "actor",
  "object",
  "fanout",
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
    case "actor":
      return actorRunner;
    case "object":
      return objectRunner;
    case "fanout":
      return fanoutRunner;
    default:
      throw new Error(
        `The "${type}" scenario type is not implemented in this version of ` +
          `fedify bench; supported types: ${
            IMPLEMENTED_SCENARIO_TYPES.join(", ")
          }.`,
      );
  }
}
