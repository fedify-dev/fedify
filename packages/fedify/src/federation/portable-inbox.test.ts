import { mockDocumentLoader, test } from "@fedify/fixture";
import {
  type Activity,
  Create,
  Follow,
  Note,
  Person,
  Tombstone,
} from "@fedify/vocab";
import {
  type DocumentLoader,
  exportDidKey,
  formatIri,
  parseIri,
  type RemoteDocument,
} from "@fedify/vocab-runtime";
import { assert, assertEquals, assertFalse, assertThrows } from "@std/assert";
import fetchMock from "fetch-mock";
import { signRequest, verifyRequestDetailed } from "../sig/http.ts";
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
import {
  forwardPortableInboxActivity,
  type ForwardPortableInboxActivityParameters,
  resolvePortableInboxForwardingOptions,
} from "./portable-inbox.ts";
import type { Message, OutboxMessage } from "./queue.ts";
import type { SenderKeyPair } from "./send.ts";

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
  /** Alice's key pairs, which are her gateway keys if she has a mapper. */
  aliceKeyPairs?: CryptoKeyPair[];
  mapPortableActorId?: (identifier: string) => URL | null;
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
    aliceKeyPairs = [],
    mapPortableActorId,
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
        : identifier === "alice"
        ? aliceKeyPairs
        : []
    );
  }
  if (mapPortableActorId != null) {
    actorCallbacks.mapPortableActorId((_ctx, identifier) =>
      mapPortableActorId(identifier)
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

test("FederationOptions.portableInboxForwarding", async (t) => {
  await t.step("maxTargets", async () => {
    const queue = new RecordingQueue();
    const { federation } = setup({
      queue,
      options: { portableInboxForwarding: { maxTargets: 1 } },
    });
    const response = await federation.fetch(
      post(inboxUrl(), await signedFollow()),
      { contextData: undefined },
    );
    assertEquals(response.status, 202);
    assertEquals(queue.outbox.map((m) => m.inbox), [
      inboxUrl(did, "/users/alice/inbox", GATEWAY2),
    ]);
  });

  await t.step("maxTargets: 0 turns off forwarding", async () => {
    const queue = new RecordingQueue();
    const { federation, received } = setup({
      queue,
      options: { portableInboxForwarding: { maxTargets: 0 } },
    });
    const response = await federation.fetch(
      post(inboxUrl(), await signedFollow()),
      { contextData: undefined },
    );
    assertEquals(response.status, 202);
    assertEquals(received.length, 1);
    assertEquals(queue.outbox.length, 0);
  });

  await t.step("ttl", async () => {
    const queue = new RecordingQueue();
    const memory = new MemoryKvStore();
    const claimTtls: (Temporal.Duration | undefined)[] = [];
    const kv: KvStore = {
      get: (key) => memory.get(key),
      set: (key, value, options) => memory.set(key, value, options),
      delete: (key) => memory.delete(key),
      list: (prefix) => memory.list(prefix),
      cas: (key, expected, value, options) => {
        if (key[1] === "portableInboxForwarding") {
          claimTtls.push(options?.ttl);
        }
        return memory.cas(key, expected, value, options);
      },
    };
    const { federation } = setup({
      queue,
      kv,
      options: {
        // A Temporal.Duration is accepted as well as a DurationLike:
        portableInboxForwarding: { ttl: Temporal.Duration.from({ days: 7 }) },
      },
    });
    const response = await federation.fetch(
      post(inboxUrl(), await signedFollow()),
      { contextData: undefined },
    );
    assertEquals(response.status, 202);
    assertEquals(queue.outbox.length, 2);
    assertEquals(claimTtls.map((ttl) => ttl?.total("day")), [7, 7]);
  });

  await t.step("longest deadline", () => {
    const resolved = resolvePortableInboxForwardingOptions({
      deadline: { milliseconds: 2 ** 31 - 1 },
    });
    assertEquals(resolved.deadline.total("millisecond"), 2 ** 31 - 1);
  });

  await t.step("defaults", () => {
    const resolved = resolvePortableInboxForwardingOptions();
    assertEquals(resolved.maxTargets, 10);
    assertEquals(resolved.ttl.total("day"), 30);
    assertEquals(resolved.deadline.total("second"), 10);
  });

  await t.step("invalid values", () => {
    const invalid = [
      { maxTargets: -1 },
      { maxTargets: 1.5 },
      { maxTargets: Number.NaN },
      { ttl: { seconds: 0 } },
      { ttl: { weeks: 1 } },
      { ttl: { months: 1 } },
      { deadline: { seconds: -1 } },
      { deadline: { years: 1 } },
      { deadline: { milliseconds: 2 ** 31 } },
    ];
    for (const portableInboxForwarding of invalid) {
      assertThrows(
        () => setup({ options: { portableInboxForwarding } }),
        RangeError,
      );
    }
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
        actorId: parseIri(`ap+ef61://${did}/users/alice`),
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
      options: resolvePortableInboxForwardingOptions({
        deadline: { milliseconds: 10 },
      }),
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

// Compatible-ID actors

function compatibleAlice(
  path = "/users/alice",
  { authority = did, origin = LOCAL, gateways = [LOCAL, GATEWAY2, GATEWAY3] }: {
    authority?: string;
    origin?: string;
    gateways?: string[];
  } = {},
): { id: URL; inbox: URL; gateways: URL[] } {
  return {
    id: new URL(`${origin}/.well-known/apgateway/${authority}${path}`),
    inbox: new URL(inboxUrl(authority, `${path}/inbox`, origin)),
    gateways: gateways.map((g) => new URL(g)),
  };
}

test("Federation.fetch() delivers to portable inboxes of compatible-ID actors", async (t) => {
  const apAlice = parseIri(`ap+ef61://${did}/users/alice`);
  const apInbox = parseIri(`ap+ef61://${did}/users/alice/inbox`);
  const cases: [string, { id: URL; inbox: URL; gateways: URL[] }, string][] = [
    ["compatible actor and inbox", compatibleAlice(), ""],
    // FEP-ef61 treats objects on different gateways as instances of the same
    // object:
    [
      "on another gateway",
      compatibleAlice(undefined, { origin: GATEWAY2 }),
      "",
    ],
    [
      "compatible actor and ap: inbox",
      { ...compatibleAlice(), inbox: apInbox },
      "",
    ],
    [
      "ap: actor and compatible inbox",
      { ...compatibleAlice(), id: apAlice },
      "",
    ],
    [
      "compatible inbox with a query",
      {
        ...compatibleAlice(),
        inbox: new URL(inboxUrl() + "?page=1"),
      },
      "?page=1",
    ],
  ];
  for (const [name, alice, query] of cases) {
    await t.step(name, async () => {
      const queue = new RecordingQueue();
      const { federation, received } = setup({
        queue,
        actor: (_ctx, identifier) =>
          identifier === "alice" ? new Person(alice) : null,
      });
      const response = await federation.fetch(
        post(inboxUrl(), await signedFollow()),
        { contextData: undefined },
      );
      assertEquals(response.status, 202);
      assertEquals(received.length, 1);
      assertEquals(received[0].recipient, "alice");
      // The inbox is forwarded to in its compatible identifiers on the other
      // gateways, keeping the query of the inbox ID:
      assertEquals(queue.outbox.map((m) => m.inbox).sort(), [
        inboxUrl(did, "/users/alice/inbox", GATEWAY3) + query,
        inboxUrl(did, "/users/alice/inbox", GATEWAY2) + query,
      ]);
    });
  }

  const json = await signedFollow();
  const rejections: [string, Person][] = [
    [
      "DID mismatch",
      new Person(compatibleAlice(undefined, { authority: otherDid })),
    ],
    [
      "inbox mismatch",
      new Person({
        ...compatibleAlice(),
        inbox: new URL(inboxUrl(did, "/users/alice/other-inbox")),
      }),
    ],
    [
      "this server is not a gateway of the actor",
      new Person(compatibleAlice(undefined, { gateways: [GATEWAY2] })),
    ],
    [
      // FEP-ef61 forbids location hints in compatible identifiers:
      "malformed actor ID",
      new Person({
        ...compatibleAlice(),
        id: new URL(
          compatibleAlice().id.href + "?@gateway=https%3A%2F%2Fexample.com",
        ),
      }),
    ],
    [
      "malformed inbox ID",
      new Person({
        ...compatibleAlice(),
        inbox: new URL(inboxUrl() + "?@gateway=https%3A%2F%2Fexample.com"),
      }),
    ],
  ];
  for (const [name, actor] of rejections) {
    await t.step(name, async () => {
      const { federation, received } = setup({
        actor: (_ctx, identifier) => identifier === "alice" ? actor : null,
      });
      const response = await federation.fetch(post(inboxUrl(), json), {
        contextData: undefined,
      });
      assertEquals(response.status, 404);
      assertEquals(received.length, 0);
    });
  }
});

test("forwardPortableInboxActivity() deduplicates compatible activity IDs", async () => {
  const kv = new MemoryKvStore();
  const queue = new RecordingQueue();
  const forward = (activityId: URL) =>
    forwardPortableInboxActivity({
      recipient: {
        actorId: compatibleAlice().id,
        inboxId: parseIri(`ap+ef61://${did}/users/alice/inbox`),
        canonicalInboxId: `ap+ef61://${did}/users/alice/inbox`,
        gateways: [new URL(LOCAL), new URL(GATEWAY2)],
      },
      activity: { id: activityId.href },
      activityId,
      activityType: "https://www.w3.org/ns/activitystreams#Follow",
      excludedOrigins: [LOCAL],
      baseUrl: LOCAL,
      kv,
      kvPrefix: ["_fedify", "portableInboxForwarding"],
      outboxQueue: queue,
    });
  const path = `${did}/follows/compatible`;
  assertEquals(
    (await forward(new URL(`${LOCAL}/.well-known/apgateway/${path}`))).length,
    1,
  );
  // The same activity in another representation is not forwarded again:
  for (
    const id of [
      new URL(`${GATEWAY2}/.well-known/apgateway/${path}`),
      new URL(`${LOCAL}/.well-known/apgateway/${path}?x=1`),
      parseIri(`ap://${path}`),
    ]
  ) {
    assertEquals(await forward(id), [], id.href);
  }
  assertEquals(queue.outbox.length, 1);
});

// Gateway keys

const aliceId = parseIri(`ap+ef61://${did}/users/alice`);
const rsaGatewayKeyPair = await crypto.subtle.generateKey(
  {
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  },
  true,
  ["sign", "verify"],
) as CryptoKeyPair;

function compatibleAliceId(origin = LOCAL): string {
  return `${origin}/.well-known/apgateway/${did}/users/alice`;
}

function mapAlice(identifier: string): URL | null {
  return identifier === "alice" ? aliceId : null;
}

function signatureKeyId(headers: Headers): string | undefined {
  // Either an RFC 9421 Signature-Input or a draft-cavage Signature header:
  return headers.get("Signature-Input")?.match(/keyid="([^"]+)"/)?.[1] ??
    headers.get("Signature")?.match(/keyId="([^"]+)"/)?.[1];
}

/**
 * Makes a document loader that serves Alice's actor document as the gateway
 * at {@link LOCAL} does: signed by her DID, and embedding the gateway keys in
 * its `assertionMethod`.
 */
async function createGatewayLoader(
  keyPairs: CryptoKeyPair[],
): Promise<DocumentLoader> {
  const { federation } = setup({
    aliceKeyPairs: keyPairs,
    mapPortableActorId: mapAlice,
  });
  const keys = await federation.createContext(new URL(LOCAL))
    .getActorKeyPairs("alice");
  const actor = await signObject(
    new Person({
      id: aliceId,
      inbox: parseIri(`${aliceId.href}/inbox`),
      gateways: [new URL(LOCAL), new URL(GATEWAY2), new URL(GATEWAY3)],
      assertionMethods: keys.map((k) => k.multikey),
    }),
    ed25519PrivateKey,
    keyId,
    { contextLoader: mockDocumentLoader },
  );
  const document = await actor.toJsonLd({ contextLoader: mockDocumentLoader });
  return (url: string): Promise<RemoteDocument> => {
    if (url.replace(/#.*$/, "") !== compatibleAliceId()) {
      return mockDocumentLoader(url);
    }
    return Promise.resolve({
      contextUrl: null,
      documentUrl: url,
      document: structuredClone(document),
    });
  };
}

interface CapturedRequest {
  readonly url: string;
  readonly headers: Headers;
  readonly body: string;
}

function toRequest({ url, headers, body }: CapturedRequest): Request {
  return new Request(url, { method: "POST", headers, body });
}

async function assertSignedBy(
  request: CapturedRequest,
  expectedKeyId: string,
  documentLoader: DocumentLoader,
): Promise<void> {
  assertEquals(signatureKeyId(request.headers), expectedKeyId);
  const result = await verifyRequestDetailed(toRequest(request), {
    documentLoader,
    contextLoader: mockDocumentLoader,
  });
  assert(result.verified, JSON.stringify(result));
  assertEquals(result.key.id?.href, expectedKeyId);
}

/** Records the requests made to the gateways other than {@link LOCAL}. */
function captureGatewayRequests(
  respond: (request: CapturedRequest) => Response = () =>
    new Response(null, { status: 202 }),
): CapturedRequest[] {
  const requests: CapturedRequest[] = [];
  fetchMock.spyGlobal();
  for (const gateway of [GATEWAY2, GATEWAY3]) {
    fetchMock.post(`begin:${gateway}/`, async (callLog) => {
      const request = callLog.request!;
      const captured = {
        url: request.url,
        headers: new Headers(request.headers),
        body: await request.text(),
      };
      requests.push(captured);
      return respond(captured);
    });
  }
  return requests;
}

test("Federation.fetch() signs forwarded portable inbox deliveries with gateway keys", async (t) => {
  const keyOrders: [string, CryptoKeyPair[], string][] = [
    ["RSA key first", [rsaGatewayKeyPair, otherKeyPair], "#main-key"],
    ["Ed25519 key first", [otherKeyPair, rsaGatewayKeyPair], "#key-2"],
  ];
  for (const [name, aliceKeyPairs, fragment] of keyOrders) {
    await t.step(name, async () => {
      const requests = captureGatewayRequests();
      try {
        const kv = new MemoryKvStore();
        const { federation, received } = setup({
          kv,
          aliceKeyPairs,
          mapPortableActorId: mapAlice,
          // The mocked gateways are not resolved:
          options: { allowPrivateAddress: true },
        });
        const json = await signedFollow();
        const response = await federation.fetch(post(inboxUrl(), json), {
          contextData: undefined,
        });
        assertEquals(response.status, 202);
        assertEquals(received.length, 1);
        assertEquals(requests.map((r) => r.url).sort(), [
          inboxUrl(did, "/users/alice/inbox", GATEWAY3),
          inboxUrl(did, "/users/alice/inbox", GATEWAY2),
        ]);
        const loader = await createGatewayLoader(aliceKeyPairs);
        for (const request of requests) {
          await assertSignedBy(request, compatibleAliceId() + fragment, loader);
          assertEquals(JSON.parse(request.body), json);
        }
        // The negotiated spec is cached as for other deliveries:
        assertEquals(
          await kv.get(["_fedify", "httpMessageSignaturesSpec", GATEWAY2]),
          "rfc9421",
        );
      } finally {
        fetchMock.hardReset();
      }
    });
  }
});

test("Federation.fetch() signs queued forwarded portable inbox deliveries with gateway keys", async () => {
  const queue = new RecordingQueue();
  const aliceKeyPairs = [otherKeyPair, rsaGatewayKeyPair];
  const { federation } = setup({
    queue,
    aliceKeyPairs,
    mapPortableActorId: mapAlice,
    // The mocked gateways are not resolved:
    options: { allowPrivateAddress: true },
  });
  const response = await federation.fetch(
    post(inboxUrl(), await signedFollow()),
    { contextData: undefined },
  );
  assertEquals(response.status, 202);
  assertEquals(queue.outbox.length, 2);
  const expectedKeyId = `${compatibleAliceId()}#key-2`;
  for (const message of queue.outbox) {
    // Only the RSA key, which signs the request, is queued:
    assertEquals(message.keys.map((k) => k.keyId), [expectedKeyId]);
    assertEquals(message.keys[0].privateKey.kty, "RSA");
  }
  const requests = captureGatewayRequests();
  try {
    for (const message of queue.outbox) {
      await federation.processQueuedTask(undefined, message);
    }
  } finally {
    fetchMock.hardReset();
  }
  assertEquals(requests.length, 2);
  const loader = await createGatewayLoader(aliceKeyPairs);
  for (const request of requests) {
    await assertSignedBy(request, expectedKeyId, loader);
  }
});

test("Federation.fetch() forwards portable inbox deliveries unsigned without gateway keys", async (t) => {
  const otherActorId = parseIri(`ap+ef61://${otherDid}/users/alice`);
  const cases: [string, Setup][] = [
    ["without a mapper", { aliceKeyPairs: [rsaGatewayKeyPair] }],
    ["the mapper returns null", {
      aliceKeyPairs: [rsaGatewayKeyPair],
      mapPortableActorId: () => null,
    }],
    ["the mapper returns another actor", {
      aliceKeyPairs: [rsaGatewayKeyPair],
      mapPortableActorId: () => otherActorId,
    }],
    ["the mapper returns another actor of the same DID", {
      aliceKeyPairs: [rsaGatewayKeyPair],
      mapPortableActorId: () => parseIri(`ap+ef61://${did}/users/bob`),
    }],
    ["without a key pairs dispatcher", {
      keyPairs: false,
      mapPortableActorId: mapAlice,
    }],
    ["without key pairs", { mapPortableActorId: mapAlice }],
    ["without an RSA key", {
      aliceKeyPairs: [otherKeyPair],
      mapPortableActorId: mapAlice,
    }],
  ];
  for (const [name, options] of cases) {
    await t.step(name, async () => {
      const queue = new RecordingQueue();
      const { federation, received } = setup({ ...options, queue });
      const response = await federation.fetch(
        post(inboxUrl(), await signedFollow()),
        { contextData: undefined },
      );
      assertEquals(response.status, 202);
      assertEquals(received.length, 1);
      assertEquals(queue.outbox.length, 2);
      for (const message of queue.outbox) assertEquals(message.keys, []);
    });
  }
});

test("Federation.fetch() signs forwarded portable inbox deliveries if the mapper returns an equivalent ID", async (t) => {
  const ids: [string, URL][] = [
    ["ap: URI", parseIri(`ap://${did}/users/alice`)],
    [
      "percent-encoded DID",
      parseIri(
        `ap+ef61://${did.replaceAll(":", "%3A")}/users/alice`,
      ),
    ],
    ["compatible identifier", new URL(compatibleAliceId(GATEWAY2))],
  ];
  for (const [name, id] of ids) {
    await t.step(name, async () => {
      const queue = new RecordingQueue();
      const { federation } = setup({
        queue,
        aliceKeyPairs: [rsaGatewayKeyPair],
        mapPortableActorId: (identifier) => identifier === "alice" ? id : null,
      });
      const response = await federation.fetch(
        post(inboxUrl(), await signedFollow()),
        { contextData: undefined },
      );
      assertEquals(response.status, 202);
      assertEquals(queue.outbox.length, 2);
      for (const message of queue.outbox) {
        assertEquals(message.keys.map((k) => k.keyId), [
          `${compatibleAliceId()}#main-key`,
        ]);
      }
    });
  }
});

test("Federation.fetch() signs forwarded portable inbox deliveries with the gateway keys of the canonical origin", async () => {
  const queue = new RecordingQueue();
  const { federation } = setup({
    queue,
    gateways: [GATEWAY2, LOCAL, GATEWAY3],
    aliceKeyPairs: [rsaGatewayKeyPair],
    mapPortableActorId: mapAlice,
    options: { origin: GATEWAY2 },
  });
  // The request is made to example.com, but this server is example.org:
  const response = await federation.fetch(
    post(inboxUrl(), await signedFollow()),
    { contextData: undefined },
  );
  assertEquals(response.status, 202);
  assertEquals(queue.outbox.length, 1);
  assertEquals(queue.outbox[0].keys.map((k) => k.keyId), [
    `${compatibleAliceId(GATEWAY2)}#main-key`,
  ]);
});

test("Federation.fetch() double-knocks forwarded portable inbox deliveries", async (t) => {
  await t.step("firstKnock", async () => {
    const requests = captureGatewayRequests();
    try {
      const { federation } = setup({
        aliceKeyPairs: [rsaGatewayKeyPair],
        mapPortableActorId: mapAlice,
        options: {
          allowPrivateAddress: true,
          firstKnock: "draft-cavage-http-signatures-12",
        },
      });
      const response = await federation.fetch(
        post(inboxUrl(), await signedFollow()),
        { contextData: undefined },
      );
      assertEquals(response.status, 202);
      assertEquals(requests.length, 2);
      for (const request of requests) {
        assert(request.headers.has("Signature"));
        assertFalse(request.headers.has("Signature-Input"));
      }
    } finally {
      fetchMock.hardReset();
    }
  });

  await t.step("falls back to the other spec", async () => {
    // The gateways reject RFC 9421 signatures:
    const requests = captureGatewayRequests((request) =>
      new Response(null, {
        status: request.headers.has("Signature-Input") ? 401 : 202,
      })
    );
    try {
      const kv = new MemoryKvStore();
      const { federation } = setup({
        kv,
        aliceKeyPairs: [rsaGatewayKeyPair],
        mapPortableActorId: mapAlice,
        options: { allowPrivateAddress: true },
      });
      const response = await federation.fetch(
        post(inboxUrl(), await signedFollow()),
        { contextData: undefined },
      );
      assertEquals(response.status, 202);
      assertEquals(requests.length, 4);
      const loader = await createGatewayLoader([rsaGatewayKeyPair]);
      for (const request of requests) {
        if (request.headers.has("Signature-Input")) continue;
        await assertSignedBy(
          request,
          `${compatibleAliceId()}#main-key`,
          loader,
        );
      }
      assertEquals(
        await kv.get(["_fedify", "httpMessageSignaturesSpec", GATEWAY2]),
        "draft-cavage-http-signatures-12",
      );
    } finally {
      fetchMock.hardReset();
    }
  });
});

test("A Fedify gateway accepts signed forwarded portable inbox deliveries", async () => {
  const requests = captureGatewayRequests();
  let forwarded: CapturedRequest;
  try {
    const { federation } = setup({
      aliceKeyPairs: [rsaGatewayKeyPair],
      mapPortableActorId: mapAlice,
      options: { allowPrivateAddress: true },
    });
    const response = await federation.fetch(
      post(inboxUrl(), await signedFollow()),
      { contextData: undefined },
    );
    assertEquals(response.status, 202);
    forwarded = requests.find((r) => r.url.startsWith(`${GATEWAY2}/`))!;
  } finally {
    fetchMock.hardReset();
  }
  // The inbox does not check HTTP Signatures of activities authenticated by
  // their proofs, so the signature is verified separately:
  await assertSignedBy(
    forwarded,
    `${compatibleAliceId()}#main-key`,
    await createGatewayLoader([rsaGatewayKeyPair]),
  );
  const queue = new RecordingQueue();
  const { federation, received } = setup({
    queue,
    options: { origin: GATEWAY2 },
  });
  const response = await federation.fetch(toRequest(forwarded), {
    contextData: undefined,
  });
  assertEquals(response.status, 202);
  assertEquals(received.length, 1);
  assertEquals(received[0].recipient, "alice");
  // The gateway forwards it on, except back to itself:
  assertEquals(queue.outbox.map((m) => m.inbox).sort(), [
    inboxUrl(did, "/users/alice/inbox", LOCAL),
    inboxUrl(did, "/users/alice/inbox", GATEWAY3),
  ]);
});

function forwardingParameters(
  overrides: Partial<ForwardPortableInboxActivityParameters> = {},
): ForwardPortableInboxActivityParameters {
  const activityId = parseIri(
    `ap+ef61://${did}/follows/${++activityCounter}`,
  );
  return {
    recipient: {
      actorId: aliceId,
      inboxId: parseIri(`ap+ef61://${did}/users/alice/inbox`),
      canonicalInboxId: `ap://${did}/users/alice/inbox`,
      gateways: [new URL(LOCAL), new URL(GATEWAY2)],
    },
    activity: { id: formatIri(activityId) },
    activityId,
    activityType: "https://www.w3.org/ns/activitystreams#Follow",
    excludedOrigins: [LOCAL],
    baseUrl: LOCAL,
    kv: new MemoryKvStore(),
    kvPrefix: ["_fedify", "portableInboxForwarding"],
    // The mocked gateway is not resolved:
    allowPrivateAddress: true,
    ...overrides,
  };
}

const gatewayKey = {
  keyId: new URL(`${compatibleAliceId()}#main-key`),
  privateKey: rsaGatewayKeyPair.privateKey,
};

test("forwardPortableInboxActivity() gets keys only when it forwards", async () => {
  let calls = 0;
  const parameters = forwardingParameters({
    outboxQueue: new RecordingQueue(),
    getKeys: () => {
      calls++;
      return Promise.resolve([gatewayKey]);
    },
  });
  assertEquals((await forwardPortableInboxActivity(parameters)).length, 1);
  assertEquals(calls, 1);
  // Nothing is claimed for a duplicate, so no keys are needed:
  assertEquals(await forwardPortableInboxActivity(parameters), []);
  assertEquals(calls, 1);
});

test("forwardPortableInboxActivity() forwards unsigned if it cannot get keys", async (t) => {
  const nonExtractable = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    false,
    ["sign", "verify"],
  ) as CryptoKeyPair;
  const getKeysCases: [string, () => Promise<SenderKeyPair[]>][] = [
    ["getKeys() rejects", () => Promise.reject(new Error("Unavailable."))],
    ["the key is not extractable", () =>
      Promise.resolve([{
        keyId: gatewayKey.keyId,
        privateKey: nonExtractable.privateKey,
      }])],
  ];
  for (const [name, getKeys] of getKeysCases) {
    await t.step(`${name} (queued)`, async () => {
      const queue = new RecordingQueue();
      const forwarded = await forwardPortableInboxActivity(
        forwardingParameters({ outboxQueue: queue, getKeys }),
      );
      assertEquals(forwarded.length, 1);
      assertEquals(queue.outbox.length, 1);
      assertEquals(queue.outbox[0].keys, []);
    });
    await t.step(`${name} (immediate)`, async () => {
      const requests = captureGatewayRequests();
      try {
        const forwarded = await forwardPortableInboxActivity(
          forwardingParameters({ getKeys }),
        );
        assertEquals(forwarded.length, 1);
      } finally {
        fetchMock.hardReset();
      }
      assertEquals(requests.length, 1);
      assertEquals(signatureKeyId(requests[0].headers), undefined);
    });
  }
});

test("forwardPortableInboxActivity() does not wait for slow keys", async () => {
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => release = resolve);
  const requests = captureGatewayRequests();
  try {
    const started = performance.now();
    const forwarded = await forwardPortableInboxActivity(
      forwardingParameters({
        options: resolvePortableInboxForwardingOptions({
          deadline: { milliseconds: 10 },
        }),
        getKeys: async () => {
          await pending;
          throw new Error("Unavailable.");
        },
      }),
    );
    assert(performance.now() - started < 5_000);
    assertEquals(forwarded.length, 1);
    assertEquals(requests.length, 0);
    // The late failure is handled, and the activity is forwarded unsigned:
    release();
    for (let i = 0; i < 100 && requests.length < 1; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assertEquals(requests.length, 1);
    assertEquals(signatureKeyId(requests[0].headers), undefined);
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
