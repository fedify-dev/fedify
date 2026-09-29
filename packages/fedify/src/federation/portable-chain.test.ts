import { mockDocumentLoader, test } from "@fedify/fixture";
import {
  Create,
  DataIntegrityProof,
  Note,
  OrderedCollection,
  Person,
  traverseCollection,
} from "@fedify/vocab";
import {
  type DocumentLoader,
  encodeMultibase,
  exportDidKey,
  FetchError,
  type PortableObjectVerifier,
  type RemoteDocument,
} from "@fedify/vocab-runtime";
import { assert, assertEquals, assertInstanceOf } from "@std/assert";
import fetchMock from "fetch-mock";
import serialize from "json-canon";
import { verifyObject, verifyPortableObjectProof } from "../sig/proof.ts";
import { exportJwk } from "../sig/key.ts";
import {
  ed25519PrivateKey,
  ed25519PublicKey,
  rsaPrivateKey2,
  rsaPublicKey2,
} from "../testing/keys.ts";
import { MemoryKvStore } from "./kv.ts";
import { FederationImpl } from "./middleware.ts";
import type { MessageQueue } from "./mq.ts";
import type { InboxMessage, Message, OutboxMessage } from "./queue.ts";

const did = await exportDidKey(ed25519PublicKey.publicKey);
const keyId = `${did}#${did.slice("did:key:".length)}`;
const GATEWAY = "https://gw.example";
const context = [
  "https://www.w3.org/ns/activitystreams",
  "https://w3id.org/security/data-integrity/v1",
  "https://w3id.org/fep/ef61",
];

function compatible(path: string, gateway: string = GATEWAY): string {
  return `${gateway}/.well-known/apgateway/${did}${path}`;
}

async function sign(
  document: Record<string, unknown>,
  proofOptions: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const proofConfig = {
    "@context": document["@context"],
    ...proofOptions,
    type: "DataIntegrityProof",
    cryptosuite: "eddsa-jcs-2022",
    verificationMethod: keyId,
    proofPurpose: "assertionMethod",
    created: "2023-02-24T23:36:38Z",
  };
  const encoder = new TextEncoder();
  const digest = new Uint8Array(64);
  digest.set(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        encoder.encode(serialize(proofConfig)),
      ),
    ),
    0,
  );
  digest.set(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        encoder.encode(serialize(document)),
      ),
    ),
    32,
  );
  const signature = await crypto.subtle.sign(
    "Ed25519",
    ed25519PrivateKey,
    digest,
  );
  return {
    ...document,
    proof: {
      ...proofConfig,
      proofValue: new TextDecoder().decode(
        encodeMultibase("base58btc", new Uint8Array(signature)),
      ),
    },
  };
}

function note(path: string, content = "A portable note") {
  return {
    "@context": context,
    id: compatible(path),
    type: "Note",
    attributedTo: compatible("/actor"),
    content,
  };
}

function activity(object: unknown, id = compatible("/activities/1")) {
  return {
    "@context": context,
    id,
    type: "Create",
    actor: compatible("/actor"),
    object,
  };
}

function actor() {
  return {
    "@context": context,
    id: compatible("/actor"),
    type: "Person",
    inbox: compatible("/actor/inbox"),
    outbox: compatible("/actor/outbox"),
    gateways: [GATEWAY],
  };
}

function createLoader(
  responses: Record<string, unknown>,
): DocumentLoader & { readonly fetched: string[] } {
  const fetched: string[] = [];
  const loader = (url: string): Promise<RemoteDocument> => {
    // Portable IRIs are looked up under the ap: scheme:
    url = url.replace(/^ap\+ef61:/, "ap:");
    fetched.push(url);
    const document = responses[url];
    if (document == null) {
      if (!URL.canParse(url)) {
        return Promise.reject(new Error(`Not found: ${url}`));
      }
      if (!url.includes("/.well-known/apgateway/")) {
        return mockDocumentLoader(url);
      }
      return Promise.reject(
        new FetchError(url, "HTTP 404", new Response(null, { status: 404 })),
      );
    }
    return Promise.resolve({
      contextUrl: null,
      documentUrl: url,
      document: structuredClone(document),
    });
  };
  return Object.assign(loader, { fetched });
}

