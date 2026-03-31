import { behindProxy } from "@hongminhee/x-forwarded-fetch";
import federation from "./federation.ts";
import "./logging.ts";

Deno.serve(
  {
    port: 8000,
    onListen: ({ port, hostname }) =>
      console.log("Server started at http://" + hostname + ":" + port)
  },
  behindProxy((req) =>
    new URL(req.url).pathname === "/"
      ? new Response("Hello, this is a Fedify server!", {
        headers: { "Content-Type": "text/plain" },
      })
      : federation.fetch(req, { contextData: undefined })
  ),
);
