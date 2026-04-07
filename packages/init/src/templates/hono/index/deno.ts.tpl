import { behindProxy } from "@hongminhee/x-forwarded-fetch";
import app from "./app.tsx";
import "./logging.ts";

Deno.serve(
  {
    port: 8000,
    onListen: ({ port, hostname }) =>
      console.log("Server started at http://" + hostname + ":" + port),
  },
  behindProxy(app.fetch.bind(app)),
);
