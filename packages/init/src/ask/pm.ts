import { pipe, when } from "@fxts/core";
import { select } from "@inquirer/prompts";
import { message, optionName, text } from "@optique/core/message";
import { print } from "@optique/run";
import process from "node:process";
import { PACKAGE_MANAGER } from "../const.ts";
import {
  checkAllRuntimes,
  getInstallUrl,
  isPackageManagerAvailable,
  kvStores,
  messageQueues,
  packageManagers,
  runtimes,
} from "../lib.ts";
import type {
  PackageManager,
  Runtime,
  RuntimeCheck,
  WebFramework,
} from "../types.ts";
import { printErrorMessage } from "../utils.ts";
import webFrameworks from "../webframeworks/mod.ts";
import { pmToRt } from "../webframeworks/utils.ts";

/**
 * Fills in the package manager by prompting the user if not provided.
 * Ensures the selected package manager is compatible with the chosen web framework.
 * If the selected package manager is not installed, informs the user and prompts again.
 *
 * @param options - Initialization options possibly containing a packageManager and webFramework
 * @returns A promise resolving to options with a guaranteed packageManager
 */
const fillPackageManager: //
  <T extends { packageManager?: PackageManager; webFramework: WebFramework }> //
  (options: T) => //
  Promise<Omit<T, "packageManager"> & { packageManager: PackageManager }> = //
  async ({ packageManager, ...options }) => {
    const choices = await calculateChoices(options.webFramework);
    if (packageManager != null) {
      const pm = packageManager;
      const choice = choices.find(({ value }) => value === pm)!;
      if (choice.disabled != null) {
        print(message`${optionName(choice.name)} ${text(choice.disabled)}`);
        process.exit(1);
      }
      if (!await isPackageManagerAvailable(pm)) {
        noticeInstallUrl(pm);
        process.exit(1);
      }
      return ({ ...options, packageManager: pm });
    }
    while (true) {
      const pm = await askPackageManager(choices);
      if (await isPackageManagerAvailable(pm)) {
        return ({ ...options, packageManager: pm });
      }
      noticeInstallUrl(pm);
    }
  };

export default fillPackageManager;

const calculateChoices = async (wf: WebFramework) => {
  const runtimeChecks = await checkAllRuntimes(
    webFrameworks[wf].minRuntimeVersions,
  );
  const choices = PACKAGE_MANAGER.map(choicePackageManager(wf, runtimeChecks));
  if (choices.every((choice) => choice.disabled)) {
    printErrorMessage`No package manager with a supported runtime is available for ${
      webFrameworks[wf].label
    }.`;
    process.exit(1);
  }
  return choices;
};

const askPackageManager = (
  choices: Awaited<ReturnType<typeof calculateChoices>>,
) =>
  select<PackageManager>({
    message: "Choose the package manager to use",
    choices,
  });

const choicePackageManager =
  (wf: WebFramework, runtimeChecks: Record<Runtime, RuntimeCheck>) =>
  (value: PackageManager) => {
    const check = runtimeChecks[pmToRt(value)];
    const label = runtimes[pmToRt(value)].label;
    const disabled = !isWfSupportsPm(wf, value)
      ? `not supported with ${webFrameworks[wf].label}`
      : check.status === "unsupported"
      ? `requires ${label} ${check.required} or later`
      : check.status === "missing"
      ? `requires ${label} which is not installed`
      : check.status === "malformed"
      ? `could not detect ${label} version`
      : "";
    return disabled === "" ? { name: value, value } : {
      name: value,
      value,
      disabled,
    };
  };

const isWfSupportsPm = (
  wf: WebFramework,
  pm: PackageManager,
) => webFrameworks[wf].packageManagers.includes(pm);

const noticeInstallUrl = (pm: PackageManager) => {
  const label = getLabel(pm);
  const url = getInstallUrl(pm);
  print(message`  Package manager ${label} is not installed.`);
  print(message`  You can install it from following link: ${url}`);
  print(message`  or choose another package manager:`);
};

const getLabel = (name: string) =>
  pipe(
    name,
    whenHasLabel(webFrameworks),
    whenHasLabel(packageManagers),
    whenHasLabel(messageQueues),
    whenHasLabel(kvStores),
    whenHasLabel(runtimes),
  );
const whenHasLabel = <T extends Record<string, { label: string }>>(desc: T) =>
  when((name: string) => name in desc, (name) => desc[name as keyof T].label);
