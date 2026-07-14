import "temporal-polyfill/global";
import {
  createFederation,
  type KvKey,
  type KvStore,
} from "@fedify/fedify/federation";
import { NetlifyMessageQueue } from "../../../../src/mod.ts";
import { PostgresKvStore } from "@fedify/postgres";
import { AsyncWorkloadsClient } from "@netlify/async-workloads";
import { getConnectionString } from "@netlify/database";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import postgres from "postgres";

export interface TaskPayload {
  readonly id: string;
  readonly value: string;
  readonly failures: number;
  readonly hold: number;
  readonly orderingKey?: string;
}

export interface ContextData {
  readonly eventId: string;
  readonly kv: KvStore;
}

const taskSchema: StandardSchemaV1<unknown, TaskPayload> = {
  "~standard": {
    version: 1 as const,
    vendor: "fedify-netlify-integration-test",
    validate(value: unknown) {
      if (
        typeof value === "object" && value != null &&
        typeof (value as TaskPayload).id === "string" &&
        typeof (value as TaskPayload).value === "string" &&
        typeof (value as TaskPayload).failures === "number" &&
        typeof (value as TaskPayload).hold === "number" &&
        ((value as TaskPayload).orderingKey === undefined ||
          typeof (value as TaskPayload).orderingKey === "string")
      ) {
        return { value: value as TaskPayload };
      }
      return { issues: [{ message: "Invalid integration task payload." }] };
    },
  },
};

export function createServices() {
  const sql = postgres(getConnectionString());
  const kv = new PostgresKvStore(sql, {
    tableName: "fedify_netlify_integration_kv",
  });
  const baseUrl = process.env.URL ?? process.env.DEPLOY_URL;
  const queue = new NetlifyMessageQueue({
    client: new AsyncWorkloadsClient(baseUrl == null ? undefined : { baseUrl }),
    orderingKv: kv,
    orderingRetryDelay: { milliseconds: 100 },
  });
  return { kv, queue };
}

async function add(kv: KvStore, key: KvKey, amount: number): Promise<number> {
  if (kv.cas == null) {
    throw new TypeError("The integration KV store needs CAS.");
  }
  while (true) {
    const previous = await kv.get<number>(key);
    const next = (previous ?? 0) + amount;
    if (await kv.cas(key, previous, next)) return next;
  }
}

function increment(kv: KvStore, key: KvKey): Promise<number> {
  return add(kv, key, 1);
}

export function createTaskFederation(
  kv: KvStore,
  queue: NetlifyMessageQueue,
) {
  const federation = createFederation<ContextData>({
    kv,
    queue,
    manuallyStartQueue: true,
  });
  const task = federation.defineTask("netlify-integration", {
    schema: taskSchema,
    handler: async (ctx, payload) => {
      const activeKey: KvKey | undefined = payload.orderingKey == null
        ? undefined
        : ["integration", "ordering", payload.orderingKey, "active"];
      if (activeKey != null) {
        const active = await increment(kv, activeKey);
        if (active > 1) {
          await kv.set(["integration", payload.id, "overlapped"], true);
        }
      }
      try {
        const attempts = await increment(kv, [
          "integration",
          payload.id,
          "attempts",
        ]);
        if (payload.hold > 0) {
          await new Promise((resolve) => setTimeout(resolve, payload.hold));
        }
        if (attempts <= payload.failures) {
          throw new Error(`Transient integration failure ${attempts}.`);
        }
        const position = payload.orderingKey == null
          ? undefined
          : await increment(kv, [
            "integration",
            "ordering",
            payload.orderingKey,
            "completed",
          ]);
        await kv.set(["integration", payload.id, "completed"], {
          value: payload.value,
          eventId: ctx.data.eventId,
          position,
        });
      } finally {
        if (activeKey != null) await add(kv, activeKey, -1);
      }
    },
  });
  return { federation, task };
}
