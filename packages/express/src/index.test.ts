import { createFederation, MemoryKvStore } from "@fedify/fedify";
import type { Request as ERequest, Response as EResponse } from "express";
import express from "express";
import { strict as assert } from "node:assert";
import type { AddressInfo } from "node:net";
import { describe, test } from "node:test";
import { integrateFederation } from "./index.ts";

interface MockFederation {
  fetch(request: Request, options: unknown): Promise<Response>;
}

function createMockRequest(): ERequest {
  return {
    protocol: "http",
    host: "localhost",
    url: "/",
    method: "GET",
    headers: {},
  } as unknown as ERequest;
}

function createMockResponse(): {
  response: EResponse;
  ended: Promise<void>;
  getBody(): string;
  getHeader(
    name: string,
  ): string | number | readonly string[] | undefined;
} {
  let body = "";
  const headers = new Map<
    string,
    string | number | readonly string[]
  >();
  let resolveEnded: () => void;
  const ended = new Promise<void>((resolve) => {
    resolveEnded = resolve;
  });
  const response = {
    statusCode: 200,
    status(code: number) {
      response.statusCode = code;
      return response;
    },
    setHeader(
      name: string,
      value: string | number | readonly string[],
    ) {
      headers.set(name.toLowerCase(), value);
      return response;
    },
    write(chunk: Buffer | string) {
      body += chunk.toString();
      return true;
    },
    end() {
      resolveEnded();
      return response;
    },
  };
  return {
    response: response as unknown as EResponse,
    ended,
    getBody: () => body,
    getHeader: (name) => headers.get(name.toLowerCase()),
  };
}

describe("integrateFederation()", () => {
  test("waits for an async contextDataFactory and passes the resolved value to federation.fetch()", async () => {
    let resolveContextData!: (value: string) => void;
    let fetchCalled = false;

    const mockFederation: MockFederation = {
      fetch(_request, options) {
        fetchCalled = true;
        const { contextData } = options as { contextData: unknown };
        return Promise.resolve(new Response(String(contextData)));
      },
    };

    const contextDataFactory = () =>
      new Promise<string>((resolve) => {
        resolveContextData = resolve;
      });

    const middleware = integrateFederation(
      mockFederation as never,
      contextDataFactory,
    );

    const req = createMockRequest();
    const { response, ended, getBody } = createMockResponse();
    let nextCalled = false;

    middleware(req, response, () => {
      nextCalled = true;
    });

    await Promise.resolve();
    assert.strictEqual(fetchCalled, false);

    resolveContextData("Hello World");
    await ended;

    assert.strictEqual(nextCalled, false);
    assert.strictEqual(getBody(), "Hello World");
  });

  test("responds with 406 when onNotAcceptable is used and no route matches", async () => {
    const mockFederation: MockFederation = {
      fetch(_request, options) {
        const { onNotAcceptable } = options as {
          onNotAcceptable: () => Response;
        };
        return Promise.resolve(onNotAcceptable());
      },
    };

    const middleware = integrateFederation(
      mockFederation as never,
      () => undefined,
    );

    const req = createMockRequest();
    const { response, ended } = createMockResponse();

    middleware(req, response, () => {});
    await ended;
    assert.strictEqual(response.statusCode, 406);
  });

  test("forwards the Fedify response status, headers, and streamed body to the Express response", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("Hello "));
        controller.enqueue(encoder.encode("World"));
        controller.close();
      },
    });

    const mockFederation: MockFederation = {
      fetch() {
        return Promise.resolve(
          new Response(body, {
            status: 201,
            headers: {
              "Header-Test": "yes",
            },
          }),
        );
      },
    };

    const middleware = integrateFederation(
      mockFederation as never,
      () => undefined,
    );

    const req = createMockRequest();
    const { response, ended, getBody, getHeader } = createMockResponse();

    middleware(req, response, () => {});
    await ended;
    assert.strictEqual(response.statusCode, 201);
    assert.strictEqual(getHeader("Header-Test"), "yes");
    assert.strictEqual(getBody(), "Hello World");
  });
});

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
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

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
