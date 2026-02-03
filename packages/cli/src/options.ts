import {
  choice,
  constant,
  flag,
  map,
  message,
  object,
  option,
  optional,
  or,
  string,
  valueSet,
  withDefault,
} from "@optique/core";

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
 * Use this when tunneling is implicit (e.g., in `lookup` with `-a`).
 */
export const tunnelServiceOption = optional(
  option(
    "--tunnel-service",
    choice(TUNNEL_SERVICES, { metavar: "SERVICE" }),
    {
      description: message`The tunneling service to use: ${
        valueSet(TUNNEL_SERVICES)
      }.`,
    },
  ),
);

/**
 * Combined option for enabling/disabling tunneling with service selection.
 * Use this when tunneling can be disabled (e.g., in `inbox` and `relay`).
 *
 * Returns either:
 * - `{ tunnel: false }` when `--no-tunnel` is specified
 * - `{ tunnel: true, tunnelService?: TunnelService }` otherwise
 */
export const tunnelOption = or(
  object({
    tunnel: map(
      flag("-T", "--no-tunnel", {
        description: message`Do not tunnel the server to the public Internet.`,
      }),
      () => false as const,
    ),
  }),
  object({
    tunnel: constant(true),
    tunnelService: tunnelServiceOption,
  }),
);

export const debugOption = object("Global options", {
  debug: option("-d", "--debug", {
    description: message`Enable debug mode.`,
  }),
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
export const configOption = withDefault(
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
