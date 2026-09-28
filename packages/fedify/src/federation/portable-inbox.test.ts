import { mockDocumentLoader, test } from "@fedify/fixture";
import {
  type Activity,
  Create,
  Follow,
  Note,
  Person,
  Tombstone,
} from "@fedify/vocab";
import { exportDidKey, formatIri, parseIri } from "@fedify/vocab-runtime";
import { assert, assertEquals, assertFalse, assertThrows } from "@std/assert";
import fetchMock from "fetch-mock";
import { signRequest } from "../sig/http.ts";
import { signJsonLd } from "../sig/ld.ts";
import { signObject } from "../sig/proof.ts";
import {
  ed25519PrivateKey,
  ed25519PublicKey,
  rsaPrivateKey2,
  rsaPrivateKey3,
  rsaPublicKey2,
  rsaPublicKey3,
} from "../testing/keys.ts";
import type { Context, InboxContext } from "./context.ts";
import { type KvKey, type KvStore, MemoryKvStore } from "./kv.ts";
import type { FederationOptions } from "./federation.ts";
import { createFederation } from "./middleware.ts";
import type { MessageQueue } from "./mq.ts";
import { forwardPortableInboxActivity } from "./portable-inbox.ts";
import type { Message, OutboxMessage } from "./queue.ts";

const did = await exportDidKey(ed25519PublicKey.publicKey);
const keyId = new URL(`${did}#${did.substring("did:key:".length)}`);
const otherKeyPair = await crypto.subtle.generateKey("Ed25519", true, [
  "sign",
  "verify",
]) as CryptoKeyPair;
const otherDid = await exportDidKey(otherKeyPair.publicKey);

const LOCAL = "https://example.com";
const GATEWAY2 = "https://example.org";
const GATEWAY3 = "https://example.net";

function inboxUrl(
  authority: string = did,
  path = "/users/alice/inbox",
  origin = LOCAL,
): string {
  return `${origin}/.well-known/apgateway/${authority}${path}`;
}

function post(url: string, body: unknown, headers: HeadersInit = {}) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/activity+json", ...headers },
    body: JSON.stringify(body),
  });
}

class RecordingQueue implements MessageQueue {
  readonly messages: Message[] = [];
  failFor?: string;

  enqueue(message: Message): Promise<void> {
    if (
      this.failFor != null && message.type === "outbox" &&
      message.inbox.startsWith(this.failFor)
    ) {
      return Promise.reject(new Error("Enqueue failed."));
    }
    this.messages.push(message);
    return Promise.resolve();
  }

  listen(): Promise<void> {
    return Promise.resolve();
  }

  get outbox(): OutboxMessage[] {
    return this.messages.filter((m): m is OutboxMessage => m.type === "outbox");
  }
}

interface Setup {
  gateways?: string[];
  kv?: KvStore;
  queue?: RecordingQueue;
  options?: Partial<FederationOptions<void>>;
  actor?: (ctx: Context<void>, identifier: string) => Person | Tombstone | null;
  listenerError?: boolean;
  keyPairs?: boolean;
  onSharedInboxKey?: () => void;
}

