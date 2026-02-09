import { concat, filter, pipe, toArray, uniq } from "@fxts/core";
import type { TestInitCommand } from "../command.ts";
import { DB_TO_CHECK } from "../const.ts";
import DB_INFO from "../json/db-to-check.json" with { type: "json" };
import { printErrorMessage, printMessage } from "../utils.ts";
import type { DbToCheckType, DefineAllOptions } from "./types.ts";

/**
 * This function checks if a given port is open by attempting to fetch from
 * localhost at that port. So, may give false positives if the service does not
 * respond to HTTP requests.
 * @param port The port number to check.
 * @returns A promise that resolves to true if the port is open, else false.
 */
async function isPortOpen(port: number): Promise<boolean> {
  try {
    await fetch(`http://localhost:${port}`, {
      signal: AbortSignal.timeout(3000),
    });
    return true;
  } catch (error: unknown) {
    if (error instanceof TypeError) {
      const msg = error.message.toLowerCase();
      if (msg.includes("refused") || msg.includes("econnrefused")) {
        return false;
      }
      return true;
    }
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return false;
    }
    return false;
  }
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
