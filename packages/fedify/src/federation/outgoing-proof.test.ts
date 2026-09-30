import { mockDocumentLoader, test } from "@fedify/fixture";
import { Accept, Announce, Create, Follow, Note, Person } from "@fedify/vocab";
import { exportDidKey, parseIri } from "@fedify/vocab-runtime";
import { configure, type LogRecord, reset } from "@logtape/logtape";
import { assert, assertEquals, assertRejects } from "@std/assert";
import fetchMock from "fetch-mock";
import {
  ed25519PrivateKey,
  ed25519PublicKey,
  rsaPrivateKey2,
  rsaPublicKey2,
} from "../testing/keys.ts";
import { verifyCompoundPortableObjectProofs } from "../sig/compound-proof.ts";
import { detachSignature } from "../sig/ld.ts";
import { signObject } from "../sig/proof.ts";
import { exportJwk } from "../sig/key.ts";
import { MemoryKvStore } from "./kv.ts";
import {
  getCompactRootId,
  getEmbeddedFirstGateway,
  warnCompatibleIdsInJson,
} from "./compatible-id-warning.ts";
import { createFederation, FederationImpl } from "./middleware.ts";
import type { MessageQueue } from "./mq.ts";
import { assertPortableActorActivity } from "./outgoing-proof.ts";
import type { FanoutMessage, Message } from "./queue.ts";
import type { SenderKeyPair } from "./send.ts";

const options = {
  contextLoader: mockDocumentLoader,
  documentLoader: mockDocumentLoader,
};
const created = Temporal.Instant.from("2023-02-24T23:36:38Z");
const childContext = [
  "https://www.w3.org/ns/activitystreams",
  "https://w3id.org/security/data-integrity/v1",
  { ex: "https://example.com/ns#" },
];
const limits = {
  maxDepth: 64,
  maxMaps: 10_000,
  maxProofs: 32,
  maxBytes: 10 * 1024 * 1024,
};
const recipient = {
  id: new URL("https://example.com/users/bob"),
  inboxId: new URL("https://example.com/inbox"),
};
const rsaKey: SenderKeyPair = {
  keyId: rsaPublicKey2.id!,
  privateKey: rsaPrivateKey2,
};

interface DidKey {
  readonly did: string;
  readonly keyId: URL;
  readonly privateKey: CryptoKey;
  readonly publicKey: CryptoKey;
}

async function didKey(
  pair?: { privateKey: CryptoKey; publicKey: CryptoKey },
): Promise<DidKey> {
  const { privateKey, publicKey } = pair ??
    await crypto.subtle.generateKey("Ed25519", true, [
      "sign",
      "verify",
    ]) as CryptoKeyPair;
  const did = await exportDidKey(publicKey);
  return {
    did,
    keyId: new URL(`${did}#${did.substring("did:key:".length)}`),
    privateKey,
    publicKey,
  };
}

function sender(key: DidKey | SenderKeyPair): SenderKeyPair {
  return { keyId: key.keyId, privateKey: key.privateKey };
}

async function signedChild(owner: DidKey): Promise<Note> {
  return await signObject(
    new Note({
      id: parseIri(`ap+ef61://${owner.did}/objects/${crypto.randomUUID()}`),
      attribution: parseIri(`ap+ef61://${owner.did}/actor`),
      content: "A portable note",
    }),
    owner.privateKey,
    owner.keyId,
    { ...options, context: childContext, created },
  );
}

function portableCreate(owner: DidKey, object: Note): Create {
  return new Create({
    id: parseIri(`ap+ef61://${owner.did}/activities/${crypto.randomUUID()}`),
    actor: parseIri(`ap+ef61://${owner.did}/actor`),
    object,
  });
}

function httpCreate(object?: Note): Create {
  return new Create({
    id: new URL(`https://example.com/activities/${crypto.randomUUID()}`),
    actor: new URL("https://example.com/users/alice"),
    object,
  });
}

function createQueue(): { queue: MessageQueue; queued: Message[] } {
  const queued: Message[] = [];
  return {
    queued,
    queue: {
      enqueue(message) {
        queued.push(message as Message);
        return Promise.resolve();
      },
      listen() {
        return Promise.resolve();
      },
    },
  };
}

function createTestFederation(queue?: MessageQueue): FederationImpl<void> {
  const federation = new FederationImpl<void>({
    kv: new MemoryKvStore(),
    queue,
    manuallyStartQueue: true,
    contextLoaderFactory: () => mockDocumentLoader,
    documentLoaderFactory: () => mockDocumentLoader,
  });
  federation.setInboxListeners("/users/{identifier}/inbox", "/inbox");
  return federation;
}

/**
 * Captures what is POSTed to the recipient's inbox while `run` executes.
 */
async function capture(
  run: () => Promise<unknown>,
): Promise<{ bodies: Record<string, unknown>[]; requests: Request[] }> {
  const bodies: Record<string, unknown>[] = [];
  const requests: Request[] = [];
  fetchMock.spyGlobal();
  try {
    fetchMock.post(recipient.inboxId.href, async (cl) => {
      const body = await cl.request!.text();
      requests.push(
        new Request(cl.request!.url, {
          method: cl.request!.method,
          headers: cl.request!.headers,
          body,
        }),
      );
      bodies.push(JSON.parse(body));
      return new Response(null, { status: 202 });
    });
    await run();
  } finally {
    fetchMock.hardReset();
  }
  return { bodies, requests };
}

function proofOf(document: Record<string, unknown>): Record<string, unknown> {
  const proof = document.proof;
  assert(
    proof != null && typeof proof === "object" && !Array.isArray(proof),
    `expected exactly one direct proof, got ${JSON.stringify(proof)}`,
  );
  return proof as Record<string, unknown>;
}

async function assertCompoundVerifies(
  body: Record<string, unknown>,
): Promise<void> {
  // The Linked Data Signature Fedify adds for its RSA key is not part of the
  // Object Integrity Proof's input.
  const result = await verifyCompoundPortableObjectProofs(
    detachSignature(body),
    limits,
    options,
  );
  assertEquals(result.status, "ok");
  assert(result.status === "ok" && result.verified);
}

