import { describe, expect, it } from "vitest";
import {
  type WorkersKvNamespaceLike,
  WorkersKvStore,
  WorkersMessageQueue,
} from "./mod.ts";

// Mock Temporal.Duration for testing in Cloudflare Workers environment
const mockDuration = (seconds: number) => ({
  total: (unit: string) => {
    if (unit === "milliseconds" || unit === "millisecond") {
      return seconds * 1000;
    }
    if (unit === "seconds" || unit === "second") return seconds;
    return seconds;
  },
});

interface KvGetWithMetadataResult<Value, Metadata> {
  readonly value: Value | null;
  readonly metadata: Metadata | null;
}

interface KvPutOptions {
  readonly expiration?: number;
  readonly expirationTtl?: number;
  readonly metadata?: unknown;
}

interface KvListOptions {
  readonly limit?: number;
  readonly prefix?: string | null;
  readonly cursor?: string | null;
}

interface KvListResult<Metadata> {
  readonly list_complete: boolean;
  readonly keys: readonly {
    readonly name: string;
    readonly expiration?: number;
    readonly metadata?: Metadata;
  }[];
  readonly cursor?: string;
}

interface StoredEntry {
  readonly value: string;
  readonly metadata: unknown;
  readonly options?: KvPutOptions;
}

class MockKvNamespace implements WorkersKvNamespaceLike {
  readonly entries = new Map<string, StoredEntry>();
  listCalls = 0;
  readonly #pageSize: number;

  constructor(pageSize = Infinity) {
    this.#pageSize = pageSize;
  }

  get(key: string): Promise<string | null>;
  get<ExpectedValue = unknown>(
    key: string,
    type: "json",
  ): Promise<ExpectedValue | null>;
  get(key: string, type?: "json") {
    const entry = this.entries.get(key);
    if (entry == null) return Promise.resolve(null);
    if (type !== "json") return Promise.resolve(entry.value);
    return Promise.resolve(JSON.parse(entry.value));
  }

  getWithMetadata<Metadata = unknown>(
    key: string,
  ): Promise<KvGetWithMetadataResult<string, Metadata>>;
  getWithMetadata<ExpectedValue = unknown, Metadata = unknown>(
    key: string,
    type: "json",
  ): Promise<KvGetWithMetadataResult<ExpectedValue, Metadata>>;
  getWithMetadata(key: string, type?: "json") {
    if (type !== "json") {
      throw new Error(
        "MockKvNamespace only uses the JSON mode of getWithMetadata().",
      );
    }

    const entry = this.entries.get(key);
    if (entry == null) return Promise.resolve({ value: null, metadata: null });
    return Promise.resolve({
      value: JSON.parse(entry.value),
      metadata: entry.metadata,
    });
  }

  put(key: string, value: string, options?: KvPutOptions): Promise<void> {
    this.entries.set(key, {
      value,
      metadata: options?.metadata ?? null,
      options,
    });
    return Promise.resolve();
  }

  delete(key: string) {
    this.entries.delete(key);
    return Promise.resolve();
  }

