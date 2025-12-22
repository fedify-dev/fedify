import type { KVNamespace, Queue } from "@cloudflare/workers-types/experimental";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    KV1: KVNamespace<string>;
    Q1: Queue;
  }
}
