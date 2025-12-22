import { fedify } from "@fedify/elysia";
import { Elysia } from "elysia";
import federation from "./federation.ts";
import { getLogger } from "@logtape/logtape";

const logger = getLogger("/* logger */");
const app = new Elysia();

app
  .use(fedify(federation, () => undefined))
  .listen(3000)
