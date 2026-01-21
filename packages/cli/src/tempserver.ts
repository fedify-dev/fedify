import { openTunnel } from "@hongminhee/localtunnel";
import { getLogger } from "@logtape/logtape";
import { serve } from "srvx";

const logger = getLogger(["fedify", "cli", "tempserver"]);

export type SpawnTemporaryServerOptions = {
  noTunnel?: boolean;
  port?: number;
  service?: "localhost.run" | "serveo.net" | "pinggy.io";
};

export type TemporaryServer = {
  url: URL;
  close(): Promise<void>;
};

export async function spawnTemporaryServer(
  fetch: (request: Request) => Promise<Response> | Response,
  options: SpawnTemporaryServerOptions = {},
): Promise<TemporaryServer> {
  const serverPort = options.port ?? 0;
  if (options.noTunnel) {
    const server = serve({
      port: serverPort,
      hostname: "::",
      silent: true,
      fetch,
    });
    await server.ready();
    const url = new URL(server.url!);
    const port = url.port;
    logger.debug("Temporary server is listening on port {port}.", {
      port: port,
    });

    return {
      url: new URL(`http://localhost:${port}`),
      async close() {
        await server.close();
      },
    };
  }

  const server = serve({
    // Note that `protocol: "https"` does not work on Deno, so we need to
    // manually rewrite the request URL to use https: on Deno:
    fetch: "Deno" in globalThis
      ? (request) => {
        const url = new URL(request.url);
        url.protocol = "https:";
        const newRequest = new Request(url, {
          method: request.method,
          headers: request.headers,
          body: request.method === "GET" || request.method === "HEAD"
            ? null
            : request.body,
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

        return fetch(newRequest);
      }
      : fetch,
    port: serverPort,
    hostname: "::",
    silent: true,
    protocol: "https",
  });

  await server.ready();

  const url = new URL(server.url!);
  const port = url.port;

  logger.debug("Temporary server is listening on port {port}.", { port });
  const tun = await openTunnel({
    port: parseInt(port),
    service: options.service,
  });
  logger.debug("Temporary server is tunneled to {url}.", { url: tun.url.href });

  return {
    url: tun.url,
    async close() {
      await server.close();
      await tun.close();
    },
  };
}
