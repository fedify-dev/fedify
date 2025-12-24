import { fedify } from "@fedify/elysia";
import { Elysia } from "elysia";
import federation from "./federation.ts";
import "./logging.ts";

const app = new Elysia();

app
  .use(fedify(federation, () => undefined))
  .get("/", () => "Hello, Fedify!")
  .listen(3000, () => {
    console.log("Server started at http://localhost:3000");
  })
