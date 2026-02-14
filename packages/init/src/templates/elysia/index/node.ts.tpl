import { fedify } from "@fedify/elysia";
import { Elysia } from "elysia";
import federation from "./federation.ts";
import "./logging.ts";
import { node } from '@elysiajs/node'

const app = new Elysia({ adapter: node() });

app
  .use(fedify(federation, () => undefined))
  .get("/", () => "Hello, Fedify!")
  .listen(3000, () => {
    console.log("Server started at http://localhost:3000");
  })
