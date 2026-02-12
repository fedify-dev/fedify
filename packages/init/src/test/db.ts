import { concat, filter, pipe, toArray, uniq } from "@fxts/core";
import { createConnection } from "node:net";
import type { TestInitCommand } from "../command.ts";
import { DB_TO_CHECK } from "../const.ts";
import DB_INFO from "../json/db-to-check.json" with { type: "json" };
import { printErrorMessage, printMessage } from "../utils.ts";
import type { DbToCheckType, DefineAllOptions } from "./types.ts";

/**
 * Checks if a given port is open by attempting a raw TCP connection to
 * localhost at that port. This works reliably for non-HTTP services like
 * Redis, PostgreSQL, or AMQP.
 * @param port The port number to check.
 * @param timeout The timeout in milliseconds. Defaults to 3000.
 * @returns A promise that resolves to true if the port is open, else false.
 */
function isPortOpen(port: number, timeout = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: "localhost" });
    socket.setTimeout(timeout);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

const getRequiredDbs = <T extends TestInitCommand>(
  { kvStore, messageQueue }: DefineAllOptions<T>,
): DbToCheckType[] =>
  pipe(
    kvStore,
    concat(messageQueue),
    uniq,
    filter((db): db is DbToCheckType =>
      DB_TO_CHECK.includes(db as DbToCheckType)
    ),
    toArray,
  );

export async function checkRequiredDbs<T extends TestInitCommand>(
  options: DefineAllOptions<T>,
): Promise<void> {
  const dbs = Array.from(getRequiredDbs(options));
  if (dbs.length === 0) return;

  printMessage`Checking required databases...`;

  for (const db of dbs) {
    const info = DB_INFO[db];
    const port = String(info.defaultPort);
    const running = await isPortOpen(info.defaultPort);
    if (running) {
      printMessage`  ${info.name} is running on port ${port}.`;
    } else {
      printErrorMessage`${info.name} is not running on port ${port}. Tests requiring ${info.name} may fail. Install: ${info.documentation}`;
    }
  }
}
