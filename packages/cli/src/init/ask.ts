import { pipe } from "@fxts/core";
import { input, select } from "@inquirer/prompts";
import { message } from "@optique/core/message";
import { print } from "@optique/run";
import * as colors from "@std/fmt/colors";
import toggle from "inquirer-toggle";
import { getCwd, type RequiredNotNull } from "../utils.ts";
import type { InitCommand } from "./command.ts";
import {
  KV_STORE,
  MESSAGE_QUEUE,
  PACKAGE_MANAGER,
  WEB_FRAMEWORK,
} from "./const.ts";
import {
  getInstallUrl,
  getLabel,
  isDirectoryEmpty,
  isPackageManagerAvailable,
  kvStores,
  messageQueues,
} from "./lib.ts";
import type {
  KvStore,
  MessageQueue,
  PackageManager,
  WebFramework,
} from "./types.ts";
import webFrameworks from "./webframeworks.ts";

const askOptions: (
  options: InitCommand,
) => Promise<RequiredNotNull<InitCommand>> = //
  (options) =>
    pipe(
      options,
      fillDir,
      fillWebFramework,
      fillPackageManager,
      fillMessageQueue,
      fillKvStore,
    );

export default askOptions;

const fillDir: <T extends { dir?: string }>(
  options: T,
) => Promise<T & { dir: string }> = async (options) => {
  const dir = options.dir ?? await askDir(getCwd());
  return await askNonEmpty(dir) ? { ...options, dir } : await fillDir(options);
};
const askDir = (cwd: string) =>
  input({ message: "Project directory:", default: cwd });
const askNonEmpty = async (directory: string) =>
  await isDirectoryEmpty(directory) || await toggle.default({
    message:
      `Directory "${directory}" is not empty. Do you want to use it anyway?`,
    default: false,
  });

const fillWebFramework: //
  <T extends { webFramework?: WebFramework }>(options: T) => //
  Promise<T & { webFramework: WebFramework }> = async (options) => //
  ({
    ...options,
    webFramework: options.webFramework ?? await askWebFramework(),
  });
const askWebFramework = () =>
  select<WebFramework>({
    message: "Choose the web framework to use",
    choices: WEB_FRAMEWORK.map((value) => //
    ({ name: webFrameworks[value].label, value })),
  });

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
  const label = colors.bold(getLabel(pm));
  const url = colors.underline(colors.blue(getInstallUrl(pm)));
  print(message`  Package manager "${label}" is not installed.`);
  print(message`  You can install it from following link: ${url}`);
  print(message`  or choose another package manager:`);
};

const fillMessageQueue: //
  <T extends { messageQueue?: MessageQueue; packageManager: PackageManager }> //
  (options: T) => Promise<T & { messageQueue: MessageQueue }> = //
  async (options) => ({
    ...options,
    messageQueue: options.messageQueue ??
      await askMessageQueue(options.packageManager),
  });
const askMessageQueue = (pm: PackageManager) =>
  select<MessageQueue>({
    message: "Choose the message queue to use",
    choices: MESSAGE_QUEUE.map(choiceMessageQueue(pm)),
  });
const choiceMessageQueue = (pm: PackageManager) => (value: MessageQueue) => ({
  name: isMqSupportsPm(value, pm)
    ? value
    : `${value} (not supported with ${pm})`,
  value,
  disabled: !isMqSupportsPm(value, pm),
});
const isMqSupportsPm = (mq: MessageQueue, pm: PackageManager) =>
  messageQueues[mq].packageManagers.includes(pm);

const fillKvStore: //
  <T extends { kvStore?: KvStore; packageManager: PackageManager }>(
    options: T,
  ) => Promise<T & { kvStore: KvStore }> = async (options) => //
  ({
    ...options,
    kvStore: options.kvStore ?? await askKvStore(options.packageManager),
  });
const askKvStore = (pm: PackageManager) =>
  select<KvStore>({
    message: "Choose the key-value store to use",
    choices: KV_STORE.map(choiceKvStore(pm)),
  });
const choiceKvStore = (pm: PackageManager) => (value: KvStore) => ({
  name: isKvSupportsPm(value, pm)
    ? value
    : `${value} (not supported with ${pm})`,
  value,
  disabled: !isKvSupportsPm(value, pm),
});
const isKvSupportsPm = (kv: KvStore, pm: PackageManager) =>
  kvStores[kv].packageManagers.includes(pm);
