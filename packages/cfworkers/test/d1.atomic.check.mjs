// Run the shared timing-sensitive suite in Node: the Workers Vitest runner's
// performance/timer clock can lag SQLite's wall clock after many binding calls.
// Wrangler still executes every SQL operation in local workerd/Miniflare D1.
import { testAtomicKvStore } from "@fedify/testing";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Temporal } from "temporal-polyfill";
import { getPlatformProxy } from "wrangler";
import { WorkersD1KvStore } from "../dist/mod.js";

test(
  "D1 shared atomic conformance through a local binding",
  { timeout: 600_000 },
  async () => {
    const proxy = await getPlatformProxy({
      configPath: fileURLToPath(new URL("../wrangler.jsonc", import.meta.url)),
      persist: false,
      remoteBindings: false,
    });
    try {
      await testAtomicKvStore(
        () => {
          const tableName = `atomic_${randomUUID().replaceAll("-", "")}`;
          const first = new WorkersD1KvStore(
            proxy.env.D1.withSession("first-primary"),
            { tableName },
          );
          const second = new WorkersD1KvStore(
            proxy.env.D1.withSession("first-primary"),
            { tableName },
          );
          return { first, second, dispose: () => first.drop() };
        },
        {
          objectKeyOrder: "ignored",
          ttl: {
            short: Temporal.Duration.from({ seconds: 5 }),
            wait: Temporal.Duration.from({ seconds: 6 }),
          },
          rejections: (key) => ({
            getMany: Array.from({ length: 257 }, (_, i) => key("read", `${i}`)),
            setMany: Array.from({ length: 129 }, (_, i) => ({
              key: key("set", `${i}`),
              value: i,
            })),
            deleteMany: Array.from({ length: 129 }, (_, i) =>
              key("delete", `${i}`),
            ),
            casMany: Array.from({ length: 129 }, (_, i) => ({
              key: key("cas", `${i}`),
              expectedValue: 0,
              newValue: 1,
            })),
          }),
        },
      );
    } finally {
      await proxy.dispose();
    }
  },
);
