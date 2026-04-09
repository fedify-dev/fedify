import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import {
  fedifyMiddleware,
  type AdonisHttpContext,
} from "@fedify/adonis";
import { getLogger } from "@logtape/logtape";
import federation from "./federation.ts";

const logger = getLogger("/* logger */");

const FedifyMiddleware = fedifyMiddleware(federation, () => undefined);
const middleware = new FedifyMiddleware();

function createHttpContext(
  req: IncomingMessage,
  res: ServerResponse,
): AdonisHttpContext {
  const host = req.headers.host ?? "localhost";
  return {
    request: {
      method: () => req.method ?? "GET",
      protocol: () => "http",
      hostname: () => host.split(":")[0],
      url: () => req.url ?? "/",
      headers: () => req.headers as Record<string, string>,
      request: req,
    },
    response: {
      response: res,
    },
  };
}

export const server = createServer(async (req, res) => {
  const ctx = createHttpContext(req, res);
  await middleware.handle(ctx, async () => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Hello, Fedify!");
  });
});

export default server;