test("a portable activity with one Ed25519 key gets one direct proof", async () => {
  const owner = await didKey();
  const child = await signedChild(await didKey());
  const federation = createTestFederation();
  const ctx = federation.createContext(new URL("https://example.com/"));
  const { bodies, requests } = await capture(() =>
    ctx.sendActivity(
      [rsaKey, sender(owner)],
      recipient,
      portableCreate(owner, child),
    )
  );
  assertEquals(bodies.length, 1);
  assertEquals(proofOf(bodies[0]).verificationMethod, owner.keyId.href);
  // The RSA key still signs the request, but not the document: a portable
  // actor's activity is authenticated only by its DID's proof.
  assert(requests[0].headers.has("Signature"));
  assertEquals(bodies[0].signature, undefined);
  await assertCompoundVerifies(bodies[0]);
});

test("a portable activity is signed only by the key matching its DID", async () => {
  const owner = await didKey();
  const other = await didKey();
  const childOwner = await didKey();
  const child = await signedChild(childOwner);
  for (const keys of [[other, owner], [owner, other]]) {
    const federation = createTestFederation();
    const ctx = federation.createContext(new URL("https://example.com/"));
    const { bodies, requests } = await capture(() =>
      ctx.sendActivity(
        // The child owner's key does not match the activity's DID either.
        [rsaKey, ...keys.map(sender), sender(childOwner)],
        recipient,
        portableCreate(owner, child),
      )
    );
    assertEquals(bodies.length, 1);
    assertEquals(proofOf(bodies[0]).verificationMethod, owner.keyId.href);
    assert(requests[0].headers.has("Signature"));
    const embedded = bodies[0].object as Record<string, unknown>;
    assertEquals(embedded["@context"], childContext);
    assertEquals(proofOf(embedded).verificationMethod, childOwner.keyId.href);
    await assertCompoundVerifies(bodies[0]);
  }
});

test("a portable activity without exactly one DID-matching key is rejected", async () => {
  const owner = await didKey();
  const child = await signedChild(await didKey());
  const cases: [string, SenderKeyPair[], string][] = [
    [
      "no key matches",
      [sender(await didKey()), sender(await didKey())],
      "none of its 2 Ed25519 keys",
    ],
    [
      // A portable URL shares the DID origin but is not a DID URL.  Such
      // a key ID only names a key for HTTP Signatures, so it is not even
      // a candidate:
      "a same-origin key ID is not a DID URL",
      [
        {
          keyId: parseIri(`ap+ef61://${owner.did}/actor#main-key`),
          privateKey: owner.privateKey,
        },
        sender(await didKey()),
      ],
      "none of its 1 Ed25519 keys",
    ],
    [
      "several keys match",
      [
        sender(owner),
        { keyId: new URL(`${owner.did}#second`), privateKey: owner.privateKey },
      ],
      "2 of its Ed25519 keys",
    ],
  ];
  for (const [name, keys, message] of cases) {
    const federation = createTestFederation();
    const ctx = federation.createContext(new URL("https://example.com/"));
    const { bodies } = await capture(() =>
      assertRejects(
        () =>
          ctx.sendActivity(
            [rsaKey, ...keys],
            recipient,
            portableCreate(owner, child),
          ),
        TypeError,
        message,
      )
    );
    assertEquals(bodies.length, 0, name);
  }
});

test("a non-portable activity embedding portable objects needs one key", async () => {
  const child = await signedChild(await didKey());
  const federation = createTestFederation();
  const ctx = federation.createContext(new URL("https://example.com/"));
  const keys = [sender(await didKey()), sender(await didKey())];
  const rejected = await capture(() =>
    assertRejects(
      () =>
        ctx.sendActivity(
          [rsaKey, ...keys],
          recipient,
          httpCreate(child),
        ),
      TypeError,
      "exactly one Ed25519 key",
    )
  );
  assertEquals(rejected.bodies.length, 0);

  const key = { keyId: ed25519PublicKey.id!, privateKey: ed25519PrivateKey };
  const accepted = await capture(() =>
    ctx.sendActivity([rsaKey, key], recipient, httpCreate(child))
  );
  assertEquals(accepted.bodies.length, 1);
  assertEquals(
    proofOf(accepted.bodies[0]).verificationMethod,
    ed25519PublicKey.id!.href,
  );
});

test("a non-portable activity embedding compatible-ID objects needs one key", async () => {
  // A portable object identified by its compatible identifier, e.g., one
  // received from tootik, embedded in an ordinary actor's activity:
  const owner = await didKey();
  const compatibleId = (path: string) =>
    new URL(`https://gw.example/.well-known/apgateway/${owner.did}${path}`);
  const child = await signObject(
    new Note({
      id: compatibleId(`/objects/${crypto.randomUUID()}`),
      attribution: compatibleId("/actor"),
      content: "A portable note",
    }),
    owner.privateKey,
    owner.keyId,
    { ...options, context: childContext, created },
  );
  const federation = createTestFederation();
  const ctx = federation.createContext(new URL("https://example.com/"));
  const keys = [sender(await didKey()), sender(await didKey())];
  const rejected = await capture(() =>
    assertRejects(
      () =>
        ctx.sendActivity(
          [rsaKey, ...keys],
          recipient,
          httpCreate(child),
        ),
      TypeError,
      "exactly one Ed25519 key",
    )
  );
  assertEquals(rejected.bodies.length, 0);

  const key = { keyId: ed25519PublicKey.id!, privateKey: ed25519PrivateKey };
  const accepted = await capture(() =>
    ctx.sendActivity([rsaKey, key], recipient, httpCreate(child))
  );
  assertEquals(accepted.bodies.length, 1);
  // What Fedify sends, a Fedify inbox accepts:
  await assertCompoundVerifies(accepted.bodies[0]);
});

test("an activity without portable objects is still signed by every key", async () => {
  const federation = createTestFederation();
  const ctx = federation.createContext(new URL("https://example.com/"));
  const keys = [await didKey(), await didKey()];
  const { bodies } = await capture(() =>
    ctx.sendActivity(
      [rsaKey, ...keys.map(sender)],
      recipient,
      httpCreate(new Note({ content: "Hello" })),
    )
  );
  assertEquals(bodies.length, 1);
  const proofs = bodies[0].proof as Record<string, unknown>[];
  assert(Array.isArray(proofs));
  assertEquals(
    proofs.map((proof) => proof.verificationMethod),
    keys.map((key) => key.keyId.href),
  );
});

