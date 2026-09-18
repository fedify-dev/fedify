/**
 * The `@fedify/adonisjs` service provider; see {@link FedifyProvider}.
 *
 * @module
 */
import { configProvider } from "@adonisjs/core";
import type { Logger } from "@adonisjs/core/logger";
import type { ApplicationService, ConfigProvider } from "@adonisjs/core/types";
import type { Federation } from "@fedify/fedify";
import { reset as resetLogging } from "@logtape/logtape";

import { builder } from "../src/builder.ts";
import {
  E_FEDERATION_NOT_READY,
  E_INVALID_FEDIFY_CONFIG,
} from "../src/errors.ts";
import FedifyMiddleware from "../src/fedify_middleware.ts";
import { installFederationGetter } from "../src/http_context.ts";
import { configureFedifyLogging } from "../src/logging.ts";
import type { ContextData, ResolvedFedifyConfig } from "../src/types.ts";

/**
 * How long a request that arrives before `ready()` waits for the federation.
 *
 * Generous, since it only needs to outlast earlier providers' `ready()` hooks.
 * It turns a `ready()` that never comes (an earlier provider waiting on this
 * server) into an error instead of a request that never completes.
 */
const READY_TIMEOUT_MS = 30_000;

/**
 * A memoised factory: the value, plus a way to drop what was cached.
 */
type Memoized<T> = (() => Promise<T>) & { forget(): void };

/**
 * Memoises an asynchronous factory, caching successes only.
 *
 * Used for the container bindings instead of `container.singleton()`, which
 * also caches *rejections*: one early, swallowed `make('fedify')` would pin
 * `E_FEDERATION_NOT_READY` for the life of the process.  A failed attempt is
 * forgotten instead, so the next caller runs the factory again.  `forget()`
 * drops a cached success once the caller knows it is stale.
 */
function memoizeSuccess<T>(factory: () => Promise<T>): Memoized<T> {
  let cached: Promise<T> | undefined;

  const memo = (): Promise<T> => {
    cached ??= factory().catch((error: unknown) => {
      cached = undefined;
      throw error;
    });

    return cached;
  };

  return Object.assign(memo, {
    forget: (): void => {
      cached = undefined;
    },
  });
}

/**
 * The service provider registered from `adonisrc.ts` as
 * `@fedify/adonisjs/fedify_provider`.
 *
 * Binds `fedify.builder`, `fedify.config`, `fedify` and
 * {@link FedifyMiddleware}, installs `ctx.federation`, bridges Fedify's logs
 * into the AdonisJS logger, builds the federation after the preload files
 * have run, and drains the task queue in the web process.
 */
export default class FedifyProvider {
  /**
   * Aborts the queue worker on shutdown.
   */
  #queueController = new AbortController();

  /**
   * The `startQueue()` promise, settled once every listener has stopped.
   * `shutdown()` returns it so AdonisJS waits for the workers.  Undefined when
   * this process does not drain the queue.
   */
  #queue?: Promise<void>;

  /**
   * Whether this provider configured LogTape and must undo it on shutdown.
   *
   * LogTape's configuration is process-global and its sink closes over *this*
   * application's `Logger`.  Left in place, a second application in the same
   * process (the test runner, a dev-server restart) would find LogTape already
   * configured and keep logging into the terminated application's logger.
   */
  #loggingConfigured = false;

  /**
   * Whether the builder may be sealed into a `Federation` object.
   *
   * Dispatchers are registered in preload files, which AdonisJS imports *after*
   * every provider's `boot()` and `start()`.  Building earlier would yield a
   * federation with no routes and 404s as the only symptom, so an early build
   * fails with an explanatory error instead.
   */
  #buildable = false;

  /**
   * Whether the HTTP server has started accepting connections.
   *
   * AdonisJS listens inside `start()` and runs `ready()` hooks afterwards, so a
   * request (a health probe, `fedify tunnel`) can arrive before this provider
   * is ready.  Such a request is the one caller allowed to *wait* for the
   * federation, since `ready()` is on its way; any other caller (a `start()`
   * hook, a preload file, an Ace command) fails fast because nothing would
   * make it ready while they wait.
   */
  #listening = false;

