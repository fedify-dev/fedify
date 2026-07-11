import { fedifyMiddleware } from "@fedify/astro";
import type { MiddlewareHandler } from "astro";
import { sequence } from "astro:middleware";
import federation from "./federation.ts";

const additionalMiddleware: MiddlewareHandler = async (_context, next) => {
  const response = await next();
  response.headers.set("X-Additional-Middleware", "called");
  return response;
};

export const onRequest = sequence(
  additionalMiddleware,
  fedifyMiddleware(federation, () => undefined),
);