test("a pre-signed portable activity is not re-signed", async () => {
  const owner = await didKey();
  const activity = await signObject(
    portableCreate(owner, await signedChild(await didKey())),
    owner.privateKey,
    owner.keyId,
    { ...options, created },
  );
  const federation = createTestFederation();
  const ctx = federation.createContext(new URL("https://example.com/"));
  // Neither key matches the activity's DID, but no key needs choosing.
  const keys = [sender(await didKey()), sender(await didKey())];
  const { bodies } = await capture(() =>
    ctx.sendActivity(
      [rsaKey, ...keys],
      recipient,
      activity,
    )
  );
  assertEquals(bodies.length, 1);
  assertEquals(proofOf(bodies[0]).verificationMethod, owner.keyId.href);
  await assertCompoundVerifies(bodies[0]);
});

test("a portable activity carrying a proof set is not delivered", async () => {
  const owner = await didKey();
  const second = {
    ...owner,
    keyId: new URL(`${owner.did}#second`),
  };
  let activity: Create = portableCreate(owner, await signedChild(owner));
  for (const key of [owner, second]) {
    activity = await signObject(activity, key.privateKey, key.keyId, {
      ...options,
      created,
    });
  }

  // Immediate delivery.
  const immediate = await capture(() =>
    assertRejects(
      () =>
        createTestFederation().createContext(
          new URL("https://example.com/"),
        ).sendActivity(rsaKey, recipient, activity),
      TypeError,
      'JSON Pointer "/proof"',
    )
  );
  assertEquals(immediate.bodies.length, 0);

  // The ordinary outbox queue.
  const outbox = createQueue();
  await assertRejects(
    () =>
      createTestFederation(outbox.queue).createContext(
        new URL("https://example.com/"),
      ).sendActivity(rsaKey, recipient, activity, { fanout: "skip" }),
    TypeError,
    'JSON Pointer "/proof"',
  );
  assertEquals(outbox.queued.length, 0);

  // The fanout queue.
  const fanout = createQueue();
  await assertRejects(
    () =>
      createTestFederation(fanout.queue).createContext(
        new URL("https://example.com/"),
      ).sendActivity(rsaKey, recipient, activity, { fanout: "force" }),
    TypeError,
    'JSON Pointer "/proof"',
  );
  assertEquals(fanout.queued.length, 0);
});

test("a proof set on an embedded map is not delivered either", async () => {
  const owner = await didKey();
  let child: Note = await signedChild(owner);
  child = await signObject(child, owner.privateKey, new URL(`${owner.did}#b`), {
    ...options,
    created,
  });
  const federation = createTestFederation();
  const ctx = federation.createContext(new URL("https://example.com/"));
  const { bodies } = await capture(() =>
    assertRejects(
      // No Ed25519 key at all, so the guard is the only thing in the way.
      () => ctx.sendActivity(rsaKey, recipient, httpCreate(child)),
      TypeError,
      'JSON Pointer "/object/proof"',
    )
  );
  assertEquals(bodies.length, 0);
});

test("a received signed object rebuilt inside a portable activity is not delivered", async () => {
  // A Follow that a Fedify server signed with an Object Integrity Proof, as
  // Fedify does by default, parsed as an inbox listener receives it:
  const followerKey = await didKey();
  const signedFollow = await signObject(
    new Follow({
      id: new URL("https://example.com/follows/1"),
      actor: new URL("https://example.com/users/bob"),
      object: parseIri("ap+ef61://did:key:z6Mkabc/actor"),
    }),
    followerKey.privateKey,
    new URL("https://example.com/users/bob#key"),
    { ...options, created },
  );
  const follow = await Follow.fromJsonLd(
    await signedFollow.toJsonLd({ format: "compact", ...options }),
    options,
  );
  const owner = await didKey();
  const accept = (object: Follow | URL) =>
    new Accept({
      id: parseIri(`ap+ef61://${owner.did}/accepts/${crypto.randomUUID()}`),
      actor: parseIri(`ap+ef61://${owner.did}/actor`),
      object,
    });

  // Embedding the parsed Follow rebuilds it under the Accept's context, so its
  // proof cannot verify on its own, and Fedify inboxes would reject
  // the Accept for it.  Whether signed here or beforehand, it is rejected:
  const unsigned = accept(follow);
  const presigned = await signObject(
    accept(follow),
    owner.privateKey,
    owner.keyId,
    { ...options, created },
  );
  const cases: [Accept, SenderKeyPair[]][] = [
    [unsigned, [rsaKey, sender(owner)]],
    [presigned, [rsaKey]],
  ];
  for (const [activity, keys] of cases) {
    const immediate = await capture(() =>
      assertRejects(
        () =>
          createTestFederation().createContext(
            new URL("https://example.com/"),
          ).sendActivity(keys, recipient, activity),
        TypeError,
        'JSON Pointer "/object"',
      )
    );
    assertEquals(immediate.bodies.length, 0);
    const fanout = createQueue();
    await assertRejects(
      () =>
        createTestFederation(fanout.queue).createContext(
          new URL("https://example.com/"),
        ).sendActivity(keys, recipient, activity, { fanout: "force" }),
      TypeError,
      'JSON Pointer "/object"',
    );
    assertEquals(fanout.queued.length, 0);
  }

  // Referring to the Follow by its ID works:
  const { bodies } = await capture(() =>
    createTestFederation().createContext(
      new URL("https://example.com/"),
    ).sendActivity([rsaKey, sender(owner)], recipient, accept(follow.id!))
  );
  assertEquals(bodies.length, 1);
  await assertCompoundVerifies(bodies[0]);
});

