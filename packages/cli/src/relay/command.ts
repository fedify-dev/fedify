import { bindConfig } from "@optique/config";
import {
  command,
  constant,
  group,
  integer,
  merge,
  message,
  multiple,
  object,
  option,
  optional,
  optionName,
  string,
  value,
} from "@optique/core";
import { choice } from "@optique/core/valueparser";
import { configContext } from "../config.ts";
import { createTunnelOption } from "../options.ts";

export const relayCommand = command(
  "relay",
  merge(
    object("Relay options", {
      command: constant("relay"),
      protocol: bindConfig(
        option(
          "-p",
          "--protocol",
          choice(["mastodon", "litepub"], { metavar: "TYPE" }),
          {
            description: message`The relay protocol to use. ${
              value("mastodon")
            } for Mastodon-compatible relay, ${
              value("litepub")
            } for LitePub-compatible relay.`,
          },
        ),
        {
          context: configContext,
          key: (config) => config.relay?.protocol ?? "mastodon",
          default: "mastodon",
        },
      ),
      persistent: optional(
        bindConfig(
          option("--persistent", string({ metavar: "PATH" }), {
            description:
              message`Path to SQLite database file for persistent storage. If not specified, uses in-memory storage which is lost when the server stops.`,
          }),
          {
            context: configContext,
            key: (config) => config.relay?.persistent,
          },
        ),
      ),
      port: bindConfig(
        option(
          "-P",
          "--port",
          integer({ min: 0, max: 65535, metavar: "PORT" }),
          {
            description: message`The local port to listen on.`,
          },
        ),
        {
          context: configContext,
          key: (config) => config.relay?.port ?? 8000,
          default: 8000,
        },
      ),
      name: bindConfig(
        option("-n", "--name", string({ metavar: "NAME" }), {
          description: message`The relay display name.`,
        }),
        {
          context: configContext,
          key: (config) => config.relay?.name ?? "Fedify Relay",
          default: "Fedify Relay",
        },
      ),
      acceptFollow: bindConfig(
        multiple(
          option("-a", "--accept-follow", string({ metavar: "URI" }), {
            description:
              message`Accept follow requests from the given actor. The argument can be either an actor URI or a handle, or a wildcard (${"*"}). Can be specified multiple times. If a wildcard is specified, all follow requests will be accepted.`,
          }),
        ),
        {
          context: configContext,
          key: (config) => config.relay?.acceptFollow ?? [],
          default: [],
        },
      ),
      rejectFollow: bindConfig(
        multiple(
          option("-r", "--reject-follow", string({ metavar: "URI" }), {
            description:
              message`Reject follow requests from the given actor. The argument can be either an actor URI or a handle, or a wildcard (${"*"}). Can be specified multiple times. If a wildcard is specified, all follow requests will be rejected.`,
          }),
        ),
        {
          context: configContext,
          key: (config) => config.relay?.rejectFollow ?? [],
          default: [],
        },
      ),
    }),
    group("Tunnel options", createTunnelOption("relay")),
  ),
  {
    brief: message`Run an ephemeral ActivityPub relay server.`,
    description:
      message`Spins up an ActivityPub relay server that forwards activities between federated instances. The server can use either Mastodon or LitePub compatible relay protocol.

By default, the server is tunneled to the public internet for external access. Use ${
        optionName("--no-tunnel")
      } to run locally only.`,
  },
);
