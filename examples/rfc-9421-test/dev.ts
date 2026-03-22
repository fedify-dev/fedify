/**
 * Development wrapper: starts a tunnel once, then launches main.ts in --watch
 * mode.  The tunnel survives server restarts so the public URL stays stable.
 *
 * Usage:  deno run -A dev.ts
 *   (or)  deno task dev
 */

import { getLogger } from "@logtape/logtape";
import "./logging.ts";
import startTunnel from "./tunnel.ts";

const logger = getLogger(["fedify", "examples", "rfc-9421-test", "dev"]);
const port = parseInt(Deno.env.get("PORT") ?? "8000", 10);

// 1. Start the tunnel (owned by this process, not the watched child).
const tunnel = await startTunnel(port, 30_000);
if (!tunnel) {
  logger.error("Tunnel failed. Aborting dev mode.");
  Deno.exit(1);
}
logger.info("Tunnel ready: {url}", { url: tunnel.url });

// 2. Spawn the server in --watch mode, passing the tunnel URL via ORIGIN.
const child = new Deno.Command("deno", {
  args: ["run", "-A", "--watch", "main.ts"],
  cwd: import.meta.dirname!,
  env: { ...Deno.env.toObject(), ORIGIN: tunnel.url },
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
}).spawn();

// 3. Clean up on SIGINT: kill server, then tunnel.
Deno.addSignalListener("SIGINT", () => {
  child.kill("SIGTERM");
  tunnel.child.kill("SIGTERM");
  Deno.exit(0);
});

await child.status;
tunnel.child.kill("SIGTERM");
