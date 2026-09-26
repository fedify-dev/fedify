import { mockDocumentLoader, test } from "@fedify/fixture";
import { Create, DataIntegrityProof, Note } from "@fedify/vocab";
import { exportDidKey, parseIri } from "@fedify/vocab-runtime";
import { assert, assertEquals } from "@std/assert";
import fetchMock from "fetch-mock";
import serialize from "json-canon";
import { normalizeOutgoingActivityJsonLd } from "../compat/outgoing-jsonld.ts";
import {
  ed25519PrivateKey,
  ed25519PublicKey,
  rsaPrivateKey2,
  rsaPublicKey2,
} from "../testing/keys.ts";
import { signObject, verifyProof } from "../sig/proof.ts";
import { exportJwk } from "../sig/key.ts";
import { MemoryKvStore } from "./kv.ts";
import { FederationImpl } from "./middleware.ts";
import type { MessageQueue } from "./mq.ts";
import type { FanoutMessage, Message } from "./queue.ts";

const options = {
  contextLoader: mockDocumentLoader,
  documentLoader: mockDocumentLoader,
};
const context = [
  "https://www.w3.org/ns/activitystreams",
  "https://w3id.org/security/data-integrity/v1",
];
const childContext = [...context, { ex: "https://example.com/ns#" }];

async function parseProof(
  document: Record<string, unknown>,
): Promise<DataIntegrityProof> {
  const proof = document.proof as Record<string, unknown>;
  return await DataIntegrityProof.fromJsonLd(
    { "@context": document["@context"], ...proof },
    options,
  );
}

test("fanout delivery keeps an embedded signed child intact", async () => {
  const created = Temporal.Instant.from("2023-02-24T23:36:38Z");
  const childDid = await exportDidKey(ed25519PublicKey.publicKey);
  const childKeyId = new URL(
    `${childDid}#${childDid.substring("did:key:".length)}`,
  );
  const child = await signObject(
    new Note({
      id: parseIri(`ap+ef61://${childDid}/objects/fanned-out`),
      attribution: parseIri(`ap+ef61://${childDid}/actor`),
      content: "A portable note carried through the fanout queue",
    }),
    ed25519PrivateKey,
    childKeyId,
    { ...options, context: childContext, created },
  );
  const activity = await signObject(
    new Create({
      id: new URL("https://example.com/activities/fanned-out"),
      actor: new URL("https://example.com/person"),
      object: child,
    }),
    ed25519PrivateKey,
    childKeyId,
    { ...options, context, created },
  );
  const compound = await normalizeOutgoingActivityJsonLd(
    await activity.toJsonLd({ format: "compact", ...options, context }),
    mockDocumentLoader,
    { preserveNestedSecuredDocuments: true },
  ) as Record<string, unknown>;
  const securedChild = compound.object as Record<string, unknown>;
  assertEquals(securedChild["@context"], childContext);

  fetchMock.spyGlobal();
  try {
    let delivered: Record<string, unknown> | null = null;
    fetchMock.post("https://example.com/inbox", async (cl) => {
      delivered = await cl.request!.json();
      return new Response(null, { status: 202 });
    });

    const federation = new FederationImpl<void>({
      kv: new MemoryKvStore(),
      contextLoaderFactory: () => mockDocumentLoader,
    });
    federation.setInboxListeners("/users/{identifier}/inbox", "/inbox");
    const message: FanoutMessage = {
      type: "fanout",
      id: crypto.randomUUID(),
      baseUrl: "https://example.com",
      keys: [{
        keyId: rsaPublicKey2.id!.href,
        privateKey: await exportJwk(rsaPrivateKey2),
      }],
      inboxes: {
        "https://example.com/inbox": {
          actorIds: ["https://example.com/recipient"],
          sharedInbox: false,
        },
      },
      // The fanout queue carries the compact document Fedify already
      // produced; reparsing and reserializing it would rebuild the secured
      // child under the parent's context.
      activity: compound,
      activityId: "https://example.com/activities/fanned-out",
      activityType: "https://www.w3.org/ns/activitystreams#Create",
      normalizeExistingProofs: true,
      traceContext: {},
    };

    await federation.processQueuedTask(undefined, message);

    assert(delivered != null);
    const body = delivered as Record<string, unknown>;
    // The Linked Data Signature is a sibling of the Object Integrity Proof,
    // so it does not belong to either proof's input.
    delete body.signature;
    assertEquals(serialize(body), serialize(compound));
    const embedded = body.object as Record<string, unknown>;
    assertEquals(
      (await verifyProof(embedded, await parseProof(embedded), options))?.id,
      childKeyId,
    );
    assertEquals(
      (await verifyProof(body, await parseProof(body), options))?.id,
      childKeyId,
    );
  } finally {
    fetchMock.hardReset();
  }
});

