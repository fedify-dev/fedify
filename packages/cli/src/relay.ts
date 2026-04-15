import { MemoryKvStore } from "@fedify/fedify";
import { createRelay, type Relay, type RelayType } from "@fedify/relay";
import { SqliteKvStore } from "@fedify/sqlite";
import { getLogger } from "@logtape/logtape";
import type { InferValue } from "@optique/core";
import Table from "cli-table3";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import ora from "ora";
import { configureLogging } from "./log.ts";
import type { GlobalOptions } from "./options.ts";
import { tableStyle } from "./table.ts";
import { spawnTemporaryServer, type TemporaryServer } from "./tempserver.ts";
import { colors, matchesActor } from "./utils.ts";

const logger = getLogger(["fedify", "cli", "relay"]);

type RelayCommand =
  & InferValue<typeof import("./relay/command.ts").relayCommand>
  & GlobalOptions;

export async function runRelay(
  command: RelayCommand,
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
