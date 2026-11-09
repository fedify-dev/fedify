import { test } from "@fedify/fixture";
import { deepStrictEqual, rejects, strictEqual } from "node:assert/strict";
import {
  type AtomicKvStore,
  isAtomicKvStore,
  type KvKey,
  type KvStore,
  MemoryKvStore,
} from "./kv.ts";

test("MemoryKvStore atomic contract and capability guard", async () => {
  const memory = new MemoryKvStore();
  const ordinary: KvStore = {
    get: memory.get.bind(memory),
    set: memory.set.bind(memory),
    delete: memory.delete.bind(memory),
    list: memory.list.bind(memory),
  };
  // Old custom stores remain valid, but cannot promise the stronger contract.
  // @ts-expect-error: ordinary stores lack required atomic operations.
  const unsupported: AtomicKvStore = ordinary;
  strictEqual(isAtomicKvStore(unsupported), false);
  const atomic: AtomicKvStore = memory;
  strictEqual(isAtomicKvStore(atomic), true);
  for (const method of ["cas", "getMany", "setMany", "deleteMany", "casMany"]) {
    strictEqual(
      isAtomicKvStore({
        ...ordinary,
        cas: memory.cas.bind(memory),
        getMany: memory.getMany.bind(memory),
        setMany: memory.setMany.bind(memory),
        deleteMany: memory.deleteMany.bind(memory),
        casMany: memory.casMany.bind(memory),
        [method]: true,
      } as unknown as KvStore),
      false,
    );
  }
  const maybe: KvStore = memory;
  if (isAtomicKvStore(maybe)) await maybe.getMany([]);

  deepStrictEqual(await memory.getMany([]), []);
  await memory.setMany([]);
  await memory.deleteMany([]);
  strictEqual(await memory.casMany([]), true);
  await memory.setMany([
    { key: ["a"], value: null },
    { key: ["b"], value: { nested: [1, "two"] } },
  ]);
  deepStrictEqual(await memory.getMany([["b"], ["missing"], ["a"], ["b"]]), [
    { nested: [1, "two"] },
    undefined,
    null,
    { nested: [1, "two"] },
  ]);
  strictEqual(
    await memory.casMany([
      { key: ["b"], expectedValue: { nested: [1, "two"] }, newValue: 2 },
      { key: ["a"], expectedValue: "wrong", newValue: undefined },
    ]),
    false,
  );
  deepStrictEqual(await memory.get(["b"]), { nested: [1, "two"] });
  strictEqual(
    await memory.casMany([
      { key: ["b"], expectedValue: { nested: [1, "two"] }, newValue: 2 },
      { key: ["a"], expectedValue: null, newValue: undefined },
    ]),
    true,
  );
  strictEqual(await memory.cas(["absent"], undefined, undefined), true);
  deepStrictEqual(await Array.fromAsync(memory.list()), [
    {
      key: ["b"],
      value: 2,
    },
  ]);
  await memory.deleteMany([["b"], ["missing"]]);
  deepStrictEqual(await Array.fromAsync(memory.list()), []);
});

test("MemoryKvStore validates whole batches before mutation", async () => {
  const store = new MemoryKvStore();
  await store.setMany([
    { key: ["a"], value: 1 },
    { key: ["b"], value: 2 },
  ]);
  const invalidTtl = { ttl: Temporal.Duration.from({ months: 1 }) };
  await rejects(
    store.setMany([
      { key: ["a"], value: 3 },
      { key: ["b"], value: 4, options: invalidTtl },
    ]),
    RangeError,
  );
  await rejects(
    store.casMany([
      { key: ["a"], expectedValue: 1, newValue: 3 },
      { key: ["b"], expectedValue: 2, newValue: 4, options: invalidTtl },
    ]),
    RangeError,
  );
  for (const duplicate of [["a"], ["a"]] as const) {
    await rejects(
      store.setMany([
        { key: ["a"], value: 3 },
        { key: duplicate, value: 4 },
      ]),
      TypeError,
    );
  }
  await rejects(store.deleteMany([["a"], ["a"]]), TypeError);
  await rejects(
    store.casMany([
      { key: ["a"], expectedValue: 1, newValue: 3 },
      { key: ["a"], expectedValue: 1, newValue: 4 },
    ]),
    TypeError,
  );
  await rejects(store.set(["a"], undefined), TypeError);
  await rejects(
    store.setMany([
      { key: ["a"], value: 3 },
      { key: ["b"], value: undefined },
    ]),
    TypeError,
  );
  const ttl = { ttl: Temporal.Duration.from({ seconds: 1 }) };
  await rejects(store.cas(["a"], "wrong", undefined, ttl), TypeError);
  await rejects(
    store.casMany([
      { key: ["a"], expectedValue: "wrong", newValue: 3 },
      { key: ["b"], expectedValue: 2, newValue: undefined, options: ttl },
    ]),
    TypeError,
  );
  await rejects(store.set(["a"], 3, invalidTtl), RangeError);
  await rejects(store.cas(["a"], 1, 3, invalidTtl), RangeError);
  const invalidKey = [] as unknown as KvKey;
  await rejects(store.get(invalidKey), TypeError);
  await rejects(store.delete(invalidKey), TypeError);
  await rejects(store.deleteMany([["a"], invalidKey]), TypeError);
  deepStrictEqual(await store.getMany([["a"], ["b"]]), [1, 2]);
  strictEqual(await store.cas(["a"], 1, undefined, {}), true);
});