  /**
   * Settles once `ready()` has built the federation: resolved on success,
   * rejected with the configuration error, or with `E_FEDERATION_NOT_READY`
   * when the application shuts down first or {@link READY_TIMEOUT_MS} passes.
   */
  #ready = Promise.withResolvers<void>();
  #readyTimer?: ReturnType<typeof setTimeout>;

  /**
   * The memoised middleware binding, kept here so that a failed `ready()` can
   * forget it.
   *
   * A request that arrives while `ready()` is running builds its middleware
   * from a federation that is buildable at that moment.  Should `ready()` fail
   * afterwards, that middleware would otherwise stay cached and keep serving
   * federation traffic in an application whose `make('fedify')` fails fast and
   * whose queue never started.
   */
  #middleware?: Memoized<FedifyMiddleware<ContextData>>;

  protected app: ApplicationService;

  /**
   * Longhand rather than a parameter property, which Node's type stripping
   * does not support; the tests run these sources through it.
   */
  constructor(app: ApplicationService) {
    this.app = app;

    // Only requests waiting on `ready()` observe the rejection; without this
    // handler Node would report it as unhandled when nobody was.
    this.#ready.promise.catch(() => {});
  }

  /**
   * Registers the container bindings.
   */
  register(): void {
    /**
     * Bound as a value: the builder is a module-level singleton that
     * application code also imports directly, and both routes must reach the
     * same object.
     */
    this.app.container.bindValue("fedify.builder", builder);

    this.app.container.bind(
      "fedify.config",
      memoizeSuccess(async () => {
        const provider = this.app.config.get<
          ConfigProvider<ResolvedFedifyConfig>
        >("fedify");
        const config = await configProvider.resolve<ResolvedFedifyConfig>(
          this.app,
          provider,
        );

        if (!config) {
          throw new E_INVALID_FEDIFY_CONFIG();
        }

        return config;
      }),
    );

    const buildFederation = memoizeSuccess(async () => {
      const config = await this.app.container.make("fedify.config");
      const federationBuilder = await this.app.container.make("fedify.builder");

      return federationBuilder.build(config);
    });

    this.app.container.bind("fedify", () => {
      if (!this.#buildable) {
        throw new E_FEDERATION_NOT_READY();
      }

      return buildFederation();
    });

    /**
     * The middleware, built with the federation and configuration in scope, as
     * `@adonisjs/cors` and `@adonisjs/session` do.  `server.use()` resolves
     * the class through the container on every request, which lands here.
     *
     * A plain `bind()` plus {@link memoizeSuccess} rather than `singleton()`
     * (see the helper), so every request shares one instance.
     *
     * A request that arrives after the server listens but before `ready()` has
     * built the federation waits for it (see {@link #listening}); any other
     * caller gets `E_FEDERATION_NOT_READY` at once.
     */
    this.#middleware = memoizeSuccess(async () => {
      if (!this.#buildable) {
        if (!this.#listening) throw new E_FEDERATION_NOT_READY();
        await this.#ready.promise;
      }

      const federation = await this.app.container.make("fedify");
      const config = await this.app.container.make("fedify.config");

      return new FedifyMiddleware<ContextData>(
        federation,
        config.contextDataFactory,
        { ignoreRoutePrefixes: config.ignoreRoutePrefixes },
      );
    });

    this.app.container.bind(FedifyMiddleware, this.#middleware);
  }

