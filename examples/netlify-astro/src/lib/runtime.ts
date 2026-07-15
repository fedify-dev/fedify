import {
  InProcessMessageQueue,
  MemoryKvStore,
} from "@fedify/fedify/federation";
import { NetlifyMessageQueue } from "@fedify/netlify";
import { PostgresKvStore } from "@fedify/postgres";
import { AsyncWorkloadsClient } from "@netlify/async-workloads";
import { getConnectionString } from "@netlify/database";
import postgres from "postgres";
import { builder, type ContextData } from "./federation.ts";

export function createNetlifyServices() {
  const sql = postgres(getConnectionString());
  const kv = new PostgresKvStore(sql);
  const queue = new NetlifyMessageQueue({
    client: new AsyncWorkloadsClient(),
    orderingKv: kv,
  });
  return { kv, queue };
}

export async function createWebRuntime() {
  if (
    process.env.NETLIFY === "true" &&
    process.env.CONTEXT === "production" &&
    process.env.NETLIFY_DB_URL != null
  ) {
    const { kv, queue } = createNetlifyServices();
    return {
      federation: await builder.build({
        kv,
        queue,
        manuallyStartQueue: true,
      }),
      contextData: { kv } satisfies ContextData,
    };
  }

  const kv = new MemoryKvStore();
  return {
    federation: await builder.build({
      kv,
      queue: new InProcessMessageQueue(),
    }),
    contextData: { kv } satisfies ContextData,
  };
}
