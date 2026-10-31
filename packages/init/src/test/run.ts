import { optionNames } from "@optique/core";
import { join } from "node:path";
import { printMessage } from "../utils.ts";
import createTestApp, { filterOptions, generateTestCases } from "./create.ts";
import runServerAndLookupUser from "./lookup.ts";
import type { InitTestData } from "./types.ts";

interface TestRunners {
  create: ReturnType<typeof createTestApp>;
  lookup: typeof runServerAndLookupUser;
}

const runTests =
  (dry: boolean, runners?: TestRunners) =>
  async <T extends InitTestData>(
    { testDirPrefix, dryRun, hydRun, ...options }: T,
  ): Promise<boolean> => {
    printMessage`\n
Init ${dry ? "Dry" : "Hyd"} Test start!
Options: ${
      optionNames([
        "Web Framework",
        "Package Manager",
        "KV Store",
        "Message Queue",
      ])
    }`;
    const create = runners?.create ??
      createTestApp(join(testDirPrefix, getMid(dryRun, hydRun, dry)), dry);
    const dirs: string[] = [];
    for (const testCase of generateTestCases(options)) {
      if (filterOptions(testCase)) dirs.push(await create(testCase));
    }
    const generated = dirs.length > 0 && dirs.every(Boolean);
    // Retain failed generations in the aggregate even though they have no app to
    // start.  Continue testing successful generations to report all failures.
    const lookup = dry
      ? true
      : await (runners?.lookup ?? runServerAndLookupUser)(dirs);
    return generated && lookup;
  };
export default runTests;

const getMid = (dryRun: boolean, hydRun: boolean, dry: boolean) =>
  dryRun === hydRun ? dry ? "dry" : "hyd" : "";
