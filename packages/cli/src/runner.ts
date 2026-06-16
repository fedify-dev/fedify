import {
  command as optiqueCommand,
  group,
  map,
  merge,
  message,
  or,
  type Parser,
} from "@optique/core";
import { printError, run, type RunOptions } from "@optique/run";
import { merge as deepMerge } from "es-toolkit";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { parse as parseToml } from "smol-toml";
import {
  activityPubCommands,
  type CliStaticCommand,
  generatingCommands,
  networkCommands,
} from "./commands.ts";
import { configContext, tryLoadToml } from "./config.ts";
import { type GlobalOptions, globalOptions } from "./options.ts";
import { describeError } from "./utils.ts";
import metadata from "../deno.json" with { type: "json" };

/**
 * Returns the system-wide configuration file paths.
 * - Linux/macOS: Searches `$XDG_CONFIG_DIRS` (default: /etc/xdg)
 * - Windows: Uses `%ProgramData%` (default: C:\ProgramData)
 */
function getSystemConfigPaths(): string[] {
  if (process.platform === "win32") {
    const programData = process.env.ProgramData || "C:\\ProgramData";
    return [join(programData, "fedify", "config.toml")];
  }
  return (process.env.XDG_CONFIG_DIRS || "/etc/xdg")
    .split(":")
    .map((dir) => join(dir, "fedify", "config.toml"));
}

/**
 * Returns the user-level configuration file path.
 * - Linux/macOS: `$XDG_CONFIG_HOME/fedify/config.toml` (default: ~/.config)
 * - Windows: `%APPDATA%\fedify\config.toml`
 */
function getUserConfigPath(): string {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ||
      join(homedir(), "AppData", "Roaming");
    return join(appData, "fedify", "config.toml");
  }
  const xdgConfigHome = process.env.XDG_CONFIG_HOME ||
    join(homedir(), ".config");
  return join(xdgConfigHome, "fedify", "config.toml");
}

const selectedCommand = "__fedifyCliSelectedCommand";

type CommandInvocation = Record<string, unknown> & {
  [selectedCommand]: CliStaticCommand;
};

type RunnableCommandValue = CommandInvocation & GlobalOptions;

export type CliProgram = {
  command: CliStaticCommand;
  value: Record<string, unknown> & GlobalOptions;
};

function staticCommandParser(
  staticCommand: CliStaticCommand,
): Parser<"sync", CommandInvocation, unknown> {
  if (staticCommand.path.length < 1) {
    throw new TypeError("Static command path must not be empty.");
  }

  let parser = staticCommand.parser as Parser<
    "sync",
    Record<string, unknown>,
    unknown
  >;
  for (let i = staticCommand.path.length - 1; i >= 0; i--) {
    const name = staticCommand.path[i];
    if (name == null) {
      throw new TypeError("Static command path contains an empty segment.");
    }
    parser = optiqueCommand(
      name,
      parser,
      i === staticCommand.path.length - 1 ? staticCommand.metadata : undefined,
    ) as Parser<"sync", Record<string, unknown>, unknown>;
  }

  return map(parser, (value) => ({
    ...value,
    [selectedCommand]: staticCommand,
  })) as Parser<"sync", CommandInvocation, unknown>;
}

function staticCommandsParser(
  commands: readonly CliStaticCommand[],
): Parser<"sync", CommandInvocation, unknown> {
  const parsers = commands.map(staticCommandParser);
  if (parsers.length < 1) {
    throw new TypeError("Static command group must not be empty.");
  }
  return parsers.length === 1 ? parsers[0]! : or(...parsers);
}

const runnableCommand = merge(
  or(
    group(
      "Generating code",
      staticCommandsParser(generatingCommands),
    ),
    group(
      "ActivityPub tools",
      staticCommandsParser(activityPubCommands),
    ),
    group(
      "Network tools",
      staticCommandsParser(networkCommands),
    ),
  ),
  globalOptions,
) as Parser<"sync", RunnableCommandValue, unknown>;

export const command = map(
  runnableCommand,
  ({ [selectedCommand]: _selectedCommand, ...value }) => value,
);

type ConfigOptions = {
  ignoreConfig: boolean;
  configPath?: string;
};

function getRunOptions(args: string[]): RunOptions {
  return {
    contexts: [configContext],
    contextOptions: { load: loadConfig },
    programName: "fedify",
    args,
    help: {
      command: { group: "Meta commands" },
      option: { group: "Meta commands" },
    },
    version: {
      value: metadata.version,
      command: { group: "Meta commands" },
      option: { group: "Meta commands" },
    },
    completion: {
      command: {
        names: ["completions", "completion"] as const,
        group: "Meta commands",
      },
    },
    colors: process.stdout.isTTY &&
      (process.env.NO_COLOR == null || process.env.NO_COLOR === ""),
    maxWidth: process.stdout.columns,
    showDefault: true,
    showChoices: true,
  };
}

export function loadConfig(
  parsed: ConfigOptions,
): { config: Record<string, unknown>; meta: undefined } | undefined {
  if (parsed.ignoreConfig) return undefined;

  // Load system-wide configs (XDG_CONFIG_DIRS on Linux/macOS, ProgramData on Windows)
  const systemConfigs = getSystemConfigPaths().map(tryLoadToml);
  const system = systemConfigs.reduce(
    (acc, config) => deepMerge(acc, config),
    {},
  );
  const user = tryLoadToml(getUserConfigPath());
  const project = tryLoadToml(join(process.cwd(), ".fedify.toml"));

  // Custom config via --config exits with error if file is missing or invalid
  let custom: Record<string, unknown> = {};
  if (parsed.configPath) {
    try {
      custom = parseToml(readFileSync(parsed.configPath, "utf-8"));
    } catch (error) {
      printError(
        message`Could not load config file at ${parsed.configPath}: ${
          describeError(error)
        }`,
      );
      process.exit(1);
    }
  }

  return {
    config: [system, user, project, custom].reduce(
      (acc, config) => deepMerge(acc, config),
      {},
    ),
    meta: undefined,
  };
}

/**
 * Runs the Fedify CLI with the given command-line arguments.
 * @param args Command-line arguments, usually `process.argv.slice(2)`.
 * @returns The parsed command result from Optique's runner.
 */
export function runCli(args: string[]) {
  return run(command, getRunOptions(args));
}

export async function parseCliProgram(args: string[]): Promise<CliProgram> {
  const { [selectedCommand]: command, ...value } = await run(
    runnableCommand,
    getRunOptions(args),
  );
  return { command, value };
}
