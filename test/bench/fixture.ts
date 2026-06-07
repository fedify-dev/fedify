import {
  createFederation,
  generateCryptoKeyPair,
  MemoryKvStore,
} from "@fedify/fedify";
import { Create, Endpoints, Person } from "@fedify/vocab";

/** A running local benchmark-mode target used by `fedify bench` tests. */
export interface BenchmarkTargetFixture {
  /** The target base URL. */
  readonly url: URL;
  /** The last User-Agent observed on signed inbox load. */
  readonly inboxUserAgent: () => string | null;
  /** The HTTP requests the fixture target has received. */
  readonly requests: () => readonly { method: string; path: string }[];
  /** Stops the fixture server. */
  readonly close: () => Promise<void>;
}

/**
 * Starts a local Fedify target in benchmark mode.
 *
 * The app exposes one actor, `alice`, with a personal and shared inbox, and an
 * inbox listener that accepts signed `Create` activities.  It is intentionally
 * small but exercises the same WebFinger, actor discovery, signature
 * verification, and inbox paths that `fedify bench` drives.
 * @returns The running fixture.
 */
export function spawnBenchmarkTarget(): BenchmarkTargetFixture {
  const federation = createFederation<void>({
    kv: new MemoryKvStore(),
    benchmarkMode: true,
  });
  let keyPairs: CryptoKeyPair[] | undefined;
  const requests: { method: string; path: string }[] = [];
  federation
    .setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
      if (identifier !== "alice") return null;
      const pairs = await ctx.getActorKeyPairs(identifier);
      return new Person({
        id: ctx.getActorUri(identifier),
        preferredUsername: identifier,
        inbox: ctx.getInboxUri(identifier),
        endpoints: new Endpoints({ sharedInbox: ctx.getInboxUri() }),
        publicKey: pairs[0]?.cryptographicKey,
        assertionMethods: pairs.map((p) => p.multikey),
      });
    })
    .mapHandle((_ctx, username) => (username === "alice" ? "alice" : null))
    .setKeyPairsDispatcher(async (_ctx, identifier) => {
      if (identifier !== "alice") return [];
      keyPairs ??= [
        await generateCryptoKeyPair("RSASSA-PKCS1-v1_5"),
        await generateCryptoKeyPair("Ed25519"),
      ];
      return keyPairs;
    });
  federation.setInboxListeners("/users/{identifier}/inbox", "/inbox").on(
    Create,
    () => {},
  );
  let inboxUserAgent: string | null = null;
  const abort = new AbortController();
  const server = Deno.serve(
    {
      port: 0,
      hostname: "127.0.0.1",
      signal: abort.signal,
      onListen: () => {},
    },
    (request: Request) => {
      const url = new URL(request.url);
      requests.push({ method: request.method, path: url.pathname });
      if (request.method === "POST") {
        inboxUserAgent = request.headers.get("user-agent");
      }
      return federation.fetch(request, { contextData: undefined });
    },
  );
  const address = server.addr as Deno.NetAddr;
  return {
    url: new URL(`http://${address.hostname}:${address.port}/`),
    inboxUserAgent: () => inboxUserAgent,
    requests: () => requests.slice(),
    close: async () => {
      abort.abort();
      await server.finished.catch(() => {});
    },
  };
}
