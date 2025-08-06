import { assertEquals, assertGreater } from "@std/assert";
import { delay } from "es-toolkit";
import { test } from "../testing/mod.ts";
import { DenoKvMessageQueue, DenoKvStore } from "./denokv.ts";

test("DenoKvStore", async (t) => {
  const kv = await Deno.openKv(":memory:");
  const store = new DenoKvStore(kv);

  await t.step("get()", async () => {
    await kv.set(["foo", "bar"], "foobar");
    assertEquals(await store.get(["foo", "bar"]), "foobar");
  });

  await t.step("set()", async () => {
    await store.set(["foo", "baz"], "baz");
    assertEquals((await kv.get<string>(["foo", "baz"])).value, "baz");
  });

  await t.step("delete()", async () => {
    await store.delete(["foo", "baz"]);
    assertEquals((await kv.get<string>(["foo", "baz"])).value, null);
  });

  await t.step("cas()", async () => {
    await store.set(["foo", "bar"], "foobar");
    assertEquals(await store.cas(["foo", "bar"], "bar", "baz"), false);
    assertEquals(await store.get(["foo", "bar"]), "foobar");
    assertEquals(await store.cas(["foo", "bar"], "foobar", "baz"), true);
    assertEquals(await store.get(["foo", "bar"]), "baz");
    await store.delete(["foo", "bar"]);
    assertEquals(await store.cas(["foo", "bar"], "foobar", "baz"), false);
    assertEquals(await store.get(["foo", "bar"]), undefined);
    assertEquals(await store.cas(["foo", "bar"], undefined, "baz"), true);
    assertEquals(await store.get(["foo", "bar"]), "baz");
  });

  kv.close();
});

test("DenoKvMessageQueue", async (t) => {
  const kv = await Deno.openKv(":memory:");
  const mq = new DenoKvMessageQueue(kv);

  const messages: string[] = [];
  const controller = new AbortController();
  const listening = mq.listen((message: string) => {
    messages.push(message);
  }, controller);

  await t.step("enqueue()", async () => {
    await mq.enqueue("Hello, world!");
  });

  await waitFor(() => messages.length > 0, 15_000);

  await t.step("listen()", () => {
    assertEquals(messages, ["Hello, world!"]);
  });

  let started = 0;
  await t.step("enqueue() with delay", async () => {
    started = Date.now();
    await mq.enqueue(
      "Delayed message",
      { delay: Temporal.Duration.from({ seconds: 3 }) },
    );
  });

  await waitFor(() => messages.length > 1, 15_000);

  await t.step("listen() with delay", () => {
    assertEquals(messages, ["Hello, world!", "Delayed message"]);
    assertGreater(Date.now() - started, 3_000);
  });

  controller.abort();
  await listening;
  mq[Symbol.dispose]();
});

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    await delay(500);
    if (Date.now() - started > timeoutMs) {
      throw new Error("Timeout");
    }
  }
}
