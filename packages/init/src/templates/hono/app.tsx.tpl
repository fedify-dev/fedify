// @ts-nocheck this file is just a template
import { Hono } from "/* hono */";
import { federation } from "@fedify/hono";
import { getLogger } from "@logtape/logtape";
import fedi from "./federation.ts";

const logger = getLogger("/* logger */");

const app = new Hono();
app.use(federation(fedi, () => undefined));

app.get("/", (c) => c.text("Hello, Fedify!"));

export default app;
