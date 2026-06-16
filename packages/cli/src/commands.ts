import { initOptions } from "@fedify/init";
import { type AnyStaticCommand, defineCommand } from "@optique/discover";
import { constant, merge, message, object, optionNames } from "@optique/core";
import { benchMetadata, benchOptions } from "./bench/command.ts";
import {
  generateVocabMetadata,
  generateVocabOptions,
} from "./generate-vocab/command.ts";
import { inboxMetadata, inboxOptions } from "./inbox/command.ts";
import { lookupMetadata, lookupOptions } from "./lookup.ts";
import { nodeInfoMetadata, nodeInfoOptions } from "./nodeinfo.ts";
import { relayMetadata, relayOptions } from "./relay/command.ts";
import { tunnelMetadata, tunnelOptions } from "./tunnel.ts";
import { webFingerMetadata, webFingerOptions } from "./webfinger/command.ts";

export type CliStaticCommand = AnyStaticCommand;

const initParser = merge(
  initOptions,
  object({ command: constant("init") }),
);

const initMetadata = {
  brief: message`Initialize a new Fedify project directory.`,
  description: message`Initialize a new Fedify project directory.

By default, it initializes the current directory.  You can specify a different directory as an argument.

Unless you specify all options (${optionNames(["-w", "--web-framework"])}, ${
    optionNames(["-p", "--package-manager"])
  }, ${optionNames(["-k", "--kv-store"])}, and ${
    optionNames(["-m", "--message-queue"])
  }), it will prompt you to select the options interactively.`,
};

export const generatingCommands = [
  defineCommand({
    path: ["init"],
    parser: initParser,
    metadata: initMetadata,
    handler: () => {},
  }),
  defineCommand({
    path: ["generate-vocab"],
    parser: generateVocabOptions,
    metadata: generateVocabMetadata,
    handler: () => {},
  }),
] satisfies readonly CliStaticCommand[];

export const activityPubCommands = [
  defineCommand({
    path: ["webfinger"],
    parser: webFingerOptions,
    metadata: webFingerMetadata,
    handler: () => {},
  }),
  defineCommand({
    path: ["lookup"],
    parser: lookupOptions,
    metadata: lookupMetadata,
    handler: () => {},
  }),
  defineCommand({
    path: ["inbox"],
    parser: inboxOptions,
    metadata: inboxMetadata,
    handler: () => {},
  }),
  defineCommand({
    path: ["nodeinfo"],
    parser: nodeInfoOptions,
    metadata: nodeInfoMetadata,
    handler: () => {},
  }),
  defineCommand({
    path: ["relay"],
    parser: relayOptions,
    metadata: relayMetadata,
    handler: () => {},
  }),
  defineCommand({
    path: ["bench"],
    parser: benchOptions,
    metadata: benchMetadata,
    handler: () => {},
  }),
] satisfies readonly CliStaticCommand[];

export const networkCommands = [
  defineCommand({
    path: ["tunnel"],
    parser: tunnelOptions,
    metadata: tunnelMetadata,
    handler: () => {},
  }),
] satisfies readonly CliStaticCommand[];