test("MemoryKvStore atomic expiry and stale iterator reclamation", async () => {
  const store = new MemoryKvStore();
  const expired = { ttl: Temporal.Duration.from({ seconds: -1 }) };
  await store.setMany([
    { key: ["first"], value: "yield" },
    { key: ["expired"], value: "old", options: expired },
  ]);
  const iterator = store.list()[Symbol.asyncIterator]();
  strictEqual((await iterator.next()).value?.value, "yield");
  strictEqual(await store.cas(["expired"], undefined, "committed"), true);
  await iterator.next();
  strictEqual(await store.get(["expired"]), "committed");
  strictEqual(
    await store.casMany([
      {
        key: ["zero"],
        expectedValue: undefined,
        newValue: "temporary",
        options: { ttl: Temporal.Duration.from({ seconds: 0 }) },
      },
    ]),
    true,
  );
  deepStrictEqual(await store.getMany([["zero"], ["zero"]]), [
    undefined,
    undefined,
  ]);
  await store.set(["expiry"], "old", {
    ttl: Temporal.Duration.from({ milliseconds: 500 }),
  });
  strictEqual(
    await store.casMany([
      { key: ["expiry"], expectedValue: "old", newValue: "new" },
      { key: ["missing"], expectedValue: true, newValue: true },
    ]),
    false,
  );
  strictEqual(await store.get(["expiry"]), "old");
  await new Promise((resolve) => setTimeout(resolve, 1000));
  strictEqual(await store.get(["expiry"]), undefined);
  await store.set(["reset"], "old", expired);
  strictEqual(await store.cas(["reset"], undefined, "persistent"), true);
  strictEqual(await store.get(["reset"]), "persistent");
});

test("MemoryKvStore snapshots and CAS serialize competing calls", async () => {
  const store = new MemoryKvStore();
  const winners = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      store.casMany([
        { key: ["a"], expectedValue: undefined, newValue: i },
        { key: ["b"], expectedValue: undefined, newValue: i },
      ]),
    ),
  );
  strictEqual(winners.filter(Boolean).length, 1);
  for (let i = 0; i < 30; i++) {
    const [, snapshot] = await Promise.all([
      store.setMany([
        { key: ["a"], value: i },
        { key: ["b"], value: i },
      ]),
      store.getMany([["a"], ["b"], ["a"]]),
    ]);
    strictEqual(snapshot[0], snapshot[1]);
    strictEqual(snapshot[0], snapshot[2]);
  }
  await store.set(["object"], { a: 1, b: [2] });
  strictEqual(await store.cas(["object"], { b: [2], a: 1 }, true), true);
});

test("MemoryKvStore private primitives preserve subclass instrumentation", async () => {
  class Instrumented extends MemoryKvStore {
    calls = 0;
    override async cas(
      ...args: Parameters<MemoryKvStore["cas"]>
    ): Promise<boolean> {
      this.calls++;
      return await super.cas(...args);
    }
  }
  const store = new Instrumented();
  await store.setMany([{ key: ["key"], value: 1 }]);
  await store.casMany([{ key: ["key"], expectedValue: 1, newValue: 2 }]);
  strictEqual(store.calls, 0);
  strictEqual(await store.cas(["key"], 2, 3), true);
  strictEqual(store.calls, 1);
});
