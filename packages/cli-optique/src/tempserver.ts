import { openTunnel } from "@hongminhee/localtunnel";
import { getLogger } from "@logtape/logtape";

const logger = getLogger(["fedify", "cli", "tempserver"]);

export interface SpawnTemporaryServerOptions {
  noTunnel?: boolean;
}

export interface TemporaryServer {
  url: URL;
  close(): Promise<void>;
}

export function spawnTemporaryServer(
  handler: Deno.ServeHandler,
  options: SpawnTemporaryServerOptions = {},
): Promise<TemporaryServer> {
  if (options.noTunnel) {
    return new Promise((resolve) => {
      const server = Deno.serve({
        handler,
        port: 0,
        hostname: "::",
        onListen({ port }) {
          logger.debug("Temporary server is listening on port {port}.", {
            port,
          });
          resolve({
            url: new URL(`http://localhost:${port}`),
            async close() {
              await server.shutdown();
            },
          });
        },
      });
    });
  }
  return new Promise((resolve) => {
    const server = Deno.serve({
      async handler(request: Request, info: Deno.ServeHandlerInfo) {
        const url = new URL(request.url);
        url.protocol = "https:";
        request = new Request(url, {
          method: request.method,
          headers: request.headers,
          body: request.method === "GET" || request.method === "HEAD"
            ? null
            : await request.blob(),
          referrer: request.referrer,
          referrerPolicy: request.referrerPolicy,
          mode: request.mode,
          credentials: request.credentials,
          cache: request.cache,
          redirect: request.redirect,
          integrity: request.integrity,
          keepalive: request.keepalive,
          signal: request.signal,
        });
        return await handler(request, info);
      },
      port: 0,
      hostname: "::",
      onListen({ port }) {
        logger.debug("Temporary server is listening on port {port}.", { port });
        openTunnel({ port }).then((tun) => {
          logger.debug(
            "Temporary server is tunneled to {url}.",
            { url: tun.url.href },
          );
          resolve({
            url: tun.url,
            async close() {
              await server.shutdown();
              await tun.close();
            },
          });
        });
      },
    });
  });
}