test("forced fanout selects the DID-matching key before enqueueing", async () => {
  const owner = await didKey();
  const childOwner = await didKey();
  const child = await signedChild(childOwner);
  const { queue, queued } = createQueue();
  const federation = createTestFederation(queue);
  const ctx = federation.createContext(new URL("https://example.com/"));
  const { bodies } = await capture(async () => {
    await ctx.sendActivity(
      [rsaKey, sender(await didKey()), sender(owner)],
      recipient,
      portableCreate(owner, child),
      { fanout: "force" },
    );
    assertEquals(queued.length, 1);
    const message = queued[0] as FanoutMessage;
    assertEquals(message.type, "fanout");
    // Every transport key still travels with the message.
    assertEquals(message.keys.length, 3);
    assertEquals(message.keys[0].keyId, rsaKey.keyId.href);
    for (let i = 0; i < queued.length; i++) {
      await federation.processQueuedTask(undefined, queued[i]);
    }
  });
  assertEquals(bodies.length, 1);
  assertEquals(proofOf(bodies[0]).verificationMethod, owner.keyId.href);
  // The worker did not rebuild the signed child under the parent's context.
  const embedded = bodies[0].object as Record<string, unknown>;
  assertEquals(embedded["@context"], childContext);
  assertEquals(proofOf(embedded).verificationMethod, childOwner.keyId.href);
  await assertCompoundVerifies(bodies[0]);
});

test("the fanout worker selects one key for an unsigned portable activity", async () => {
  const owner = await didKey();
  const child = await signedChild(await didKey());
  const federation = createTestFederation();
  const message = async (activity: Create): Promise<FanoutMessage> => ({
    type: "fanout",
    id: crypto.randomUUID(),
    baseUrl: "https://example.com",
    keys: await Promise.all(
      [rsaKey, sender(await didKey()), sender(owner)].map(async (key) => ({
        keyId: key.keyId.href,
        privateKey: await exportJwk(key.privateKey),
      })),
    ),
    inboxes: {
      [recipient.inboxId.href]: {
        actorIds: [recipient.id.href],
        sharedInbox: false,
      },
    },
    activity: await activity.toJsonLd({ format: "compact", ...options }),
    activityId: activity.id!.href,
    activityType: "https://www.w3.org/ns/activitystreams#Create",
    traceContext: {},
  });
  const byId = new Create({
    id: parseIri(`ap+ef61://${owner.did}/activities/${crypto.randomUUID()}`),
    actor: parseIri(`ap+ef61://${owner.did}/actor`),
    object: child.id,
  });
  const { bodies } = await capture(async () =>
    federation.processQueuedTask(undefined, await message(byId))
  );
  assertEquals(bodies.length, 1);
  assertEquals(proofOf(bodies[0]).verificationMethod, owner.keyId.href);
  await assertCompoundVerifies(bodies[0]);

  // Current senders sign an activity before enqueueing it, so the worker
  // delivers the queued document as is.  An unsigned one, e.g., queued by an
  // older version, is parsed and serialized again, which rebuilds a signed
  // child, so it is refused rather than delivered for inboxes to reject:
  const embedded = await message(portableCreate(owner, child));
  const refused = await capture(() =>
    assertRejects(
      () => federation.processQueuedTask(undefined, embedded),
      TypeError,
      'JSON Pointer "/object"',
    )
  );
  assertEquals(refused.bodies.length, 0);
});

test("actor key pairs follow the compound-proof key selection too", async () => {
  const dispatched: { privateKey: CryptoKey; publicKey: CryptoKey }[] = [];
  const federation = createTestFederation();
  federation
    .setActorDispatcher(
      "/users/{identifier}",
      (ctx, identifier) =>
        new Person({
          id: ctx.getActorUri(identifier),
          inbox: ctx.getInboxUri(identifier),
        }),
    )
    .setKeyPairsDispatcher(() => dispatched);
  const ctx = federation.createContext(new URL("https://example.com/"));
  const owner = await didKey();
  const child = await signedChild(await didKey());

  // Dispatched Multikey IDs are not DID URLs, so none of several keys can
  // sign a portable activity.
  const other = await didKey();
  dispatched.push(
    { privateKey: rsaPrivateKey2, publicKey: rsaPublicKey2.publicKey! },
    { privateKey: owner.privateKey, publicKey: owner.publicKey },
    { privateKey: other.privateKey, publicKey: other.publicKey },
  );
  const rejected = await capture(() =>
    assertRejects(
      () =>
        ctx.sendActivity(
          { identifier: "alice" },
          recipient,
          portableCreate(owner, child),
        ),
      TypeError,
      "none of its 2 Ed25519 keys",
    )
  );
  assertEquals(rejected.bodies.length, 0);

  // A portable activity that already carries a proof keeps just that one.
  dispatched.splice(2);
  const presigned = await signObject(
    portableCreate(owner, child),
    owner.privateKey,
    owner.keyId,
    { ...options, created },
  );
  const kept = await capture(() =>
    ctx.sendActivity({ identifier: "alice" }, recipient, presigned)
  );
  assertEquals(kept.bodies.length, 1);
  assertEquals(proofOf(kept.bodies[0]).verificationMethod, owner.keyId.href);

  // Outside the profile, dispatched keys still append to an existing proof.
  const ordinary = await signObject(
    httpCreate(new Note({ content: "Hello" })),
    owner.privateKey,
    owner.keyId,
    { ...options, created },
  );
  const appended = await capture(() =>
    ctx.sendActivity({ identifier: "alice" }, recipient, ordinary)
  );
  assertEquals(appended.bodies.length, 1);
  const proofs = appended.bodies[0].proof as Record<string, unknown>[];
  assert(Array.isArray(proofs));
  assertEquals(proofs.map((proof) => proof.verificationMethod), [
    owner.keyId.href,
    "https://example.com/users/alice#multikey-2",
  ]);
});

