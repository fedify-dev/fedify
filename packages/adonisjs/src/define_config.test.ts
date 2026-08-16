/**
 * Tests for `defineConfig()` and the service provider's lifecycle.
 *
 * @module
 */
import { rejects, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";

import { configProvider } from "@adonisjs/core";
import { AppFactory } from "@adonisjs/core/factories/app";
import type { ApplicationService } from "@adonisjs/core/types";
import { MemoryKvStore } from "@fedify/fedify";

import { defineConfig } from "./define_config.ts";
import { E_FEDERATION_NOT_READY } from "./errors.ts";
import FedifyProvider from "./provider.ts";
import type { FedifyConfig, ResolvedFedifyConfig } from "./types.ts";

async function createApp(
  config: Record<string, unknown> = {},
): Promise<ApplicationService> {
  const app = new AppFactory().create(
    new URL("../", import.meta.url),
    () => import("node:util"),
  ) as ApplicationService;
  app.useConfig(config);
  await app.init();
  // `app.config` only exists after boot, and the provider reads it.
  await app.boot();
  return app;
}

async function resolve(config: FedifyConfig): Promise<ResolvedFedifyConfig> {
  const app = await createApp();
  const resolved = await configProvider.resolve<ResolvedFedifyConfig>(
    app,
    defineConfig(config),
  );
  strictEqual(resolved !== null, true);
  return resolved!;
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
});

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
});
