import { map, pipe } from "@fxts/core";
import { join } from "node:path";
import { createTestApp, generateTestCases } from "./create.ts";
import runServerAndReadUser from "./read.ts";
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
      generateTestCases,
      map(createTestApp(join(testDirPrefix, getMid(dryRun, hydRun, dry)), dry)),
      Array.fromAsync<string>,
      runServerAndReadUser,
    );

const getMid = (dryRun: boolean, hydRun: boolean, dry: boolean) =>
  dryRun === hydRun ? dry ? "dry" : "hyd" : "";
