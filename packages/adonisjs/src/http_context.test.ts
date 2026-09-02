/**
 * Tests for the `ctx.federation` getter itself: who installs it, on which
 * class, that installing it twice is harmless, that a conflicting member is
 * reported, and the Macroable semantics the middleware relies on.
 *
 * The getter lives on a class prototype, which is process-wide, so these tests
 * have a file of their own and reset the prototype before each one.
 * `node --test` runs files in separate processes but tests within a file share
 * the prototype; a test that checked "boot() installs the getter" after another
 * test had already installed it would pass whatever `boot()` did.
 *
 * @module
 */
import { ok, strictEqual, throws } from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { AppFactory } from "@adonisjs/core/factories/app";
import { HttpContextFactory } from "@adonisjs/core/factories/http";
import { HttpContext } from "@adonisjs/core/http";
import type { ApplicationService } from "@adonisjs/core/types";
import type { RequestContext } from "@fedify/fedify";

import FedifyProvider from "../providers/fedify_provider.ts";
import { defineConfig } from "./define_config.ts";
import { E_FEDIFY_CONTEXT_UNAVAILABLE } from "./errors.ts";
import FedifyMiddleware from "./fedify_middleware.ts";
import {
  ensureFederationGetter,
  installFederationGetter,
  setFederationContextFactory,
} from "./http_context.ts";
import { createTestFederation, startTestServer } from "./test_utils.ts";

function descriptor(
  target: { prototype: object } = HttpContext,
): PropertyDescriptor | undefined {
  return Object.getOwnPropertyDescriptor(target.prototype, "federation");
}

/**
 * Removes the getter again.  Macroable defines it configurable, so the
 * prototype can be returned to its pristine state between tests.
 */
function uninstall(target: { prototype: object } = HttpContext): void {
  Reflect.deleteProperty(target.prototype, "federation");
}

async function createBootedApp(): Promise<ApplicationService> {
  const app = new AppFactory().create(
    new URL("../", import.meta.url),
    () => import("node:util"),
  ) as ApplicationService;
  app.useConfig({
    fedify: defineConfig({ origin: "https://example.com", logging: false }),
  });
  await app.init();
  await app.boot();
  return app;
}

describe("the ctx.federation getter", () => {
  beforeEach(() => uninstall());

  it("is installed by the provider's boot()", async () => {
    strictEqual(descriptor(), undefined);

    const app = await createBootedApp();
    const provider = new FedifyProvider(app);
    provider.register();
    await provider.boot();

    const installed = descriptor();
    ok(installed);
    strictEqual(typeof installed.get, "function");
  });

  it("is installed by the middleware on the class of the context it handles", async () => {
    // The container-free path has no provider, and an application may hand
    // the middleware contexts of another `@adonisjs/core` copy's class.  The
    // first request installs the getter where those contexts will find it.
    strictEqual(descriptor(), undefined);

    const server = await startTestServer({
      middleware: new FedifyMiddleware(createTestFederation(), () => null),
      defineRoutes(router) {
        router.get("/probe", (ctx) => ctx.federation.getActorUri("alice").href);
      },
    });
    try {
      const response = await server.fetch("/probe");
      strictEqual(await response.text(), `${server.url}/users/alice`);
      strictEqual(typeof descriptor()?.get, "function");
    } finally {
      await server.close();
    }
  });

  it("can target a context class other than the one this package imports", () => {
    // Stands in for a second copy of `@adonisjs/core`: a class of its own,
    // whose prototype is not the one this module's `HttpContext` import
    // sees, holding contexts the middleware nevertheless has to serve.
    class OtherContext extends HttpContext {}
    const ctx = new HttpContextFactory().create();
    Object.setPrototypeOf(ctx, OtherContext.prototype);

    installFederationGetter(OtherContext);
    const context = {} as RequestContext<null>;
    setFederationContextFactory(ctx, () => context);

    strictEqual(ctx.federation, context);
    // The package's own class was left alone.
    strictEqual(descriptor(), undefined);
    strictEqual(typeof descriptor(OtherContext)?.get, "function");
  });

  it("is installed once per class", () => {
    installFederationGetter();
    const first = descriptor()?.get;
    ok(first);

    installFederationGetter();

    strictEqual(descriptor()?.get, first);
  });

  it("reports a federation member somebody else defined", () => {
    // Silently keeping the foreign member would have the middleware record
    // factories that nothing ever reads.  `ensureFederationGetter` says so in
    // its return value, for the middleware -- which must not fail a request
    // over it -- while the provider turns it into an error at boot.
    HttpContext.macro("federation", {} as HttpContext["federation"]);

    strictEqual(ensureFederationGetter(), false);
    throws(() => installFederationGetter(), /already has a "federation"/);
  });

  it("memoises the context per request and never caches a throw", () => {
    installFederationGetter();
    const ctx = new HttpContextFactory().create();

    // No middleware recorded a factory for this context: every access throws,
    // not only the first.
    const unavailable = (error: unknown) =>
      error instanceof E_FEDIFY_CONTEXT_UNAVAILABLE;
    throws(() => void ctx.federation, unavailable);
    throws(() => void ctx.federation, unavailable);

    const context = {} as RequestContext<null>;
    let created = 0;
    setFederationContextFactory(ctx, () => {
      created++;
      return context;
    });

    strictEqual(ctx.federation, context);
    strictEqual(ctx.federation, context);
    strictEqual(created, 1);

    // Once memoised the value is read-only, as with any Macroable singleton
    // getter; earlier, the prototype accessor has no setter.
    throws(() => {
      (ctx as { federation: unknown }).federation = null;
    }, TypeError);
  });
});
