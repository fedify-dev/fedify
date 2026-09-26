import { mockDocumentLoader, test } from "@fedify/fixture";
import { Create, Note, Person } from "@fedify/vocab";
import { exportDidKey, parseIri } from "@fedify/vocab-runtime";
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
import { createFederation, FederationImpl } from "./middleware.ts";
import type { MessageQueue } from "./mq.ts";
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
  // The RSA key still signs the request and the document.
  assert(requests[0].headers.has("Signature"));
  assert(bodies[0].signature != null);
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
      // A portable URL shares the DID origin but is not a DID URL.
      "a same-origin key ID is not a DID URL",
      [
        {
          keyId: parseIri(`ap+ef61://${owner.did}/actor#main-key`),
          privateKey: owner.privateKey,
        },
        sender(await didKey()),
      ],
      "none of its 2 Ed25519 keys",
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
  const activity = portableCreate(owner, child);
  const federation = createTestFederation();
  const message: FanoutMessage = {
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
  };
  const { bodies } = await capture(() =>
    federation.processQueuedTask(undefined, message)
  );
  assertEquals(bodies.length, 1);
  assertEquals(proofOf(bodies[0]).verificationMethod, owner.keyId.href);
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
