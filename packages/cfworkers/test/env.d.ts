// KVNamespace and Queue are globals provided by @cloudflare/workers-types,
// which is a global declaration file without named exports to import from.
declare module "cloudflare:test" {
  interface ProvidedEnv {
    KV1: KVNamespace<string>;
    Q1: Queue;
  }
}
