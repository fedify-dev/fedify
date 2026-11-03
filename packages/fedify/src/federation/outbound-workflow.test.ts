import { test } from "@fedify/fixture";
import { Create, Person } from "@fedify/vocab";
import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { rsaPrivateKey2, rsaPublicKey2 } from "../testing/keys.ts";
import { createFederation } from "./middleware.ts";
import { MemoryKvStore } from "./kv.ts";
import type { Message } from "./queue.ts";
import type {
  OutboundAttemptReport,
  OutboundHttpExchangeReport,
  OutboundWorkerReport,
} from "./outbound-report.ts";

test({
  name: "outbound recorder archives real HTTP exchanges across a queued retry",
  // The package Deno suite is offline; focused --allow-all and Node/Bun run it.
  ignore: "Deno" in globalThis &&
    (await Deno.permissions.query({ name: "net" })).state !== "granted",
  async fn() {
    let accepting = false;
    const received: { status: number; activity: unknown }[] = [];
    const receiverErrors: unknown[] = [];
    const server = createServer((request, response) => {
      void (async () => {
        let body = "";
        for await (const chunk of request) body += chunk.toString();
        const status = accepting ? 202 : 503;
        received.push({ status, activity: JSON.parse(body) });
        response.writeHead(status, {
          "Content-Type": "text/plain",
          "Connection": "close",
        });
        response.end(accepting ? "accepted" : "retry later");
      })().catch((error) => {
        receiverErrors.push(error);
        response.writeHead(500);
        response.end();
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const inbox = new URL(
      `http://127.0.0.1:${(server.address() as AddressInfo).port}/inbox`,
    );
    const queued: Message[] = [];
    const attempts: OutboundAttemptReport[] = [];
    const exchanges: OutboundHttpExchangeReport[] = [];
    const workers: OutboundWorkerReport[] = [];
    const archive = new Map<string, Uint8Array[]>();
    const federation = createFederation<void>({
      kv: new MemoryKvStore(),
      allowPrivateAddress: true,
      manuallyStartQueue: true,
      circuitBreaker: false,
      outboxRetryPolicy: () => Temporal.Duration.from({ milliseconds: 0 }),
      queue: {
        outbox: {
          enqueue(message) {
            queued.push(message);
            return Promise.resolve();
          },
          listen: () => Promise.resolve(),
        },
      },
    });
    federation.setOutboundObservers({
      senderPayload: true,
      responseBodyCapture: {
        maxBytes: 4096,
        timeoutMs: 1000,
        async onBody(_ctx, event) {
          const key = `${event.attemptId}:${event.exchangeIndex}`;
          const chunks: Uint8Array[] = [];
          archive.set(key, chunks);
          const reader = event.body.getReader();
          try {
            while (true) {
              const chunk = await reader.read();
              if (chunk.done) break;
              chunks.push(chunk.value.slice());
            }
          } finally {
            reader.releaseLock();
          }
        },
      },
      onAttempt(_ctx, report) {
        attempts.push(report);
      },
      onHttpExchange(_ctx, report) {
        exchanges.push(report);
      },
      onWorker(_ctx, report) {
        workers.push(report);
      },
    });
    try {
      await federation.createContext(new URL("https://example.com"), undefined)
        .sendActivity(
          { keyId: rsaPublicKey2.id!, privateKey: rsaPrivateKey2 },
          new Person({ id: new URL(inbox.origin + "/actor"), inbox }),
          new Create({
            id: new URL("https://example.com/workflow/activity"),
            actor: new URL("https://example.com/person2"),
          }),
          { fanout: "skip", dispatchId: "saved-workflow-dispatch" },
        );
      strictEqual(received.length, 0);
      strictEqual(queued.length, 1);
      await federation.processQueuedTask(undefined, queued.shift()!);
      strictEqual(attempts.length, 1);
      strictEqual(attempts[0].outcome.type, "failed");
      ok(attempts[0].outcome.response.type === "final");
      strictEqual(attempts[0].outcome.response.metadata.status, 503);
      strictEqual(queued.length, 1);
      const retry = workers[0].actions.find((action) =>
        action.type === "scheduled" && action.action === "retry"
      );
      ok(retry?.type === "scheduled");
      strictEqual(retry.queue.queueAttempt, 1);
      accepting = true;
      await federation.processQueuedTask(undefined, queued.shift()!);
      strictEqual(queued.length, 0);
      strictEqual(attempts.length, 2);
      strictEqual(attempts[1].outcome.type, "succeeded");
      strictEqual(attempts[0].deliveryId, attempts[1].deliveryId);
      ok(attempts[0].attemptId !== attempts[1].attemptId);
      deepStrictEqual(attempts[0].broadcast, attempts[1].broadcast);
      strictEqual(attempts[1].queue?.queueAttempt, 1);
      for (const report of attempts) {
        strictEqual(report.provenance.dispatchId, "saved-workflow-dispatch");
        strictEqual(report.senderPayload.type, "available");
        strictEqual(
          report.httpExchangeCount,
          exchanges.filter((exchange) =>
            exchange.attemptId === report.attemptId
          )
            .length,
        );
      }
      strictEqual(received.length, exchanges.length);
      strictEqual(archive.size, exchanges.length);
      for (const [index, exchange] of exchanges.entries()) {
        deepStrictEqual(exchange.bodyCapture, {
          type: "complete",
          bytesExposed: received[index].status === 503 ? 11 : 8,
        });
        const chunks = archive.get(
          `${exchange.attemptId}:${exchange.exchangeIndex}`,
        )!;
        const decoder = new TextDecoder();
        strictEqual(
          chunks.map((chunk) => decoder.decode(chunk)).join(""),
          received[index].status === 503 ? "retry later" : "accepted",
        );
      }
      deepStrictEqual(workers.map((worker) => worker.attemptsStarted), [1, 1]);
      deepStrictEqual(receiverErrors, []);
    } finally {
      const closed = new Promise<void>((resolve, reject) =>
        server.close((error) => error ? reject(error) : resolve())
      );
      server.closeAllConnections();
      await closed;
    }
  },
});
