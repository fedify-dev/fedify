import type { Message } from "@optique/core";
import { commandLine, message } from "@optique/core/message";
import { getDevCommand } from "../lib.ts";
import type { PackageManager } from "../types.ts";

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

Then, try look up an actor from your server:

  ${commandLine(`fedify lookup http://localhost:${port}/users/john`)}

`;

/**
 * Converts a package manager to its corresponding runtime.
 * @param pm - The package manager (deno, bun, npm, yarn, pnpm)
 * @returns The runtime name (deno, bun, or node)
 */
export const packageManagerToRuntime = (
  pm: PackageManager,
): "deno" | "bun" | "node" =>
  pm === "deno" ? "deno" : pm === "bun" ? "bun" : "node";
