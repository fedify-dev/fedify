import { map, pipe, toArray, toAsync } from "@fxts/core";
import { message } from "@optique/core";
import { print, printError } from "@optique/run";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type GeneratedType, product, runSubCommand } from "../../utils.ts";
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
    print(message`Pass: ${testDir}`);
    return testDir;
  } catch (error) {
    console.error(`Error while init ${testDir}:`, error);
    printError(message`Fail: ${testDir}`);
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
  if (dry) yield "-d";
}

const generateTestCases = <T extends Pick<InitTestData, MultipleOption>>(
  { webFramework, packageManager, kvStore, messageQueue }: T,
) => product(webFramework, packageManager, kvStore, messageQueue);

const saveOutputs = async (
  dirPath: string,
  {
    stdout,
    stderr,
  }: { stdout: string; stderr: string },
): Promise<void> => {
  await mkdir(dirPath, { recursive: true });
  stdout && await writeFile(join(dirPath, "out.txt"), stdout + "\n", "utf8");
  stderr && await writeFile(join(dirPath, "err.txt"), stderr + "\n", "utf8");
};