test("a Fedify inbox accepts a portable activity Fedify produced", async () => {
  const owner = await didKey();
  const child = await signedChild(await didKey());
  const sending = createTestFederation();
  const ctx = sending.createContext(new URL("https://example.com/"));
  // Without an RSA key, no Linked Data Signature is attached, so the delivered
  // body is exactly what the Object Integrity Proofs cover.
  const other = await didKey();
  const { requests } = await capture(() =>
    ctx.sendActivity(
      [sender(other), sender(owner)],
      recipient,
      portableCreate(owner, child),
    )
  );
  assertEquals(requests.length, 1);

  let received = 0;
  const receiving = createFederation<void>({
    kv: new MemoryKvStore(),
    contextLoaderFactory: () => mockDocumentLoader,
    documentLoaderFactory: () => mockDocumentLoader,
  });
  receiving.setActorDispatcher("/users/{identifier}", () => null);
  receiving
    .setInboxListeners("/users/{identifier}/inbox", "/inbox")
    .on(Create, () => {
      received++;
    });
  const response = await receiving.fetch(requests[0], {
    contextData: undefined,
  });
  assertEquals([response.status, received], [202, 1]);
});

// Compatible-ID actors and activities

const gateway = "https://gw.example";

function compatibleId(
  did: string,
  path: string,
  origin: string = gateway,
): URL {
  return new URL(`${origin}/.well-known/apgateway/${did}${path}`);
}

function compatibleCreate(
  owner: DidKey,
  object?: Note,
  { id, actor }: { id?: URL; actor?: URL } = {},
): Create {
  // As tootik's are, both the activity and the actor are identified by
  // compatible identifiers:
  return new Create({
    id: id ?? compatibleId(owner.did, `/activities/${crypto.randomUUID()}`),
    actor: actor ?? compatibleId(owner.did, "/actor"),
    object,
  });
}

test("a compatible-ID activity is signed only by the key matching its DID", async () => {
  const owner = await didKey();
  const childOwner = await didKey();
  const child = await signedChild(childOwner);
  const federation = createTestFederation();
  const ctx = federation.createContext(new URL("https://example.com/"));
  const { bodies, requests } = await capture(async () =>
    ctx.sendActivity(
      [rsaKey, sender(await didKey()), sender(owner), sender(childOwner)],
      recipient,
      compatibleCreate(owner, child),
    )
  );
  assertEquals(bodies.length, 1);
  assertEquals(proofOf(bodies[0]).verificationMethod, owner.keyId.href);
  // The RSA key signs the request, but not the document, as for an actor
  // with an ap: ID:
  assert(requests[0].headers.has("Signature"));
  assertEquals(bodies[0].signature, undefined);
  await assertCompoundVerifies(bodies[0]);
});

test("a compatible-ID actor's activity needs an ID of the actor's DID", async () => {
  const owner = await didKey();
  const other = await didKey();
  const cases: [string, Create, string][] = [
    [
      "a compatible activity ID of another DID",
      compatibleCreate(owner, undefined, {
        id: compatibleId(other.did, "/activities/1"),
      }),
      "with the same DID",
    ],
    [
      "an ap: activity ID of another DID",
      compatibleCreate(owner, undefined, {
        id: parseIri(`ap://${other.did}/activities/1`),
      }),
      "with the same DID",
    ],
    [
      "an ordinary activity ID",
      compatibleCreate(owner, undefined, {
        id: new URL("https://gw.example/activities/1"),
      }),
      "with the same DID",
    ],
    [
      // FEP-ef61 forbids location hints in compatible identifiers:
      "a malformed compatible activity ID",
      compatibleCreate(owner, undefined, {
        id: new URL(
          compatibleId(owner.did, "/activities/1").href +
            "?@gateway=https%3A%2F%2Fgw.example",
        ),
      }),
      "with the same DID",
    ],
    [
      "a malformed compatible actor ID",
      compatibleCreate(owner, undefined, {
        actor: new URL(
          compatibleId(owner.did, "/actor").href +
            "?@gateway=https%3A%2F%2Fgw.example",
        ),
      }),
      "malformed FEP-ef61 portable ID",
    ],
    [
      "compatible actors of different DIDs",
      new Create({
        id: compatibleId(owner.did, "/activities/1"),
        actors: [
          compatibleId(owner.did, "/actor"),
          compatibleId(other.did, "/actor"),
        ],
      }),
      "different DIDs",
    ],
  ];
  for (const [name, activity, message] of cases) {
    const federation = createTestFederation();
    const ctx = federation.createContext(new URL("https://example.com/"));
    const { bodies } = await capture(() =>
      assertRejects(
        () => ctx.sendActivity([rsaKey, sender(owner)], recipient, activity),
        TypeError,
        message,
      )
    );
    assertEquals(bodies.length, 0, name);
  }
});

test("a compatible-ID activity without exactly one DID-matching key is rejected", async () => {
  const owner = await didKey();
  const cases: [string, SenderKeyPair[], string][] = [
    [
      "no key matches",
      [sender(await didKey())],
      "none of its 1 Ed25519 keys",
    ],
    [
      // A gateway key never signs proofs, even for the actor's own DID:
      "only a gateway key",
      [{
        keyId: compatibleId(owner.did, "/actor#main-key"),
        privateKey: owner.privateKey,
      }],
      "none of its 0 Ed25519 keys",
    ],
    [
      "several keys match",
      [
        sender(owner),
        { keyId: new URL(`${owner.did}#second`), privateKey: owner.privateKey },
      ],
      "2 of its Ed25519 keys",
    ],
  ];
  for (const [name, keys, message] of cases) {
    const federation = createTestFederation();
    const ctx = federation.createContext(new URL("https://example.com/"));
    const { bodies } = await capture(() =>
      assertRejects(
        () =>
          ctx.sendActivity(
            [rsaKey, ...keys],
            recipient,
            compatibleCreate(owner),
          ),
        TypeError,
        message,
      )
    );
    assertEquals(bodies.length, 0, name);
  }
});

test("compatible and ap: IDs of the same DID can be mixed", async () => {
  const owner = await didKey();
  const activities = [
    compatibleCreate(owner, undefined, {
      id: parseIri(`ap://${owner.did}/activities/${crypto.randomUUID()}`),
    }),
    compatibleCreate(owner, undefined, {
      actor: parseIri(`ap+ef61://${owner.did}/actor`),
    }),
    // FEP-ef61 treats objects on different gateways as instances of the same
    // object, so an activity on another gateway is still the actor's:
    compatibleCreate(owner, undefined, {
      id: compatibleId(owner.did, "/activities/1", "https://other.example"),
    }),
  ];
  for (const activity of activities) {
    const federation = createTestFederation();
    const ctx = federation.createContext(new URL("https://example.com/"));
    const { bodies } = await capture(async () =>
      ctx.sendActivity(
        [rsaKey, sender(await didKey()), sender(owner)],
        recipient,
        activity,
      )
    );
    assertEquals(bodies.length, 1, activity.id?.href);
    assertEquals(proofOf(bodies[0]).verificationMethod, owner.keyId.href);
  }
});