function setup(
  {
    gateways = [LOCAL, GATEWAY2, GATEWAY3],
    kv = new MemoryKvStore(),
    queue,
    options = {},
    actor,
    listenerError = false,
    keyPairs = true,
    onSharedInboxKey,
  }: Setup = {},
) {
  const federation = createFederation<void>({
    kv,
    // allowPrivateAddress cannot be combined with custom loaders; the default
    // ones preload the JSON-LD contexts that the tests use:
    ...(options.allowPrivateAddress ? {} : {
      documentLoaderFactory: () => mockDocumentLoader,
      contextLoaderFactory: () => mockDocumentLoader,
    }),
    manuallyStartQueue: true,
    ...(queue == null ? {} : { queue: { outbox: queue } }),
    ...options,
  });
  const received: {
    activity: Activity;
    recipient: string | null;
  }[] = [];
  const actorCallbacks = federation.setActorDispatcher(
    "/users/{identifier}",
    actor ??
      ((ctx, identifier) => {
        if (identifier === "ordinary") {
          return new Person({
            id: ctx.getActorUri(identifier),
            inbox: ctx.getInboxUri(identifier),
          });
        }
        if (identifier !== "alice") return null;
        return new Person({
          id: parseIri(`ap+ef61://${did}/users/alice`),
          inbox: ctx.getPortableInboxUri(identifier, did),
          gateways: gateways.map((g) => new URL(g)),
        });
      }),
  );
  if (keyPairs) {
    actorCallbacks.setKeyPairsDispatcher((_ctx, identifier) =>
      identifier === "ordinary"
        ? [{ privateKey: rsaPrivateKey2, publicKey: rsaPublicKey2.publicKey! }]
        : []
    );
  }
  const inboxListeners = federation
    .setInboxListeners("/users/{identifier}/inbox", "/inbox");
  if (onSharedInboxKey != null) {
    inboxListeners.setSharedKeyDispatcher(() => {
      onSharedInboxKey();
      return null;
    });
  }
  inboxListeners
    .on(Follow, (ctx: InboxContext<void>, activity) => {
      received.push({
        activity,
        recipient: ctx.recipient,
      });
      if (listenerError) throw new Error("Listener failed.");
    })
    .on(Create, (ctx: InboxContext<void>, activity) => {
      received.push({
        activity,
        recipient: ctx.recipient,
      });
    });
  return { federation, received, kv, queue };
}

let activityCounter = 0;

async function signedFollow(
  authority = did,
  privateKey = ed25519PrivateKey,
  signingKeyId = keyId,
): Promise<unknown> {
  const follow = await signObject(
    new Follow({
      id: parseIri(`ap+ef61://${authority}/follows/${++activityCounter}`),
      actor: parseIri(`ap+ef61://${authority}/users/bob`),
      object: parseIri(`ap+ef61://${did}/users/alice`),
    }),
    privateKey,
    signingKeyId,
    { contextLoader: mockDocumentLoader },
  );
  return await follow.toJsonLd({ contextLoader: mockDocumentLoader });
}

test("Federation.fetch() delivers to portable inboxes", async (t) => {
  const queue = new RecordingQueue();
  const { federation, received } = setup({ queue });
  const json = await signedFollow();

  await t.step("routes to the existing inbox listeners", async () => {
    const response = await federation.fetch(post(inboxUrl(), json), {
      contextData: undefined,
    });
    assertEquals(response.status, 202);
    assertEquals(received.length, 1);
    assertEquals(received[0].recipient, "alice");
    assert(received[0].activity instanceof Follow);
  });

  await t.step("forwards the activity to the other gateways", () => {
    const targets = queue.outbox.map((m) => m.inbox).sort();
    assertEquals(targets, [
      inboxUrl(did, "/users/alice/inbox", GATEWAY3),
      inboxUrl(did, "/users/alice/inbox", GATEWAY2),
    ]);
    for (const message of queue.outbox) {
      assertEquals(message.keys, []);
      assertEquals(message.activity, json);
      assertFalse(message.sharedInbox);
    }
  });

  await t.step("neither forwards nor dispatches duplicates", async () => {
    const response = await federation.fetch(post(inboxUrl(), json), {
      contextData: undefined,
    });
    assertEquals(response.status, 202);
    assertEquals(received.length, 1);
    assertEquals(queue.outbox.length, 2);
  });

  await t.step("accepts ap: and percent-encoded DIDs", async () => {
    const response = await federation.fetch(
      post(inboxUrl(did.replaceAll(":", "%3A")), await signedFollow()),
      { contextData: undefined },
    );
    assertEquals(response.status, 202);
    assertEquals(received.length, 2);
  });
});

test("Federation.fetch() delivers to portable inboxes without key pairs", async () => {
  const queue = new RecordingQueue();
  const { federation, received } = setup({ queue, keyPairs: false });
  const response = await federation.fetch(
    post(inboxUrl(), await signedFollow()),
    { contextData: undefined },
  );
  assertEquals(response.status, 202);
  assertEquals(received.length, 1);
  assertEquals(queue.outbox.length, 2);
});

