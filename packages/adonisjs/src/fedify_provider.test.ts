/**
 * Tests for the service provider: its container bindings, the builder service
 * module, the documented way to reach the built `Federation` from outside an
 * HTTP request, and the middleware it constructs for `start/kernel.ts`.
 *
 * `@fedify/adonisjs/services/builder` is a public entry point that application
 * code imports directly, so it deserves coverage of its own.  There is no
 * companion `services/federation` module on purpose: the built instance is
 * resolved from the container (`app.container.make('fedify')`), which is what
 * the second suite pins down.
 *
 * @module
 */
import { ok, rejects, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";

import { Emitter } from "@adonisjs/core/events";
import { AppFactory } from "@adonisjs/core/factories/app";
import { ServerFactory } from "@adonisjs/core/factories/http";
import type { HttpContext } from "@adonisjs/core/http";
import type { Logger } from "@adonisjs/core/logger";
import { setApp } from "@adonisjs/core/services/app";
import type {
  ApplicationService,
  ContainerBindings,
  EventsList,
} from "@adonisjs/core/types";
import { InProcessMessageQueue } from "@fedify/fedify";
import { Person } from "@fedify/vocab";
import { getConfig, getLogger, reset } from "@logtape/logtape";

import FedifyProvider from "../providers/fedify_provider.ts";
import { builder } from "./builder.ts";
import { defineConfig } from "./define_config.ts";
import { E_FEDERATION_NOT_READY } from "./errors.ts";
import FedifyMiddleware from "./fedify_middleware.ts";
import { ACTIVITY_PUB_ACCEPT, listen } from "./test_utils.ts";
import type { FedifyConfig } from "./types.ts";

/**
 * The one actor the end-to-end suite serves.
 *
 * Registered once, at module scope: the builder is a process-wide singleton and
 * Fedify rejects registering the same dispatcher twice.  Every federation the
 * tests below build from it therefore carries this actor, which none of the
 * other suites mind.
 */
builder
  .setActorDispatcher("/users/{identifier}", (ctx, identifier) => {
    if (identifier !== "alice") return null;
    return new Person({
      id: ctx.getActorUri(identifier),
      preferredUsername: identifier,
    });
  })
  .setKeyPairsDispatcher(() => []);

/**
 * Builds an application and publishes it as the global one, which is what the
 * service modules resolve through — exactly as the Ignitor does at runtime.
 *
 * The application is booted unless `boot` is `false`, and `fedify` overrides
 * the default `config/fedify.ts` values.  It carries an emitter, as a real
 * application does, so that the HTTP server's start can be announced.  The
 * environment is only worth setting for the queue worker, which the provider
 * starts in the `web` one alone.
 */
async function createGlobalApp(
  options: {
    fedify?: Partial<FedifyConfig>;
    boot?: boolean;
    environment?: "web" | "console" | "test" | "repl";
  } = {},
): Promise<ApplicationService> {
  const app = new AppFactory().create(
    new URL("../", import.meta.url),
    () => import("node:util"),
  ) as ApplicationService;

  // The environment is frozen once the application boots.
  if (options.environment !== undefined) {
    app.setEnvironment(options.environment);
  }
  app.useConfig({
    fedify: defineConfig({
      origin: "https://example.com",
      logging: false,
      ...options.fedify,
    }),
  });
  await app.init();
  app.container.bindValue("emitter", new Emitter<EventsList>(app));
  if (options.boot !== false) await app.boot();

  setApp(app);
  return app;
}

/**
 * Announces what `HttpServerProcess` announces once `listen()` has returned:
 * the moment requests can start arriving.
 */
async function announceServerStarted(app: ApplicationService): Promise<void> {
  const emitter = await app.container.make("emitter");
  await emitter.emit("http:server_ready", {
    host: "127.0.0.1",
    port: 0,
    duration: [0, 0],
  });
}

/**
 * Resolves to "pending" when `promise` has not settled by the time the event
 * loop has turned over a few times.
 */
function settledOrPending(promise: Promise<unknown>): Promise<string> {
  return Promise.race([
    promise.then(() => "settled", () => "settled"),
    new Promise<string>((resolve) => setTimeout(() => resolve("pending"), 50)),
  ]);
}

describe("services/builder", () => {
  it("is the same object the container binds", async () => {
    const app = await createGlobalApp();
    const provider = new FedifyProvider(app);
    provider.register();

    const { default: fromService } = await import("../services/builder.ts");
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

  it("builds the federation once, however often it is resolved", async () => {
    // `fedify` is a plain `bind()`, not a `singleton()`, so the container runs
    // the factory on every `make()`.  The provider memoises inside the factory
    // instead — a `singleton()` would also cache an early rejection — and this
    // pins down that the memo holds across the app container and the
    // request-scoped resolvers that `ctx.containerResolver` hands middleware.
    const app = await createGlobalApp();
    const provider = new FedifyProvider(app);
    provider.register();
    await provider.boot();

    // Spy before `ready()`, which performs the one eager build at boot.
    const builder = await app.container.make("fedify.builder");
    const build = builder.build.bind(builder);
    let builds = 0;
    builder.build = ((options) => {
      builds++;
      return build(options);
    }) as typeof builder.build;

    try {
      await provider.ready();
      await app.start(async () => {});
      strictEqual(builds, 1);

      const resolved = await Promise.all([
        app.container.make("fedify"),
        app.container.make("fedify"),
        app.container.createResolver().make("fedify"),
        app.container.createResolver().make("fedify"),
        app.container.createResolver().make("fedify"),
      ]);

      strictEqual(builds, 1);
      for (const federation of resolved) strictEqual(federation, resolved[0]);
    } finally {
      builder.build = build;
      await provider.shutdown();
    }
  });

  it("fails fast again after a ready() that could not build", async () => {
    // A process that survives a failed `ready()` -- an Ace command, the REPL
    // -- must not have later resolutions quietly re-run the configuration.
    const app = await createGlobalApp();
    const provider = new FedifyProvider(app);
    provider.register();
    await provider.boot();

    const builder = await app.container.make("fedify.builder");
    const build = builder.build.bind(builder);
    builder.build = () => {
      throw new Error("boom");
    };

    try {
      await rejects(() => provider.ready(), /boom/);
      await rejects(
        () => app.container.make("fedify"),
        (error: Error) => error instanceof E_FEDERATION_NOT_READY,
      );
    } finally {
      builder.build = build;
    }
  });
});

describe("the provider-built middleware", () => {
  it("is constructed by the container, once, with the federation and config", async () => {
    // `start/kernel.ts` imports `@fedify/adonisjs/fedify_middleware`, and
    // `server.use()` resolves that class through the container on every
    // request.  The provider binds it there, the way `@adonisjs/cors` and
    // `@adonisjs/session` bind theirs, so this is the path every real request
    // takes.
    const app = await createGlobalApp();
    const provider = new FedifyProvider(app);
    provider.register();
    await provider.boot();
    await provider.ready();
    await app.start(async () => {});

    try {
      const middleware = await app.container.make(FedifyMiddleware);

      ok(middleware instanceof FedifyMiddleware);
      strictEqual(typeof middleware.handle, "function");

      // One instance for the whole process, from whichever resolver asks.
      strictEqual(await app.container.make(FedifyMiddleware), middleware);
      strictEqual(
        await app.container.createResolver().make(FedifyMiddleware),
        middleware,
      );
    } finally {
      await provider.shutdown();
    }
  });

  it("serves requests through the container-bound middleware", async () => {
    // The real wiring, end to end: the bare class in the server stack, the
    // provider's binding supplying the federation and `config/fedify.ts`, and
    // `ctx.federation` on a route.
    const app = await createGlobalApp({
      fedify: { ignoreRoutePrefixes: ["/assets/"] },
    });
    const provider = new FedifyProvider(app);
    provider.register();
    await provider.boot();
    await provider.ready();
    await app.start(async () => {});

    const server = new ServerFactory().merge({ app }).create();
    server.use([() => Promise.resolve({ default: FedifyMiddleware })]);

    let seen: HttpContext | undefined;
    server.getRouter().get("/whoami", (ctx) => {
      seen = ctx;
      return ctx.federation.getActorUri("alice").href;
    });
    server.getRouter().get("/assets/x", (ctx) => {
      try {
        void ctx.federation;
        return "available";
      } catch (error) {
        return (error as { code?: string }).code ?? "unknown";
      }
    });
    await server.boot();

    const listening = await listen(server);
    try {
      // Served by Fedify, with the origin from `config/fedify.ts`.
      const actor = await listening.fetch("/users/alice", {
        headers: { Accept: ACTIVITY_PUB_ACCEPT },
      });
      strictEqual(actor.status, 200);
      const document = (await actor.json()) as Record<string, unknown>;
      strictEqual(document.id, "https://example.com/users/alice");

      // Served by AdonisJS, with `ctx.federation` from the same federation and
      // the default `contextDataFactory` handing over the `HttpContext`.
      const whoami = await listening.fetch("/whoami");
      strictEqual(await whoami.text(), "https://example.com/users/alice");
      ok(seen);
      strictEqual(seen.federation.data, seen);

      // `ignoreRoutePrefixes` from `config/fedify.ts` reached the middleware.
      const ignored = await listening.fetch("/assets/x");
      strictEqual(await ignored.text(), "E_FEDIFY_CONTEXT_UNAVAILABLE");
    } finally {
      await listening.close();
      await provider.shutdown();
    }
  });
});

describe("the middleware binding before ready()", () => {
  it("waits for ready() once the server is listening", async () => {
    // AdonisJS listens inside the `start()` callback and runs the providers'
    // `ready()` hooks afterwards, so a request can arrive in between.  It has
    // to wait for the federation rather than be answered with a 500.
    const app = await createGlobalApp();
    const provider = new FedifyProvider(app);
    provider.register();
    await provider.boot();
    await announceServerStarted(app);

    const pending = app.container.make(FedifyMiddleware);
    strictEqual(await settledOrPending(pending), "pending");

    await provider.ready();
    try {
      ok((await pending) instanceof FedifyMiddleware);
    } finally {
      await provider.shutdown();
    }
  });

  it("fails fast before the server is listening", async () => {
    // A provider's `start()` hook or a preload file resolving the middleware
    // could wait forever: `ready()` only runs once they have returned.  The
    // guard says why instead.
    const app = await createGlobalApp();
    const provider = new FedifyProvider(app);
    provider.register();
    await provider.boot();

    await rejects(
      () => app.container.make(FedifyMiddleware),
      (error: Error) => error instanceof E_FEDERATION_NOT_READY,
    );
  });

  it("fails fast while the application is still booting", async () => {
    const app = await createGlobalApp({ boot: false });
    const provider = new FedifyProvider(app);
    provider.register();

    await rejects(
      () => app.container.make(FedifyMiddleware),
      (error: Error) => error instanceof E_FEDERATION_NOT_READY,
    );
  });

  it("releases waiting requests when the application shuts down", async () => {
    // A `ready()` that never comes -- an earlier provider's hook threw, or the
    // process was told to stop -- must not leave requests hanging, which would
    // also keep a graceful server close from ever finishing.
    const app = await createGlobalApp();
    const provider = new FedifyProvider(app);
    provider.register();
    await provider.boot();
    await announceServerStarted(app);

    const pending = app.container.make(FedifyMiddleware);
    strictEqual(await settledOrPending(pending), "pending");

    await provider.shutdown();

    await rejects(
      () => pending,
      (error: Error) => error instanceof E_FEDERATION_NOT_READY,
    );
  });

  it("hands waiting requests the error ready() hit", async () => {
    const app = await createGlobalApp();
    const provider = new FedifyProvider(app);
    provider.register();
    await provider.boot();
    await announceServerStarted(app);

    const builder = await app.container.make("fedify.builder");
    const build = builder.build.bind(builder);
    builder.build = () => {
      throw new Error("boom");
    };

    try {
      const pending = app.container.make(FedifyMiddleware);
      await rejects(() => provider.ready(), /boom/);
      await rejects(() => pending, /boom/);
    } finally {
      builder.build = build;
    }
  });

  it("hands them the error the queue context data callback hit", async () => {
    // The callback runs in `ready()` as well, and a throwing one has to fail
    // startup the way a broken federation does.  Releasing the waiting
    // requests first would leave them served by an application whose `ready()`
    // rejected and whose queue never started.
    const app = await createGlobalApp({
      environment: "web",
      fedify: {
        // A queue, since a drainer without one is a configuration error.
        queue: new InProcessMessageQueue(),
        queueContextData: () => {
          throw new Error("boom");
        },
      },
    });
    const provider = new FedifyProvider(app);
    provider.register();
    await provider.boot();
    await announceServerStarted(app);

    const pending = app.container.make(FedifyMiddleware);
    await rejects(() => provider.ready(), /boom/);
    await rejects(() => pending, /boom/);

    // And back to failing fast, as after a failed build.
    await rejects(
      () => app.container.make("fedify"),
      (error: Error) => error instanceof E_FEDERATION_NOT_READY,
    );
  });

  it("forgets a middleware built while a failing ready() ran", async () => {
    // A request that arrives once `ready()` has made the federation buildable
    // is served without waiting.  Should `ready()` fail afterwards, the
    // middleware it built must not stay cached: it would keep serving
    // federation traffic in an application whose `make('fedify')` fails fast
    // and whose queue never started.
    let arrived!: () => void;
    const request = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    const app = await createGlobalApp({
      environment: "web",
      fedify: {
        queue: new InProcessMessageQueue(),
        queueContextData: async () => {
          await request;
          throw new Error("boom");
        },
      },
    });
    const provider = new FedifyProvider(app);
    provider.register();
    await provider.boot();

    // `ready()` is in flight: the federation is buildable, and the queue
    // context data has not thrown yet.
    const readied = provider.ready();
    const middleware = await app.container.make(FedifyMiddleware);
    ok(middleware instanceof FedifyMiddleware);
    arrived();

    await rejects(() => readied, /boom/);
    await rejects(
      () => app.container.make(FedifyMiddleware),
      (error: Error) => error instanceof E_FEDERATION_NOT_READY,
    );
  });
});

describe("the LogTape bridge", () => {
  /**
   * A stand-in for the AdonisJS (Pino) logger that records the messages it is
   * given.  The bridge calls it with a merging object first.
   */
  function createLogger(): { logger: Logger; messages: string[] } {
    const messages: string[] = [];
    const record = () => (_fields: unknown, message?: string) => {
      if (message !== undefined) messages.push(message);
    };

    const logger = {
      trace: record(),
      debug: record(),
      info: record(),
      warn: record(),
      error: record(),
      fatal: record(),
    } as unknown as Logger;

    return { logger, messages };
  }

  /**
   * Boots a provider with the logging bridge on, against its own logger.
   */
  async function bootWithLogging(): Promise<
    { provider: FedifyProvider; messages: string[] }
  > {
    const app = await createGlobalApp({ fedify: { logging: true } });
    const { logger, messages } = createLogger();
    // The container's `logger` is the manager, of which the bridge only ever
    // uses the log methods this fake has.
    app.container.bindValue(
      "logger",
      logger as unknown as ContainerBindings["logger"],
    );

    const provider = new FedifyProvider(app);
    provider.register();
    await provider.boot();

    return { provider, messages };
  }

  it("follows the application lifecycle rather than the process", async () => {
    // LogTape's configuration is process-global and its sink closes over the
    // logger of the application that installed it.  A process that boots a
    // second application -- the AdonisJS test runner, an in-process
    // dev-server restart -- would otherwise find LogTape already configured,
    // leave it alone, and go on writing Fedify's logs into the terminated
    // application's logger.
    const first = await bootWithLogging();
    try {
      ok(getConfig() != null);
    } finally {
      await first.provider.shutdown();
    }
    strictEqual(getConfig() == null, true);

    const second = await bootWithLogging();
    try {
      first.messages.length = 0;
      getLogger(["fedify", "federation"]).warn("Delivery failed.");

      ok(
        second.messages.some((message) => message.includes("Delivery failed")),
      );
      strictEqual(first.messages.length, 0);
    } finally {
      await second.provider.shutdown();
      // Nothing else in this file configures LogTape, but a failed assertion
      // above must not leave the global set for whatever runs next.
      await reset();
    }
  });
});
