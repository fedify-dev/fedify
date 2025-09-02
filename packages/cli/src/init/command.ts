import {
  argument,
  choice,
  command,
  constant,
  type InferValue,
  message,
  object,
  option,
} from "@optique/core";
import { path } from "@optique/run";
import {
  KV_STORE,
  MESSAGE_QUEUE,
  PACKAGE_MANAGER,
  RUNTIME,
  WEB_FRAMEWORK,
} from "./const.ts";
import { join } from "npm:@fxts/core@^1.15.0";

const joinSep = join(" | ");
const webFramework = option(
  "-w",
  "--web-framework",
  choice(WEB_FRAMEWORK, {
    metavar: `WEB_FRAMEWORK: ${joinSep(WEB_FRAMEWORK)}`,
  }),
);
const runtime = option(
  "-r",
  "--runtime",
  choice(RUNTIME, { metavar: `RUNTIME: ${joinSep(RUNTIME)}` }),
);
const packageManager = option(
  "-p",
  "--package-manager",
  choice(PACKAGE_MANAGER, {
    metavar: `PACKAGE_MANAGER: ${joinSep(PACKAGE_MANAGER)}`,
  }),
);
const kvStore = option(
  "-k",
  "--kv-store",
  choice(KV_STORE, { metavar: `KV_STORE: ${joinSep(KV_STORE)}` }),
);
const messageQueue = option(
  "-m",
  "--message-queue",
  choice(MESSAGE_QUEUE, {
    metavar: `MESSAGE_QUEUE: ${joinSep(MESSAGE_QUEUE)}`,
  }),
);

export const initCommand = command(
  "init",
  object({
    command: constant("init"),
    dir: argument(path({ metavar: "DIRECTORY" })),
    webFramework,
    runtime,
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