test("a pre-signed compatible-ID activity is not re-signed", async () => {
  const owner = await didKey();
  const activity = await signObject(
    compatibleCreate(owner, await signedChild(await didKey())),
    owner.privateKey,
    owner.keyId,
    { ...options, created },
  );
  const federation = createTestFederation();
  const ctx = federation.createContext(new URL("https://example.com/"));
  const { bodies } = await capture(async () =>
    ctx.sendActivity(
      [rsaKey, sender(await didKey()), sender(await didKey())],
      recipient,
      activity,
    )
  );
  assertEquals(bodies.length, 1);
  assertEquals(proofOf(bodies[0]).verificationMethod, owner.keyId.href);
  await assertCompoundVerifies(bodies[0]);
});

test("forced fanout selects the DID-matching key for a compatible-ID activity", async () => {
  const owner = await didKey();
  const { queue, queued } = createQueue();
  const federation = createTestFederation(queue);
  const ctx = federation.createContext(new URL("https://example.com/"));
  const { bodies } = await capture(async () => {
    await ctx.sendActivity(
      [rsaKey, sender(await didKey()), sender(owner)],
      recipient,
      compatibleCreate(owner, await signedChild(await didKey())),
      { fanout: "force" },
    );
    assertEquals(queued.length, 1);
    for (let i = 0; i < queued.length; i++) {
      await federation.processQueuedTask(undefined, queued[i]);
    }
  });
  assertEquals(bodies.length, 1);
  assertEquals(proofOf(bodies[0]).verificationMethod, owner.keyId.href);
  await assertCompoundVerifies(bodies[0]);
});

test("a Fedify inbox accepts an activity Fedify produced for a compatible-ID actor", async () => {
  const owner = await didKey();
  const child = await signedChild(await didKey());
  const sending = createTestFederation();
  const ctx = sending.createContext(new URL("https://example.com/"));
  // Without an RSA key, no HTTP Signature is made, so the proof alone has to
  // authenticate the activity:
  const { requests } = await capture(async () =>
    ctx.sendActivity(
      [sender(await didKey()), sender(owner)],
      recipient,
      compatibleCreate(owner, child),
    )
  );
  assertEquals(requests.length, 1);

  let received = 0;
  const receiving = createFederation<void>({
    kv: new MemoryKvStore(),
    contextLoaderFactory: () => mockDocumentLoader,
    documentLoaderFactory: () => mockDocumentLoader,
  });
  receiving.setActorDispatcher("/users/{identifier}", () => null);
  receiving
    .setInboxListeners("/users/{identifier}/inbox", "/inbox")
    .on(Create, () => {
      received++;
    });
  const body = await requests[0].text();
  const deliver = (json: string) =>
    receiving.fetch(
      new Request(requests[0].url, {
        method: "POST",
        headers: requests[0].headers,
        body: json,
      }),
      { contextData: undefined },
    );
  const response = await deliver(body);
  assertEquals([response.status, received], [202, 1]);

  // The same activity claiming another DID's actor is rejected:
  const forged = JSON.parse(body);
  forged.actor = compatibleId((await didKey()).did, "/actor").href;
  const rejected = await deliver(JSON.stringify(forged));
  assertEquals([rejected.status, received], [401, 1]);
});

async function captureLogs(run: () => unknown): Promise<LogRecord[]> {
  const records: LogRecord[] = [];
  await reset();
  try {
    await configure({
      sinks: { buffer: (record: LogRecord) => records.push(record) },
      filters: {},
      loggers: [
        { category: ["logtape", "meta"], sinks: [] },
        { category: [], sinks: ["buffer"], lowestLevel: "warning" },
      ],
    });
    await run();
  } finally {
    await reset();
  }
  return records.filter((record) => record.category[0] === "fedify");
}

test("sendActivity warns for compatible IDs off the actor's first gateway", async () => {
  const owner = await didKey();
  const ownerId = parseIri(`ap://${owner.did}/users/alice`);
  const federation = createTestFederation();
  let actorCalls = 0;
  federation.setActorDispatcher("/users/{identifier}", (_ctx, identifier) => {
    actorCalls++;
    return identifier === "alice"
      ? new Person({
        id: ownerId,
        gateways: [
          new URL("https://primary.example"),
          new URL("https://secondary.example"),
        ],
      })
      : null;
  });
  const ctx = federation.createContext(
    new Request("https://example.com/"),
    undefined,
  );
  const child = await signObject(
    new Note({
      id: compatibleId(owner.did, "/notes/1", "https://secondary.example"),
      attribution: ownerId,
      content: "Hello",
    }),
    owner.privateKey,
    owner.keyId,
    { ...options, context: childContext, created },
  );
  const activity = new Create({
    id: compatibleId(owner.did, "/activities/1", "https://secondary.example"),
    actor: ownerId,
    object: child,
  });
  const records = await captureLogs(async () => {
    const { bodies } = await capture(() =>
      ctx.sendActivity([rsaKey, sender(owner)], recipient, activity)
    );
    assertEquals(bodies.length, 1);
    assertEquals(bodies[0].id, activity.id?.href);
  });
  assertEquals(
    records.filter((r) => r.properties.kind === "activity").length,
    1,
  );
  assertEquals(
    records.filter((r) => r.properties.kind === "object").length,
    1,
  );
  assertEquals(actorCalls, 1);
});

