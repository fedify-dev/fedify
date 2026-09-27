import { test } from "@fedify/fixture";
import {
  Collection,
  CollectionPage,
  Note,
  type Object as ASObject,
  OrderedCollection,
  Person,
  traverseCollection,
} from "@fedify/vocab";
import {
  type DocumentLoader,
  exportDidKey,
  FetchError,
  type PortableObjectReferrer,
  preloadedContexts,
  type RemoteDocument,
} from "@fedify/vocab-runtime";
import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import serialize from "json-canon";
import { ed25519PrivateKey, ed25519PublicKey } from "../testing/keys.ts";
import { encodeMultibase } from "@fedify/vocab-runtime";
import {
  verifyPortableObject,
  type VerifyPortableObjectOptions,
  type VerifyPortableObjectResult,
} from "./portable-collection.ts";

const AS = "https://www.w3.org/ns/activitystreams#";
const context = [
  "https://www.w3.org/ns/activitystreams",
  "https://w3id.org/security/data-integrity/v1",
  "https://w3id.org/fep/ef61",
];

const did = await exportDidKey(ed25519PublicKey.publicKey);
const keyId = `${did}#${did.slice("did:key:".length)}`;
const otherKeyPair = await crypto.subtle.generateKey("Ed25519", true, [
  "sign",
  "verify",
]) as CryptoKeyPair;
const otherDid = await exportDidKey(otherKeyPair.publicKey);

const actorId = `ap://${did}/actor`;
const outboxId = `ap://${did}/actor/outbox`;
const gw1 = "https://gw1.example";
const gw2 = "https://gw2.example";
const evil = "https://evil.example";

function gatewayUrl(gateway: string, id: string): string {
  return `${gateway}/.well-known/apgateway/${id.replace(/^ap:\/\//, "")}`;
}

async function sign(
  document: Record<string, unknown>,
  privateKey: CryptoKey = ed25519PrivateKey,
  verificationMethod: string = keyId,
): Promise<Record<string, unknown>> {
  const proofConfig = {
    "@context": document["@context"],
    type: "DataIntegrityProof",
    cryptosuite: "eddsa-jcs-2022",
    verificationMethod,
    proofPurpose: "assertionMethod",
    created: "2023-02-24T23:36:38Z",
  };
  const encoder = new TextEncoder();
  const proofDigest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(serialize(proofConfig)),
  );
  const messageDigest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(serialize(document)),
  );
  const digest = new Uint8Array(64);
  digest.set(new Uint8Array(proofDigest), 0);
  digest.set(new Uint8Array(messageDigest), 32);
  const signature = await crypto.subtle.sign("Ed25519", privateKey, digest);
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

function actor(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    "@context": context,
    id: actorId,
    type: "Person",
    inbox: `ap://${did}/actor/inbox`,
    outbox: outboxId,
    followers: `ap://${did}/actor/followers`,
    gateways: [gw1, gw2],
    ...overrides,
  };
}

function outbox(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    "@context": context,
    id: outboxId,
    type: "OrderedCollection",
    totalItems: 0,
    ...overrides,
  };
}

const contextLoader: DocumentLoader = (url) => {
  const document = preloadedContexts[url];
  if (document == null) return Promise.reject(new Error(`No context: ${url}`));
  return Promise.resolve({ contextUrl: null, documentUrl: url, document });
};

type Response = Record<string, unknown> | { redirect: string };

function createLoader(
  responses: Record<string, Response>,
): DocumentLoader & { readonly fetched: string[] } {
  const fetched: string[] = [];
  const loader = (url: string): Promise<RemoteDocument> => {
    fetched.push(url);
    let response = responses[url];
    let documentUrl = url;
    if (response != null && "redirect" in response) {
      documentUrl = response.redirect as string;
      response = responses[documentUrl];
    }
    if (response == null) {
      return Promise.reject(
        URL.canParse(url)
          ? new FetchError(url, "HTTP 404", new Response(null, { status: 404 }))
          : new Error(`Not found: ${url}`),
      );
    }
    return Promise.resolve({
      contextUrl: null,
      documentUrl,
      document: structuredClone(response),
    });
  };
  return Object.assign(loader, { fetched });
}

function linkFrom(
  object: unknown,
  property: string,
  overrides: Partial<PortableObjectReferrer> = {},
): PortableObjectReferrer {
  const id = (object as { id?: URL | null }).id ?? null;
  return { object, id, property: AS + property, ...overrides };
}

