import { always, filter, map, pipe, tap, unless } from "@fxts/core";
import { optionNames } from "@optique/core";
import { join } from "node:path";
import { printMessage } from "../../utils.ts";
import createTestApp, { filterOptions, generateTestCases } from "./create.ts";
import runServerAndLookupUser from "./lookup.ts";
import type { InitTestData } from "./types.ts";

const runTests =
  (dry: boolean) =>
  <T extends InitTestData>({ testDirPrefix, dryRun, hydRun, ...options }: T) =>
    pipe(
      options,
      printStartMessage(dry),
      generateTestCases,
      filter(filterOptions),
      map(createTestApp(join(testDirPrefix, getMid(dryRun, hydRun, dry)), dry)),
      Array.fromAsync<string>,
      unless(always(dry), runServerAndLookupUser),
    );
export default runTests;

const printStartMessage: (dry: boolean) => <T>(t: T) => T = (dry: boolean) =>
  tap(
    () =>
      printMessage`\n
Init ${dry ? "Dry" : "Hyd"} Test start!
Options: ${
        optionNames([
          "Web Framework",
          "Package Manager",
          "KV Store",
          "Message Queue",
        ])
      }`,
  );

const getMid = (dryRun: boolean, hydRun: boolean, dry: boolean) =>
  dryRun === hydRun ? dry ? "dry" : "hyd" : "";
