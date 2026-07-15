import { fedifyMiddleware } from "@fedify/astro";
import type { MiddlewareHandler } from "astro";
import { sequence } from "astro:middleware";
import federation from "./lib/federation.ts";

const additionalMiddleware: MiddlewareHandler = async (_context, next) =>
  await next();

export const onRequest = sequence(
  additionalMiddleware,
  fedifyMiddleware(federation, (_context) => undefined),
);
