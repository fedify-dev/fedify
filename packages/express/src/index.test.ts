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
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
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