test("forced fanout signs before serializing so the child survives", async () => {
  const created = Temporal.Instant.from("2023-02-24T23:36:38Z");
  const childDid = await exportDidKey(ed25519PublicKey.publicKey);
  const childKeyId = new URL(
    `${childDid}#${childDid.substring("did:key:".length)}`,
  );
  const child = await signObject(
    new Note({
      id: parseIri(`ap+ef61://${childDid}/objects/forced-fanout`),
      attribution: parseIri(`ap+ef61://${childDid}/actor`),
      content: "A portable note sent through a forced fanout",
    }),
    ed25519PrivateKey,
    childKeyId,
    { ...options, context: childContext, created },
  );
  // The activity itself is left unsigned, so Fedify has to create the outer
  // proof.  It must do so while the typed child still carries its retained
  // representation, not after the fanout worker has reparsed the activity.
  const activity = new Create({
    id: new URL("https://example.com/activities/forced-fanout"),
    actor: new URL("https://example.com/person"),
    object: child,
  });

  fetchMock.spyGlobal();
  try {
    let delivered: Record<string, unknown> | null = null;
    fetchMock.post("https://example.com/inbox", async (cl) => {
      delivered = await cl.request!.json();
      return new Response(null, { status: 202 });
    });

    const queued: Message[] = [];
    const queue: MessageQueue = {
      enqueue(message) {
        queued.push(message as Message);
        return Promise.resolve();
      },
      listen() {
        return Promise.resolve();
      },
    };
    const federation = new FederationImpl<void>({
      kv: new MemoryKvStore(),
      queue,
      manuallyStartQueue: true,
      contextLoaderFactory: () => mockDocumentLoader,
    });
    federation.setInboxListeners("/users/{identifier}/inbox", "/inbox");
    const context = federation.createContext(new URL("https://example.com/"));
    await context.sendActivity(
      { keyId: childKeyId, privateKey: ed25519PrivateKey },
      {
        id: new URL("https://example.com/users/bob"),
        inboxId: new URL("https://example.com/inbox"),
      },
      activity,
      { fanout: "force" },
    );

    // The fanout worker hands the activity on to the outbox queue, so drain
    // every message the run produces.
    assertEquals(queued.length, 1);
    for (let i = 0; i < queued.length; i++) {
      await federation.processQueuedTask(undefined, queued[i]);
    }

    assert(delivered != null);
    const body = delivered as Record<string, unknown>;
    delete body.signature;
    const embedded = body.object as Record<string, unknown>;
    assertEquals(embedded["@context"], childContext);
    assertEquals(
      (await verifyProof(embedded, await parseProof(embedded), options))?.id,
      childKeyId,
    );
    assertEquals(
      (await verifyProof(body, await parseProof(body), options))?.id,
      childKeyId,
    );
  } finally {
    fetchMock.hardReset();
  }
});

test("an already signed activity keeps its single proof through fanout", async () => {
  const created = Temporal.Instant.from("2023-02-24T23:36:38Z");
  const childDid = await exportDidKey(ed25519PublicKey.publicKey);
  const childKeyId = new URL(
    `${childDid}#${childDid.substring("did:key:".length)}`,
  );
  const child = await signObject(
    new Note({
      id: parseIri(`ap+ef61://${childDid}/objects/pre-signed`),
      attribution: parseIri(`ap+ef61://${childDid}/actor`),
      content: "A portable note in a pre-signed activity",
    }),
    ed25519PrivateKey,
    childKeyId,
    { ...options, context: childContext, created },
  );
  // Signed with Fedify's default context, which is what `sendActivity()`
  // serializes the activity with; a caller-supplied context here would make
  // the outer proof cover bytes that are never sent.
  const activity = await signObject(
    new Create({
      id: new URL("https://example.com/activities/pre-signed"),
      actor: new URL("https://example.com/person"),
      object: child,
    }),
    ed25519PrivateKey,
    childKeyId,
    { ...options, created },
  );

  fetchMock.spyGlobal();
  try {
    let delivered: Record<string, unknown> | null = null;
    fetchMock.post("https://example.com/inbox", async (cl) => {
      delivered = await cl.request!.json();
      return new Response(null, { status: 202 });
    });

    const queued: Message[] = [];
    const queue: MessageQueue = {
      enqueue(message) {
        queued.push(message as Message);
        return Promise.resolve();
      },
      listen() {
        return Promise.resolve();
      },
    };
    const federation = new FederationImpl<void>({
      kv: new MemoryKvStore(),
      queue,
      manuallyStartQueue: true,
      contextLoaderFactory: () => mockDocumentLoader,
    });
    federation.setInboxListeners("/users/{identifier}/inbox", "/inbox");
    const context_ = federation.createContext(new URL("https://example.com/"));
    await context_.sendActivity(
      { keyId: childKeyId, privateKey: ed25519PrivateKey },
      {
        id: new URL("https://example.com/users/bob"),
        inboxId: new URL("https://example.com/inbox"),
      },
      activity,
      { fanout: "force" },
    );
    for (let i = 0; i < queued.length; i++) {
      await federation.processQueuedTask(undefined, queued[i]);
    }

    assert(delivered != null);
    const body = delivered as Record<string, unknown>;
    delete body.signature;
    // Exactly one direct proof: a proof set is outside the map-local
    // compound-proof profile.
    assert(!Array.isArray(body.proof));
    assertEquals(
      (await verifyProof(body, await parseProof(body), options))?.id,
      childKeyId,
    );
    const embedded = body.object as Record<string, unknown>;
    assertEquals(embedded["@context"], childContext);
    assertEquals(
      (await verifyProof(embedded, await parseProof(embedded), options))?.id,
      childKeyId,
    );
  } finally {
    fetchMock.hardReset();
  }
});
