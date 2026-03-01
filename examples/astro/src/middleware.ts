import { fedifyMiddleware } from "@fedify/astro";
import federation from "./lib/federation.ts";

export const onRequest = fedifyMiddleware(federation, (_context) => undefined);
