export const PACKAGE_MANAGER = ["deno", "pnpm", "bun", "yarn", "npm"] as const;
export const WEB_FRAMEWORK = [
  "hono",
  "nitro",
  "next",
  "elysia",
  "express",
] as const;
export const MESSAGE_QUEUE = ["denokv", "redis", "postgres", "amqp"] as const;
export const KV_STORE = ["denokv", "redis", "postgres"] as const;
