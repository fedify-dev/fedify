import { filter, map, pipe, tap } from "@fxts/core";
import { optionNames } from "@optique/core";
import { join } from "node:path";
import { printMessage } from "../../utils.ts";
import createTestApp, { filterOptions, generateTestCases } from "./create.ts";
import runServerAndReadUser from "./lookup.ts";
import type { InitTestData } from "./types.ts";

export const isDryRun = <T extends { dryRun: boolean }>({ dryRun }: T) =>
  dryRun;
export const isHydRun = <T extends { hydRun: boolean }>({ hydRun }: T) =>
  hydRun;

export const runTests =
  (dry: boolean) =>
  <T extends InitTestData>({ testDirPrefix, dryRun, hydRun, ...options }: T) =>
    pipe(
      options,
      printStartMessage,
      generateTestCases,
      filter(filterOptions),
      map(createTestApp(join(testDirPrefix, getMid(dryRun, hydRun, dry)), dry)),
      Array.fromAsync<string>,
      runServerAndReadUser,
    );

const printStartMessage: <T>(t: T) => T = tap(
  () =>
    printMessage`\n
Init Test start!
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