test("sendActivity skips first-gateway and portable IDs", async () => {
  const owner = await didKey();
  const ownerId = parseIri(`ap://${owner.did}/users/alice`);
  const federation = createTestFederation();
  federation.setActorDispatcher(
    "/users/{identifier}",
    (_ctx, identifier) =>
      identifier === "alice"
        ? new Person({
          id: ownerId,
          gateways: [new URL("https://primary.example")],
        })
        : null,
  );
  const ctx = federation.createContext(
    new Request("https://example.com/"),
    undefined,
  );
  for (
    const id of [
      compatibleId(owner.did, "/activities/first", "https://primary.example"),
      parseIri(`ap://${owner.did}/activities/portable`),
    ]
  ) {
    const records = await captureLogs(() =>
      capture(() =>
        ctx.sendActivity(
          [rsaKey, sender(owner)],
          recipient,
          new Create({ id, actor: ownerId }),
        )
      )
    );
    assertEquals(records.filter((r) => r.properties.kind != null), []);
  }
  const plain = federation.createContext(new URL("https://example.com/"));
  const records = await captureLogs(() =>
    capture(() =>
      plain.sendActivity(
        [rsaKey, sender(owner)],
        recipient,
        new Create({
          id: compatibleId(
            owner.did,
            "/activities/unknown-gateway",
            "https://secondary.example",
          ),
          actor: ownerId,
        }),
      )
    )
  );
  assertEquals(records.filter((r) => r.properties.kind != null), []);
});

test("fanout warns once before enqueueing a compatible activity", async () => {
  const owner = await didKey();
  const ownerId = parseIri(`ap://${owner.did}/users/alice`);
  const { queue, queued } = createQueue();
  const federation = createTestFederation(queue);
  federation.setActorDispatcher("/users/{identifier}", () =>
    new Person({
      id: ownerId,
      gateways: [new URL("https://primary.example")],
    }));
  const ctx = federation.createContext(
    new Request("https://example.com/"),
    undefined,
  );
  const records = await captureLogs(() =>
    capture(async () => {
      await ctx.sendActivity(
        [rsaKey, sender(owner)],
        recipient,
        new Create({
          id: compatibleId(
            owner.did,
            "/activities/fanout",
            "https://secondary.example",
          ),
          actor: ownerId,
        }),
        { fanout: "force" },
      );
      assertEquals(queued.length, 1);
      for (let i = 0; i < queued.length; i++) {
        await federation.processQueuedTask(undefined, queued[i]);
      }
    })
  );
  assertEquals(
    records.filter((r) => r.properties.kind === "activity").length,
    1,
  );
});

test("an embedded actor supplies gateways to a plain send context", async () => {
  const owner = await didKey();
  const ownerId = parseIri(`ap://${owner.did}/users/alice`);
  const federation = new FederationImpl<void>({
    kv: new MemoryKvStore(),
    contextLoaderFactory: () => mockDocumentLoader,
    documentLoaderFactory: () => mockDocumentLoader,
    activityTransformers: [],
  });
  const ctx = federation.createContext(new URL("https://example.com/"));
  const activity = await signObject(
    new Create({
      id: compatibleId(
        owner.did,
        "/activities/embedded-actor",
        "https://secondary.example",
      ),
      actor: new Person({
        id: ownerId,
        gateways: [new URL("https://primary.example")],
      }),
    }),
    owner.privateKey,
    owner.keyId,
    { ...options, created },
  );
  assertEquals(
    getEmbeddedFirstGateway(
      await activity.toJsonLd({
        format: "compact",
        contextLoader: mockDocumentLoader,
      }),
      ownerId,
      owner.did,
    )?.origin,
    "https://primary.example",
  );
  const records = await captureLogs(() =>
    capture(() =>
      ctx.sendActivity(
        [rsaKey, sender(owner)],
        recipient,
        activity,
      )
    )
  );
  assertEquals(
    records.filter((r) => r.properties.kind === "activity").length,
    1,
  );
});

test("sendActivity checks a locally owned embedded object independently", async () => {
  const alice = await didKey();
  const bob = await didKey();
  const aliceId = parseIri(`ap://${alice.did}/users/alice`);
  const bobId = parseIri(`ap://${bob.did}/users/bob`);
  const federation = createTestFederation();
  federation.setActorDispatcher(
    "/users/{identifier}",
    (_ctx, identifier) =>
      identifier === "alice"
        ? new Person({
          id: aliceId,
          gateways: [new URL("https://primary.example")],
        })
        : identifier === "bob"
        ? new Person({ id: bobId, gateways: [new URL("https://bob.example")] })
        : null,
  );
  const child = await signObject(
    new Note({
      id: compatibleId(bob.did, "/notes/1", "https://secondary.example"),
      attribution: bobId,
      content: "Bob's note",
    }),
    bob.privateKey,
    bob.keyId,
    { ...options, context: childContext, created },
  );
  const ctx = federation.createContext(
    new Request("https://example.com/"),
    undefined,
  );
  const records = await captureLogs(() =>
    capture(() =>
      ctx.sendActivity(
        [rsaKey, sender(alice)],
        recipient,
        new Announce({
          id: parseIri(`ap://${alice.did}/activities/announce`),
          actor: aliceId,
          object: child,
        }),
      )
    )
  );
  assertEquals(
    records.filter((r) => r.properties.kind === "object").map((r) =>
      r.properties.id
    ),
    [child.id?.href],
  );
});

test("sendActivity in an actor dispatcher does not re-enter it", async () => {
  const owner = await didKey();
  const ownerId = parseIri(`ap://${owner.did}/users/alice`);
  const federation = createTestFederation();
  let calls = 0;
  federation.setActorDispatcher("/users/{identifier}", async (ctx) => {
    calls++;
    await ctx.sendActivity(
      [rsaKey, sender(owner)],
      recipient,
      new Create({
        id: compatibleId(
          owner.did,
          "/activities/from-dispatcher",
          "https://secondary.example",
        ),
        actor: ownerId,
      }),
    );
    return new Person({
      id: ownerId,
      gateways: [new URL("https://primary.example")],
    });
  });
  await capture(async () => {
    const response = await federation.fetch(
      new Request("https://example.com/users/alice", {
        headers: { Accept: "application/activity+json" },
      }),
      { contextData: undefined },
    );
    assertEquals(response.status, 200);
  });
  assertEquals(calls, 1);
});