test("Federation.fetch() refuses portable inbox deliveries it does not accept", async (t) => {
  const { federation, received } = setup({
    gateways: [GATEWAY2],
  });
  const json = await signedFollow();

  await t.step("this server is not a gateway of the actor", async () => {
    const response = await federation.fetch(post(inboxUrl(), json), {
      contextData: undefined,
    });
    assertEquals(response.status, 404);
  });

  const accepting = setup();
  const cases: [string, string][] = [
    ["unknown actor", inboxUrl(did, "/users/unknown/inbox")],
    ["non-portable actor", inboxUrl(did, "/users/ordinary/inbox")],
    ["DID mismatch", inboxUrl(otherDid)],
    ["shared inbox", inboxUrl(did, "/inbox")],
    ["actor path", inboxUrl(did, "/users/alice")],
    ["unregistered path", inboxUrl(did, "/unknown/alice/inbox")],
  ];
  for (const [name, url] of cases) {
    await t.step(name, async () => {
      const response = await accepting.federation.fetch(post(url, json), {
        contextData: undefined,
      });
      assertEquals(response.status, 404);
    });
  }

  await t.step("inbox mismatch", async () => {
    const { federation } = setup({
      actor: () =>
        new Person({
          id: parseIri(`ap+ef61://${did}/users/alice`),
          inbox: parseIri(`ap+ef61://${did}/users/alice/other-inbox`),
          gateways: [new URL(LOCAL)],
        }),
    });
    const response = await federation.fetch(post(inboxUrl(), json), {
      contextData: undefined,
    });
    assertEquals(response.status, 404);
  });

  await t.step("tombstone", async () => {
    const { federation } = setup({
      actor: () =>
        new Tombstone({ id: parseIri(`ap+ef61://${did}/users/alice`) }),
    });
    const response = await federation.fetch(post(inboxUrl(), json), {
      contextData: undefined,
    });
    assertEquals(response.status, 404);
  });

  await t.step("malformed DID", async () => {
    const response = await accepting.federation.fetch(
      post(`${LOCAL}/.well-known/apgateway/did:key:/users/alice/inbox`, json),
      { contextData: undefined },
    );
    assertEquals(response.status, 400);
  });

  await t.step("listeners are not called", () => {
    assertEquals(received.length, 0);
    assertEquals(accepting.received.length, 0);
  });
});

test("Federation.fetch() applies the proof policy to portable inbox deliveries", async (t) => {
  const queue = new RecordingQueue();
  const { federation, received } = setup({ queue });

  await t.step("unsigned portable activity", async () => {
    const json = await new Follow({
      id: parseIri(`ap+ef61://${did}/follows/unsigned`),
      actor: parseIri(`ap+ef61://${did}/users/bob`),
      object: parseIri(`ap+ef61://${did}/users/alice`),
    }).toJsonLd({ contextLoader: mockDocumentLoader });
    const response = await federation.fetch(post(inboxUrl(), json), {
      contextData: undefined,
    });
    assertEquals(response.status, 401);
  });

  await t.step("proof made by another DID", async () => {
    const json = await signedFollow(
      did,
      otherKeyPair.privateKey,
      new URL(`${otherDid}#${otherDid.substring("did:key:".length)}`),
    );
    const response = await federation.fetch(post(inboxUrl(), json), {
      contextData: undefined,
    });
    assertEquals(response.status, 401);
  });

  await t.step("unsigned portable object in a signed activity", async () => {
    const create = await signObject(
      new Create({
        id: parseIri(`ap+ef61://${did}/creates/1`),
        actor: parseIri(`ap+ef61://${did}/users/bob`),
        object: new Note({
          id: parseIri(`ap+ef61://${did}/notes/1`),
          content: "Hello",
        }),
      }),
      ed25519PrivateKey,
      keyId,
      { contextLoader: mockDocumentLoader },
    );
    const json = await create.toJsonLd({ contextLoader: mockDocumentLoader });
    const response = await federation.fetch(post(inboxUrl(), json), {
      contextData: undefined,
    });
    assertEquals(response.status, 401);
  });

  await t.step("nothing is dispatched or forwarded", () => {
    assertEquals(received.length, 0);
    assertEquals(queue.outbox.length, 0);
  });
});