async function verify(
  document: Record<string, unknown>,
  options: VerifyPortableObjectOptions,
): Promise<VerifyPortableObjectResult> {
  return await verifyPortableObject(document, { contextLoader, ...options });
}

function assertFailure(
  result: VerifyPortableObjectResult,
  type: string,
): void {
  ok(!result.verified, `expected ${type}, got ${JSON.stringify(result)}`);
  strictEqual(result.reason.type, type);
}

const signedActor = await sign(actor());
const actorObject = await Person.fromJsonLd(signedActor, { contextLoader });

test("verifyPortableObject() trusts unsecured collections from listed gateways", async () => {
  const documentLoader = createLoader({
    [gatewayUrl(gw1, actorId)]: signedActor,
  });
  const result = await verify(outbox(), {
    documentLoader,
    documentUrl: new URL(gatewayUrl(gw2, outboxId)),
    gatewayHints: [new URL(gw1)],
    referrer: linkFrom(actorObject, "outbox"),
  });
  ok(result.verified);
  strictEqual(result.method, "gateway");
  if (result.method !== "gateway") return;
  deepStrictEqual(result.gateway, new URL(gw2));
  strictEqual(result.owner.href, actorObject.id?.href);
  // The owner was fetched through the collection's gateway hints, since the
  // referring actor was not dereferenced through gateways itself:
  deepStrictEqual(documentLoader.fetched, [gatewayUrl(gw1, actorId)]);
});

test("verifyPortableObject() rejects unsecured collections from unlisted gateways", async () => {
  const result = await verify(outbox(), {
    documentLoader: createLoader({ [gatewayUrl(gw1, actorId)]: signedActor }),
    documentUrl: new URL(gatewayUrl(evil, outboxId)),
    gatewayHints: [new URL(evil), new URL(gw1)],
    referrer: linkFrom(actorObject, "outbox"),
  });
  assertFailure(result, "untrustedGateway");
  if (result.verified || result.reason.type !== "untrustedGateway") return;
  deepStrictEqual(result.reason.gateway, new URL(evil));
  deepStrictEqual(result.reason.gateways, [new URL(gw1), new URL(gw2)]);
});

test("verifyPortableObject() uses the actual fetch source", async () => {
  const documentLoader = createLoader({
    [gatewayUrl(gw1, actorId)]: signedActor,
  });
  const referrer = linkFrom(actorObject, "outbox");
  const gateways = [new URL(gw1)];
  // Without a final URL, the source is unknown:
  assertFailure(
    await verify(outbox(), { documentLoader, gateways, referrer }),
    "unknownCollectionSource",
  );
  // A redirect off the gateway path loses trust:
  assertFailure(
    await verify(outbox(), {
      documentLoader,
      gateways,
      referrer,
      documentUrl: new URL("https://gw1.example/cdn/outbox.json"),
    }),
    "unknownCollectionSource",
  );
  // A compatible identifier for another object does not count:
  assertFailure(
    await verify(outbox(), {
      documentLoader,
      gateways,
      referrer,
      documentUrl: new URL(gatewayUrl(gw1, `ap://${did}/actor/inbox`)),
    }),
    "unknownCollectionSource",
  );
  // A malformed compatible identifier does not count either:
  assertFailure(
    await verify(outbox(), {
      documentLoader,
      gateways,
      referrer,
      documentUrl: new URL(
        `https://user@gw1.example/.well-known/apgateway/${did}/actor/outbox`,
      ),
    }),
    "unknownCollectionSource",
  );
  // The gateway is judged by the final URL, not by the collection ID or
  // the request:
  const result = await verify(outbox({ id: gatewayUrl(evil, outboxId) }), {
    documentLoader,
    gateways,
    referrer,
    documentUrl: new URL(gatewayUrl(gw1, outboxId)),
  });
  // An HTTP(S) ID is not a portable collection at all:
  assertFailure(result, "notPortableObject");
});

