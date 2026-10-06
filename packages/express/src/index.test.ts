import { createFederation, MemoryKvStore } from "@fedify/fedify";
import express from "express";
import { strict as assert } from "node:assert";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { integrateFederation } from "./index.ts";

// Large enough to fill the stream buffers that used to stall; see
// <https://github.com/fedify-dev/fedify/issues/1059>.
const LARGE_BODY_SIZE = 512 * 1024;

async function withServer(
  app: express.Express,
  callback: (origin: string) => Promise<void>,
): Promise<void> {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

for (const failure of ["contextDataFactory", "federation.fetch"] as const) {
  test(`integrateFederation() forwards a rejected ${failure} to error middleware`, async () => {
    const error = new Error(`${failure} failed`);
    const context = Promise.withResolvers<string>();
    const requested = Promise.withResolvers<void>();
    let fetchCalls = 0;
    const errors: unknown[] = [];
    const federation = {
      fetch(_request: Request, options: { contextData: string }) {
        fetchCalls++;
        assert.equal(options.contextData, "context value");
        return Promise.reject(error);
      },
    };
    const app = express();
    app.use(integrateFederation(federation as never, () => {
      requested.resolve();
      return context.promise;
    }));
    app.use((
      error: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      errors.push(error);
      res.status(500).send(error.message);
    });

    await withServer(app, async (origin) => {
      const responsePromise = fetch(origin, {
        signal: AbortSignal.timeout(5000),
      });
      await Promise.race([
        requested.promise,
        responsePromise.then(() => {
          assert.fail("The request completed before the context factory ran.");
        }),
      ]);
      assert.equal(fetchCalls, 0);
      if (failure === "contextDataFactory") context.reject(error);
      else context.resolve("context value");
      const response = await responsePromise;
      assert.equal(response.status, 500);
      assert.equal(await response.text(), error.message);
    });
    assert.equal(fetchCalls, failure === "contextDataFactory" ? 0 : 1);
    assert.equal(errors.length, 1);
    assert.strictEqual(errors[0], error);
  });
}

for (const failure of ["contextDataFactory", "federation.fetch"] as const) {
  for (const reason of ["route", "router"]) {
    test(`integrateFederation() forwards a ${reason} rejection from ${failure} to error middleware`, async () => {
      const errors: unknown[] = [];
      let fetchCalls = 0;
      const federation = {
        fetch() {
          fetchCalls++;
          return Promise.reject(reason);
        },
      };
      const app = express();
      app.use(integrateFederation(
        federation as never,
        () =>
          failure === "contextDataFactory"
            ? Promise.reject(reason)
            : Promise.resolve(undefined),
      ));
      app.use((_req: express.Request, res: express.Response) => {
        res.send("unexpected fallthrough");
      });
      app.use((
        error: Error,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ) => {
        errors.push(error);
        res.status(500).send(error.message);
      });

      await withServer(app, async (origin) => {
        const response = await fetch(origin, {
          signal: AbortSignal.timeout(5000),
        });
        assert.equal(response.status, 500);
        assert.equal(await response.text(), reason);
      });
      assert.equal(fetchCalls, failure === "contextDataFactory" ? 0 : 1);
      assert.equal(errors.length, 1);
      assert.ok(errors[0] instanceof Error);
      assert.equal(errors[0].message, reason);
    });
  }
}

test("integrateFederation() forwards a rejection without a reason to error middleware", async () => {
  const errors: unknown[] = [];
  let fetchCalls = 0;
  const federation = {
    fetch() {
      fetchCalls++;
      return Promise.resolve(new Response("ok"));
    },
  };
  const app = express();
  app.use(integrateFederation(
    federation as never,
    () => Promise.reject(),
  ));
  app.use((_req: express.Request, res: express.Response) => {
    res.status(200).send("unexpected fallthrough");
  });
  app.use((
    error: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    errors.push(error);
    res.status(500).send(error.message);
  });

  await withServer(app, async (origin) => {
    const response = await fetch(origin, {
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 500);
    assert.ok((await response.text()).length > 0);
  });
  assert.equal(fetchCalls, 0);
  assert.equal(errors.length, 1);
  assert.ok(errors[0] instanceof Error);
});

test("integrateFederation() leaves synchronous factory errors to Express", async () => {
  const error = new Error("context failed");
  const errors: unknown[] = [];
  let fetchCalls = 0;
  const federation = {
    fetch() {
      fetchCalls++;
      return Promise.resolve(new Response("ok"));
    },
  };
  const app = express();
  app.use(integrateFederation(federation as never, () => {
    throw error;
  }));
  app.use((
    error: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    errors.push(error);
    res.status(500).send(error.message);
  });

  await withServer(app, async (origin) => {
    const response = await fetch(origin, {
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 500);
    assert.equal(await response.text(), error.message);
  });
  assert.equal(fetchCalls, 0);
  assert.equal(errors.length, 1);
  assert.strictEqual(errors[0], error);
});

test("integrateFederation() waits for successful asynchronous context data", async () => {
  const context = Promise.withResolvers<string>();
  const requested = Promise.withResolvers<void>();
  let fetchCalls = 0;
  const errors: unknown[] = [];
  const federation = {
    fetch(_request: Request, options: { contextData: string }) {
      fetchCalls++;
      return Promise.resolve(new Response(options.contextData));
    },
  };
  const app = express();
  app.use(integrateFederation(federation as never, () => {
    requested.resolve();
    return context.promise;
  }));
  app.use((
    error: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    errors.push(error);
    res.status(500).send(error.message);
  });

  await withServer(app, async (origin) => {
    const responsePromise = fetch(origin, {
      signal: AbortSignal.timeout(5000),
    });
    await Promise.race([
      requested.promise,
      responsePromise.then(() => {
        assert.fail("The request completed before the context factory ran.");
      }),
    ]);
    assert.equal(fetchCalls, 0);
    context.resolve("context value");
    const response = await responsePromise;
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "context value");
  });
  assert.equal(fetchCalls, 1);
  assert.deepEqual(errors, []);
});

// Sends the body only after a delay, so that the request reaches Fedify
// before any of its body has arrived:
function delayedBody(body: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      setTimeout(() => {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      }, 100);
    },
  });
}

