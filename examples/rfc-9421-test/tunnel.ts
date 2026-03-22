import { openTunnel, type Tunnel } from "@hongminhee/localtunnel";
import { getLogger } from "@logtape/logtape";

const logger = getLogger(["fedify", "examples", "tunnel"]);

/**
 * Opens a tunnel to expose a local port using `@hongminhee/localtunnel`.
 * Returns the {@link Tunnel} object (with `.url` and `.close()`), or `null`
 * if it fails.
 */
export default async function startTunnel(
  port: number,
): Promise<Tunnel | null> {
  logger.info("Opening tunnel on port {port}…", { port });
  try {
    const tunnel = await openTunnel({ port, service: "pinggy.io" });
    logger.info("Tunnel established at {url}", { url: tunnel.url.href });
    return tunnel;
  } catch (error) {
    logger.error("Failed to open tunnel: {error}", { error });
    return null;
  }
}
