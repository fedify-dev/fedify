import kv from "./json/kv.json" with { type: "json" };
import mq from "./json/mq.json" with { type: "json" };
import rt from "./json/rt.json" with { type: "json" };

/** All supported package manager identifiers, in display order. */
export const PACKAGE_MANAGER = ["deno", "pnpm", "bun", "yarn", "npm"] as const;

/** All supported web framework identifiers, in display order. */
export const WEB_FRAMEWORK = [
  "bare-bones",
  "hono",
  "nitro",
  "next",
  "elysia",
  "astro",
  "express",
  "nuxt",
  "solidstart",
  "sveltekit",
] as const;
/** All supported message queue backend identifiers. */
export const MESSAGE_QUEUE = Object.keys(mq) as readonly (keyof typeof mq)[];

/** All supported key-value store backend identifiers. */
export const KV_STORE = Object.keys(kv) as readonly (keyof typeof kv)[];

/** All supported runtime identifiers. */
export const RUNTIME = Object.keys(rt) as readonly (keyof typeof rt)[];
/**
 * External database services that need to be running for integration tests.
 * Used by the test suite to check service availability before running tests.
 */
export const DB_TO_CHECK = ["redis", "postgres", "mysql", "amqp"] as const;
