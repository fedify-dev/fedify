import process from "node:process";

/** Select Node.js even when a compatibility test imports the harness in Deno. */
export const nodeExecutable =
  process.versions.deno != null || process.versions.bun != null
    ? "node"
    : process.execPath;
