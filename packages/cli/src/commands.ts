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
import { benchMetadata, benchOptions } from "./bench/command.ts";
import {
  generateVocabMetadata,
  generateVocabOptions,
} from "./generate-vocab/command.ts";
import { inboxMetadata, inboxOptions } from "./inbox/command.ts";
import { lookupMetadata, lookupOptions } from "./lookup/command.ts";
import { nodeInfoMetadata, nodeInfoOptions, runNodeInfo } from "./nodeinfo.ts";
import type { GlobalOptions } from "./options.ts";
import { relayMetadata, relayOptions } from "./relay/command.ts";
import { runTunnel, tunnelMetadata, tunnelOptions } from "./tunnel.ts";
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
    run: async (value) => {
      const { default: runGenerateVocab } = await import(
        "./generate-vocab/action.ts"
      );
      return await runGenerateVocab(value);
    },
  }),
] satisfies readonly AnyCliStaticCommand[];

export const activityPubCommands = [
  defineCliCommand({
    path: ["webfinger"],
    parser: webFingerOptions,
    metadata: webFingerMetadata,
    run: async (value) => {
      const { default: runWebFinger } = await import("./webfinger/action.ts");
      return await runWebFinger(value);
    },
  }),
  defineCliCommand({
    path: ["lookup"],
    parser: lookupOptions,
    metadata: lookupMetadata,
    run: async (value) => {
      const { runLookup } = await import("./lookup.ts");
      return await runLookup(value);
    },
  }),
  defineCliCommand({
    path: ["inbox"],
    parser: inboxOptions,
    metadata: inboxMetadata,
    run: async (value) => {
      const { runInbox } = await import("./inbox.tsx");
      return await runInbox(value);
    },
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
    run: async (value) => {
      const { runRelay } = await import("./relay.ts");
      return await runRelay(value);
    },
  }),
  defineCliCommand({
    path: ["bench"],
    parser: benchOptions,
    metadata: benchMetadata,
    run: async (value) => {
      const { runBench } = await import("./bench/mod.ts");
      return await runBench(value);
    },
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
