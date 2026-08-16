/**
 * The `defineConfig` helper used by `config/fedify.ts`.
 *
 * @module
 */
import { configProvider } from "@adonisjs/core";
import type { ConfigProvider } from "@adonisjs/core/types";
import { InvalidArgumentsException } from "@adonisjs/core/exceptions";
import { MemoryKvStore } from "@fedify/fedify";

import type {
  ContextData,
  FedifyConfig,
  ResolvedFedifyConfig,
} from "./types.ts";

/**
 * Defines the Fedify configuration of an AdonisJS application.
 *
 * The return value is an AdonisJS *config provider* rather than a plain object,
 * which lets the resolution step reach the application instance — needed to
 * detect production mode and to log through the application's logger — while
 * `config/fedify.ts` itself stays a simple, synchronous, statically analysable
 * module.
 *
 * @example
 * ```ts
 * // config/fedify.ts
 * import { defineConfig } from '@fedify/adonisjs'
 * import { SqliteKvStore } from '@fedify/sqlite'
 * import env from '#start/env'
 *
 * export default defineConfig({
 *   origin: env.get('PUBLIC_URL'),
 *   kv: new SqliteKvStore(database),
 * })
 * ```
 */
export function defineConfig(
  config: FedifyConfig,
): ConfigProvider<ResolvedFedifyConfig> {
  return configProvider.create<ResolvedFedifyConfig>(async (app) => {
    if (!config.origin) {
      throw new InvalidArgumentsException(
        'Missing "origin" in config/fedify.ts. It must be the canonical public URL of this server, ' +
          "usually read from the PUBLIC_URL environment variable",
      );
    }

    let kv = config.kv;
    if (kv === undefined) {
      kv = new MemoryKvStore();

      if (app.inProduction) {
        // Not fatal — an application may genuinely run a single process and
        // accept the trade-off — but silently losing inbox idempotency and the
        // document cache on every restart is worth shouting about.
        const logger = await app.container.make("logger");
        logger.warn(
          "Fedify is using an in-memory key-value store in production. Inbox idempotency, " +
            "the document cache and outbox state will be lost on restart and cannot be shared " +
            'between processes. Configure "kv" in config/fedify.ts with a persistent store such ' +
            "as @fedify/sqlite, @fedify/postgres or @fedify/redis",
        );
      }
    }

    const {
      contextDataFactory,
      ignoreRoutePrefixes,
      logging,
      queueContextData,
      ...federationOptions
    } = config;

    /**
     * A configured queue forces the "who drains it" decision to be explicit.
     *
     * Fedify's own default starts the queue lazily on the first enqueued task,
     * capturing that request's context data and reusing it for every background
     * job thereafter. For this integration the captured value would be a single
     * stale `HttpContext`, whose request has long since finished. Rather than
     * pick a wrong default, refuse to guess.
     */
    if (
      federationOptions.queue !== undefined && queueContextData === undefined
    ) {
      throw new InvalidArgumentsException(
        'config/fedify.ts configures a "queue" but not "queueContextData". Set ' +
          '"queueContextData" to a callback to have this process drain the queue, or to ' +
          '"false" when a separate worker process owns it',
      );
    }

    return {
      ...federationOptions,
      kv,

      // The queue is always started deliberately — by this package's service
      // provider, or by a separate worker — never lazily by Fedify.
      manuallyStartQueue: queueContextData !== undefined
        ? true
        : config.manuallyStartQueue,

      contextDataFactory: contextDataFactory ?? ((ctx) => ctx as ContextData),
      ignoreRoutePrefixes: ignoreRoutePrefixes ?? [],
      logging: logging ?? true,
      queueContextData,
    };
  });
}
