import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { WorkersMessageQueue } from "../src/mod.ts";

// Mock Temporal.Duration for testing in Cloudflare Workers environment
const mockDuration = (seconds: number) => ({
  total: (unit: string) => {
    if (unit === "milliseconds" || unit === "millisecond") return seconds * 1000;
    if (unit === "seconds" || unit === "second") return seconds;
    return seconds;
  },
});

describe("WorkersMessageQueue", () => {
  it("enqueue() sends message to queue", async () => {
    const sendSpy = vi
      .spyOn(env.Q1, "send")
      .mockImplementation(async () => {});

    const queue = new WorkersMessageQueue(env.Q1);
    await queue.enqueue({ foo: 1, bar: 2 });

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith(
      {
        __fedify_ordering_key__: undefined,
        __fedify_payload__: { foo: 1, bar: 2 },
      },
      { contentType: "json", delaySeconds: 0 },
    );

    sendSpy.mockRestore();
  });

  it("enqueue() with delay", async () => {
    const sendSpy = vi
      .spyOn(env.Q1, "send")
      .mockImplementation(async () => {});

    const queue = new WorkersMessageQueue(env.Q1);
    await queue.enqueue(
      { baz: 3, qux: 4 },
      { delay: mockDuration(5) as unknown as Temporal.Duration },
    );

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith(
      {
        __fedify_ordering_key__: undefined,
        __fedify_payload__: { baz: 3, qux: 4 },
      },
      { contentType: "json", delaySeconds: 5 },
    );

    sendSpy.mockRestore();
  });

  it("enqueue() with ordering key", async () => {
    const sendSpy = vi
      .spyOn(env.Q1, "send")
      .mockImplementation(async () => {});

    const queue = new WorkersMessageQueue(env.Q1);
    await queue.enqueue({ foo: 1 }, { orderingKey: "test-key" });

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith(
      {
        __fedify_ordering_key__: "test-key",
        __fedify_payload__: { foo: 1 },
      },
      { contentType: "json", delaySeconds: 0 },
    );

    sendSpy.mockRestore();
  });

  it("enqueueMany() sends batch of messages", async () => {
    const sendBatchSpy = vi
      .spyOn(env.Q1, "sendBatch")
      .mockImplementation(async () => {});

    const queue = new WorkersMessageQueue(env.Q1);
    await queue.enqueueMany([{ a: 1 }, { b: 2 }, { c: 3 }]);

    expect(sendBatchSpy).toHaveBeenCalledTimes(1);
    expect(sendBatchSpy).toHaveBeenCalledWith(
      [
        {
          body: { __fedify_ordering_key__: undefined, __fedify_payload__: { a: 1 } },
          contentType: "json",
        },
        {
          body: { __fedify_ordering_key__: undefined, __fedify_payload__: { b: 2 } },
          contentType: "json",
        },
        {
          body: { __fedify_ordering_key__: undefined, __fedify_payload__: { c: 3 } },
          contentType: "json",
        },
      ],
      { delaySeconds: 0 },
    );

    sendBatchSpy.mockRestore();
  });

  it("enqueueMany() with ordering key", async () => {
    const sendBatchSpy = vi
      .spyOn(env.Q1, "sendBatch")
      .mockImplementation(async () => {});

    const queue = new WorkersMessageQueue(env.Q1);
    await queue.enqueueMany([{ a: 1 }, { b: 2 }], { orderingKey: "batch-key" });

    expect(sendBatchSpy).toHaveBeenCalledTimes(1);
    expect(sendBatchSpy).toHaveBeenCalledWith(
      [
        {
          body: { __fedify_ordering_key__: "batch-key", __fedify_payload__: { a: 1 } },
          contentType: "json",
        },
        {
          body: { __fedify_ordering_key__: "batch-key", __fedify_payload__: { b: 2 } },
          contentType: "json",
        },
      ],
      { delaySeconds: 0 },
    );

    sendBatchSpy.mockRestore();
  });

  it("listen() throws TypeError", () => {
    const queue = new WorkersMessageQueue(env.Q1);
    expect(() => queue.listen(() => {})).toThrow(TypeError);
    expect(() => queue.listen(() => {})).toThrow(
      "WorkersMessageQueue does not support listen()",
    );
  });

  it("nativeRetrial is true", () => {
    const queue = new WorkersMessageQueue(env.Q1);
    expect(queue.nativeRetrial).toBe(true);
  });

  describe("processMessage()", () => {
    it("processes message without ordering key", async () => {
      const queue = new WorkersMessageQueue(env.Q1);
      const result = await queue.processMessage({
        __fedify_payload__: { data: "test" },
      });

      expect(result.shouldProcess).toBe(true);
      expect(result.message).toEqual({ data: "test" });
      expect(result.release).toBeUndefined();
    });

    it("processes unwrapped message for backwards compatibility", async () => {
      const queue = new WorkersMessageQueue(env.Q1);
      const result = await queue.processMessage({ data: "legacy" });

      expect(result.shouldProcess).toBe(true);
      expect(result.message).toEqual({ data: "legacy" });
      expect(result.release).toBeUndefined();
    });

    it("processes message with ordering key when KV not configured", async () => {
      const queue = new WorkersMessageQueue(env.Q1);
      const result = await queue.processMessage({
        __fedify_ordering_key__: "key1",
        __fedify_payload__: { data: "test" },
      });

      expect(result.shouldProcess).toBe(true);
      expect(result.message).toEqual({ data: "test" });
      expect(result.release).toBeUndefined();
    });

    it("acquires lock and processes message with ordering key", async () => {
      const getSpy = vi.spyOn(env.KV1, "get").mockResolvedValue(null);
      const putSpy = vi.spyOn(env.KV1, "put").mockResolvedValue(undefined);
      const deleteSpy = vi.spyOn(env.KV1, "delete").mockResolvedValue(undefined);

      const queue = new WorkersMessageQueue(env.Q1, { orderingKv: env.KV1 });
      const result = await queue.processMessage({
        __fedify_ordering_key__: "key1",
        __fedify_payload__: { data: "test" },
      });

      expect(result.shouldProcess).toBe(true);
      expect(result.message).toEqual({ data: "test" });
      expect(result.release).toBeDefined();

      expect(getSpy).toHaveBeenCalledWith("__fedify_ordering_key1");
      expect(putSpy).toHaveBeenCalledWith(
        "__fedify_ordering_key1",
        expect.any(String),
        { expirationTtl: 60 },
      );

      // Release the lock
      await result.release!();
      expect(deleteSpy).toHaveBeenCalledWith("__fedify_ordering_key1");

      getSpy.mockRestore();
      putSpy.mockRestore();
      deleteSpy.mockRestore();
    });

    it("returns shouldProcess=false when lock exists", async () => {
      const getSpy = vi.spyOn(env.KV1, "get").mockResolvedValue("locked");

      const queue = new WorkersMessageQueue(env.Q1, { orderingKv: env.KV1 });
      const result = await queue.processMessage({
        __fedify_ordering_key__: "key1",
        __fedify_payload__: { data: "test" },
      });

      expect(result.shouldProcess).toBe(false);
      expect(result.message).toBeUndefined();
      expect(result.release).toBeUndefined();

      getSpy.mockRestore();
    });

    it("uses custom ordering key prefix", async () => {
      const getSpy = vi.spyOn(env.KV1, "get").mockResolvedValue(null);
      const putSpy = vi.spyOn(env.KV1, "put").mockResolvedValue(undefined);

      const queue = new WorkersMessageQueue(env.Q1, {
        orderingKv: env.KV1,
        orderingKeyPrefix: "custom_prefix_",
      });
      await queue.processMessage({
        __fedify_ordering_key__: "key1",
        __fedify_payload__: { data: "test" },
      });

      expect(getSpy).toHaveBeenCalledWith("custom_prefix_key1");
      expect(putSpy).toHaveBeenCalledWith(
        "custom_prefix_key1",
        expect.any(String),
        { expirationTtl: 60 },
      );

      getSpy.mockRestore();
      putSpy.mockRestore();
    });

    it("uses custom lock TTL (minimum 60 seconds)", async () => {
      const getSpy = vi.spyOn(env.KV1, "get").mockResolvedValue(null);
      const putSpy = vi.spyOn(env.KV1, "put").mockResolvedValue(undefined);

      const queue = new WorkersMessageQueue(env.Q1, {
        orderingKv: env.KV1,
        orderingLockTtl: 120,
      });
      await queue.processMessage({
        __fedify_ordering_key__: "key1",
        __fedify_payload__: { data: "test" },
      });

      expect(putSpy).toHaveBeenCalledWith(
        "__fedify_ordering_key1",
        expect.any(String),
        { expirationTtl: 120 },
      );

      getSpy.mockRestore();
      putSpy.mockRestore();
    });

    it("enforces minimum 60 second TTL", async () => {
      const getSpy = vi.spyOn(env.KV1, "get").mockResolvedValue(null);
      const putSpy = vi.spyOn(env.KV1, "put").mockResolvedValue(undefined);

      const queue = new WorkersMessageQueue(env.Q1, {
        orderingKv: env.KV1,
        orderingLockTtl: 30, // Below minimum
      });
      await queue.processMessage({
        __fedify_ordering_key__: "key1",
        __fedify_payload__: { data: "test" },
      });

      expect(putSpy).toHaveBeenCalledWith(
        "__fedify_ordering_key1",
        expect.any(String),
        { expirationTtl: 60 }, // Should be enforced to minimum 60
      );

      getSpy.mockRestore();
      putSpy.mockRestore();
    });
  });
});
