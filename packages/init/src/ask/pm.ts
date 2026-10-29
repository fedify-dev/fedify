import { select } from "@inquirer/prompts";
import { message, optionName, text } from "@optique/core/message";
import { print } from "@optique/run";
import process from "node:process";
import { PACKAGE_MANAGER } from "../const.ts";
import {
  checkAllRuntimes,
  checkRuntimeVersion,
  getInstallUrl,
  isPackageManagerAvailable,
  isTest,
  resolveRequiredVersion,
  runtimes,
} from "../lib.ts";
import type { PackageManager, RuntimeCheck, WebFramework } from "../types.ts";
import { printErrorMessage } from "../utils.ts";
import webFrameworks from "../webframeworks/mod.ts";
import { pmToRt } from "../webframeworks/utils.ts";

/**
 * Fills in the package manager by prompting the user if not provided.
 * Ensures the selected package manager is compatible with the chosen web
 * framework and installed on the system. When an explicitly requested package
 * manager is unavailable, informs the user and prompts again.
 *
 * @param options - Initialization options possibly containing a packageManager and webFramework
 * @returns A promise resolving to options with a guaranteed packageManager
 */
const fillPackageManager: //
  <
    T extends {
      packageManager?: PackageManager;
      webFramework: WebFramework;
      testMode: boolean;
    },
  > //
  (options: T) => //
  Promise<Omit<T, "packageManager"> & { packageManager: PackageManager }> = //
  async ({ packageManager, ...options }) => {
    // An explicit matrix case only needs its selected runtime.  Keep full
    // availability checks for the public CLI and interactive selection.
    const runtime = packageManager == null ? undefined : pmToRt(packageManager);
    const choices = isTest(options) && packageManager != null && runtime != null
      ? [
        await choicePackageManager(
          options.webFramework,
          packageManager,
          await checkRuntimeVersion({
            ...runtimes[runtime],
            minVersion: resolveRequiredVersion(
              runtime,
              webFrameworks[options.webFramework].minRuntimeVersions?.[runtime],
            ),
          }),
        ),
      ]
      : await calculateChoices(options.webFramework);
    if (packageManager != null) {
      const choice = choices.find(({ value }) => value === packageManager)!;
      if (choice.disabled == null) {
        return { ...options, packageManager };
      }
      print(message`${optionName(choice.name)} ${text(choice.disabled)}`);
      if (isTest(options)) process.exit(1);
    }
    return { ...options, packageManager: await askPackageManager(choices) };
  };

export default fillPackageManager;

const calculateChoices = async (wf: WebFramework) => {
  const runtimeChecks = await checkAllRuntimes(
    webFrameworks[wf].minRuntimeVersions,
  );
  const choices = await Promise.all(
    PACKAGE_MANAGER.map((pm) =>
      choicePackageManager(wf, pm, runtimeChecks[pmToRt(pm)])
    ),
  );
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

const choicePackageManager = async (
  wf: WebFramework,
  value: PackageManager,
  check: RuntimeCheck,
) => {
  const label = runtimes[pmToRt(value)].label;
  const disabled = !isWfSupportsPm(wf, value)
    ? `not supported with ${webFrameworks[wf].label}`
    : check.status === "unsupported"
    ? `requires ${label} ${check.required} or later (detected: ${check.detected})`
    : check.status === "missing"
    ? `requires ${label} which is not installed`
    : check.status === "malformed"
    ? `could not detect ${label} version`
    : pmToRt(value) === "node" && !await isPackageManagerAvailable(value)
    ? `is not installed; install it from ${getInstallUrl(value)}`
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