test("verifyPortableObject() requires an unambiguous owner", async () => {
  const documentLoader = createLoader({
    [gatewayUrl(gw1, actorId)]: signedActor,
  });
  const base = {
    documentLoader,
    documentUrl: new URL(gatewayUrl(gw1, outboxId)),
    gateways: [new URL(gw1)],
  };
  // No referrer and no attributedTo:
  assertFailure(await verify(outbox(), base), "unknownCollectionOwner");
  // A referrer through a property other than the actor's collections:
  const note = await Note.fromJsonLd({
    "@context": context,
    id: `ap://${did}/notes/1`,
    type: "Note",
  }, { contextLoader });
  assertFailure(
    await verify(outbox(), { ...base, referrer: linkFrom(note, "replies") }),
    "unknownCollectionOwner",
  );
  // The single attributedTo actor is a candidate on its own:
  const attributed = await verify(outbox({ attributedTo: actorId }), base);
  ok(attributed.verified);
  strictEqual(attributed.method, "gateway");
  // Multiple attributedTo actors are ambiguous:
  assertFailure(
    await verify(
      outbox({ attributedTo: [actorId, `ap://${did}/actor2`] }),
      base,
    ),
    "conflictingCollectionOwners",
  );
  // An attributedTo that disagrees with the referring actor:
  assertFailure(
    await verify(outbox({ attributedTo: `ap://${did}/actor2` }), {
      ...base,
      referrer: linkFrom(actorObject, "outbox"),
    }),
    "conflictingCollectionOwners",
  );
  // A non-portable attributedTo cannot be an owner:
  assertFailure(
    await verify(outbox({ attributedTo: "https://example.com/actor" }), base),
    "unknownCollectionOwner",
  );
});

test("verifyPortableObject() requires the owner to share the collection's DID", async () => {
  // A validly signed actor under another DID that lists this DID's outbox:
  const foreignActorId = `ap://${otherDid}/actor`;
  const foreignActor = await sign(
    actor({ id: foreignActorId, gateways: [evil] }),
    otherKeyPair.privateKey,
    `${otherDid}#${otherDid.slice("did:key:".length)}`,
  );
  const foreignActorObject = await Person.fromJsonLd(foreignActor, {
    contextLoader,
  });
  const documentLoader = createLoader({
    [gatewayUrl(evil, foreignActorId)]: foreignActor,
  });
  const base = {
    documentLoader,
    documentUrl: new URL(gatewayUrl(evil, outboxId)),
    gateways: [new URL(evil)],
  };
  assertFailure(
    await verify(outbox(), {
      ...base,
      referrer: linkFrom(foreignActorObject, "outbox"),
    }),
    "unknownCollectionOwner",
  );
  assertFailure(
    await verify(outbox({ attributedTo: foreignActorId }), base),
    "unknownCollectionOwner",
  );
  deepStrictEqual(documentLoader.fetched, []);
});

test("verifyPortableObject() confirms the owner with its actor document", async () => {
  const documentUrl = new URL(gatewayUrl(gw1, outboxId));
  const gateways = [new URL(gw1)];
  const referrer = linkFrom(actorObject, "outbox");
  // The owner cannot be fetched:
  assertFailure(
    await verify(outbox(), {
      documentLoader: createLoader({}),
      documentUrl,
      gateways,
      referrer,
    }),
    "collectionOwnerUnavailable",
  );
  // The owner's actor document is not signed:
  assertFailure(
    await verify(outbox(), {
      documentLoader: createLoader({ [gatewayUrl(gw1, actorId)]: actor() }),
      documentUrl,
      gateways,
      referrer,
    }),
    "collectionOwnerUnavailable",
  );
  // The owner lists no gateways:
  const { gateways: _, ...noGateways } = actor();
  assertFailure(
    await verify(outbox(), {
      documentLoader: createLoader({
        [gatewayUrl(gw1, actorId)]: await sign(noGateways),
      }),
      documentUrl,
      gateways,
      referrer,
    }),
    "collectionOwnerUnavailable",
  );
  // The owner does not list the collection:
  const otherCollectionId = `ap://${did}/collections/1`;
  assertFailure(
    await verify(outbox({ id: otherCollectionId, attributedTo: actorId }), {
      documentLoader: createLoader({ [gatewayUrl(gw1, actorId)]: signedActor }),
      documentUrl: new URL(gatewayUrl(gw1, otherCollectionId)),
      gateways,
    }),
    "collectionNotListedByOwner",
  );
  // The owner is fetched from the explicit gateways even if they are empty,
  // in which case the document loader is asked for the portable ID itself:
  const emptyLoader = createLoader({ [gatewayUrl(gw1, actorId)]: signedActor });
  assertFailure(
    await verify(outbox(), {
      documentLoader: emptyLoader,
      documentUrl,
      gateways: [],
      gatewayHints: [new URL(gw1)],
      referrer,
    }),
    "collectionOwnerUnavailable",
  );
  deepStrictEqual(emptyLoader.fetched, [`ap+ef61://${did}/actor`]);
});

