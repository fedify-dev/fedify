import { type AdonisHttpContext, fedifyMiddleware } from "@fedify/adonis";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import process from "node:process";
import federation, { relationStore } from "./federation.ts";

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
  await middleware.handle(ctx, () => {
    const host = req.headers.host ?? "localhost";
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(`\
 _____        _ _  __         ____
|  ___|__  __| (_)/ _|_   _  |  _ \\  ___ _ __ ___   ___
| |_ / _ \\/ _\` | | |_| | | | | | | |/ _ \\ '_ \` _ \\ / _ \\
|  _|  __/ (_| | |  _| |_| | | |_| |  __/ | | | | | (_) |
|_|  \\___|\\__,_|_|_|  \\__, | |____/ \\___|_| |_| |_|\\___/
                      |___/

This small federated server app is a demo of Fedify with AdonisJS integration.
The only thing it does is to accept follow requests.

You can follow this demo app via the below handle:

    @demo@${host}

This account has the below ${relationStore.size} followers:

    ${Array.from(relationStore.values()).join("\n    ")}
`);
  });
});

export default server;

const PORT = process.env.PORT ?? 3333;
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
