/**
 * The `object` scenario runner.
 * @since 2.3.0
 * @module
 */

import { convertUrlIfHandle } from "../../webfinger/lib.ts";
import { asList } from "../scenario/coerce.ts";
import { objectUrlsFromSource } from "./object-discovery.ts";
import { runReadLoad } from "./read.ts";
import {
  assertBareHttpUrl,
  isBareHttpUrl,
  type RunContext,
  type ScenarioRunner,
} from "./runner.ts";

/** The `object` scenario runner. */
export const objectRunner: ScenarioRunner = {
  validate(scenario): void {
    const { source } = scenario;
    if (source == null) return;
    if (typeof source === "string" || Array.isArray(source)) {
      for (const url of asList(source)) {
        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          throw new Error(
            `Scenario "${scenario.name}": invalid object source URL ` +
              `${JSON.stringify(url)}.`,
          );
        }
        assertBareHttpUrl(scenario.name, "object source URL", parsed);
      }
      return;
    }
    for (const seed of asList(source.seed)) {
      let url: URL;
      try {
        url = convertUrlIfHandle(seed);
      } catch {
        throw new Error(
          `Scenario "${scenario.name}": invalid object source seed URL ` +
            `${JSON.stringify(seed)}.`,
        );
      }
      if (url.protocol !== "acct:" && !isBareHttpUrl(url)) {
        throw new Error(
          `Scenario "${scenario.name}": object source seed must be an acct: ` +
            `handle or a bare http(s) URL with a host and no credentials; ` +
            `got ${JSON.stringify(url.href)}.`,
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
