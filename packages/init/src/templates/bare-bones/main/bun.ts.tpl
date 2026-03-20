import { behindProxy } from "x-forwarded-fetch";
import federation from "./federation.ts";
import "./logging.ts";

const server = Bun.serve({
  port: 8000,
  fetch: behindProxy((req) =>
    new URL(req.url).pathname === "/"
      ? new Response("Hello, this is a Fedify server!", {
        headers: { "Content-Type": "text/plain" },
      })
      : federation.fetch(req, { contextData: undefined })
  ),
});

console.log("Server started at", server.url.href);
