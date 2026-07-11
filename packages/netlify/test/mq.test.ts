import "temporal-polyfill/global";
import {
  type KvKey,
  type KvStore,
  type KvStoreListEntry,
  type KvStoreSetOptions,
  MemoryKvStore,
  type Message,
} from "@fedify/fedify/federation";
import * as temporal from "@js-temporal/polyfill";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type NetlifyAsyncWorkloadsClient,
  NetlifyMessageQueue,
  NetlifyMessageQueueSendError,
  type NetlifyQueueEventData,
} from "../src/mod.ts";

const Temporal = globalThis.Temporal ?? temporal.Temporal;

interface SendCall {
  readonly eventName: string;
  readonly options?: {
    readonly data?: NetlifyQueueEventData;
    readonly delayUntil?: number | string;
    readonly priority?: number;
  };
}

class FakeClient implements NetlifyAsyncWorkloadsClient {
  readonly calls: SendCall[] = [];
  readonly results: ("succeeded" | "failed" | Error)[] = [];

  send(
    eventName: string,
    options?: SendCall["options"],
  ): Promise<{
    readonly sendStatus: "succeeded" | "failed";
    readonly eventId: string;
  }> {
    this.calls.push({ eventName, options });
    const result = this.results.shift() ?? "succeeded";
    if (result instanceof Error) return Promise.reject(result);
    return Promise.resolve({
      eventId: `event-${this.calls.length}`,
      sendStatus: result,
    });
  }
}

class NoCasKvStore implements KvStore {
  readonly #store = new MemoryKvStore();

  get<T = unknown>(key: KvKey): Promise<T | undefined> {
    return this.#store.get<T>(key);
  }

  set(
    key: KvKey,
    value: unknown,
    options?: KvStoreSetOptions,
  ): Promise<void> {
    return this.#store.set(key, value, options);
  }

  delete(key: KvKey): Promise<void> {
    return this.#store.delete(key);
  }

  list(prefix?: KvKey): AsyncIterable<KvStoreListEntry> {
    return this.#store.list(prefix);
  }
}

const message: Message = {
  type: "task",
  id: crypto.randomUUID(),
  baseUrl: "https://example.com/",
  taskName: "example",
  data: "[]",
  started: new Date(0).toISOString(),
  attempt: 0,
  traceContext: {},
};