test("verifyPortableObject() reuses a verified referring actor", async () => {
  const documentLoader = createLoader({});
  const result = await verify(outbox(), {
    documentLoader,
    documentUrl: new URL(gatewayUrl(gw1, outboxId)),
    referrer: linkFrom(actorObject, "outbox", { acceptance: "verified" }),
  });
  ok(result.verified);
  strictEqual(result.method, "gateway");
  deepStrictEqual(documentLoader.fetched, []);
});

test("verifyPortableObject() does not downgrade signed collections", async () => {
  const documentLoader = createLoader({});
  const signedOutbox = await sign(outbox());
  const result = await verify(signedOutbox, {
    documentLoader,
    referrer: linkFrom(actorObject, "outbox"),
  });
  ok(result.verified);
  strictEqual(result.method, "proof");
  // A collection with a broken proof is rejected, not treated as unsecured:
  const tampered = { ...signedOutbox, totalItems: 1 };
  assertFailure(
    await verify(tampered, {
      documentLoader: createLoader({ [gatewayUrl(gw1, actorId)]: signedActor }),
      documentUrl: new URL(gatewayUrl(gw1, outboxId)),
      gateways: [new URL(gw1)],
      referrer: linkFrom(actorObject, "outbox"),
    }),
    "invalidProof",
  );
  // HTTP(S) collections are outside the policy:
  assertFailure(
    await verify(outbox({ id: "https://example.com/outbox" }), {
      documentLoader,
    }),
    "notPortableObject",
  );
});

test("verifyPortableObject() checks pages against their collection", async () => {
  const documentLoader = createLoader({
    [gatewayUrl(gw1, actorId)]: signedActor,
  });
  const collectionResult = await verify(outbox(), {
    documentLoader,
    documentUrl: new URL(gatewayUrl(gw1, outboxId)),
    gateways: [new URL(gw1)],
    referrer: linkFrom(actorObject, "outbox"),
  });
  ok(collectionResult.verified);
  const collection = await OrderedCollection.fromJsonLd(outbox(), {
    contextLoader,
  });
  const collectionContext = collectionResult.collectionContext;
  const pageId = `ap://${did}/actor/outbox?page=1`;
  const page = (overrides: Record<string, unknown> = {}) => ({
    "@context": context,
    id: pageId,
    type: "OrderedCollectionPage",
    partOf: outboxId,
    orderedItems: [],
    ...overrides,
  });
  const pageReferrer = linkFrom(collection, "first", { collectionContext });
  const fetchedBefore = documentLoader.fetched.length;
  // A page inherits the owner, but is checked against its own source:
  const accepted = await verify(page(), {
    documentLoader,
    documentUrl: new URL(gatewayUrl(gw2, pageId)),
    referrer: pageReferrer,
  });
  ok(accepted.verified);
  strictEqual(accepted.method, "gateway");
  strictEqual(documentLoader.fetched.length, fetchedBefore);
  assertFailure(
    await verify(page(), {
      documentLoader,
      documentUrl: new URL(gatewayUrl(evil, pageId)),
      referrer: pageReferrer,
    }),
    "untrustedGateway",
  );
  // A page of another collection:
  assertFailure(
    await verify(page({ partOf: `ap://${did}/actor/inbox` }), {
      documentLoader,
      documentUrl: new URL(gatewayUrl(gw1, pageId)),
      referrer: pageReferrer,
    }),
    "collectionPageMismatch",
  );
  // A page under another DID:
  const foreignPageId = `ap://${otherDid}/outbox?page=1`;
  assertFailure(
    await verify(page({ id: foreignPageId, partOf: undefined }), {
      documentLoader,
      documentUrl: new URL(gatewayUrl(gw1, foreignPageId)),
      referrer: pageReferrer,
    }),
    "collectionPageMismatch",
  );
  // A page naming another owner:
  assertFailure(
    await verify(page({ attributedTo: `ap://${did}/actor2` }), {
      documentLoader,
      documentUrl: new URL(gatewayUrl(gw1, pageId)),
      referrer: pageReferrer,
    }),
    "conflictingCollectionOwners",
  );
  // A page does not fall back to its own attributedTo when it was reached
  // from a collection without context:
  assertFailure(
    await verify(page({ attributedTo: actorId }), {
      documentLoader,
      documentUrl: new URL(gatewayUrl(gw1, pageId)),
      referrer: linkFrom(collection, "first"),
    }),
    "unknownCollectionOwner",
  );
  // A context that verifyPortableObject() did not create is ignored:
  assertFailure(
    await verify(page(), {
      documentLoader,
      documentUrl: new URL(gatewayUrl(gw1, pageId)),
      referrer: linkFrom(collection, "first", {
        collectionContext: { rootId: outboxId, owner: null },
      }),
    }),
    "unknownCollectionOwner",
  );
});

