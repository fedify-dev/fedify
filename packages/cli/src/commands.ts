import { initOptions, runInit } from "@fedify/init";
import {
  constant,
  merge,
  message,
  object,
  optionNames,
  type Parser,
} from "@optique/core";
import {
  type CommandMetadata,
  type CommandPath,
  defineCommand,
  type StaticCommand,
} from "@optique/discover";
import runBench from "./bench/action.ts";
import { benchMetadata, benchOptions } from "./bench/command.ts";
import runGenerateVocab from "./generate-vocab/action.ts";
import {
  generateVocabMetadata,
  generateVocabOptions,
} from "./generate-vocab/command.ts";
import { runInbox } from "./inbox.tsx";
import { inboxMetadata, inboxOptions } from "./inbox/command.ts";
import { lookupMetadata, lookupOptions, runLookup } from "./lookup.ts";
import { nodeInfoMetadata, nodeInfoOptions, runNodeInfo } from "./nodeinfo.ts";
import type { GlobalOptions } from "./options.ts";
import { runRelay } from "./relay.ts";
import { relayMetadata, relayOptions } from "./relay/command.ts";
import { runTunnel, tunnelMetadata, tunnelOptions } from "./tunnel.ts";
import runWebFinger from "./webfinger/action.ts";
import { webFingerMetadata, webFingerOptions } from "./webfinger/command.ts";

type CliCommandHandler<TValue extends object> = (
  value: TValue & GlobalOptions,
) => unknown | Promise<unknown>;

export type CliStaticCommand<TValue extends object> =
  & Omit<StaticCommand<"sync", TValue>, "handler">
  & {
    readonly handler: (value: never) => unknown | Promise<unknown>;
    readonly run: CliCommandHandler<TValue>;
  };

export type AnyCliStaticCommand =
  & Omit<StaticCommand<"sync", never>, "handler" | "parser">
  & {
    readonly parser: Parser<"sync", unknown, unknown>;
    readonly handler: (value: never) => unknown | Promise<unknown>;
    readonly run: (value: never) => unknown | Promise<unknown>;
  };

export type CliCommandValue<TCommand extends AnyCliStaticCommand> =
  TCommand extends CliStaticCommand<infer TValue> ? TValue : never;

function defineCliCommand<const TValue extends object>(
  command: {
    readonly path: CommandPath;
    readonly parser: Parser<"sync", TValue, unknown>;
    readonly metadata?: CommandMetadata;
    readonly run: CliCommandHandler<NoInfer<TValue>>;
  },
): CliStaticCommand<TValue> {
  const { run, ...definition } = command;
  return {
    ...defineCommand({
      ...definition,
      handler: (_value: TValue) => {},
    }),
    run,
  };
}

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
  defineCliCommand({
    path: ["init"],
    parser: initParser,
    metadata: initMetadata,
    run: runInit,
  }),
  defineCliCommand({
    path: ["generate-vocab"],
    parser: generateVocabOptions,
    metadata: generateVocabMetadata,
    run: runGenerateVocab,
  }),
] satisfies readonly AnyCliStaticCommand[];

export const activityPubCommands = [
  defineCliCommand({
    path: ["webfinger"],
    parser: webFingerOptions,
    metadata: webFingerMetadata,
    run: runWebFinger,
  }),
  defineCliCommand({
    path: ["lookup"],
    parser: lookupOptions,
    metadata: lookupMetadata,
    run: runLookup,
  }),
  defineCliCommand({
    path: ["inbox"],
    parser: inboxOptions,
    metadata: inboxMetadata,
    run: runInbox,
  }),
  defineCliCommand({
    path: ["nodeinfo"],
    parser: nodeInfoOptions,
    metadata: nodeInfoMetadata,
    run: runNodeInfo,
  }),
  defineCliCommand({
    path: ["relay"],
    parser: relayOptions,
    metadata: relayMetadata,
    run: runRelay,
  }),
  defineCliCommand({
    path: ["bench"],
    parser: benchOptions,
    metadata: benchMetadata,
    run: runBench,
  }),
] satisfies readonly AnyCliStaticCommand[];

export const networkCommands = [
  defineCliCommand({
    path: ["tunnel"],
    parser: tunnelOptions,
    metadata: tunnelMetadata,
    run: runTunnel,
  }),
] satisfies readonly AnyCliStaticCommand[];

export const cliCommands = [
  ...generatingCommands,
  ...activityPubCommands,
  ...networkCommands,
] as const satisfies readonly AnyCliStaticCommand[];

export type CliCommand = typeof cliCommands[number];
