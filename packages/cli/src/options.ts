import { getUserAgent } from "@fedify/vocab-runtime";
import { bindConfig } from "@optique/config";
import {
  choice,
  constant,
  flag,
  type InferValue,
  map,
  merge,
  message,
  object,
  option,
  or,
  string,
  valueSet,
  withDefault,
} from "@optique/core";
import { type Config, configContext } from "./config.ts";

/**
 * Available tunneling services for exposing local servers to the public internet.
 */
export const TUNNEL_SERVICES = [
  "localhost.run",
  "serveo.net",
  "pinggy.io",
] as const;

/**
 * Type representing a valid tunneling service.
 */
export type TunnelService = typeof TUNNEL_SERVICES[number];

/**
 * Option for selecting a tunneling service.
 * Uses the global `tunnelService` config setting.
 */
export const tunnelServiceOption = bindConfig(
  option(
    "--tunnel-service",
    choice(TUNNEL_SERVICES, { metavar: "SERVICE" }),
    {
      description: message`The tunneling service to use: ${
        valueSet(TUNNEL_SERVICES)
      }.`,
    },
  ),
  {
    context: configContext,
    key: (config) => config.tunnelService ?? "localhost.run",
    default: "localhost.run" as const,
  },
);

/**
 * Config sections that support the noTunnel option.
 */
type TunnelConfigSection = "inbox" | "relay";

/**
 * Creates a tunnel option that binds to a specific config section's noTunnel field.
 * Use this when tunneling can be disabled (e.g., in `inbox` and `relay`).
 *
 * @param section - The config section to read noTunnel from ("inbox" or "relay")
 * @returns An option object with `tunnel` (boolean) and `tunnelService` fields
 */
export function createTunnelOption<S extends TunnelConfigSection>(section: S) {
  return object({
    tunnel: bindConfig(
      withDefault(
        map(
          flag("-T", "--no-tunnel", {
            description:
              message`Do not tunnel the server to the public Internet.`,
          }),
          () => false as const,
        ),
        true,
      ),
      {
        context: configContext,
        key: (config: Config) => !(config[section]?.noTunnel ?? false),
        default: true,
      },
    ),
    tunnelService: tunnelServiceOption,
  });
}

export const debugOption = object({
  debug: bindConfig(
    option("-d", "--debug", {
      description: message`Enable debug mode.`,
    }),
    {
      context: configContext,
      key: (config) => config.debug ?? false,
      default: false,
    },
  ),
});

export const userAgentOption = object({
  userAgent: bindConfig(
    option(
      "-u",
      "--user-agent",
      string({ metavar: "USER_AGENT" }),
      { description: message`The custom User-Agent header value.` },
    ),
    {
      context: configContext,
      key: (config) => config.userAgent ?? getUserAgent(),
      default: getUserAgent(),
    },
  ),
});

/**
 * Configuration file options.
 *
 * These options are mutually exclusive:
 * - `--config PATH` loads an additional config file on top of standard hierarchy
 * - `--ignore-config` skips all config files (useful for CI reproducibility)
 *
 * Returns either:
 * - `{ ignoreConfig: true }` when `--ignore-config` is specified
 * - `{ ignoreConfig: false, configPath: string }` when `--config` is specified
 * - `{ ignoreConfig: false }` when neither is specified (default)
 */
const configOption = withDefault(
  or(
    object({
      ignoreConfig: map(
        flag("--ignore-config", {
          description: message`Ignore all configuration files.`,
        }),
        () => true as const,
      ),
    }),
    object({
      ignoreConfig: constant(false),
      configPath: option("--config", string({ metavar: "PATH" }), {
        description: message`Load an additional configuration file.`,
      }),
    }),
  ),
  { ignoreConfig: false, configPath: undefined } as const,
);

/**
 * Global options that apply to all commands.
 *
 * Combines debug mode and configuration file options into a single
 * "Global options" group.
 */
export const globalOptions = merge(
  "Global options",
  debugOption,
  configOption,
);

/**
 * Type representing the parsed global options.
 * Use this to extend command types with global options in run functions.
 */
export type GlobalOptions = InferValue<typeof globalOptions>;
