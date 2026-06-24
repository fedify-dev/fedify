import { integrateFederation } from "@fedify/express";
import express from "express";
import federation from "./federation.ts";

export const app = express();

app.set("trust proxy", true);

app.use(integrateFederation(federation, () => undefined));

app.get("/", (_, res) => res.send("Hello, Fedify!"));

export default app;