test("Federation.fetch() does not forward activities authenticated only by HTTP Signatures", async () => {
  const queue = new RecordingQueue();
  const { federation, received } = setup({ queue });
  const activity = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: "https://example.com/follows/http",
    type: "Follow",
    actor: "https://example.com/person2",
    object: formatIri(parseIri(`ap+ef61://${did}/users/alice`)),
  };
  const request = await signRequest(
    post(inboxUrl(), activity),
    rsaPrivateKey3,
    new URL("https://example.com/person2#key3"),
  );
  const response = await federation.fetch(request, { contextData: undefined });
  assertEquals(response.status, 202);
  assertEquals(received.length, 1);
  assertEquals(queue.outbox.length, 0);
});

test("Federation.fetch() forwards activities authenticated by Linked Data Signatures", async () => {
  const queue = new RecordingQueue();
  const { federation, received } = setup({ queue });
  const activity = await signJsonLd(
    {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: "https://example.com/follows/lds",
      type: "Follow",
      actor: "https://example.com/person2",
      object: formatIri(parseIri(`ap+ef61://${did}/users/alice`)),
    },
    rsaPrivateKey3,
    rsaPublicKey3.id!,
    { contextLoader: mockDocumentLoader },
  );
  // Not signed with HTTP Signatures:
  const response = await federation.fetch(post(inboxUrl(), activity), {
    contextData: undefined,
  });
  assertEquals(response.status, 202);
  assertEquals(received.length, 1);
  assertEquals(queue.outbox.length, 2);
  for (const message of queue.outbox) {
    assertEquals(message.activity, activity);
  }
});

test("Federation.fetch() does not forward portable inbox deliveries without verification", async () => {
  const queue = new RecordingQueue();
  const { federation, received } = setup({
    queue,
    options: { skipSignatureVerification: true },
  });
  const response = await federation.fetch(
    post(inboxUrl(), await signedFollow()),
    { contextData: undefined },
  );
  assertEquals(response.status, 202);
  assertEquals(received.length, 1);
  assertEquals(queue.outbox.length, 0);
});

test("Federation.fetch() does not forward portable inbox deliveries whose listener failed", async () => {
  const queue = new RecordingQueue();
  const { federation } = setup({ queue, listenerError: true });
  const json = await signedFollow();
  let response = await federation.fetch(post(inboxUrl(), json), {
    contextData: undefined,
  });
  assertEquals(response.status, 500);
  assertEquals(queue.outbox.length, 0);
  // The sender retries:
  response = await federation.fetch(post(inboxUrl(), json), {
    contextData: undefined,
  });
  assertEquals(response.status, 500);
  assertEquals(queue.outbox.length, 0);
});

