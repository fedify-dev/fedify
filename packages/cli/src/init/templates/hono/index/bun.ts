import { behindProxy } from "x-forwarded-fetch";
import app from "./app.tsx";
import "./logging.ts";

const server = Bun.serve({
  port: 8000,
  fetch: behindProxy(app.fetch.bind(app)),
});

console.log("Server started at", server.url.href);
