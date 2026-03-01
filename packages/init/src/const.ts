/** All supported package manager identifiers, in display order. */
export const PACKAGE_MANAGER = ["deno", "pnpm", "bun", "yarn", "npm"] as const;

/** All supported web framework identifiers, in display order. */
export const WEB_FRAMEWORK = [
  "hono",
  "nitro",
  "next",
  "elysia",
  "astro",
  "express",
] as const;

/** All supported message queue backend identifiers. */
export const MESSAGE_QUEUE = ["denokv", "redis", "postgres", "amqp"] as const;

/** All supported key-value store backend identifiers. */
export const KV_STORE = ["denokv", "redis", "postgres"] as const;

/**
 * External database services that need to be running for integration tests.
 * Used by the test suite to check service availability before running tests.
 */
export const DB_TO_CHECK = ["redis", "postgres", "amqp"] as const;
