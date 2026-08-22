/**
 * The `@fedify/adonisjs` service provider.
 *
 * It owns the whole lifecycle of the `Federation` object: reading
 * `config/fedify.ts`, exposing the builder, building the federation once every
 * dispatcher has been registered, starting the task queue, and shutting it down
 * again.
 *
 * @module
 */
import { configProvider } from "@adonisjs/core";
import type { ApplicationService, ConfigProvider } from "@adonisjs/core/types";
import type { Federation } from "@fedify/fedify";

import { builder } from "./builder.ts";
import { E_FEDERATION_NOT_READY, E_INVALID_FEDIFY_CONFIG } from "./errors.ts";
import { configureFedifyLogging } from "./logging.ts";
import type { ContextData, ResolvedFedifyConfig } from "./types.ts";

export default class FedifyProvider {
  /**
   * Aborts the queue worker when the application shuts down.
   */
  #queueController = new AbortController();

  /**
   * The `startQueue()` promise, which settles once every queue listener has
   * stopped.
   *
   * `shutdown()` returns it so that AdonisJS waits for the workers instead of
   * tearing the process down around them.  Undefined whenever this process does
   * not drain the queue.
   */
  #queue?: Promise<void>;

  /**
   * Whether the builder may be sealed into a `Federation` object.
   *
   * Registration of dispatchers happens in preload files, which AdonisJS
   * imports *after* every provider's `boot()` and `start()` have run.  Building
   * the federation before then would produce an object with no routes, and the
   * only symptom would be 404s from every federation endpoint.  Refusing to
   * build early turns that into an error message that says what to do.
   */
  #buildable = false;

  /**
   * Memoised results for the two container bindings.
   *
   * They are held here rather than relying on `container.singleton()`, which
   * memoises *rejections* as well as values: one early, swallowed resolution of
   * `'fedify'` would cache `E_FEDERATION_NOT_READY` for the lifetime of the
   * process, and `ready()` would then re-throw it and the application would
   * never start. Caching only successful results keeps a transient guard
   * transient.
   */
  #config?: Promise<ResolvedFedifyConfig>;
  #federation?: Promise<Federation<ContextData>>;

  protected app: ApplicationService;

  /**
   * Written out longhand rather than as a TypeScript parameter property, which
   * Node's built-in type stripping does not support — the test suite runs these
   * sources directly through it.
   */
  constructor(app: ApplicationService) {
    this.app = app;
  }

  register(): void {
    /**
     * The builder is bound as a value, not a singleton factory, because it is a
     * module-level singleton that application code also imports directly. Both
     * routes must reach the same object.
     */
    this.app.container.bindValue("fedify.builder", builder);

    this.app.container.bind("fedify.config", () => {
      this.#config ??= (async () => {
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
      })().catch((error: unknown) => {
        this.#config = undefined;
        throw error;
      });

      return this.#config;
    });

    this.app.container.bind("fedify", () => {
      if (!this.#buildable) {
        throw new E_FEDERATION_NOT_READY();
      }

      this.#federation ??= (async () => {
        const config = await this.app.container.make("fedify.config");
        const federationBuilder = await this.app.container.make(
          "fedify.builder",
        );

        return federationBuilder.build(config);
      })().catch((error: unknown) => {
        this.#federation = undefined;
        throw error;
      });

      return this.#federation;
    });
  }

  async boot(): Promise<void> {
    const config = await this.app.container.make("fedify.config");

    if (config.logging !== false) {
      const logger = await this.app.container.make("logger");
      await configureFedifyLogging({
        logger,
        categories: config.logging === true
          ? undefined
          : config.logging.categories,
      });
    }
  }

  /**
   * Runs after preload files have been imported, i.e. after every dispatcher
   * has been registered on the builder.
   */
  async ready(): Promise<void> {
    this.#buildable = true;

    // Build eagerly so that a misconfiguration surfaces at boot rather than on
    // the first federation request.
    const federation = await this.app.container.make("fedify");
    const config = await this.app.container.make("fedify.config");

    /**
     * Only the web process drains the queue.
     *
     * Ace commands, the REPL and the test runner all reach `ready()` too, and
     * starting a worker there would have short-lived commands linger while they
     * finish deliveries they happened to pick up, and would have several
     * processes competing for the same queue during a test run.
     */
    if (
      typeof config.queueContextData === "function" &&
      this.app.getEnvironment() === "web"
    ) {
      const logger = await this.app.container.make("logger");
      const contextData = await config.queueContextData();

      // `startQueue` only settles when the queue stops, so it must not be
      // awaited here or the application would never finish starting.  The
      // promise is kept for `shutdown()`, and the `catch` is part of what is
      // kept so that awaiting it there can never reject.
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
  }

  /**
   * Stops the queue worker and waits for it.
   *
   * Aborting the controller only *asks* the listeners to stop; `startQueue()`
   * settles once they actually have, which may be one in-flight delivery later.
   * Returning that promise keeps the rest of the AdonisJS shutdown sequence —
   * closing the database connection, most importantly — behind it instead of
   * pulling the ground out from under a job that is still running.
   *
   * A process that does not drain the queue has nothing to wait for, and the
   * return type stays a promise there too: AdonisJS invokes provider hooks
   * through a diagnostics-channel tracer that warns when a hook returns a
   * non-thenable.
   */
  shutdown(): Promise<void> {
    this.#queueController.abort();
    return this.#queue ?? Promise.resolve();
  }
}
