import {
  createFederation,
  generateCryptoKeyPair,
  MemoryKvStore,
} from "@fedify/fedify";
import { Create, Endpoints, Person } from "@fedify/vocab";
import { Buffer } from "node:buffer";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

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
export async function spawnBenchmarkTarget(): Promise<BenchmarkTargetFixture> {
  const federation = createFederation<void>({
    kv: new MemoryKvStore(),
    benchmarkMode: true,
  });
  const keyPairs = Promise.all([
    generateCryptoKeyPair("RSASSA-PKCS1-v1_5"),
    generateCryptoKeyPair("Ed25519"),
  ]);
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
      return await keyPairs;
    });
  federation.setInboxListeners("/users/{identifier}/inbox", "/inbox").on(
    Create,
    () => {},
  );
  let inboxUserAgent: string | null = null;
  const server = createServer(
    async (incoming: IncomingMessage, outgoing: ServerResponse) => {
      const request = await toFetchRequest(incoming);
      const url = new URL(request.url);
      requests.push({ method: request.method, path: url.pathname });
      if (request.method === "POST") {
        inboxUserAgent = request.headers.get("user-agent");
      }
      const response = await federation.fetch(request, {
        contextData: undefined,
      });
      await writeFetchResponse(response, outgoing);
    },
  );
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  return {
    url: new URL(`http://${address.address}:${address.port}/`),
    inboxUserAgent: () => inboxUserAgent,
    requests: () => requests.slice(),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => error == null ? resolve() : reject(error));
      }),
  };
}

async function toFetchRequest(incoming: IncomingMessage): Promise<Request> {
  const host = incoming.headers.host ?? "127.0.0.1";
  const url = new URL(incoming.url ?? "/", `http://${host}`);
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, value);
    }
  }
  const method = incoming.method ?? "GET";
  const init: RequestInit = { method, headers };
  if (method !== "GET" && method !== "HEAD") {
    init.body = await readBody(incoming);
  }
  return new Request(url, init);
}

async function readBody(incoming: IncomingMessage): Promise<ArrayBuffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of incoming) {
    chunks.push(
      typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk,
    );
  }
  const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body.buffer;
}

async function writeFetchResponse(
  response: Response,
  outgoing: ServerResponse,
): Promise<void> {
  outgoing.statusCode = response.status;
  response.headers.forEach((value, name) => {
    outgoing.setHeader(name, value);
  });
  outgoing.end(Buffer.from(await response.arrayBuffer()));
}
