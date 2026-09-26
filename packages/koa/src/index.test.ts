import { createFederation, MemoryKvStore } from "@fedify/fedify";
import Koa from "koa";
import { strict as assert } from "node:assert";
import { Buffer } from "node:buffer";
import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { createMiddleware } from "./index.ts";

// Large enough to fill the stream buffers that used to stall; see
// <https://github.com/fedify-dev/fedify/issues/1059>.
const LARGE_BODY_SIZE = 512 * 1024;

async function withServer(
  app: Koa,
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

function readBody(message: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    message.on("data", (chunk: Uint8Array) => chunks.push(chunk));
    message.on("end", () => resolve(Buffer.concat(chunks).toString()));
    message.on("error", reject);
  });
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

test("createMiddleware() leaves request bodies it declines intact", async () => {
  const federation = createFederation<void>({ kv: new MemoryKvStore() });
  federation.setActorDispatcher("/users/{identifier}", () => null);
  const app = new Koa();
  app.use(createMiddleware(federation, () => undefined));
  app.use(async (ctx: Koa.Context) => {
    ctx.body = String((await readBody(ctx.req)).length);
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

test("createMiddleware() passes request bodies to Fedify", async () => {
  const federation = createFederation<void>({
    kv: new MemoryKvStore(),
    skipSignatureVerification: true,
  });
  federation.setActorDispatcher("/users/{identifier}", () => null);
  federation.setInboxListeners("/users/{identifier}/inbox", "/inbox");
  const app = new Koa();
  app.use(createMiddleware(federation, () => undefined));

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

test("createMiddleware() restores request bodies Fedify read before declining", async () => {
  // A dispatcher may clone the request, e.g., through ctx.getSignedKey(), and
  // then return null; the clone tees the body, which starts reading it.
  for (const readClone of [false, true]) {
    const federation = createFederation<void>({ kv: new MemoryKvStore() });
    federation.setActorDispatcher("/users/{identifier}", async (ctx) => {
      const clone = ctx.request.clone();
      if (readClone) await clone.arrayBuffer();
      return null;
    });
    const app = new Koa();
    app.use(createMiddleware(federation, () => undefined));
    app.use(async (ctx: Koa.Context) => {
      ctx.body = await readBody(ctx.req);
    });

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