function createFederation(
  documentLoader: DocumentLoader,
  queue?: MessageQueue,
): FederationImpl<void> {
  return new FederationImpl<void>({
    kv: new MemoryKvStore(),
    queue,
    manuallyStartQueue: true,
    contextLoaderFactory: () => mockDocumentLoader,
    documentLoaderFactory: () => documentLoader,
  });
}

test("Context.verifyPortableObject", async (t) => {
  const signed = await sign(note("/notes/1"));
  const federation = createFederation(createLoader({}));
  const ctx = federation.createContext(new URL("https://example.com/"));

  await t.step("is an own property that survives spreading", () => {
    assert(Object.hasOwn(ctx, "verifyPortableObject"));
    assert({ ...ctx }.verifyPortableObject === ctx.verifyPortableObject);
    assert(ctx.clone(undefined).verifyPortableObject != null);
  });

  await t.step(
    "verifies portable objects with the context's loaders",
    async () => {
      assertEquals(
        (await ctx.verifyPortableObject!(signed, {})).verified,
        true,
      );
      assertEquals(
        (await ctx.verifyPortableObject!(note("/notes/1"), {})).verified,
        false,
      );
      assertEquals(
        (await ctx.verifyPortableObject!(
          { ...signed, content: "Forged" },
          {},
        )).verified,
        false,
      );
    },
  );
});

test("accessors given a Context verify references of compatible-ID objects", async (t) => {
  const signed = await sign(note("/notes/1"));
  const create = () =>
    Create.fromJsonLd(activity(compatible("/notes/1")), {
      contextLoader: mockDocumentLoader,
    });

  await t.step("a signed object at the reference", async () => {
    const loader = createLoader({ [compatible("/notes/1")]: signed });
    const ctx = createFederation(loader)
      .createContext(new URL("https://example.com/"));
    const object = await (await create()).getObject(ctx);
    assertInstanceOf(object, Note);
    assertEquals(object.content, "A portable note");
    assertEquals(loader.fetched, [compatible("/notes/1")]);
  });

  await t.step("an unsigned object at the reference", async () => {
    const loader = createLoader({ [compatible("/notes/1")]: note("/notes/1") });
    const ctx = createFederation(loader)
      .createContext(new URL("https://example.com/"));
    assertEquals(await (await create()).getObject(ctx), null);
  });

  await t.step("a forged object at the reference", async () => {
    const loader = createLoader({
      [compatible("/notes/1")]: { ...signed, content: "Forged" },
    });
    const ctx = createFederation(loader)
      .createContext(new URL("https://example.com/"));
    assertEquals(await (await create()).getObject(ctx), null);
  });

  await t.step("an ordinary object's compatible reference", async () => {
    // Since a Context carries a verifier, compatible identifiers from
    // ordinary objects are verified as well:
    const loader = createLoader({ [compatible("/notes/1")]: note("/notes/1") });
    const ctx = createFederation(loader)
      .createContext(new URL("https://example.com/"));
    const create = await Create.fromJsonLd(
      activity(compatible("/notes/1"), "https://example.com/activities/1"),
      { contextLoader: mockDocumentLoader },
    );
    assertEquals(await create.getObject(ctx), null);
    // Without it, the old behavior stays:
    assertInstanceOf(
      await create.getObject({
        documentLoader: loader,
        contextLoader: mockDocumentLoader,
      }),
      Note,
    );
  });
});

