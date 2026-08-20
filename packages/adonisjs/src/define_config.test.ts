/**
 * Tests for `defineConfig()` and the service provider's lifecycle.
 *
 * @module
 */
import { match, rejects, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";

import { configProvider } from "@adonisjs/core";
import { AppFactory } from "@adonisjs/core/factories/app";
import type { ApplicationService } from "@adonisjs/core/types";
import {
  InProcessMessageQueue,
  MemoryKvStore,
  type MessageQueue,
  type MessageQueueListenOptions,
} from "@fedify/fedify";

import { defineConfig } from "./define_config.ts";
import { E_FEDERATION_NOT_READY } from "./errors.ts";
import FedifyProvider from "./provider.ts";
import type { FedifyConfig, ResolvedFedifyConfig } from "./types.ts";

async function createApp(
  config: Record<string, unknown> = {},
  environment?: "web" | "console" | "test" | "repl",
): Promise<ApplicationService> {
  const app = new AppFactory().create(
    new URL("../", import.meta.url),
    () => import("node:util"),
  ) as ApplicationService;
  app.useConfig(config);
  // The environment is frozen once the application boots, and the provider only
  // starts a queue worker in the `web` one.
  if (environment !== undefined) app.setEnvironment(environment);
  await app.init();
  // `app.config` only exists after boot, and the provider reads it.
  await app.boot();
  return app;
}

async function resolve(
  config: FedifyConfig,
  app?: ApplicationService,
): Promise<ResolvedFedifyConfig> {
  const application = app ?? (await createApp());
  const resolved = await configProvider.resolve<ResolvedFedifyConfig>(
    application,
    defineConfig(config),
  );
  strictEqual(resolved !== null, true);
  return resolved!;
}

/**
 * Swaps the container's `logger` binding for one that records what it is told.
 *
 * Both `defineConfig` and the provider resolve the logger from the container
 * rather than importing one, so a `bindValue` is enough to capture it — and the
 * bare `AppFactory` application has no `logger` binding of its own.
 */
function bindStubLogger(
  app: ApplicationService,
): { warnings: string[]; errors: unknown[] } {
  const warnings: string[] = [];
  const errors: unknown[] = [];
  app.container.bindValue(
    "logger",
    {
      warn: (message: string) => void warnings.push(message),
      error: (details: unknown) => void errors.push(details),
    } as never,
  );
  return { warnings, errors };
}

describe("defineConfig", () => {
  it("fills in the AdonisJS-specific defaults", async () => {
    const config = await resolve({ origin: "https://example.com" });

    strictEqual(config.origin, "https://example.com");
    strictEqual(config.kv instanceof MemoryKvStore, true);
    strictEqual(config.logging, true);
    strictEqual(config.ignoreRoutePrefixes.length, 0);
    strictEqual(typeof config.contextDataFactory, "function");
  });

  it("defaults the context data factory to the HttpContext itself", async () => {
    const config = await resolve({ origin: "https://example.com" });
    const fakeContext = { marker: "ctx" };

    strictEqual(
      await config.contextDataFactory(fakeContext as never),
      fakeContext,
    );
  });

  it("rejects a configuration without an origin", async () => {
    await rejects(
      () => resolve({ origin: "" }),
      (error: Error) => /Missing "origin"/.test(error.message),
    );
  });

  it("keeps a caller-provided key-value store", async () => {
    const kv = new MemoryKvStore();
    const config = await resolve({ origin: "https://example.com", kv });

    strictEqual(config.kv, kv);
  });

  it("forces manual queue start when the application drains the queue", async () => {
    const config = await resolve({
      origin: "https://example.com",
      queueContextData: () => null as never,
    });

    strictEqual(config.manuallyStartQueue, true);
  });

  it("leaves manuallyStartQueue alone when no queue context data is given", async () => {
    const config = await resolve({ origin: "https://example.com" });

    strictEqual(config.manuallyStartQueue, undefined);
  });

  it("rejects a queue without queue context data", async () => {
    // There is no safe default: Fedify's own lazy start would capture whichever
    // request happened to enqueue first and reuse its context data forever.
    await rejects(
      () =>
        resolve({
          origin: "https://example.com",
          queue: new InProcessMessageQueue(),
        }),
      (error: Error) => /"queueContextData"/.test(error.message),
    );
  });

  it("warns about the in-memory key-value store in production", async () => {
    const app = await createApp();
    Object.defineProperty(app, "inProduction", { value: true });
    const { warnings } = bindStubLogger(app);

    const config = await resolve({ origin: "https://example.com" }, app);

    strictEqual(config.kv instanceof MemoryKvStore, true);
    strictEqual(warnings.length, 1);
    match(warnings[0]!, /in-memory key-value store in production/);
  });

  it("stays quiet about a caller-provided store in production", async () => {
    const app = await createApp();
    Object.defineProperty(app, "inProduction", { value: true });
    const { warnings } = bindStubLogger(app);

    await resolve(
      { origin: "https://example.com", kv: new MemoryKvStore() },
      app,
    );

    strictEqual(warnings.length, 0);
  });
});

/**
 * A queue whose `listen()` keeps running for a turn after it is aborted, the
 * way a real backend finishes the delivery it is holding.
 */
class SlowQueue implements MessageQueue {
  listening = false;
  stopped = false;

  enqueue(): Promise<void> {
    return Promise.resolve();
  }

  async listen(
    _handler: (message: unknown) => Promise<void> | void,
    options: MessageQueueListenOptions = {},
  ): Promise<void> {
    this.listening = true;
    await new Promise<void>((resolve) => {
      options.signal?.addEventListener(
        "abort",
        () => setTimeout(resolve, 10),
      );
    });
    this.stopped = true;
  }
}

describe("FedifyProvider", () => {
  it("binds the builder and refuses to build the federation too early", async () => {
    const app = await createApp({
      fedify: defineConfig({ origin: "https://example.com" }),
    });

    const provider = new FedifyProvider(app);
    provider.register();

    // The builder is available immediately: preload files register dispatchers
    // on it long before the federation itself can exist.
    const builder = await app.container.make("fedify.builder");
    strictEqual(typeof builder.build, "function");

    // The federation is not, and says why.
    await rejects(
      () => app.container.make("fedify"),
      (error: Error) => error instanceof E_FEDERATION_NOT_READY,
    );
  });

  it("builds the federation once the application is ready", async () => {
    const app = await createApp({
      fedify: defineConfig({ origin: "https://example.com", logging: false }),
    });

    const provider = new FedifyProvider(app);
    provider.register();
    await provider.boot();
    await provider.ready();

    const federation = await app.container.make("fedify");
    strictEqual(typeof federation.fetch, "function");

    await provider.shutdown();
  });

  it("waits for the queue worker to stop before shutdown resolves", async () => {
    // Aborting only asks the listeners to stop.  `shutdown()` has to return the
    // `startQueue()` promise, or AdonisJS tears the rest of the application
    // down -- the database connection above all -- around a job still running.
    const queue = new SlowQueue();
    const app = await createApp({
      fedify: defineConfig({
        origin: "https://example.com",
        logging: false,
        queue,
        queueContextData: () => null as never,
      }),
    }, "web");

    bindStubLogger(app);

    const provider = new FedifyProvider(app);
    provider.register();
    await provider.boot();
    await provider.ready();

    strictEqual(queue.listening, true);
    strictEqual(queue.stopped, false);

    await provider.shutdown();

    strictEqual(queue.stopped, true);
  });
});