test("Federation.fetch() forwards each portable inbox delivery at most once", async (t) => {
  await t.step("concurrent deliveries", async () => {
    const queue = new RecordingQueue();
    const { federation } = setup({ queue });
    const json = await signedFollow();
    const responses = await Promise.all([
      federation.fetch(post(inboxUrl(), json), { contextData: undefined }),
      federation.fetch(post(inboxUrl(), json), { contextData: undefined }),
      federation.fetch(post(inboxUrl(), json), { contextData: undefined }),
    ]);
    for (const response of responses) assertEquals(response.status, 202);
    assertEquals(
      queue.outbox.map((m) => m.inbox).sort(),
      [
        inboxUrl(did, "/users/alice/inbox", GATEWAY3),
        inboxUrl(did, "/users/alice/inbox", GATEWAY2),
      ],
    );
  });

  await t.step("failed hand-offs are not retried", async () => {
    const queue = new RecordingQueue();
    queue.failFor = GATEWAY2;
    const { federation, received } = setup({ queue });
    const json = await signedFollow();
    let response = await federation.fetch(post(inboxUrl(), json), {
      contextData: undefined,
    });
    assertEquals(response.status, 202);
    assertEquals(queue.outbox.map((m) => m.inbox), [
      inboxUrl(did, "/users/alice/inbox", GATEWAY3),
    ]);
    queue.failFor = undefined;
    response = await federation.fetch(post(inboxUrl(), json), {
      contextData: undefined,
    });
    assertEquals(response.status, 202);
    assertEquals(queue.outbox.length, 1);
    assertEquals(received.length, 1);
  });

  await t.step("a delivery forwarded back is not forwarded again", async () => {
    const queue = new RecordingQueue();
    const kv = new MemoryKvStore();
    // example.org and example.com share the key–value store for the sake of
    // the test, but they are separate gateways:
    const local = setup({ queue, kv });
    const json = await signedFollow();
    await local.federation.fetch(post(inboxUrl(), json), {
      contextData: undefined,
    });
    assertEquals(queue.outbox.length, 2);
    // example.org forwards it back to example.com:
    const response = await local.federation.fetch(post(inboxUrl(), json), {
      contextData: undefined,
    });
    assertEquals(response.status, 202);
    assertEquals(queue.outbox.length, 2);
    assertEquals(local.received.length, 1);
  });

  await t.step("without KvStore.cas()", async () => {
    const queue = new RecordingQueue();
    const memory = new MemoryKvStore();
    const kv: KvStore = {
      get: (key: KvKey) => memory.get(key),
      set: (key, value, options) => memory.set(key, value, options),
      delete: (key) => memory.delete(key),
      list: (prefix) => memory.list(prefix),
    };
    const { federation, received } = setup({ queue, kv });
    const response = await federation.fetch(
      post(inboxUrl(), await signedFollow()),
      { contextData: undefined },
    );
    assertEquals(response.status, 202);
    assertEquals(received.length, 1);
    assertEquals(queue.outbox.length, 0);
  });

  await t.step("configured origin", async () => {
    const queue = new RecordingQueue();
    const { federation } = setup({
      queue,
      gateways: [GATEWAY2, LOCAL, GATEWAY3],
      options: { origin: GATEWAY2 },
    });
    // The request is made to example.com, which is not this server's
    // canonical origin (example.org), so both are excluded:
    const response = await federation.fetch(
      post(inboxUrl(), await signedFollow()),
      { contextData: undefined },
    );
    assertEquals(response.status, 202);
    assertEquals(queue.outbox.map((m) => m.inbox), [
      inboxUrl(did, "/users/alice/inbox", GATEWAY3),
    ]);
  });

  await t.step("gateway cap", async () => {
    const queue = new RecordingQueue();
    const gateways = [LOCAL];
    for (let i = 0; i < 15; i++) gateways.push(`https://gw${i}.example.net`);
    const { federation } = setup({ queue, gateways });
    const response = await federation.fetch(
      post(inboxUrl(), await signedFollow()),
      { contextData: undefined },
    );
    assertEquals(response.status, 202);
    assertEquals(queue.outbox.length, 10);
  });
});

test("Federation.fetch() forwards portable inbox deliveries immediately without a queue", async () => {
  fetchMock.spyGlobal();
  const requests: { url: string; headers: Headers; body: unknown }[] = [];
  fetchMock.post(`begin:${GATEWAY2}/`, async (callLog) => {
    const request = callLog.request!;
    requests.push({
      url: request.url,
      headers: new Headers(request.headers),
      body: await request.json(),
    });
    return new Response(null, { status: 202 });
  });
  fetchMock.post(`begin:${GATEWAY3}/`, () => {
    throw new TypeError("Connection refused.");
  });
  try {
    // The mocked gateways are not resolved; the activity is authenticated by
    // its did:key proof, so no remote document is fetched:
    const { federation, received } = setup({
      options: { allowPrivateAddress: true },
    });
    const json = await signedFollow();
    let response = await federation.fetch(post(inboxUrl(), json), {
      contextData: undefined,
    });
    assertEquals(response.status, 202);
    assertEquals(received.length, 1);
    assertEquals(requests.length, 1);
    assertEquals(
      requests[0].url,
      inboxUrl(did, "/users/alice/inbox", GATEWAY2),
    );
    assertFalse(requests[0].headers.has("Signature"));
    assertFalse(requests[0].headers.has("Signature-Input"));
    assertEquals(requests[0].body, json);
    // A redelivery forwards to neither gateway again:
    response = await federation.fetch(post(inboxUrl(), json), {
      contextData: undefined,
    });
    assertEquals(response.status, 202);
    assertEquals(requests.length, 1);
    assertEquals(
      fetchMock.callHistory.calls(`begin:${GATEWAY3}/`).length,
      1,
    );
  } finally {
    fetchMock.hardReset();
  }
});

