import { MemoryKvStore } from "@fedify/fedify";
import { createRelay, type Relay, type RelayType } from "@fedify/relay";
import { SqliteKvStore } from "@fedify/sqlite";
import { getLogger } from "@logtape/logtape";
import { bindConfig } from "@optique/config";
import {
  command,
  constant,
  group,
  type InferValue,
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
import Table from "cli-table3";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import ora from "ora";
import { configContext } from "./config.ts";
import { configureLogging } from "./log.ts";
import { createTunnelOption, type GlobalOptions } from "./options.ts";
import { tableStyle } from "./table.ts";
import { spawnTemporaryServer, type TemporaryServer } from "./tempserver.ts";
import { colors, matchesActor } from "./utils.ts";

const logger = getLogger(["fedify", "cli", "relay"]);

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

export async function runRelay(
  command: InferValue<typeof relayCommand> & GlobalOptions,
): Promise<void> {
  if (command.debug) {
    await configureLogging();
  }

  const spinner = ora({
    text: "Starting relay server...",
    discardStdin: false,
  }).start();

  let kv: MemoryKvStore | SqliteKvStore;
  if (command.persistent) {
    logger.debug("Using SQLite storage at {path}.", {
      path: command.persistent,
    });
    const db = new DatabaseSync(command.persistent);
    kv = new SqliteKvStore(db);
  } else {
    logger.debug("Using in-memory storage.");
    kv = new MemoryKvStore();
  }

  // deno-lint-ignore prefer-const
  let relay: Relay;
  let server: TemporaryServer | null = null;
  const acceptFollows: string[] = [];
  const rejectFollows: string[] = [];

  if (command.acceptFollow != null && command.acceptFollow.length > 0) {
    acceptFollows.push(...(command.acceptFollow ?? []));
  }

  if (command.rejectFollow != null && command.rejectFollow.length > 0) {
    rejectFollows.push(...(command.rejectFollow ?? []));
  }

  server = await spawnTemporaryServer(async (request) => {
    return await relay.fetch(request);
  }, {
    noTunnel: !command.tunnel,
    port: command.port,
    ...(command.tunnel && { service: command.tunnelService }),
  });

  relay = createRelay(
    command.protocol as RelayType,
    {
      origin: server?.url.origin,
      name: command.name,
      kv: kv,
      subscriptionHandler: async (_ctx, actor) => {
        const isInAcceptList = await matchesActor(actor, acceptFollows);
        const isInRejectList = await matchesActor(actor, rejectFollows);

        return isInAcceptList && !isInRejectList;
      },
    },
  );

  spinner.succeed(
    `Relay server is running: ${colors.green(server.url.href)}`,
  );

  await printRelayInfo(relay, {
    protocol: command.protocol,
    name: command.name,
    persistent: command.persistent,
  });

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    spinner.start("Shutting down relay server...");
    await server.close();
    spinner.succeed("Relay server stopped.");
    process.exit(0);
  });
}

interface RelayInfoOptions {
  protocol: string;
  name: string;
  persistent?: string;
}

async function printRelayInfo(
  relay: Relay,
  options: RelayInfoOptions,
): Promise<void> {
  const actorUri = await relay.getActorUri();
  const sharedInboxUri = await relay.getSharedInboxUri();

  const table = new Table({
    chars: tableStyle,
    style: { head: [], border: [] },
  });

  table.push(
    { "Actor URI:": colors.green(actorUri.href) },
    { "Shared Inbox:": colors.green(sharedInboxUri.href) },
    { "Protocol:": colors.green(options.protocol) },
    { "Name:": colors.green(options.name) },
    { "Storage:": colors.green(options.persistent ?? "in-memory") },
  );
  console.log(table.toString());
  console.log("\nPress ^C to stop the relay server.");
}
