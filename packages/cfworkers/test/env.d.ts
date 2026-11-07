// D1Database, KVNamespace, and Queue are globals provided by
// @cloudflare/workers-types, which is a global declaration file without named
// exports to import from.
declare module "cloudflare:test" {
  interface ProvidedEnv {
    D1: D1Database;
    KV1: KVNamespace<string>;
    Q1: Queue;
  }
}
