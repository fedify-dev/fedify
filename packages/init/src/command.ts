import {
  argument,
  choice,
  command,
  constant,
  type InferValue,
  merge,
  message,
  multiple,
  object,
  option,
  optional,
  optionNames,
  or,
} from "@optique/core";
import { path } from "@optique/run";
import {
  KV_STORE,
  MESSAGE_QUEUE,
  PACKAGE_MANAGER,
  WEB_FRAMEWORK,
} from "./const.ts";

const webFramework = optional(option(
  "-w",
  "--web-framework",
  choice(WEB_FRAMEWORK, { metavar: "WEB_FRAMEWORK" }),
  {
    description: message`The web framework to integrate Fedify with.`,
  },
));
const packageManager = optional(option(
  "-p",
  "--package-manager",
  choice(PACKAGE_MANAGER, { metavar: "PACKAGE_MANAGER" }),
  {
    description:
      message`The package manager to use for installing dependencies.`,
  },
));
const kvStore = optional(option(
  "-k",
  "--kv-store",
  choice(KV_STORE, { metavar: "KV_STORE" }),
  {
    description:
      message`The key-value store to use for caching and some other features.`,
  },
));
const messageQueue = optional(option(
  "-m",
  "--message-queue",
  choice(MESSAGE_QUEUE, { metavar: "MESSAGE_QUEUE" }),
  {
    description: message`The message queue to use for background tasks.`,
  },
));

const debugOption = object("Global options", {
  debug: option("-d", "--debug", {
    description: message`Enable debug mode.`,
  }),
});

export const initOptions = object("Initialization options", {
  dir: optional(argument(path({ metavar: "DIR" }), {
    description:
      message`The project directory to initialize.  If a specified directory does not exist, it will be created.`,
  })),
  webFramework,
  packageManager,
  kvStore,
  messageQueue,
  dryRun: option("--dry-run", {
    description: message`Perform a trial run with no changes made.`,
  }),
  debugOption,
});

export const initCommand = command(
  "init",
  merge(
    initOptions,
    object({ command: constant("init") }),
  ),
  {
    brief: message`Initialize a new Fedify project directory.`,
    description: message`Initialize a new Fedify project directory.

By default, it initializes the current directory.  You can specify a different directory as an argument.

Unless you specify all options (${optionNames(["-w", "--web-framework"])}, ${
      optionNames(["-p", "--package-manager"])
    }, ${optionNames(["-k", "--kv-store"])}, and ${
      optionNames(["-m", "--message-queue"])
    }), it will prompt you to select the options interactively.`,
  },
);

export type InitCommand = InferValue<typeof initCommand>;

const noHydRun = object({
  noHydRun: option("--no-hyd-run", {
    description: message`Log outputs without creating files.`,
  }),
});
const noDryRun = object({
  noDryRun: option("--no-dry-run", {
    description: message`Test with files creations and installations.`,
  }),
});
export const testInitCommand = command(
  "test-init",
  merge(
    object("Initialization options", {
      webFramework: multiple(webFramework),
      packageManager: multiple(packageManager),
      kvStore: multiple(kvStore),
      messageQueue: multiple(messageQueue),
      debugOption,
    }),
    optional(or(noHydRun, noDryRun)),
  ),
  {
    brief: message`Test an initializing command.`,
    description: message`Test an initializing command on temporary directories.

Unless you specify all options (${optionNames(["-w", "--web-framework"])}, ${
      optionNames(["-p", "--package-manager"])
    }, ${optionNames(["-k", "--kv-store"])}, and ${
      optionNames(["-m", "--message-queue"])
    }), it will test all combinations of the options.`,
  },
);

export type TestInitCommand = InferValue<typeof testInitCommand>;
