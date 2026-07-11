import { fedifyMiddleware } from "@fedify/astro";
import type { MiddlewareHandler } from "astro";
import { createWebRuntime } from "./lib/runtime.ts";

const runtime = await createWebRuntime();
const federationMiddleware = fedifyMiddleware(
  runtime.federation,
  () => runtime.contextData,
);

export const onRequest: MiddlewareHandler = (context, next) =>
  context.isPrerendered ? next() : federationMiddleware(context, next);