test("integrateFederation() leaves request bodies it declines intact", async () => {
  const federation = createFederation<void>({ kv: new MemoryKvStore() });
  federation.setActorDispatcher("/users/{identifier}", () => null);
  const app = express();
  app.use(integrateFederation(federation, () => undefined));
  app.use(express.text({ type: "*/*", limit: "1mb" }));
  app.post("/api/articles", (req: express.Request, res: express.Response) => {
    res.send(String(req.body.length));
  });

  await withServer(app, async (origin) => {
    for (const size of [1024, LARGE_BODY_SIZE]) {
      const response = await fetch(`${origin}/api/articles`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "x".repeat(size),
        signal: AbortSignal.timeout(5000),
      });
      assert.equal(response.status, 200);
      assert.equal(await response.text(), String(size));
    }
  });
});

test("integrateFederation() passes request bodies to Fedify", async () => {
  const federation = createFederation<void>({
    kv: new MemoryKvStore(),
    skipSignatureVerification: true,
  });
  federation.setActorDispatcher("/users/{identifier}", () => null);
  federation.setInboxListeners("/users/{identifier}/inbox", "/inbox");
  const app = express();
  app.use(integrateFederation(federation, () => undefined));

  await withServer(app, async (origin) => {
    // Fedify rejects a truncated body as invalid JSON, so an accepted
    // activity means the whole body reached it:
    const response = await fetch(`${origin}/inbox`, {
      method: "POST",
      headers: { "Content-Type": "application/activity+json" },
      body: JSON.stringify({
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Create",
        id: "https://remote.example/activities/1",
        actor: "https://remote.example/users/alice",
        object: {
          type: "Note",
          id: "https://remote.example/notes/1",
          attributedTo: "https://remote.example/users/alice",
          content: "x".repeat(LARGE_BODY_SIZE),
        },
      }),
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 202);
  });
});

test("integrateFederation() restores request bodies Fedify read before declining", async () => {
  // A dispatcher may clone the request, e.g., through ctx.getSignedKey(), and
  // then return null; the clone tees the body, which starts reading it.
  for (const readClone of [false, true]) {
    const federation = createFederation<void>({ kv: new MemoryKvStore() });
    federation.setActorDispatcher("/users/{identifier}", async (ctx) => {
      const clone = ctx.request.clone();
      if (readClone) await clone.arrayBuffer();
      return null;
    });
    const app = express();
    app.use(integrateFederation(federation, () => undefined));
    app.use(express.text({ type: "*/*", limit: "1mb" }));
    app.post(
      "/users/:identifier",
      (req: express.Request, res: express.Response) => {
        res.send(req.body);
      },
    );

    await withServer(app, async (origin) => {
      for (const size of [1024, LARGE_BODY_SIZE]) {
        for (const delayed of [false, true]) {
          const body = "0123456789".repeat(size / 10);
          const response = await fetch(`${origin}/users/alice`, {
            method: "POST",
            headers: {
              Accept: "application/activity+json",
              "Content-Type": "text/plain",
            },
            body: delayed ? delayedBody(body) : body,
            // @ts-ignore: Node.js requires duplex for streaming request bodies
            duplex: "half",
            signal: AbortSignal.timeout(5000),
          });
          assert.equal(response.status, 200);
          assert.equal(await response.text(), body);
        }
      }
    });
  }
});
