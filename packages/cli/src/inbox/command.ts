import { bindConfig } from "@optique/config";
import {
  command,
  constant,
  group,
  merge,
  message,
  multiple,
  object,
  option,
  string,
} from "@optique/core";
import { configContext } from "../config.ts";
import { createTunnelOption } from "../options.ts";

export const inboxCommand = command(
  "inbox",
  merge(
    object("Inbox options", {
      command: constant("inbox"),
      follow: bindConfig(
        multiple(
          option("-f", "--follow", string({ metavar: "URI" }), {
            description:
              message`Follow the given actor. The argument can be either an actor URI or a handle. Can be specified multiple times.`,
          }),
        ),
        {
          context: configContext,
          key: (config) => config.inbox?.follow ?? [],
          default: [],
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
          key: (config) => config.inbox?.acceptFollow ?? [],
          default: [],
        },
      ),
      actorName: bindConfig(
        option("--actor-name", string({ metavar: "NAME" }), {
          description: message`Customize the actor display name.`,
        }),
        {
          context: configContext,
          key: (config) => config.inbox?.actorName ?? "Fedify Ephemeral Inbox",
          default: "Fedify Ephemeral Inbox",
        },
      ),
      actorSummary: bindConfig(
        option("--actor-summary", string({ metavar: "SUMMARY" }), {
          description: message`Customize the actor description.`,
        }),
        {
          context: configContext,
          key: (config) =>
            config.inbox?.actorSummary ??
              "An ephemeral ActivityPub inbox for testing purposes.",
          default: "An ephemeral ActivityPub inbox for testing purposes.",
        },
      ),
      authorizedFetch: bindConfig(
        option(
          "-A",
          "--authorized-fetch",
          {
            description:
              message`Enable authorized fetch mode. Incoming requests without valid HTTP signatures will be rejected with 401 Unauthorized.`,
          },
        ),
        {
          context: configContext,
          key: (config) => config.inbox?.authorizedFetch ?? false,
          default: false,
        },
      ),
    }),
    group("Tunnel options", createTunnelOption("inbox")),
  ),
  {
    brief: message`Run an ephemeral ActivityPub inbox server.`,
    description:
      message`Spins up an ephemeral server that serves the ActivityPub inbox with an one-time actor, through a short-lived public DNS with HTTPS. You can monitor the incoming activities in real-time.`,
  },
);
