import "temporal-polyfill/global";
import type {
  Federation,
  KvKey,
  KvStoreSetOptions,
  Message,
} from "@fedify/fedify/federation";
import { MemoryKvStore } from "@fedify/fedify/federation";
import {
  type AsyncWorkloadEvent,
  ErrorDoNotRetry,
} from "@netlify/async-workloads";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createNetlifyQueueEventHandler,
  createNetlifyQueueHandlerWith,
  type NetlifyQueueEvent,
} from "../src/handler.ts";
import {
  NetlifyMessageQueue,
  NetlifyMessageQueueSendError,
} from "../src/mq.ts";
import type { NetlifyAsyncWorkloadsClient } from "../src/types.ts";

const client: NetlifyAsyncWorkloadsClient = {
  send: () => Promise.resolve({ eventId: "unused", sendStatus: "succeeded" }),
};

class FailSecondCasKvStore extends MemoryKvStore {
  readonly failure = new Error("ordering state unavailable");
  #casCalls = 0;

  override cas(
    key: KvKey,
    expectedValue: unknown,
    newValue: unknown,
    options?: KvStoreSetOptions,
  ): Promise<boolean> {
    this.#casCalls++;
    if (this.#casCalls === 2) return Promise.reject(this.failure);
    return super.cas(key, expectedValue, newValue, options);
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

function event(
  eventData: unknown = { message },
  sleep: (reasonId: string, sleepMs: number | string) => Promise<void> = () =>
    Promise.resolve(),
): AsyncWorkloadEvent<NetlifyQueueEvent> {
  return {
    eventName: "fedify:queue",
    eventData,
    eventId: crypto.randomUUID(),
    request: new Request("https://example.net/.netlify/functions/queue", {
      headers: { "x-nf-deploy-id": "deploy-1" },
    }),
    attempt: 0,
    step: {
      run: (_id, callback) => Promise.resolve(callback()),
      sleep,
    },
    sendEvent: () =>
      Promise.resolve({ eventId: "nested", sendStatus: "succeeded" }),
  } as AsyncWorkloadEvent<NetlifyQueueEvent>;
}

function federation(
  processQueuedTask: (contextData: unknown, queued: Message) => Promise<void>,
): Federation<unknown> {
  return { processQueuedTask } as Federation<unknown>;
}

describe("createNetlifyQueueHandler", () => {
  it("builds the federation for each event and processes its message", async () => {
    const queue = new NetlifyMessageQueue({ client });
    const processed: Array<{ contextData: unknown; message: Message }> = [];
    const factoryEvents: AsyncWorkloadEvent<NetlifyQueueEvent>[] = [];
    const contextEvents: AsyncWorkloadEvent<NetlifyQueueEvent>[] = [];
    const handler = createNetlifyQueueEventHandler({
      queue,
      federation: (received) => {
        factoryEvents.push(received);
        return federation((contextData, queued) => {
          processed.push({ contextData, message: queued });
          return Promise.resolve();
        });
      },
      contextData: (received) => {
        contextEvents.push(received);
        return { deployId: received.request.headers.get("x-nf-deploy-id") };
      },
    });
    const first = event();
    const second = event();

    await handler(first);
    await handler(second);

    assert.deepEqual(factoryEvents, [first, second]);
    assert.deepEqual(contextEvents, [first, second]);
    assert.deepEqual(processed, [
      { contextData: { deployId: "deploy-1" }, message },
      { contextData: { deployId: "deploy-1" }, message },
    ]);
  });

  it("propagates transient processing errors", async () => {
    const failure = new Error("database unavailable");
    const handler = createNetlifyQueueEventHandler({
      queue: new NetlifyMessageQueue({ client }),
      federation: () => federation(() => Promise.reject(failure)),
    });

    await assert.rejects(handler(event()), failure);
  });

  for (
    const malformed of [
      null,
      {},
      { message: null },
      { message: {} },
      { message: { ...message, type: "unknown" } },
      { message, orderingKey: 42 },
      { message, orderingKey: "" },
      { message, orderingKey: "actor:alice" },
      { message, orderingSequence: 1 },
    ]
  ) {
    it(`does not retry malformed data: ${JSON.stringify(malformed)}`, async () => {
      const handler = createNetlifyQueueEventHandler({
        queue: new NetlifyMessageQueue({ client }),
        federation: () => federation(() => Promise.resolve()),
      });

      await assert.rejects(handler(event(malformed)), ErrorDoNotRetry);
    });
  }

  it("releases an ordered sequence for a malformed message", async () => {
    const kv = new MemoryKvStore();
    const sent: NetlifyQueueEvent["eventData"][] = [];
    const orderingClient: NetlifyAsyncWorkloadsClient = {
      send: (_eventName, options) => {
        sent.push(options?.data as NetlifyQueueEvent["eventData"]);
        return Promise.resolve({
          eventId: `event-${sent.length}`,
          sendStatus: "succeeded",
        });
      },
    };
    const queue = new NetlifyMessageQueue({
      client: orderingClient,
      orderingKv: kv,
    });
    await queue.enqueue(message, { orderingKey: "actor:alice" });
    await queue.enqueue(message, { orderingKey: "actor:alice" });
    const processed: number[] = [];
    const handler = createNetlifyQueueEventHandler({
      queue,
      federation: (received) =>
        federation(() => {
          processed.push(received.eventData.orderingSequence!);
          return Promise.resolve();
        }),
    });

    await assert.rejects(
      handler(event({
        ...sent[0],
        message: { ...message, type: "unknown" },
      })),
      ErrorDoNotRetry,
    );
    await handler(event(sent[1], () => {
      throw new Error("The second sequence should not need to wait.");
    }));

    assert.deepEqual(processed, [2]);
  });

  it("processes later arrivals in their reserved FIFO order", async () => {
    const kv = new MemoryKvStore();
    const sent: NetlifyQueueEvent["eventData"][] = [];
    const orderingClient: NetlifyAsyncWorkloadsClient = {
      send: (_eventName, options) => {
        sent.push(options?.data as NetlifyQueueEvent["eventData"]);
        return Promise.resolve({
          eventId: `event-${sent.length}`,
          sendStatus: "succeeded",
        });
      },
    };
    const orderedQueue = new NetlifyMessageQueue({
      client: orderingClient,
      orderingKv: kv,
      orderingRetryDelay: { milliseconds: 1 },
    });
    await orderedQueue.enqueue(message, { orderingKey: "actor:alice" });
    await orderedQueue.enqueue(message, { orderingKey: "actor:alice" });

    const processed: number[] = [];
    const handler = createNetlifyQueueEventHandler({
      queue: orderedQueue,
      federation: (received) =>
        federation(async () => {
          processed.push(received.eventData.orderingSequence!);
          if (received.eventData.orderingSequence === 1) {
            await new Promise((resolve) => setTimeout(resolve, 5));
          }
        }),
    });
    let releaseWait!: () => void;
    let waiting = false;
    const wait = new Promise<void>((resolve) => {
      releaseWait = resolve;
    });
    const second = handler(event(sent[1], async () => {
      waiting = true;
      await wait;
    }));
    while (!waiting) await new Promise((resolve) => setTimeout(resolve, 0));

    await handler(event(sent[0]));
    releaseWait();
    await second;

    assert.deepEqual(processed, [1, 2]);
  });

  it("keeps a later sequence waiting for a long-running task", async () => {
    const kv = new MemoryKvStore();
    const sent: NetlifyQueueEvent["eventData"][] = [];
    const orderingClient: NetlifyAsyncWorkloadsClient = {
      send: (_eventName, options) => {
        sent.push(options?.data as NetlifyQueueEvent["eventData"]);
        return Promise.resolve({
          eventId: `event-${sent.length}`,
          sendStatus: "succeeded",
        });
      },
    };
    const queue = new NetlifyMessageQueue({
      client: orderingClient,
      orderingKv: kv,
      orderingRetryDelay: { milliseconds: 1 },
    });
    await queue.enqueue(message, { orderingKey: "actor:alice" });
    await queue.enqueue(message, { orderingKey: "actor:alice" });

    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let releaseWait!: () => void;
    const waitGate = new Promise<void>((resolve) => {
      releaseWait = resolve;
    });
    let secondWaiting = false;
    const active = new Set<number>();
    let overlapped = false;
    const handler = createNetlifyQueueEventHandler({
      queue,
      federation: (received) =>
        federation(async () => {
          const sequence = received.eventData.orderingSequence!;
          if (active.size > 0) overlapped = true;
          active.add(sequence);
          if (sequence === 1) await firstGate;
          active.delete(sequence);
        }),
    });

    const first = handler(event(sent[0]));
    while (active.size === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const second = handler(event(sent[1], async () => {
      secondWaiting = true;
      await waitGate;
    }));
    while (!secondWaiting) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    assert.deepEqual([...active], [1]);

    releaseFirst();
    await first;
    releaseWait();
    await second;

    assert.equal(overlapped, false);
  });

  it("does not rerun a task when ordering completion is retried", async () => {
    const kv = new FailSecondCasKvStore();
    let sent: NetlifyQueueEvent["eventData"] | undefined;
    const queue = new NetlifyMessageQueue({
      client: {
        send: (_eventName, options) => {
          sent = options?.data as NetlifyQueueEvent["eventData"];
          return Promise.resolve({
            eventId: "event-1",
            sendStatus: "succeeded",
          });
        },
      },
      orderingKv: kv,
    });
    await queue.enqueue(message, { orderingKey: "actor:alice" });

    let processed = 0;
    const handler = createNetlifyQueueEventHandler({
      queue,
      federation: () =>
        federation(() => {
          processed++;
          return Promise.resolve();
        }),
    });
    const workload = event(sent);
    const stepResults = new Map<string, unknown>();
    workload.step.run = async <T>(
      stepId: string,
      callback: () => Promise<T> | T,
    ): Promise<T> => {
      if (stepResults.has(stepId)) return stepResults.get(stepId) as T;
      const result = await callback();
      stepResults.set(stepId, result);
      return result;
    };

    await assert.rejects(handler(workload), kv.failure);
    await handler(workload);

    assert.equal(processed, 1);
  });

  it("waits with durable sleep instead of consuming failure retries", async () => {
    const kv = new MemoryKvStore();
    const sent: NetlifyQueueEvent["eventData"][] = [];
    const orderingClient: NetlifyAsyncWorkloadsClient = {
      send: (_eventName, options) => {
        sent.push(options?.data as NetlifyQueueEvent["eventData"]);
        return Promise.resolve({
          eventId: `event-${sent.length}`,
          sendStatus: "succeeded",
        });
      },
    };
    const queue = new NetlifyMessageQueue({
      client: orderingClient,
      orderingKv: kv,
      orderingRetryDelay: { seconds: 7 },
    });
    await queue.enqueue(message, { orderingKey: "actor:alice" });
    await queue.enqueue(message, { orderingKey: "actor:alice" });
    const sleeps: Array<{ reasonId: string; sleepMs: number | string }> = [];
    let releaseWait!: () => void;
    const wait = new Promise<void>((resolve) => {
      releaseWait = resolve;
    });
    const handler = createNetlifyQueueEventHandler({
      queue,
      federation: () => federation(() => Promise.resolve()),
    });
    const secondEvent = event(sent[1], async (reasonId, sleepMs) => {
      sleeps.push({ reasonId, sleepMs });
      await wait;
    });
    Object.assign(secondEvent, { attempt: 999 });
    const second = handler(secondEvent);
    while (sleeps.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    await handler(event(sent[0]));
    releaseWait();
    await second;

    assert.deepEqual(sleeps, [{
      reasonId: "fedify-ordering-wait-0",
      sleepMs: 7_000,
    }]);
  });

  it("advances ordering after the last configured processing attempt", async () => {
    const kv = new MemoryKvStore();
    const sent: NetlifyQueueEvent["eventData"][] = [];
    const orderingClient: NetlifyAsyncWorkloadsClient = {
      send: (_eventName, options) => {
        sent.push(options?.data as NetlifyQueueEvent["eventData"]);
        return Promise.resolve({
          eventId: `event-${sent.length}`,
          sendStatus: "succeeded",
        });
      },
    };
    const queue = new NetlifyMessageQueue({
      client: orderingClient,
      orderingKv: kv,
    });
    await queue.enqueue(message, { orderingKey: "actor:alice" });
    await queue.enqueue(message, { orderingKey: "actor:alice" });
    const processed: number[] = [];
    const failure = new Error("permanent failure");
    const handler = createNetlifyQueueEventHandler({
      queue,
      maxRetries: 2,
      federation: (received) =>
        federation(() => {
          const sequence = received.eventData.orderingSequence!;
          processed.push(sequence);
          return sequence === 1 ? Promise.reject(failure) : Promise.resolve();
        }),
    });
    const first = event(sent[0]);
    Object.assign(first, { attempt: 2 });

    await assert.rejects(handler(first), failure);
    await handler(event(sent[1], () => {
      throw new Error("The second sequence should not need to wait.");
    }));

    assert.deepEqual(processed, [1, 2]);
  });

  it("allows an operator to skip an unobservable dead-lettered sequence", async () => {
    const kv = new MemoryKvStore();
    const sent: NetlifyQueueEvent["eventData"][] = [];
    const orderingClient: NetlifyAsyncWorkloadsClient = {
      send: (_eventName, options) => {
        sent.push(options?.data as NetlifyQueueEvent["eventData"]);
        return Promise.resolve({
          eventId: `event-${sent.length}`,
          sendStatus: "succeeded",
        });
      },
    };
    const queue = new NetlifyMessageQueue({
      client: orderingClient,
      orderingKv: kv,
    });
    await queue.enqueue(message, { orderingKey: "actor:alice" });
    await queue.enqueue(message, { orderingKey: "actor:alice" });

    await queue.skipOrderingSequence("actor:alice", 1);
    let processed = false;
    const handler = createNetlifyQueueEventHandler({
      queue,
      federation: () =>
        federation(() => {
          processed = true;
          return Promise.resolve();
        }),
    });
    await handler(event(sent[1], () => {
      throw new Error("The recovered sequence should not need to wait.");
    }));

    assert.equal(processed, true);
  });

  it("keeps a failed send sequence until an operator skips it", async () => {
    const kv = new MemoryKvStore();
    let call = 0;
    let sent: NetlifyQueueEvent["eventData"] | undefined;
    const orderingClient: NetlifyAsyncWorkloadsClient = {
      send: (_eventName, options) => {
        call++;
        if (call === 1) {
          return Promise.resolve({ eventId: "failed", sendStatus: "failed" });
        }
        sent = options?.data as NetlifyQueueEvent["eventData"];
        return Promise.resolve({ eventId: "sent", sendStatus: "succeeded" });
      },
    };
    const queue = new NetlifyMessageQueue({
      client: orderingClient,
      orderingKv: kv,
    });
    await assert.rejects(
      queue.enqueue(message, { orderingKey: "actor:alice" }),
      (error: unknown) => {
        assert.ok(error instanceof NetlifyMessageQueueSendError);
        assert.equal(error.eventId, "failed");
        assert.equal(error.orderingKey, "actor:alice");
        assert.equal(error.orderingSequence, 1);
        return true;
      },
    );
    await queue.enqueue(message, { orderingKey: "actor:alice" });
    let processed = false;
    let waiting = false;
    let releaseWait!: () => void;
    const wait = new Promise<void>((resolve) => {
      releaseWait = resolve;
    });
    const handler = createNetlifyQueueEventHandler({
      queue,
      federation: () =>
        federation(() => {
          processed = true;
          return Promise.resolve();
        }),
    });

    const processing = handler(event(sent, async () => {
      waiting = true;
      await wait;
    }));
    while (!waiting) await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(processed, false);

    await queue.skipOrderingSequence("actor:alice", 1);
    releaseWait();
    await processing;

    assert.equal(sent?.orderingSequence, 2);
    assert.equal(processed, true);
  });

  it("rejects ordered events when CAS support is unavailable", async () => {
    const queue = new NetlifyMessageQueue({ client });
    const handler = createNetlifyQueueEventHandler({
      queue,
      federation: () => federation(() => Promise.resolve()),
    });

    await assert.rejects(
      handler(event({
        message,
        orderingKey: "actor:alice",
        orderingSequence: 1,
      })),
      /orderingKey.*cas\(\)/,
    );
  });

  it("wraps the event handler with asyncWorkloadFn", () => {
    const sentinel = () => Promise.resolve(new Response("ok"));
    let wrapped: unknown;
    const result = createNetlifyQueueHandlerWith(
      (handler) => {
        wrapped = handler;
        return sentinel;
      },
      {
        queue: new NetlifyMessageQueue({ client }),
        federation: () => federation(() => Promise.resolve()),
      },
    );

    assert.equal(typeof wrapped, "function");
    assert.equal(result, sentinel);
  });
});
