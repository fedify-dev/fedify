import {
  argument,
  choice,
  command,
  constant,
  type InferValue,
  message,
  object,
  option,
  optional,
} from "@optique/core";
import { path } from "@optique/run";
import {
  KV_STORE,
  MESSAGE_QUEUE,
  PACKAGE_MANAGER,
  WEB_FRAMEWORK,
} from "./const.ts";

const joinSep = (str: readonly string[]) => str.join(" | ");
const webFramework = optional(option(
  "-w",
  "--web-framework",
  choice(WEB_FRAMEWORK, {
    metavar: `WEB_FRAMEWORK: ${joinSep(WEB_FRAMEWORK)}`,
  }),
));
const packageManager = optional(option(
  "-p",
  "--package-manager",
  choice(PACKAGE_MANAGER, {
    metavar: `PACKAGE_MANAGER: ${joinSep(PACKAGE_MANAGER)}`,
  }),
));
const kvStore = optional(option(
  "-k",
  "--kv-store",
  choice(KV_STORE, { metavar: `KV_STORE: ${joinSep(KV_STORE)}` }),
));
const messageQueue = optional(option(
  "-m",
  "--message-queue",
  choice(MESSAGE_QUEUE, {
    metavar: `MESSAGE_QUEUE: ${joinSep(MESSAGE_QUEUE)}`,
  }),
));

export const initCommand = command(
  "init",
  object({
    command: constant("init"),
    dir: optional(argument(path({ metavar: "DIRECTORY" }))),
    webFramework,
    packageManager,
    kvStore,
    messageQueue,
    dryRun: option("-d", "--dry-run"),
  }),
  {
    description: message`Initialize a new Fedify project directory.`,
  },
);

export type InitCommand = InferValue<typeof initCommand>;
