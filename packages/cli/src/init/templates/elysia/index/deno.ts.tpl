import { fedify } from "@fedify/elysia";
import { Elysia } from "elysia";
import federation from "./federation.ts";
import "./logging.ts";

const app = new Elysia();

app
  .use(fedify(federation, () => undefined))
  .get("/", () => "Hello, Fedify!")

Deno.serve(
  {
    port: 3000,
    onListen: ({ port, hostname }) =>
      console.log("Server started at http://" + hostname + ":" + port),
  },
  app.fetch,
) 
