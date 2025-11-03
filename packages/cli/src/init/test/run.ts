import { filter, isEmpty, map, pipe, toArray } from "@fxts/core";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import {
  CommandError,
  type GeneratedType,
  printErrorMessage,
  printMessage,
  product,
  runSubCommand,
} from "../../utils.ts";
import packageManagers from "../json/pm.json" with { type: "json" };
import type { PackageManager } from "../types.ts";
import type { InitTestData, MultipleOption } from "./types.ts";

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
      map(runTest(join(testDirPrefix, getMid(dryRun, hydRun, dry)), dry)),
      Array.fromAsync<string>,
    );

const runTest = (testDirPrefix: string, dry: boolean) =>
async (
  options: GeneratedType<ReturnType<typeof generateTestCases>>,
): Promise<string> => {
  const testDir = join(testDirPrefix, ...options);
  try {
    const result = await runSubCommand(
      toArray(genInitCommand(testDir, dry, options)),
      {
        cwd: join(import.meta.dirname!, "../../.."),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    await saveOutputs(testDir, result);
    printMessage`Pass: ${testDir}`;
    return testDir;
  } catch (error) {
    if (error instanceof CommandError) {
      await saveOutputs(testDir, {
        stdout: error.stdout,
        stderr: error.stderr,
      });
    } else {
      const errorMessage = error instanceof Error
        ? error.message
        : String(error);
      await saveOutputs(testDir, { stdout: "", stderr: errorMessage });
    }
    printMessage`Fail: ${testDir}`;
    return "";
  }
};

const getMid = (dryRun: boolean, hydRun: boolean, dry: boolean) =>
  dryRun === hydRun ? dry ? "dry" : "hyd" : "";

function* genInitCommand(
  testDir: string,
  dry: boolean,
  [webFramework, packageManager, kvStore, messageQueue]: //
    GeneratedType<ReturnType<typeof generateTestCases>>,
) {
  yield "deno";
  yield "run";
  yield "-A";
  yield "src/mod.ts";
  yield "init";
  yield testDir;
  yield "-w";
  yield webFramework;
  yield "-p";
  yield packageManager;
  yield "-k";
  yield kvStore;
  yield "-m";
  yield messageQueue;
  yield "--test-mode";
  if (dry) yield "-d";
}

const generateTestCases = <T extends Pick<InitTestData, MultipleOption>>(
  { webFramework, packageManager, kvStore, messageQueue }: T,
) => {
  const pms = filterPackageManager(packageManager);
  exitIfCasesEmpty([webFramework, pms, kvStore, messageQueue]);

  return product(webFramework, pms, kvStore, messageQueue);
};

const filterPackageManager = (pm: PackageManager[]) =>
  pipe(
    pm,
    filter(
      (pm) =>
        BANNED_PMS.includes(pm)
          ? printErrorMessage`${packageManagers[pm]["label"]} is not \
supported in test mode yet because ${packageManagers[pm]["label"]} don't \
support local file dependencies properly.`
          : true,
    ),
    toArray,
  );

const BANNED_PMS: PackageManager[] = ["bun", "yarn"];

const exitIfCasesEmpty = (cases: string[][]): never | void => {
  if (cases.some(isEmpty)) {
    printErrorMessage`No test cases to run. Exiting.`;
    process.exit(1);
  }
};

const saveOutputs = async (
  dirPath: string,
  { stdout, stderr }: { stdout: string; stderr: string },
): Promise<void> => {
  await mkdir(dirPath, { recursive: true });
  if (stdout) await writeFile(join(dirPath, "out.txt"), stdout + "\n", "utf8");
  if (stderr) await writeFile(join(dirPath, "err.txt"), stderr + "\n", "utf8");
};