test("verifyPortableObject() checks intermediate pages", async () => {
  const documentLoader = createLoader({
    [gatewayUrl(gw1, actorId)]: signedActor,
  });
  const collection = await OrderedCollection.fromJsonLd(outbox(), {
    contextLoader,
  });
  const intermediate = async (partOf: string) =>
    await CollectionPage.fromJsonLd({
      "@context": context,
      id: `ap://${did}/actor/outbox?page=1`,
      type: "OrderedCollectionPage",
      partOf,
    }, { contextLoader });
  const pageId = `ap://${did}/actor/outbox?page=2`;
  const page = {
    "@context": context,
    id: pageId,
    type: "OrderedCollectionPage",
    partOf: outboxId,
    orderedItems: [],
  };
  const chain = (first: ASObject): PortableObjectReferrer =>
    linkFrom(first, "next", {
      referrer: linkFrom(collection, "first", {
        referrer: linkFrom(actorObject, "outbox"),
      }),
    });
  const options = {
    documentLoader,
    documentUrl: new URL(gatewayUrl(gw1, pageId)),
    gateways: [new URL(gw1)],
  };
  const result = await verify(page, {
    ...options,
    referrer: chain(await intermediate(outboxId)),
  });
  ok(result.verified);
  strictEqual(result.method, "gateway");
  assertFailure(
    await verify(page, {
      ...options,
      referrer: chain(await intermediate(`ap://${did}/actor/inbox`)),
    }),
    "collectionPageMismatch",
  );
  // A truncated chain is not trusted:
  assertFailure(
    await verify(page, {
      ...options,
      referrer: linkFrom(await intermediate(outboxId), "next", {
        truncated: true,
      }),
    }),
    "unknownCollectionOwner",
  );
});

test("verifyPortableObject() works with property accessors", async () => {
  const itemId = `ap://${did}/notes/1`;
  const note = await sign({
    "@context": context,
    id: itemId,
    type: "Note",
    attributedTo: actorId,
    content: "Hello",
  });
  const page1Id = `ap://${did}/actor/outbox?page=1`;
  const page2Id = `ap://${did}/actor/outbox?page=2`;
  const page1 = {
    id: page1Id,
    type: "OrderedCollectionPage",
    partOf: outboxId,
    orderedItems: [
      // An embedded, unsigned copy with the same origin is not trusted,
      // but fetched and verified on its own:
      { id: itemId, type: "Note", content: "Forged" },
    ],
    next: page2Id,
  };
  const documentLoader = createLoader({
    [gatewayUrl(gw1, actorId)]: signedActor,
    // The embedded first page is not trusted either, so it is fetched too:
    [gatewayUrl(gw1, outboxId)]: outbox({ first: page1 }),
    [gatewayUrl(gw1, page1Id)]: { "@context": context, ...page1 },
    [gatewayUrl(gw1, page2Id)]: {
      "@context": context,
      id: page2Id,
      type: "OrderedCollectionPage",
      partOf: outboxId,
      orderedItems: [itemId],
    },
    [gatewayUrl(gw1, itemId)]: note,
  });
  const options = {
    documentLoader,
    contextLoader,
    gateways: [gw1],
    verifyPortableObject,
  };
  const create = await Collection.fromJsonLd({
    "@context": context,
    type: "Collection",
    items: [actorId],
  }, { contextLoader });
  const items = await Array.fromAsync(create.getItems(options));
  strictEqual(items.length, 1);
  ok(items[0] instanceof Person);
  const person = items[0] as Person;
  const outboxCollection = await person.getOutbox(options);
  ok(outboxCollection instanceof OrderedCollection);
  const traversed = await Array.fromAsync(
    traverseCollection(outboxCollection, options),
  );
  deepStrictEqual(
    traversed.map((item) => item instanceof Note ? item.content : null),
    ["Hello", "Hello"],
  );

  // The same collection served by a gateway that the actor does not list is
  // rejected:
  const evilLoader = createLoader({
    // The genuine actor document can be served by anyone:
    [gatewayUrl(evil, actorId)]: signedActor,
    [gatewayUrl(evil, outboxId)]: outbox(),
  });
  const person2 = await Person.fromJsonLd(signedActor, { contextLoader });
  strictEqual(
    await person2.getOutbox({
      ...options,
      documentLoader: evilLoader,
      gateways: [evil],
    }),
    null,
  );
});

