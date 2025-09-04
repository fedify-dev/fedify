export const RUNTIME = ["deno", "bun", "node"] as const;
export const PACKAGE_MANAGER = ["npm", "yarn", "pnpm"] as const;
export const WEB_FRAMEWORK = ["hono", "express", "nitro", "next"] as const;
export const MESSAGE_QUEUE = ["denokv", "redis", "postgres", "amqp"] as const;
export const KV_STORE = ["denokv", "redis", "postgres"] as const;
