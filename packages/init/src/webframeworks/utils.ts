import type { Message } from "@optique/core";
import { commandLine, message } from "@optique/core/message";
import deps from "../json/deps.json" with { type: "json" };
import { getDevCommand } from "../lib.ts";
import type { PackageManager } from "../types.ts";

export const nodeBunDevToolTasks = {
  format: "oxfmt",
  "format:check": "oxfmt --check",
  lint: "oxlint .",
} as const satisfies Record<string, string>;

export const getNodeBunDevToolTasks = (
  pm: PackageManager,
): Record<string, string> => (pm === "deno" ? {} : nodeBunDevToolTasks);

const SMOKE_TEST_FILE = "scripts/smoke.test.ts";

/**
 * Returns the `test` task command that runs the generated smoke-test
 * script (`WebFrameworkInitializer.testFile`) with the runtime matching the
 * given package manager.
 */
export const getTestTask = (pm: PackageManager): string =>
  pmToRt(pm) === "deno"
    ? `deno run -A ${SMOKE_TEST_FILE}`
    : pmToRt(pm) === "bun"
      ? `bun run ${SMOKE_TEST_FILE}`
      : `tsx ${SMOKE_TEST_FILE}`;

/**
 * Returns the dev dependencies the `test` task needs beyond what the
 * framework already declares.  Node.js runs the smoke-test script through
 * `tsx`; Deno and Bun execute TypeScript natively.
 */
export const getTestDependencies = (
  pm: PackageManager,
): Record<string, string> =>
  pmToRt(pm) === "node" ? { tsx: deps["npm:tsx"] } : {};

/**
 * Generates the post-initialization instruction message that shows
 * the user how to start the dev server and look up an actor.
 *
 * @param packageManager - The chosen package manager
 * @param port - The default port for the dev server
 * @returns A formatted `Message` with startup instructions
 */
export const getInstruction: (
  packageManager: PackageManager,
  port: number,
) => Message = (pm, port) =>
  message`
To start the server, run the following command:

  ${commandLine(getDevCommand(pm))}

Then, try to look up an actor from your server:

  ${commandLine(`fedify lookup http://localhost:${port}/users/john`)}

`;

/**
 * Converts a package manager to its corresponding runtime.
 * @param pm - The package manager (deno, bun, npm, yarn, pnpm)
 * @returns The runtime name (deno, bun, or node)
 */
export const pmToRt = (pm: PackageManager): "deno" | "bun" | "node" =>
  pm !== "deno" && pm !== "bun" ? "node" : pm;
