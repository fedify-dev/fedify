import type {
  D1Database,
  D1DatabaseSession,
  KVNamespace,
  Queue,
} from "@cloudflare/workers-types";
import type {
  AtomicKvStore,
  KvStore,
  MessageQueue,
} from "@fedify/fedify/federation";
import {
  WorkersD1KvStore,
  WorkersKvStore,
  WorkersMessageQueue,
} from "../../dist/mod.js";

// Checks that the public API accepts the D1, KV, and Queue bindings declared
// by `@cloudflare/workers-types` itself, in addition to the `wrangler types`
// declarations covered by wrangler-generated-kv.ts.

declare const d1: D1Database;
declare const d1Session: D1DatabaseSession;
declare const kv: KVNamespace;
declare const queue: Queue;

export const store: KvStore = new WorkersKvStore(kv);
export const d1Store: AtomicKvStore = new WorkersD1KvStore(d1);
export const d1SessionStore: AtomicKvStore = new WorkersD1KvStore(d1Session, {
  tableName: "fedify_kv",
  initialized: true,
});
export const mq: MessageQueue = new WorkersMessageQueue(queue);
export const orderedMq: MessageQueue = new WorkersMessageQueue(queue, {
  orderingKv: kv,
});
