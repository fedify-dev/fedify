/**
 * The `defineConfig` helper used by `config/fedify.ts`.
 *
 * @module
 */
import { configProvider } from "@adonisjs/core";
import { InvalidArgumentsException } from "@adonisjs/core/exceptions";
import type { ConfigProvider } from "@adonisjs/core/types";
import type { FederationOptions } from "@fedify/fedify";

import type {
  ContextData,
  FedifyConfig,
  ResolvedFedifyConfig,
} from "./types.ts";

/**
 * Whether the `queue` option carries a queue at all.
 *
 * `FederationOptions.queue` takes either one `MessageQueue` for every role or
 * an object of per-role queues, and Fedify reads an object whose members are
 * all `undefined` as no queue.  Testing the option's presence would therefore
 * misfire in both directions: `queue: { outbox: app.inProduction ? q :
 * undefined }` looks configured in development, and `queue: {}` looks like a
 * queue that needs draining.
 */
function hasQueue(queue: FederationOptions<unknown>["queue"]): boolean {
  if (queue == null) return false;
  if ("enqueue" in queue && "listen" in queue) return true;
  return Object.values(queue).some((role) => role != null);
}

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
      const { MemoryKvStore } = await import("@fedify/fedify");
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
    if (hasQueue(federationOptions.queue) && queueContextData === undefined) {
      throw new InvalidArgumentsException(
        'config/fedify.ts configures a "queue" but not "queueContextData". Set ' +
          '"queueContextData" to a callback to have this process drain the queue, or to ' +
          '"false" when a separate worker process owns it',
      );
    }

    /**
     * The mirror image: a drainer for a queue that does not exist.  Nothing
     * fails on its own — `startQueue()` resolves over no queues and
     * `sendActivity()` delivers inline without retry, so failed deliveries are
     * silently lost.
     *
     * Only a warning, because a task registered with
     * `defineTask(name, { queue })` from a preload file brings its own queue,
     * which this configuration cannot see.  Refusing would break a valid
     * application, and dropping the callback would hand that queue back to
     * Fedify's lazy start.  Only a *callback* is reported: `false` stays valid
     * without a queue, so `queue: app.inProduction ? … : undefined` still
     * boots in development and test.
     */
    if (
      !hasQueue(federationOptions.queue) &&
      typeof queueContextData === "function"
    ) {
      const logger = await app.container.make("logger");
      logger.warn(
        'config/fedify.ts sets "queueContextData" but no "queue". Unless a task registers its own ' +
          "queue through defineTask(), there is nothing to drain and activity delivery stays " +
          'inline, with failed deliveries never retried. Configure "queue" with a message queue ' +
          "such as @fedify/sqlite, @fedify/postgres, @fedify/redis or @fedify/amqp, or remove " +
          '"queueContextData"',
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

      /**
       * The cast is sound because `ContextDataFactoryOption` makes
       * `contextDataFactory` a *required* key the moment an application
       * augments `FedifyTypes`.  This branch is therefore only reachable while
       * `ContextData` still includes `HttpContext`, which is exactly what it
       * returns.
       */
      contextDataFactory: contextDataFactory ?? ((ctx) => ctx as ContextData),
      ignoreRoutePrefixes: ignoreRoutePrefixes ?? [],
      logging: logging ?? true,
      queueContextData,
    };
  });
}