  /**
   * Installs `ctx.federation`, bridges Fedify's logs into the AdonisJS logger,
   * and subscribes to the HTTP server's ready event.
   */
  async boot(): Promise<void> {
    // `ctx.federation` as a Macroable getter on the `HttpContext` prototype.
    // The middleware also installs it on each context's class (covering
    // another `@adonisjs/core` copy); this covers requests the middleware
    // never saw, which then get `E_FEDIFY_CONTEXT_UNAVAILABLE` rather than
    // `undefined`.
    installFederationGetter();

    const config = await this.app.container.make("fedify.config");

    if (config.logging !== false) {
      const logger = await this.app.container.make("logger");
      this.#loggingConfigured = await configureFedifyLogging({
        logger,
        categories: config.logging === true
          ? undefined
          : config.logging.categories,
      });
    }

    // The core `app_provider` binds the emitter; a bare application in a test
    // may lack it, and then has no HTTP server to hear from either.
    if (this.app.container.hasBinding("emitter")) {
      const emitter = await this.app.container.make("emitter");
      emitter.on("http:server_ready", () => this.#serverStarted());
    }
  }

  /**
   * Runs after the preload files have registered every dispatcher.
   */
  async ready(): Promise<void> {
    this.#buildable = true;

    // Build eagerly so a broken federation surfaces at startup rather than on
    // the first federation request.  Requests waiting in the middleware
    // binding get the same outcome.
    let federation: Federation<ContextData>;
    let worker: { contextData: ContextData; logger: Logger } | undefined;
    try {
      federation = await this.app.container.make("fedify");
      const config = await this.app.container.make("fedify.config");

      // Only the web process drains the queue: Ace commands, the REPL and the
      // test runner also reach `ready()`, where a worker would outlive the
      // command and compete for the queue.  The context data is built before
      // the waiting requests are released, so a throwing callback fails
      // startup like a broken federation instead of rejecting `ready()` with
      // requests already being served.
      if (
        typeof config.queueContextData === "function" &&
        this.app.getEnvironment() === "web"
      ) {
        worker = {
          contextData: await config.queueContextData(),
          logger: await this.app.container.make("logger"),
        };
      }
    } catch (error: unknown) {
      // Back to failing fast: a surviving process (an Ace command, the REPL)
      // must not have later `make('fedify')` calls re-run the configuration,
      // nor keep the middleware a request built while this hook was still
      // running (see {@link #middleware}).
      this.#buildable = false;
      this.#middleware?.forget();
      this.#settle(error);
      throw error;
    }
    this.#settle();

    if (worker === undefined) return;

    // `shutdown()` can have run while this hook was awaiting above: it settles
    // and aborts, but finds no queue promise to wait for.  Starting a worker on
    // the aborted signal now would leave one running that nothing awaits.
    if (this.#queueController.signal.aborted) return;

    // `startQueue` settles only when the queue stops, so it must not be
    // awaited here.  The promise is kept for `shutdown()`, `catch` included,
    // so awaiting it there never rejects.
    const { contextData, logger } = worker;
    this.#queue = federation
      .startQueue(contextData, { signal: this.#queueController.signal })
      .catch((error: unknown) => {
        if (this.#queueController.signal.aborted) return;
        logger.error(
          { err: error },
          "The Fedify task queue stopped unexpectedly",
        );
      });
  }

  /**
   * Stops the queue worker and waits for it, releases any request still
   * waiting on `ready()`, and takes the LogTape configuration down.
   *
   * Aborting only *asks* the listeners to stop; `startQueue()` settles once
   * they have, possibly one in-flight delivery later.  Returning that promise
   * keeps the rest of the shutdown sequence (closing the database, most
   * importantly) behind it.
   *
   * LogTape is reset after the queue stops, so an outgoing delivery can still
   * log, and only if this provider configured it (see
   * {@link #loggingConfigured}); resetting the application's own
   * configuration would silence its logs.
   *
   * The return type stays a promise even with no queue to wait for: AdonisJS
   * warns when a provider hook returns a non-thenable.
   */
  shutdown(): Promise<void> {
    this.#settle(new E_FEDERATION_NOT_READY());
    this.#queueController.abort();

    const stopped = this.#queue ?? Promise.resolve();
    if (!this.#loggingConfigured) return stopped;

    this.#loggingConfigured = false;
    // A failing reset must not fail the shutdown queued behind it.  The queue
    // promise never rejects, so only the reset is guarded.
    return stopped.then(() => resetLogging().catch(() => {}));
  }

  /**
   * Called when the HTTP server starts listening and requests can arrive.
   */
  #serverStarted(): void {
    this.#listening = true;
    if (this.#buildable) return;

    this.#readyTimer = setTimeout(
      () => this.#settle(new E_FEDERATION_NOT_READY()),
      READY_TIMEOUT_MS,
    );
    // A pending timer must not keep the process alive.
    this.#readyTimer.unref();
  }

  /**
   * Settles the `ready()` promise once; later calls are no-ops.
   */
  #settle(error?: unknown): void {
    clearTimeout(this.#readyTimer);
    if (error === undefined) this.#ready.resolve();
    else this.#ready.reject(error);
  }
}
