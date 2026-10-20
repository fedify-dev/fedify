import { assertPublicAddress } from "../url.ts";
import { createBunPinner } from "./bun.ts";
import { createNodePinner } from "./node.ts";
import type { ConnectionPinner } from "./types.ts";

export type { ConnectionPinner, ConnectionPinnerOptions } from "./types.ts";

/**
 * The JavaScript runtimes that are told apart for connection pinning.
 */
export type Runtime = "cfworkers" | "deno" | "bun" | "node" | "other";

/**
 * Detects the current runtime.  Cloudflare Workers is checked first, since
 * `process` can exist there with `nodejs_compat`, and Deno and Bun before
 * Node.js, since both provide `process.versions.node`.
 * @returns The current runtime.
 */
export function detectRuntime(): Runtime {
  const g = globalThis as {
    navigator?: { userAgent?: string };
    process?: { versions?: { node?: string } };
  };
  if (g.navigator?.userAgent === "Cloudflare-Workers") return "cfworkers";
  if ("Deno" in globalThis) return "deno";
  if ("Bun" in globalThis) return "bun";
  if (g.process?.versions?.node != null) return "node";
  return "other";
}

let runtimePinner: Promise<ConnectionPinner | null> | undefined;

/**
 * Gets the production pinner of the current runtime, which rejects
 * non-public addresses right before connecting.  Deno and Cloudflare Workers
 * have no pinner.
 * @returns The pinner, or `null` if the runtime has none.
 */
export function getRuntimePinner(): Promise<ConnectionPinner | null> {
  runtimePinner ??= createRuntimePinner(detectRuntime());
  return runtimePinner;
}

async function createRuntimePinner(
  runtime: Runtime,
): Promise<ConnectionPinner | null> {
  switch (runtime) {
    case "bun":
      return createBunPinner({ verifyAddress: assertPublicAddress });
    case "node":
      // The npm undici package is loaded only on Node.js:
      return createNodePinner({
        verifyAddress: assertPublicAddress,
        undici: await import("undici"),
      });
    default:
      return null;
  }
}
