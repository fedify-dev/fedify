// @ts-nocheck this file is just a template
import { serve } from "@hono/node-server";
import { behindProxy } from "x-forwarded-fetch";
import app from "./app.tsx";
import "./logging.ts";

serve(
  {
    port: 8000,
    fetch: behindProxy(app.fetch.bind(app)),
  },
  (info) =>
    console.log("Server started at http://" + info.address + ":" + info.port),
);
