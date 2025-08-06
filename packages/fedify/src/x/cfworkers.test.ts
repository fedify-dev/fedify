import type { KVNamespace } from "@cloudflare/workers-types/experimental";
import { assertEquals } from "@std/assert";
import { delay } from "es-toolkit";
import { test } from "../testing/mod.ts";
import { WorkersKvStore, WorkersMessageQueue } from "./cfworkers.ts";

test({
  name: "WorkersKvStore",
  ignore: !("navigator" in globalThis &&
    navigator.userAgent === "Cloudflare-Workers"),
  async fn(t) {
    const { env } = t as unknown as {
      env: Record<string, KVNamespace<string>>;
    };
    const store = new WorkersKvStore(env.KV1);

    await t.step("set() & get()", async () => {
      await store.set(["foo", "bar"], { foo: 1, bar: 2 });
      assertEquals(await store.get(["foo", "bar"]), { foo: 1, bar: 2 });
      assertEquals(await store.get(["foo"]), undefined);

      await store.set(["foo", "baz"], "baz", {
        ttl: Temporal.Duration.from({ seconds: 0 }),
      });
      assertEquals(await store.get(["foo", "baz"]), undefined);
    });

    await t.step("delete()", async () => {
      await store.delete(["foo", "bar"]);
      assertEquals(await store.get(["foo", "bar"]), undefined);
    });
  },
});

test({
  name: "WorkersMessageQueue",
  ignore: !("navigator" in globalThis &&
    navigator.userAgent === "Cloudflare-Workers"),
  async fn(t) {
    const { env, messageBatches } = t as unknown as {
      env: Record<string, Queue>;
      messageBatches: MessageBatch[];
    };
    const queue = new WorkersMessageQueue(env.Q1);
    await queue.enqueue({ foo: 1, bar: 2 });
    await waitFor(() => messageBatches.length > 0, 5000);
    assertEquals(messageBatches.length, 1);
    assertEquals(messageBatches[0].queue, "Q1");
    assertEquals(messageBatches[0].messages.length, 1);
    assertEquals(messageBatches[0].messages[0].body, { foo: 1, bar: 2 });

    await queue.enqueue(
      { baz: 3, qux: 4 },
      { delay: Temporal.Duration.from({ seconds: 3 }) },
    );
    await delay(2000);
    assertEquals(messageBatches.length, 1);
    await waitFor(() => messageBatches.length > 1, 6000);
    assertEquals(messageBatches[1].queue, "Q1");
    assertEquals(messageBatches[1].messages.length, 1);
    assertEquals(messageBatches[1].messages[0].body, { baz: 3, qux: 4 });
  },
});

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<void> {
  let delayed = 0;
  while (!predicate()) {
    await delay(500);
    delayed += 500;
    if (delayed > timeoutMs) {
      throw new Error("Timeout");
    }
  }
}
