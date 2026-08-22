/**
 * Tests for the builder service module and the documented way to reach the
 * built `Federation` from outside an HTTP request.
 *
 * `@fedify/adonisjs/services/builder` is a public entry point that application
 * code imports directly, so it deserves coverage of its own.  There is no
 * companion `services/federation` module on purpose: the built instance is
 * resolved from the container (`app.container.make('fedify')`), which is what
 * the second suite pins down.
 *
 * @module
 */
import { rejects, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";

import { AppFactory } from "@adonisjs/core/factories/app";
import { setApp } from "@adonisjs/core/services/app";
import type { ApplicationService } from "@adonisjs/core/types";

import { defineConfig } from "../define_config.ts";
import { E_FEDERATION_NOT_READY } from "../errors.ts";
import FedifyProvider from "../provider.ts";

/**
 * Builds an application and publishes it as the global one, which is what the
 * service modules resolve through — exactly as the Ignitor does at runtime.
 */
async function createGlobalApp(): Promise<ApplicationService> {
  const app = new AppFactory().create(
    new URL("../../", import.meta.url),
    () => import("node:util"),
  ) as ApplicationService;

  app.useConfig({
    fedify: defineConfig({ origin: "https://example.com", logging: false }),
  });
  await app.init();
  await app.boot();

  setApp(app);
  return app;
}

describe("services/builder", () => {
  it("is the same object the container binds", async () => {
    const app = await createGlobalApp();
    const provider = new FedifyProvider(app);
    provider.register();

    const { default: fromService } = await import("./builder.ts");
    const fromContainer = await app.container.make("fedify.builder");

    // Dispatchers registered through the service module have to end up on the
    // very builder the provider later seals into a Federation.
    strictEqual(fromService, fromContainer);
    strictEqual(typeof fromService.build, "function");
  });
});

describe("resolving the federation outside a request", () => {
  it("works through the container once the application is ready", async () => {
    const app = await createGlobalApp();
    const provider = new FedifyProvider(app);
    provider.register();
    await provider.boot();

    // Before `ready()`, resolving the federation is an error rather than a
    // silently empty object.
    await rejects(
      () => app.container.make("fedify"),
      (error: Error) => error instanceof E_FEDERATION_NOT_READY,
    );

    await provider.ready();
    await app.start(async () => {});

    // The documented pattern for Ace commands and queue workers.
    const federation = await app.container.make("fedify");

    strictEqual(typeof federation.fetch, "function");
    strictEqual(typeof federation.createContext, "function");

    await provider.shutdown();
  });
});