  list<Metadata = unknown>(
    options?: KvListOptions,
  ): Promise<KvListResult<Metadata>> {
    this.listCalls++;
    const matches = [...this.entries]
      .filter(([name]) => name.startsWith(options?.prefix ?? ""))
      .map(([name, entry]) => ({ name, metadata: entry.metadata as Metadata }));
    const start = options?.cursor == null ? 0 : Number(options.cursor);
    const keys = matches.slice(start, start + this.#pageSize);
    const nextStart = start + keys.length;
    if (nextStart >= matches.length) {
      return Promise.resolve({ list_complete: true, keys });
    }
    return Promise.resolve({
      list_complete: false,
      keys,
      cursor: String(nextStart),
    });
  }
}

describe("WorkersKvStore", () => {
  it("set() & get()", async () => {
    const store = new WorkersKvStore(new MockKvNamespace());

    await store.set(["foo", "bar"], { foo: 1, bar: 2 });

    expect(await store.get(["foo", "bar"])).toEqual({ foo: 1, bar: 2 });
    expect(await store.get(["foo"])).toBeUndefined();
  });

  it("get() - excludes expired entry", async () => {
    const namespace = new MockKvNamespace();
    const store = new WorkersKvStore(namespace);

    namespace.entries.set('["expired"]', {
      value: JSON.stringify("stale"),
      metadata: { expires: Date.now() - 1000 },
    });

    expect(await store.get(["expired"])).toBeUndefined();
  });

  it("get() - includes unexpired entry", async () => {
    const namespace = new MockKvNamespace();
    const store = new WorkersKvStore(namespace);

    namespace.entries.set('["fresh"]', {
      value: JSON.stringify("live"),
      metadata: { expires: Date.now() + 60000 },
    });

    expect(await store.get(["fresh"])).toBe("live");
  });

  it("set() - JSON-encodes key and value", async () => {
    const namespace = new MockKvNamespace();
    const store = new WorkersKvStore(namespace);

    await store.set(["foo", "bar"], { foo: 1 });

    expect(namespace.entries.get('["foo","bar"]')?.value).toBe('{"foo":1}');
  });

  it("set() - overwrites existing value", async () => {
    const namespace = new MockKvNamespace();
    const store = new WorkersKvStore(namespace);

    await store.set(["foo"], "first");
    await store.set(["foo"], "second");

    expect(await store.get(["foo"])).toBe("second");
  });

  it("delete()", async () => {
    const namespace = new MockKvNamespace();
    const store = new WorkersKvStore(namespace);

    await store.set(["delete", "me"], "value");
    await store.delete(["delete", "me"]);

    expect(await store.get(["delete", "me"])).toBeUndefined();
  });

  it("delete() - missing key", async () => {
    const store = new WorkersKvStore(new MockKvNamespace());

    await store.delete(["missing"]);

    expect(await store.get(["missing"])).toBeUndefined();
  });

  it("set() - no TTL omits expirationTtl", async () => {
    const namespace = new MockKvNamespace();
    const store = new WorkersKvStore(namespace);

    await store.set(["no-ttl"], "value");

    const entry = namespace.entries.get('["no-ttl"]');
    expect(entry?.options?.expirationTtl).toBeUndefined();
    expect(entry?.metadata).toEqual({});
  });

  it("set() - TTL over a minute passes through", async () => {
    const namespace = new MockKvNamespace();
    const store = new WorkersKvStore(namespace);

    await store.set(["long-ttl"], "value", {
      ttl: mockDuration(3600) as unknown as Temporal.Duration, // 1 hour
    });

    expect(namespace.entries.get('["long-ttl"]')?.options?.expirationTtl)
      .toBe(3600);
  });

  it("set() - clamps sub-minute TTL to 60 seconds", async () => {
    const namespace = new MockKvNamespace();
    const store = new WorkersKvStore(namespace);

    const before = Date.now();
    await store.set(["short-ttl"], "value", {
      ttl: mockDuration(5) as unknown as Temporal.Duration, // 5 sec,
    });

    const entry = namespace.entries.get('["short-ttl"]');
    expect(entry?.options?.expirationTtl).toBe(60);

    const { expires } = entry?.metadata as { expires: number };
    expect(expires).toBeGreaterThanOrEqual(before + 5000);
    expect(expires).toBeLessThanOrEqual(Date.now() + 5000);
  });

  it("list() - exact prefix key and child keys", async () => {
    const store = new WorkersKvStore(new MockKvNamespace());

    await store.set(["prefix"], "root");
    await store.set(["prefix", "a"], "value-a");
    await store.set(["prefix", "b"], "value-b");
    await store.set(["prefix", "nested", "c"], "value-c");
    await store.set(["other", "x"], "value-x");

    const entries = await Array.fromAsync(store.list(["prefix"]));

    expect(entries).toHaveLength(4);
    expect(entries).toContainEqual({ key: ["prefix"], value: "root" });
    expect(entries).toContainEqual({ key: ["prefix", "a"], value: "value-a" });
    expect(entries).toContainEqual({ key: ["prefix", "b"], value: "value-b" });
    expect(entries).toContainEqual({
      key: ["prefix", "nested", "c"],
      value: "value-c",
    });
  });

  it("list() - no match for sibling string prefix", async () => {
    const store = new WorkersKvStore(new MockKvNamespace());

    await store.set(["prefix", "a"], "value-a");
    await store.set(["prefixextra", "b"], "value-b");

    const entries = await Array.fromAsync(store.list(["prefix"]));

    expect(entries).toEqual([{ key: ["prefix", "a"], value: "value-a" }]);
  });

  it("list() - excludes expired entries", async () => {
    const namespace = new MockKvNamespace();
    const store = new WorkersKvStore(namespace);

    namespace.entries.set('["prefix"]', {
      value: JSON.stringify("stale-root"),
      metadata: { expires: Date.now() - 1000 },
    });
    namespace.entries.set('["prefix","stale"]', {
      value: JSON.stringify("stale-child"),
      metadata: { expires: Date.now() - 1000 },
    });
    await store.set(["prefix", "fresh"], "fresh-child");

    const entries = await Array.fromAsync(store.list(["prefix"]));

    expect(entries).toEqual([
      { key: ["prefix", "fresh"], value: "fresh-child" },
    ]);
  });

  it("list() - follows cursor across pages", async () => {
    const namespace = new MockKvNamespace(2);
    const store = new WorkersKvStore(namespace);

    await store.set(["page", "a"], "value-a");
    await store.set(["page", "b"], "value-b");
    await store.set(["page", "c"], "value-c");
    await store.set(["page", "d"], "value-d");
    await store.set(["page", "e"], "value-e");

    const entries = await Array.fromAsync(store.list(["page"]));

    expect(entries).toHaveLength(5);
    expect(entries).toContainEqual({ key: ["page", "a"], value: "value-a" });
    expect(entries).toContainEqual({ key: ["page", "e"], value: "value-e" });

    expect(namespace.listCalls).toBe(3);
  });
});

describe("WorkersMessageQueue", () => {
  // listen() throws before touching the queue, so no methods are needed.
  const mockQueue = {} as unknown as Queue;

  it("listen() throws TypeError", () => {
    const queue = new WorkersMessageQueue(mockQueue);
    expect(() => queue.listen(() => {})).toThrow(TypeError);
    expect(() => queue.listen(() => {})).toThrow(
      "WorkersMessageQueue does not support listen().  " +
        "Use Federation.processQueuedTask() method instead.",
    );
  });

  it("processMessage() - release() frees the ordering lock", async () => {
    const orderingKv = new MockKvNamespace();
    const queue = new WorkersMessageQueue(mockQueue, { orderingKv });

    const first = await queue.processMessage({
      __fedify_ordering_key__: "actor-1",
      __fedify_payload__: { id: "first" },
    });

    expect(first.shouldProcess).toBe(true);
    expect(first.message).toEqual({ id: "first" });
    expect(orderingKv.entries.has("__fedify_ordering_actor-1")).toBe(true);

    await first.release?.();

    expect(orderingKv.entries.has("__fedify_ordering_actor-1")).toBe(false);

    // Releasing is only meaningful if it lets the next message through, so
    // check the queue actually moves rather than just that the key is gone.
    const second = await queue.processMessage({
      __fedify_ordering_key__: "actor-1",
      __fedify_payload__: { id: "second" },
    });

    expect(second.shouldProcess).toBe(true);
    expect(second.message).toEqual({ id: "second" });
  });

  it("enqueue() sends __fedify_ordering_key__ and __fedify_payload__ to the queue binding", async () => {
    let sentMessage: unknown;

    const queueBinding = {
      send: (message: unknown) => {
        sentMessage = message;
      },
    } as unknown as Queue;

    const queue = new WorkersMessageQueue(queueBinding);

    await queue.enqueue(
      { id: "test-message" },
      { orderingKey: "actor-1" },
    );

    expect(sentMessage).toEqual({
      __fedify_ordering_key__: "actor-1",
      __fedify_payload__: { id: "test-message" },
    });
  });

  it("processMessage() - returns shouldProcess=false when lock exists", async () => {
    const orderingKv = new MockKvNamespace();
    const queue = new WorkersMessageQueue(mockQueue, { orderingKv });

    const first = await queue.processMessage({
      __fedify_ordering_key__: "key1",
      __fedify_payload__: { id: "first" },
    });

    expect(first.shouldProcess).toBe(true);
    expect(first.message).toEqual({ id: "first" });

    const second = await queue.processMessage({
      __fedify_ordering_key__: "key1",
      __fedify_payload__: { id: "second" },
    });

    expect(second.shouldProcess).toBe(false);
    expect(second.message).toBeUndefined();
    expect(second.release).toBeUndefined();
  });
});
