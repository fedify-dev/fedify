import { pipe, when } from "@fxts/core";
import { select } from "@inquirer/prompts";
import { message } from "@optique/core/message";
import { print } from "@optique/run";
import { PACKAGE_MANAGER } from "../const.ts";
import {
  getInstallUrl,
  isPackageManagerAvailable,
  kvStores,
  messageQueues,
  packageManagers,
  runtimes,
} from "../lib.ts";
import type { PackageManager, WebFramework } from "../types.ts";
import webFrameworks from "../webframeworks.ts";

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
    const pm = packageManager ?? await askPackageManager(options.webFramework);
    if (await isPackageManagerAvailable(pm)) {
      return ({ ...options, packageManager: pm });
    }
    noticeInstallUrl(pm);
    return await fillPackageManager(options) as //
    typeof options & { packageManager: PackageManager };
  };

export default fillPackageManager;

const askPackageManager = (wf: WebFramework) =>
  select<PackageManager>({
    message: "Choose the package manager to use",
    choices: PACKAGE_MANAGER.map(choicePackageManager(wf)),
  });

const choicePackageManager = (wf: WebFramework) => (value: PackageManager) => ({
  name: isWfSupportsPm(wf, value)
    ? value
    : `${value} (not supported with ${webFrameworks[wf].label})`,
  value,
  disabled: !isWfSupportsPm(wf, value),
});

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
