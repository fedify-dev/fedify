import {
  argument,
  choice,
  command,
  constant,
  flag,
  type InferValue,
  message,
  multiple,
  object,
  option,
  optional,
  optionNames,
} from "@optique/core";
import { path } from "@optique/run";
import { debugOption } from "../globals.ts";
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
const testMode = flag(
  "--test-mode",
  {
    description: message`The test mode to use for testing purposes.`,
  },
);

export const initCommand = command(
  "init",
  object("Initialization options", {
    command: constant("init"),
    dir: optional(argument(path({ metavar: "DIR" }), {
      description:
        message`The project directory to initialize.  If a specified directory does not exist, it will be created.`,
    })),
    webFramework,
    packageManager,
    kvStore,
    messageQueue,
    dryRun: option("-d", "--dry-run", {
      description: message`Perform a trial run with no changes made.`,
    }),
    debugOption,
    testMode,
  }),
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

export const testInitCommand = command(
  "test-init",
  object("Initialization options", {
    command: constant("test-init"),
    webFramework: multiple(webFramework),
    packageManager: multiple(packageManager),
    kvStore: multiple(kvStore),
    messageQueue: multiple(messageQueue),
    hydRun: option("-h", "--hyd-run", {
      description: message`Test with files creations and installations.`,
    }),
    dryRun: option("-d", "--dry-run", {
      description: message`Log outputs without creating files.`,
    }),
    debugOption,
  }),
  {
    brief: message`Test an initializing command .`,
    description: message`Test an initializing command on temporary directories.

Unless you specify all options (${optionNames(["-w", "--web-framework"])}, ${
      optionNames(["-p", "--package-manager"])
    }, ${optionNames(["-k", "--kv-store"])}, and ${
      optionNames(["-m", "--message-queue"])
    }), it will test all combinations of the options.`,
  },
);

export type TestInitCommand = InferValue<typeof testInitCommand>;