test("Federation.fetch() forwards portable inbox deliveries when it enqueues them", async () => {
  const queue = new RecordingQueue();
  const inboxQueue = new RecordingQueue();
  let sharedInboxKeyCalls = 0;
  const { federation, received } = setup({
    queue,
    keyPairs: false,
    onSharedInboxKey: () => sharedInboxKeyCalls++,
    options: { queue: { inbox: inboxQueue, outbox: queue } },
  });
  const response = await federation.fetch(
    post(inboxUrl(), await signedFollow()),
    { contextData: undefined },
  );
  assertEquals(response.status, 202);
  // The listener runs later in the worker, but the activity is forwarded as
  // soon as it is accepted:
  assertEquals(received.length, 0);
  assertEquals(inboxQueue.messages.length, 1);
  assertEquals(inboxQueue.messages[0].type, "inbox");
  assertEquals(queue.outbox.length, 2);
  // The worker processes it even without key pairs, and does not treat it as
  // a shared inbox delivery:
  await federation.processQueuedTask(undefined, inboxQueue.messages[0]);
  assertEquals(received.length, 1);
  assertEquals(received[0].recipient, "alice");
  assertEquals(sharedInboxKeyCalls, 0);
});

test("forwardPortableInboxActivity() does not wait for slow gateways", async () => {
  fetchMock.spyGlobal();
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => release = resolve);
  fetchMock.post(`begin:${GATEWAY2}/`, async () => {
    await pending;
    throw new TypeError("Connection reset.");
  });
  try {
    const kv = new MemoryKvStore();
    const activityId = parseIri(`ap+ef61://${did}/follows/slow`);
    const parameters = {
      recipient: {
        inboxId: parseIri(`ap+ef61://${did}/users/alice/inbox`),
        canonicalInboxId: `ap://${did}/users/alice/inbox`,
        gateways: [new URL(LOCAL), new URL(GATEWAY2)],
      },
      activity: { id: formatIri(activityId) },
      activityId,
      activityType: "https://www.w3.org/ns/activitystreams#Follow",
      excludedOrigins: [LOCAL],
      baseUrl: LOCAL,
      kv,
      kvPrefix: ["_fedify", "portableInboxForwarding"],
      deadline: 10,
      // The mocked gateway is not resolved:
      allowPrivateAddress: true,
    } as const;
    const started = performance.now();
    const forwarded = await forwardPortableInboxActivity(parameters);
    assert(performance.now() - started < 5_000);
    assertEquals(forwarded.map((u) => u.href), [
      inboxUrl(did, "/users/alice/inbox", GATEWAY2),
    ]);
    // The late failure is handled, and the claim is kept:
    release();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assertEquals(await forwardPortableInboxActivity(parameters), []);
    assertEquals(fetchMock.callHistory.calls().length, 1);
  } finally {
    fetchMock.hardReset();
  }
});

test("Context.getPortableInboxUri()", async (t) => {
  const { federation } = setup();

  await t.step("Context", () => {
    const ctx = federation.createContext(new URL(LOCAL), undefined);
    const uri = ctx.getPortableInboxUri("alice", did);
    assertEquals(uri.protocol, "ap+ef61:");
    assertEquals(formatIri(uri), `ap+ef61://${did}/users/alice/inbox`);
    assertThrows(
      () => ctx.getPortableInboxUri("alice", "not-a-did"),
      TypeError,
    );
  });

  await t.step("RequestContext without portable request", () => {
    const ctx = federation.createContext(new Request(LOCAL), undefined);
    assertThrows(() => ctx.getPortableInboxUri("alice"), TypeError);
    assertEquals(
      formatIri(ctx.getPortableInboxUri("alice", did)),
      `ap+ef61://${did}/users/alice/inbox`,
    );
  });
});

test("Federation.fetch() keeps ordinary inbox deliveries unchanged", async () => {
  const queue = new RecordingQueue();
  const { federation, received } = setup({ queue });
  const response = await federation.fetch(
    post(`${LOCAL}/users/alice/inbox`, await signedFollow()),
    { contextData: undefined },
  );
  assertEquals(response.status, 202);
  assertEquals(received.length, 1);
  assertEquals(queue.outbox.length, 0);
});
