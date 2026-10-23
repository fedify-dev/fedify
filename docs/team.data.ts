import { readFileSync } from "node:fs";
import {
  fetchContributors,
  parseContributors,
  visibleContributors,
} from "./.vitepress/contributors.mts";

export default {
  async load() {
    try {
      return await fetchContributors({
        token: process.env.GITHUB_TOKEN,
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      console.warn(
        "Could not refresh contributors; using the checked-in snapshot.",
      );
      return visibleContributors(parseContributors(JSON.parse(readFileSync(
        new URL("./.vitepress/data/contributors.json", import.meta.url),
        "utf8",
      ))));
    }
  },
};

export declare const data:
  import("./.vitepress/contributors.mts").Contributor[];
