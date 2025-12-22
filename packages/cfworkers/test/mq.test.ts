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
      { foo: 1, bar: 2 },
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
      { baz: 3, qux: 4 },
      { contentType: "json", delaySeconds: 5 },
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
        { body: { a: 1 }, contentType: "json" },
        { body: { b: 2 }, contentType: "json" },
        { body: { c: 3 }, contentType: "json" },
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
});