test("sendActivity still delivers when the diagnostic actor lookup fails", async () => {
  const owner = await didKey();
  const ownerId = parseIri(`ap://${owner.did}/users/alice`);
  const federation = createTestFederation();
  federation.setActorDispatcher("/users/{identifier}", () => {
    throw new Error("Actor storage unavailable");
  });
  const ctx = federation.createContext(
    new Request("https://example.com/"),
    undefined,
  );
  const id = compatibleId(
    owner.did,
    "/activities/lookup-fails",
    "https://secondary.example",
  );
  const records = await captureLogs(async () => {
    const { bodies } = await capture(() =>
      ctx.sendActivity(
        [rsaKey, sender(owner)],
        recipient,
        new Create({ id, actor: ownerId }),
      )
    );
    assertEquals(bodies.length, 1);
    assertEquals(bodies[0].id, id.href);
  });
  assertEquals(records.filter((r) => r.properties.kind != null), []);
});

test("warning checks later local actors when the first is missing", async () => {
  const owner = await didKey();
  const missing = parseIri(`ap://${owner.did}/users/missing`);
  const alice = parseIri(`ap://${owner.did}/users/alice`);
  const federation = createTestFederation();
  federation.setActorDispatcher(
    "/users/{identifier}",
    (_ctx, identifier) =>
      identifier === "alice"
        ? new Person({
          id: alice,
          gateways: [new URL("https://primary.example")],
        })
        : null,
  );
  const ctx = federation.createContext(
    new Request("https://example.com/"),
    undefined,
  );
  const records = await captureLogs(() =>
    warnCompatibleIdsInJson({
      id: compatibleId(
        owner.did,
        "/activities/multi",
        "https://secondary.example",
      ).href,
      type: "Create",
      actor: [missing.href, alice.href],
    }, ctx)
  );
  assertEquals(
    records.filter((r) => r.properties.kind === "activity").length,
    1,
  );
});

test("warning ignores an embedded gateway key", async () => {
  const owner = await didKey();
  const actorId = parseIri(`ap://${owner.did}/users/alice`);
  const records = await captureLogs(() =>
    warnCompatibleIdsInJson({
      id: compatibleId(owner.did, "/activities/1", "https://secondary.example")
        .href,
      type: "Create",
      actor: {
        id: actorId.href,
        type: "Person",
        gateways: ["https://primary.example"],
        publicKey: [
          {
            id: compatibleId(
              owner.did,
              "/users/alice/keys/1",
              "https://secondary.example",
            ).href,
            type: ["CryptographicKey"],
          },
          {
            id: compatibleId(
              owner.did,
              "/users/alice/keys/2",
              "https://secondary.example",
            ).href,
            type: "sec:Key",
          },
        ],
      },
    })
  );
  assertEquals(
    records.filter((r) => r.properties.kind === "activity").length,
    1,
  );
  assertEquals(records.filter((r) => r.properties.kind === "object"), []);
});

test("warning resolves a signed child's local ownership alias", async () => {
  const alice = await didKey();
  const bob = await didKey();
  const aliceId = parseIri(`ap://${alice.did}/users/alice`);
  const bobId = parseIri(`ap://${bob.did}/users/bob`);
  const federation = createTestFederation();
  federation.setActorDispatcher(
    "/users/{identifier}",
    (_ctx, identifier) =>
      identifier === "bob"
        ? new Person({
          id: bobId,
          gateways: [new URL("https://primary.example")],
        })
        : null,
  );
  const ctx = federation.createContext(
    new Request("https://example.com/"),
    undefined,
  );
  const records = await captureLogs(() =>
    warnCompatibleIdsInJson({
      id: parseIri(`ap://${alice.did}/activities/announce`).href,
      type: "Announce",
      actor: aliceId.href,
      object: {
        "@context": [
          "https://www.w3.org/ns/activitystreams",
          {
            by: { "@id": "as:attributedTo", "@type": "@id" },
            identifier: "@id",
          },
        ],
        identifier:
          compatibleId(bob.did, "/notes/1", "https://secondary.example").href,
        type: "Note",
        by: bobId.href,
      },
    }, ctx)
  );
  assertEquals(records.filter((r) => r.properties.kind === "object").length, 1);
});

test("warning reads an inline alias of the serialized root ID", async () => {
  const owner = await didKey();
  const id = compatibleId(owner.did, "/notes/1", "https://secondary.example");
  assertEquals(
    getCompactRootId({
      "@context": [
        "https://www.w3.org/ns/activitystreams",
        { identifier: "@id" },
      ],
      identifier: id.href,
      type: "Note",
    })?.href,
    id.href,
  );
});

test("an activity on another gateway than its compatible-ID actor is warned about", async () => {
  const owner = await didKey();
  const warnings = (activity: Create) =>
    captureLogs(() => assertPortableActorActivity(activity)).then((records) =>
      records.map((r) => r.properties.activityId)
    );
  const other = compatibleId(
    owner.did,
    "/activities/1",
    "https://other.example",
  );
  assertEquals(
    await warnings(compatibleCreate(owner, undefined, { id: other })),
    [other.href],
  );
  // The same gateway, or mixed forms, are not warned about:
  assertEquals(await warnings(compatibleCreate(owner)), []);
  assertEquals(
    await warnings(
      compatibleCreate(owner, undefined, {
        id: parseIri(`ap://${owner.did}/activities/1`),
      }),
    ),
    [],
  );
  assertEquals(
    await warnings(
      compatibleCreate(owner, undefined, {
        id: other,
        actor: parseIri(`ap://${owner.did}/actor`),
      }),
    ),
    [],
  );
});

test("an unsigned activity with a malformed compatible ID is rejected", async () => {
  const owner = await didKey();
  const federation = createTestFederation();
  const ctx = federation.createContext(new URL("https://example.com/"));
  const { bodies } = await capture(() =>
    assertRejects(
      () =>
        ctx.sendActivity(
          [rsaKey, sender(owner)],
          recipient,
          new Create({
            id: new URL(
              compatibleId(owner.did, "/activities/1").href +
                "?@gateway=https%3A%2F%2Fgw.example",
            ),
            actor: new URL("https://example.com/users/alice"),
          }),
        ),
      TypeError,
      "malformed FEP-ef61 portable ID",
    )
  );
  assertEquals(bodies.length, 0);
});