test("verifyPortableObject() lets pages inherit owners across signed and embedded collections", async () => {
  const page1Id = `ap://${did}/actor/outbox?page=1`;
  const page1 = {
    "@context": context,
    id: page1Id,
    type: "OrderedCollectionPage",
    partOf: outboxId,
    orderedItems: [],
  };
  const fetchPerson = async (
    options: Parameters<Collection["getItems"]>[0],
  ) => {
    const wrapper = await Collection.fromJsonLd({
      "@context": context,
      type: "Collection",
      items: [actorId],
    }, { contextLoader });
    const [person] = await Array.fromAsync(wrapper.getItems(options));
    ok(person instanceof Person);
    return person;
  };

  // A signed collection whose pages are unsigned:
  const signedOutbox = await sign(outbox({ first: page1Id }));
  let documentLoader = createLoader({
    [gatewayUrl(gw1, actorId)]: signedActor,
    [gatewayUrl(gw1, outboxId)]: signedOutbox,
    [gatewayUrl(gw2, page1Id)]: page1,
  });
  let options = {
    documentLoader,
    contextLoader,
    gateways: [gw1, gw2],
    verifyPortableObject,
  };
  let person = await fetchPerson(options);
  let collection = await person.getOutbox(options);
  ok(collection instanceof OrderedCollection);
  ok(await collection.getFirst(options) instanceof CollectionPage);

  // An actor that embeds its outbox:
  const embeddingActor = await sign(actor({
    outbox: { id: outboxId, type: "OrderedCollection", first: page1Id },
  }));
  documentLoader = createLoader({
    [gatewayUrl(gw1, actorId)]: embeddingActor,
    [gatewayUrl(gw2, page1Id)]: page1,
    [gatewayUrl(evil, page1Id)]: page1,
  });
  options = { ...options, documentLoader };
  person = await fetchPerson(options);
  collection = await person.getOutbox(options);
  ok(collection instanceof OrderedCollection);
  ok(await collection.getFirst(options) instanceof CollectionPage);
  // The embedding actor was verified, so it was not fetched again:
  deepStrictEqual(documentLoader.fetched, [
    gatewayUrl(gw1, actorId),
    gatewayUrl(gw1, page1Id),
    gatewayUrl(gw2, page1Id),
  ]);
  // Pages from an unlisted gateway are still rejected:
  person = await fetchPerson(options);
  collection = await person.getOutbox(options);
  ok(collection instanceof OrderedCollection);
  strictEqual(
    await collection.getFirst({ ...options, gateways: [evil] }),
    null,
  );
});

test("verifyPortableObject() reuses a verified actor for pages of signed collections", async () => {
  const documentLoader = createLoader({});
  const signed = await verify(await sign(outbox()), {
    documentLoader,
    referrer: linkFrom(actorObject, "outbox", { acceptance: "verified" }),
  });
  ok(signed.verified);
  strictEqual(signed.method, "proof");
  const collection = await OrderedCollection.fromJsonLd(outbox(), {
    contextLoader,
  });
  const pageId = `ap://${did}/actor/outbox?page=1`;
  const result = await verify({
    "@context": context,
    id: pageId,
    type: "OrderedCollectionPage",
    partOf: outboxId,
    orderedItems: [],
  }, {
    documentLoader,
    documentUrl: new URL(gatewayUrl(gw1, pageId)),
    referrer: linkFrom(collection, "first", {
      collectionContext: signed.collectionContext,
    }),
  });
  ok(result.verified);
  strictEqual(result.method, "gateway");
  deepStrictEqual(documentLoader.fetched, []);
});

test("verifyPortableObject() fetches the owner through attributedTo hints", async () => {
  const documentLoader = createLoader({
    [gatewayUrl(gw2, actorId)]: signedActor,
  });
  const result = await verify(
    outbox({
      attributedTo: `${actorId}?@gateway=${encodeURIComponent(gw2)}`,
    }),
    {
      documentLoader,
      documentUrl: new URL(gatewayUrl(gw1, outboxId)),
      gatewayHints: [new URL(gw1)],
    },
  );
  ok(result.verified);
  strictEqual(result.method, "gateway");
  deepStrictEqual(documentLoader.fetched, [gatewayUrl(gw2, actorId)]);
});
