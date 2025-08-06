import { assertEquals } from "@std/assert";
import { test } from "../testing/mod.ts";
import { MemoryKvStore } from "./kv.ts";

test("MemoryKvStore", async (t) => {
  const store = new MemoryKvStore();

  await t.step("set() & get()", async () => {
    await store.set(["foo", "bar"], "foobar");
    assertEquals(await store.get(["foo", "bar"]), "foobar");
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
});
