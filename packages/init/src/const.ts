import kv from "./json/kv.json" with { type: "json" };
import mq from "./json/mq.json" with { type: "json" };

/** All supported package manager identifiers, in display order. */
export const PACKAGE_MANAGER = ["deno", "pnpm", "bun", "yarn", "npm"] as const;
export const WEB_FRAMEWORK = [
  "bare-bones",
  "hono",
  "nitro",
  "next",
  "elysia",
  "express",
] as const;

/** All supported message queue backend identifiers. */
export const MESSAGE_QUEUE = Object.keys(mq) as readonly (keyof typeof mq)[];

/** All supported key-value store backend identifiers. */
export const KV_STORE = Object.keys(kv) as readonly (keyof typeof kv)[];

export const DB_TO_CHECK = ["redis", "postgres", "amqp"] as const;
