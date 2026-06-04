import assert from "node:assert/strict";
import test from "node:test";
import { createSigningPipeline } from "./pipeline.ts";

function fakeFactory(delayMs = 0): () => Promise<Request> {
  let counter = 0;
  return () =>
    new Promise<Request>((resolve) =>
      setTimeout(
        () =>
          resolve(new Request(`http://sink/${counter++}`, { method: "POST" })),
        delayMs,
      )
    );
}

test("jit - signs in the send path with no starvation", async () => {
  const pipeline = createSigningPipeline("jit", fakeFactory());
  const request = await pipeline.next();
  assert.ok(request instanceof Request);
  assert.strictEqual(pipeline.starvationCount, 0);
  await pipeline.close();
});

test("pipeline - buffers and surfaces starvation under a slow signer", async () => {
  const pipeline = createSigningPipeline("pipeline", fakeFactory(15), {
    bufferSize: 1,
    signers: 1,
  });
  await pipeline.prime();
  const requests: Request[] = [];
  for (let i = 0; i < 5; i++) requests.push(await pipeline.next());
  assert.strictEqual(requests.length, 5);
  assert.ok(
    pipeline.starvationCount > 0,
    `expected starvation, got ${pipeline.starvationCount}`,
  );
  await pipeline.close();
});

test("pipeline - survives a synchronous factory throw", async () => {
  let calls = 0;
  const pipeline = createSigningPipeline("pipeline", () => {
    calls++;
    if (calls <= 2) throw new Error("sync boom");
    return Promise.resolve(new Request("http://sink/ok", { method: "POST" }));
  }, { bufferSize: 1, signers: 1 });
  const request = await pipeline.next();
  assert.ok(request instanceof Request);
  await pipeline.close();
});

test("pipeline - fails fast when signing always fails", async () => {
  const pipeline = createSigningPipeline(
    "pipeline",
    () => Promise.reject(new Error("bad key")),
    { bufferSize: 2, signers: 1 },
  );
  await assert.rejects(pipeline.next(), /bad key/);
  await pipeline.close();
});

test("presign - signs the whole run up front without starvation", async () => {
  const pipeline = createSigningPipeline("presign", fakeFactory(), {
    total: 3,
    signers: 2,
  });
  await pipeline.prime();
  assert.strictEqual(pipeline.starvationCount, 0);
  for (let i = 0; i < 3; i++) {
    assert.ok((await pipeline.next()) instanceof Request);
  }
  await pipeline.close();
});

test("close - rejects a pending consumer", async () => {
  const pipeline = createSigningPipeline("pipeline", fakeFactory(50), {
    bufferSize: 1,
    signers: 1,
  });
  await pipeline.prime();
  await pipeline.next();
  const pending = pipeline.next();
  // Attach the rejection handler before close() rejects the pending consumer.
  const rejection = assert.rejects(pending, /closed/);
  await pipeline.close();
  await rejection;
});

test("close - resolves promptly even with a never-resolving factory", async () => {
  const pipeline = createSigningPipeline(
    "pipeline",
    () => new Promise<Request>(() => {}),
    { bufferSize: 2, signers: 2 },
  );
  const outcome = await Promise.race([
    pipeline.close().then(() => "closed"),
    new Promise((resolve) => setTimeout(() => resolve("timeout"), 1000)),
  ]);
  assert.strictEqual(outcome, "closed");
});
