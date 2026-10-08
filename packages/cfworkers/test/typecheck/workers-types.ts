import type { KVNamespace, Queue } from "@cloudflare/workers-types";
import type { KvStore, MessageQueue } from "@fedify/fedify/federation";
import { WorkersKvStore, WorkersMessageQueue } from "../../dist/mod.js";

// Checks that the public API accepts the KV and Queue bindings declared by
// `@cloudflare/workers-types` itself, in addition to the `wrangler types`
// declarations covered by wrangler-generated-kv.ts.

declare const kv: KVNamespace;
declare const queue: Queue;

export const store: KvStore = new WorkersKvStore(kv);
export const mq: MessageQueue = new WorkersMessageQueue(queue);
export const orderedMq: MessageQueue = new WorkersMessageQueue(queue, {
  orderingKv: kv,
});
