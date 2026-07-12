import $ from "@david/dax";
import { filter, isEmpty, pipe, toArray } from "@fxts/core";
import { values } from "@optique/core";
import {
  appendFile,
  lstat,
  mkdir,
  readFile,
  stat,
  symlink,
} from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import process from "node:process";
import packageManagers from "../json/pm.json" with { type: "json" };
import { getBuildCommand, kvStores, messageQueues } from "../lib.ts";
import type {
  KvStore,
  MessageQueue,
  PackageManager,
  WebFramework,
} from "../types.ts";
import {
  type GeneratedType,
  printErrorMessage,
  printMessage,
  product,
} from "../utils.ts";
import webFrameworks from "../webframeworks/mod.ts";
import type { InitTestData, MultipleOption } from "./types.ts";

const BANNED_PMS: PackageManager[] = ["bun", "yarn"];

const createTestApp = (testDirPrefix: string, dry: boolean) =>
async (
  options: GeneratedType<ReturnType<typeof generateTestCases>>,
): Promise<string> => {
  const testDir = join(testDirPrefix, ...options);
  const vals = values(testDir.split(sep).slice(-4));
  const result = await $`${toArray(genInitCommand(testDir, dry, options))}`
    .cwd(join(import.meta.dirname!, "..", ".."))
    .stdin("null")
    .stdout("piped")
    .stderr("piped")
    .noThrow()
    .spawn();
  await saveOutputs(testDir, result);
  if (result.code === 0) {
    if (
      !dry &&
      (!(await validateDevToolScripts(testDir, options)) ||
        !(await validateFrameworkBuild(testDir, options)))
    ) {
      printMessage`  Fail: ${vals}`;
      printMessage`    Check out these files for more details: \
${join(testDir, "out.txt")} and \
${join(testDir, "err.txt")}\n`;
      return "";
    }
    printMessage`  Pass: ${vals}`;
    return testDir;
  }
  printMessage`  Fail: ${vals}`;
  printMessage`    Check out these files for more details: \
${join(testDir, "out.txt")} and \
${join(testDir, "err.txt")}\n`;
  return "";
};

export default createTestApp;

function* genInitCommand(
  testDir: string,
  dry: boolean,
  [webFramework, packageManager, kvStore, messageQueue]: //
    GeneratedType<ReturnType<typeof generateTestCases>>,
) {
  yield "deno";
  yield "run";
  yield "-A";
  yield "src/test/execute.ts";
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
  if (dry) yield "--dry-run";
}

export const generateTestCases = <T extends Pick<InitTestData, MultipleOption>>(
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
  if (stdout) await appendFile(join(dirPath, "out.txt"), stdout + "\n", "utf8");
  if (stderr) await appendFile(join(dirPath, "err.txt"), stderr + "\n", "utf8");
};

async function validateDevToolScripts(
  dir: string,
  options: GeneratedType<ReturnType<typeof generateTestCases>>,
): Promise<boolean> {
  const [webFramework, packageManager] = options as [
    WebFramework,
    PackageManager,
    KvStore,
    MessageQueue,
  ];
  if (packageManager === "deno") return true;
  if (!(await hasInstalledNodeDependencies(dir))) return true;

  if (webFramework === "astro") {
    const format = await $`${[packageManager, "run", "format"]}`
      .cwd(dir)
      .stdin("null")
      .stdout("piped")
      .stderr("piped")
      .noThrow()
      .spawn();
    await saveOutputs(dir, format);
    if (format.code !== 0) return false;
  }

  for (const script of ["format:check", "lint"]) {
    const result = await $`${[packageManager, "run", script]}`
      .cwd(dir)
      .stdin("null")
      .stdout("piped")
      .stderr("piped")
      .noThrow()
      .spawn();
    await saveOutputs(dir, result);
    if (result.code !== 0) return false;
  }
  return true;
}

async function hasInstalledNodeDependencies(dir: string): Promise<boolean> {
  try {
    return (await stat(join(dir, "node_modules"))).isDirectory();
  } catch {
    return false;
  }
}

async function validateFrameworkBuild(
  dir: string,
  options: GeneratedType<ReturnType<typeof generateTestCases>>,
): Promise<boolean> {
  const [webFramework, packageManager] = options as [
    WebFramework,
    PackageManager,
    KvStore,
    MessageQueue,
  ];
  if (webFramework !== "astro") return true;
  if (packageManager === "deno") await linkDenoWorkspacePackages(dir);
  const result = await $`${getBuildCommand(packageManager)}`
    .cwd(dir)
    .stdin("null")
    .stdout("piped")
    .stderr("piped")
    .noThrow()
    .spawn();
  await saveOutputs(dir, result);
  return result.code === 0;
}

async function linkDenoWorkspacePackages(dir: string): Promise<void> {
  const config = JSON.parse(await readFile(join(dir, "deno.json"), "utf8"));
  for (const link of config.links ?? []) {
    const packageDir = resolve(dir, link);
    const metadata = JSON.parse(
      await readFile(join(packageDir, "package.json"), "utf8"),
    );
    const target = join(dir, "node_modules", ...metadata.name.split("/"));
    await mkdir(dirname(target), { recursive: true });
    try {
      await lstat(target);
    } catch {
      await symlink(packageDir, target, "junction");
    }
  }
}

export function filterOptions(
  options: GeneratedType<ReturnType<typeof generateTestCases>>,
): boolean {
  const [wf, pm, kv, mq] = options as //
  [WebFramework, PackageManager, KvStore, MessageQueue];
  return [
    webFrameworks[wf].packageManagers,
    kvStores[kv].packageManagers,
    messageQueues[mq].packageManagers,
  ].every((pms) => pms.includes(pm));
}