function createRecordingQueue(): { queue: MessageQueue; queued: Message[] } {
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

test("inbox listeners dereference references of compatible-ID activities without options", async (t) => {
  const signedNote = await sign(note("/notes/1"));
  const signedCreate = await sign(activity(compatible("/notes/1")));

  for (const queued of [false, true]) {
    for (
      const [label, served] of [["signed", signedNote], [
        "unsigned",
        note("/notes/1"),
      ]] as const
    ) {
      await t.step(
        `${label} object${queued ? " through a queue" : ""}`,
        async () => {
          const loader = createLoader({ [compatible("/notes/1")]: served });
          const { queue, queued: messages } = createRecordingQueue();
          const federation = createFederation(
            loader,
            queued ? queue : undefined,
          );
          const results: (Note | null)[] = [];
          federation.setActorDispatcher("/users/{identifier}", () => null);
          federation
            .setInboxListeners("/users/{identifier}/inbox", "/inbox")
            .on(Create, async (_ctx, create) => {
              const object = await create.getObject();
              assert(object == null || object instanceof Note);
              results.push(object);
            });
          const response = await federation.fetch(
            new Request("https://example.com/inbox", {
              method: "POST",
              headers: { "Content-Type": "application/activity+json" },
              body: JSON.stringify(signedCreate),
            }),
            { contextData: undefined },
          );
          assertEquals(response.status, 202);
          if (queued) {
            assertEquals(messages.length, 1);
            assertEquals((messages[0] as InboxMessage).type, "inbox");
            await federation.processQueuedTask(undefined, messages[0]);
          }
          assertEquals(results.length, 1);
          if (label === "signed") {
            assertInstanceOf(results[0], Note);
            assertEquals(results[0].content, "A portable note");
          } else {
            assertEquals(results[0], null);
          }
          assertEquals(loader.fetched, [compatible("/notes/1")]);
        },
      );
    }
  }
});

test("verifyObject() does not leave its proof verifier to returned objects", async () => {
  // A proof given by reference, which verifyObject() fetches with
  // a permissive verifier of its own and caches in the returned object:
  const proofUrl = `ap://${did}/proofs/1`;
  const signed = await sign(activity(compatible("/notes/1")), {
    id: proofUrl,
  });
  const { proof, ...document } = signed;
  const referenced = {
    ...document,
    "https://w3id.org/security#proof": [
      { "@graph": [proof] },
      { "@graph": [{ "@id": proofUrl }] },
    ],
  };
  const loader = createLoader({ [proofUrl]: proof });
  const verifier: PortableObjectVerifier = () =>
    Promise.resolve({ verified: false });
  for (const verifyPortableObject of [undefined, verifier]) {
    const create = await verifyObject(Create, referenced, {
      contextLoader: mockDocumentLoader,
      documentLoader: loader,
      verifyPortableObject,
    });
    assertInstanceOf(create, Create);
    assert(loader.fetched.includes(proofUrl));
    const proofs = await Array.fromAsync(create.getProofs());
    assertEquals(proofs.length, 2);
    for (const p of proofs) {
      assertInstanceOf(p, DataIntegrityProof);
      // The cached proofs use only the default given to verifyObject():
      assert(
        (p as unknown as { _verifyPortableObject: unknown })
          ._verifyPortableObject === verifyPortableObject,
      );
    }
    assert(
      (create as unknown as { _verifyPortableObject: unknown })
        ._verifyPortableObject === verifyPortableObject,
    );
  }
});

test("Context.lookupObject() applies the gateway policy to unsecured collections", async (t) => {
  const outbox = {
    "@context": context,
    id: compatible("/actor/outbox"),
    type: "OrderedCollection",
    attributedTo: compatible("/actor"),
    orderedItems: [compatible("/notes/1")],
  };
  const signedActor = await sign(actor());

  await t.step("from a listed gateway", async () => {
    const loader = createLoader({
      [compatible("/actor")]: signedActor,
      [compatible("/actor/outbox")]: outbox,
      [compatible("/notes/1")]: note("/notes/1"),
    });
    const ctx = createFederation(loader)
      .createContext(new URL("https://example.com/"));
    const collection = await ctx.lookupObject(compatible("/actor/outbox"));
    assertInstanceOf(collection, OrderedCollection);
    // Its unsigned item is rejected, even without options:
    assertEquals(await Array.fromAsync(collection.getItems()), []);
    assertEquals(
      await Array.fromAsync(traverseCollection(collection, ctx)),
      [],
    );
    // A proof-only policy rejects the collection itself:
    assertEquals(
      await ctx.lookupObject(compatible("/actor/outbox"), {
        verifyPortableObject: verifyPortableObjectProof,
      }),
      null,
    );
  });

  await t.step("from an unlisted gateway", async () => {
    const evil = "https://evil.example";
    const loader = createLoader({
      [compatible("/actor", evil)]: signedActor,
      [compatible("/actor/outbox", evil)]: {
        ...outbox,
        id: compatible("/actor/outbox", evil),
      },
    });
    const ctx = createFederation(loader)
      .createContext(new URL("https://example.com/"));
    assertEquals(
      await ctx.lookupObject(compatible("/actor/outbox", evil)),
      null,
    );
  });

  await t.step("with signed items", async () => {
    const loader = createLoader({
      [compatible("/actor")]: signedActor,
      [compatible("/actor/outbox")]: outbox,
      [compatible("/notes/1")]: await sign(note("/notes/1")),
    });
    const ctx = createFederation(loader)
      .createContext(new URL("https://example.com/"));
    const collection = await ctx.lookupObject(compatible("/actor/outbox"));
    assertInstanceOf(collection, OrderedCollection);
    const items = await Array.fromAsync(collection.getItems());
    assertEquals(items.length, 1);
    assertInstanceOf(items[0], Note);
  });
});

test("traverseCollection() with a Context verifies pages and items of portable collections", async () => {
  const loader = createLoader({
    [compatible("/actor")]: await sign(actor()),
    [compatible("/actor/outbox")]: {
      "@context": context,
      id: compatible("/actor/outbox"),
      type: "OrderedCollection",
      first: compatible("/actor/outbox/1"),
    },
    [compatible("/actor/outbox/1")]: {
      "@context": context,
      id: compatible("/actor/outbox/1"),
      type: "OrderedCollectionPage",
      partOf: compatible("/actor/outbox"),
      orderedItems: [compatible("/notes/1"), compatible("/notes/2")],
    },
    [compatible("/notes/1")]: await sign(note("/notes/1")),
    [compatible("/notes/2")]: note("/notes/2", "Unsigned"),
  });
  const ctx = createFederation(loader)
    .createContext(new URL("https://example.com/"));
  // The actor is parsed without a default verifier:
  const person = await Person.fromJsonLd(actor(), {
    contextLoader: mockDocumentLoader,
  });
  const outbox = await person.getOutbox(ctx);
  assertInstanceOf(outbox, OrderedCollection);
  const items = await Array.fromAsync(traverseCollection(outbox, ctx));
  assertEquals(items.length, 1);
  assertInstanceOf(items[0], Note);
  assertEquals(items[0].content, "A portable note");
  // The yielded items use the verifier given to the calls by default:
  assertInstanceOf(
    await items[0].getAttribution({ documentLoader: loader }),
    Person,
  );

  // ...unless the calls keep it to themselves:
  const outbox2 = await (await Person.fromJsonLd(actor(), {
    contextLoader: mockDocumentLoader,
  })).getOutbox({ ...ctx, inheritPortableObjectVerifier: false });
  assertInstanceOf(outbox2, OrderedCollection);
  const items2 = await Array.fromAsync(
    traverseCollection(outbox2, {
      ...ctx,
      inheritPortableObjectVerifier: false,
    }),
  );
  assertEquals(items2.length, 1);
  assertInstanceOf(items2[0], Note);
  let error: unknown;
  try {
    await items2[0].getAttribution({ documentLoader: loader });
  } catch (e) {
    error = e;
  }
  assertInstanceOf(error, TypeError);
  assertInstanceOf(await items2[0].getAttribution(ctx), Person);
});

test("onOutboxError receives activities that verify portable objects by default", async () => {
  const loader = createLoader({
    [compatible("/notes/1")]: await sign(note("/notes/1")),
  });
  const received: unknown[] = [];
  const federation = new FederationImpl<void>({
    kv: new MemoryKvStore(),
    queue: createRecordingQueue().queue,
    manuallyStartQueue: true,
    contextLoaderFactory: () => mockDocumentLoader,
    documentLoaderFactory: () => loader,
    authenticatedDocumentLoaderFactory: () => loader,
    onOutboxError: async (_error, activity) => {
      try {
        received.push(await activity?.getObject());
      } catch (error) {
        received.push(error);
      }
    },
  });
  const message: OutboxMessage = {
    type: "outbox",
    id: crypto.randomUUID(),
    baseUrl: "https://example.com",
    keys: [{
      keyId: rsaPublicKey2.id!.href,
      privateKey: await exportJwk(rsaPrivateKey2),
    }],
    activity: await sign(activity(compatible("/notes/1"))),
    activityId: compatible("/activities/1"),
    activityType: "https://www.w3.org/ns/activitystreams#Create",
    inbox: "https://remote.example/inbox",
    sharedInbox: false,
    started: new Date().toISOString(),
    attempt: 0,
    headers: {},
    traceContext: {},
  };
  fetchMock.spyGlobal();
  fetchMock.post("https://remote.example/inbox", 500);
  try {
    await federation.processQueuedTask(undefined, message);
  } finally {
    fetchMock.hardReset();
  }
  assertEquals(received.length, 1);
  assertInstanceOf(received[0], Note);
  assertEquals(loader.fetched, [compatible("/notes/1")]);
});
