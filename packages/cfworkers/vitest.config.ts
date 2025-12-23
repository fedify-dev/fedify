import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        singleWorker: true,
        wrangler: {
          configPath: "./wrangler.jsonc",
        },
        miniflare: {
          compatibilityFlags: ["service_binding_extra_handlers"],
          queueConsumers: {
            "test-queue": {
              maxBatchTimeout: 0.05,
            },
          },
        },
      },
    },
  },
});