describe("NetlifyMessageQueue", () => {
  it("sends the default event envelope", async () => {
    const client = new FakeClient();
    const queue = new NetlifyMessageQueue({ client });

    await queue.enqueue(message);

    assert.equal(queue.eventName, "fedify:queue");
    assert.equal(queue.nativeRetrial, true);
    assert.equal(queue.nativeDeduplication, false);
    assert.equal(queue.atomicEnqueueMany, false);
    assert.deepEqual(client.calls, [{
      eventName: "fedify:queue",
      options: {
        data: {
          message,
          orderingKey: undefined,
          orderingSequence: undefined,
        },
      },
    }]);
  });

  it("supports custom event names, delays, and ordering keys", async () => {
    const client = new FakeClient();
    const queue = new NetlifyMessageQueue({
      client,
      eventName: "fedify:outbox",
      orderingKv: new MemoryKvStore(),
    });
    const before = Date.now();

    await queue.enqueue(message, {
      delay: Temporal.Duration.from({ seconds: 5 }),
      orderingKey: "actor:alice",
    });

    const delayUntil = client.calls[0].options?.delayUntil;
    assert.equal(typeof delayUntil, "number");
    assert.ok((delayUntil as number) >= before + 5_000);
    assert.ok((delayUntil as number) <= Date.now() + 5_000);
    assert.deepEqual(client.calls[0].options?.data, {
      message,
      orderingKey: "actor:alice",
      orderingSequence: 1,
    });
    assert.equal(client.calls[0].eventName, "fedify:outbox");
  });

  it("assigns monotonically increasing ordering sequences", async () => {
    const client = new FakeClient();
    const queue = new NetlifyMessageQueue({
      client,
      orderingKv: new MemoryKvStore(),
    });

    await queue.enqueue(message, { orderingKey: "actor:alice" });
    await queue.enqueue(message, { orderingKey: "actor:alice" });
    await queue.enqueue(message, { orderingKey: "actor:bob" });

    assert.deepEqual(
      client.calls.map((call) => call.options?.data?.orderingSequence),
      [1, 2, 1],
    );
  });

  it("preserves input order in an ordered enqueueMany call", async () => {
    const client = new FakeClient();
    const queue = new NetlifyMessageQueue({
      client,
      orderingKv: new MemoryKvStore(),
    });
    const messages: Message[] = [message, message, message].map((item) => ({
      ...item,
      id: crypto.randomUUID(),
    }));

    await queue.enqueueMany(messages, { orderingKey: "actor:alice" });

    assert.deepEqual(
      client.calls.map((call) => ({
        message: call.options?.data?.message,
        sequence: call.options?.data?.orderingSequence,
      })),
      [
        { message: messages[0], sequence: 1 },
        { message: messages[1], sequence: 2 },
        { message: messages[2], sequence: 3 },
      ],
    );
  });

  it("does not reserve a sequence for an invalid delayed enqueue", async () => {
    const client = new FakeClient();
    const queue = new NetlifyMessageQueue({
      client,
      orderingKv: new MemoryKvStore(),
    });

    await assert.rejects(
      queue.enqueue(message, {
        delay: Temporal.Duration.from({ seconds: -1 }),
        orderingKey: "actor:alice",
      }),
      RangeError,
    );
    await queue.enqueue(message, { orderingKey: "actor:alice" });

    assert.equal(client.calls[0].options?.data?.orderingSequence, 1);
  });

  it("rejects unsuccessful sends", async () => {
    const client = new FakeClient();
    client.results.push("failed");
    const queue = new NetlifyMessageQueue({ client });

    await assert.rejects(
      queue.enqueue(message),
      /event-1.*fedify:queue|fedify:queue.*event-1/,
    );
  });

  it("propagates client errors", async () => {
    const client = new FakeClient();
    const failure = new Error("network unavailable");
    client.results.push(failure);
    const queue = new NetlifyMessageQueue({ client });

    await assert.rejects(
      queue.enqueue(message),
      (error: unknown) => {
        assert.ok(error instanceof NetlifyMessageQueueSendError);
        assert.equal(error.cause, failure);
        assert.equal(error.orderingSequence, undefined);
        return true;
      },
    );
  });

  it("sends many messages concurrently and propagates failures", async () => {
    const client = new FakeClient();
    client.results.push("succeeded", "failed", "succeeded");
    const queue = new NetlifyMessageQueue({ client });

    await assert.rejects(
      queue.enqueueMany([message, message, message]),
      /event-2.*fedify:queue|fedify:queue.*event-2/,
    );
    assert.equal(client.calls.length, 3);
  });

  it("rejects ordering keys without a CAS-capable store", async () => {
    const client = new FakeClient();
    const queue = new NetlifyMessageQueue({
      client,
      orderingKv: new NoCasKvStore(),
    });

    await assert.rejects(
      queue.enqueue(message, { orderingKey: "actor:alice" }),
      /orderingKey.*cas\(\)/,
    );
    assert.equal(client.calls.length, 0);
  });

  it("rejects empty event names", () => {
    assert.throws(
      () =>
        new NetlifyMessageQueue({ client: new FakeClient(), eventName: "" }),
      TypeError,
    );
  });

  it("does not support listen()", () => {
    const queue = new NetlifyMessageQueue({ client: new FakeClient() });
    assert.throws(
      () => queue.listen(() => undefined),
      /createNetlifyQueueHandler\(\)/,
    );
  });
});
