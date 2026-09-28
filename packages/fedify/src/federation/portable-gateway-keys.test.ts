import { mockDocumentLoader, test } from "@fedify/fixture";
import { Create, CryptographicKey, Person } from "@fedify/vocab";
import {
  type DocumentLoader,
  encodeMultibase,
  exportDidKey,
  parseIri,
  type RemoteDocument,
} from "@fedify/vocab-runtime";
import { assertEquals, assertRejects } from "@std/assert";
import fetchMock from "fetch-mock";
import serialize from "json-canon";
import {
  createInboxContext,
  createRequestContext,
} from "../testing/context.ts";
import {
  ed25519PrivateKey,
  ed25519PublicKey,
  rsaPrivateKey2,
  rsaPublicKey2,
} from "../testing/keys.ts";
import { signRequest } from "../sig/http.ts";
import { signJsonLd } from "../sig/ld.ts";
import { ActivityListenerSet } from "./activity-listener.ts";
import type { InboxContext } from "./context.ts";
import { handleInbox } from "./handler.ts";
import { KvKeyCache } from "./keycache.ts";
import { MemoryKvStore } from "./kv.ts";
import { createFederation, FederationImpl } from "./middleware.ts";
import type { SenderKeyPair } from "./send.ts";

const did = await exportDidKey(ed25519PublicKey.publicKey);
const didKeyId = new URL(`${did}#${did.slice("did:key:".length)}`);
const actorId = parseIri(`ap+ef61://${did}/actors/alice`);
const gateway = "https://example.com";
const otherGateway = "https://other.example";
const compatibleActorId = (origin: string) =>
  `${origin}/.well-known/apgateway/${did}/actors/alice`;
const gatewayKeyId = new URL(`${compatibleActorId(gateway)}#main-key`);

const ed25519GatewayKeyPair = await crypto.subtle.generateKey(
  "Ed25519",
  true,
  ["sign", "verify"],
) as CryptoKeyPair;
const rsaGatewayKeyPair: CryptoKeyPair = {
  privateKey: rsaPrivateKey2,
  publicKey: rsaPublicKey2.publicKey!,
};

const portableContext = [
  "https://www.w3.org/ns/activitystreams",
  "https://w3id.org/security/data-integrity/v1",
  "https://w3id.org/fep/ef61",
];

const recipient = {
  id: new URL("https://example.com/users/bob"),
  inboxId: new URL("https://example.com/inbox"),
};

async function sign(
  document: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const proofConfig = {
    "@context": document["@context"],
    type: "DataIntegrityProof",
    cryptosuite: "eddsa-jcs-2022",
    verificationMethod: didKeyId.href,
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

function createTestFederation(
  mapper?: (identifier: string) => URL | null,
): FederationImpl<void> {
  const federation = new FederationImpl<void>({
    kv: new MemoryKvStore(),
    manuallyStartQueue: true,
    contextLoaderFactory: () => mockDocumentLoader,
    documentLoaderFactory: () => mockDocumentLoader,
  });
  const setters = federation
    .setActorDispatcher("/users/{identifier}", () => null)
    .setKeyPairsDispatcher(() => [rsaGatewayKeyPair, ed25519GatewayKeyPair]);
  if (mapper != null) setters.mapPortableActorId((_ctx, id) => mapper(id));
  return federation;
}

function portableCreate(id = "1"): Create {
  return new Create({
    id: parseIri(`ap+ef61://${did}/activities/${id}`),
    actor: actorId,
    object: new URL("https://example.com/notes/1"),
  });
}

async function signedPortableCreate(id = "1"): Promise<Create> {
  const json = await portableCreate(id).toJsonLd({
    format: "compact",
    context: portableContext,
    contextLoader: mockDocumentLoader,
  }) as Record<string, unknown>;
  return await Create.fromJsonLd(await sign(json), {
    contextLoader: mockDocumentLoader,
    documentLoader: mockDocumentLoader,
  });
}

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

function signatureKeyId(request: Request): string | undefined {
  // Either an RFC 9421 Signature-Input or a draft-cavage Signature header:
  return request.headers.get("Signature-Input")?.match(/keyid="([^"]+)"/)
    ?.[1] ??
    request.headers.get("Signature")?.match(/keyId="([^"]+)"/)?.[1];
}

test("Context.getActorKeyPairs() derives gateway keys for portable actors", async () => {
  const federation = createTestFederation((id) =>
    id === "alice" ? actorId : null
  );
  const ctx = federation.createContext(new URL(gateway));
  const keys = await ctx.getActorKeyPairs("alice");
  assertEquals(keys.map((k) => k.keyId.href), [
    gatewayKeyId.href,
    `${compatibleActorId(gateway)}#key-2`,
  ]);
  for (const key of keys) {
    assertEquals(key.cryptographicKey.id?.href, key.keyId.href);
    assertEquals(key.cryptographicKey.ownerId?.href, actorId.href);
    // Gateway keys are listed in assertionMethod under the same key IDs:
    assertEquals(key.multikey.id?.href, key.keyId.href);
    assertEquals(key.multikey.controllerId?.href, actorId.href);
  }
  // Actors that are not portable keep their keys as before:
  const ordinary = await ctx.getActorKeyPairs("bob");
  assertEquals(ordinary.map((k) => [k.keyId.href, k.multikey.id?.href]), [
    [
      "https://example.com/users/bob#main-key",
      "https://example.com/users/bob#multikey-1",
    ],
    [
      "https://example.com/users/bob#key-2",
      "https://example.com/users/bob#multikey-2",
    ],
  ]);
  // The actor document published with the keys:
  const person = new Person({
    id: actorId,
    gateways: [new URL(gateway)],
    publicKey: keys[0].cryptographicKey,
    assertionMethods: keys.map((k) => k.multikey),
  });
  const json = await person.toJsonLd({
    format: "compact",
    contextLoader: mockDocumentLoader,
  }) as Record<string, unknown>;
  const assertionMethod = json.assertionMethod as Record<string, unknown>[];
  assertEquals(assertionMethod.map((k) => [k.id, k.controller]), [
    [gatewayKeyId.href, `ap+ef61://${did}/actors/alice`],
    [`${compatibleActorId(gateway)}#key-2`, `ap+ef61://${did}/actors/alice`],
  ]);
  assertEquals(
    (json.publicKey as Record<string, unknown>).id,
    gatewayKeyId.href,
  );
});

test("Context.getActorKeyPairs() accepts compatible IDs as portable actor IDs", async () => {
  const published = new URL(compatibleActorId(otherGateway));
  const federation = createTestFederation(() => published);
  const ctx = federation.createContext(new URL(gateway));
  const [key] = await ctx.getActorKeyPairs("alice");
  // The key ID is based on this gateway, but the owner is the ID as
  // the actor document publishes it:
  assertEquals(key.keyId.href, gatewayKeyId.href);
  assertEquals(key.cryptographicKey.ownerId?.href, published.href);
});

test("Context.getActorKeyPairs() propagates portable actor ID mapper errors", async () => {
  for (
    const id of [
      new URL(`${actorId.href}#me`),
      new URL("https://example.com/users/alice"),
    ]
  ) {
    const ctx = createTestFederation(() => id).createContext(
      new URL(gateway),
    );
    await assertRejects(() => ctx.getActorKeyPairs("alice"), TypeError);
  }
  const ctx = createTestFederation(() => {
    throw new RangeError("mapper failed");
  }).createContext(new URL(gateway));
  await assertRejects(() => ctx.getActorKeyPairs("alice"), RangeError);
  // Key pairs dispatcher errors still yield no keys, as before:
  const federation = new FederationImpl<void>({ kv: new MemoryKvStore() });
  federation
    .setActorDispatcher("/users/{identifier}", () => null)
    .setKeyPairsDispatcher(() => {
      throw new Error("dispatcher failed");
    })
    .mapPortableActorId(() => actorId);
  assertEquals(
    await federation.createContext(new URL(gateway)).getActorKeyPairs("alice"),
    [],
  );
});

test("Context.sendActivity() signs requests with gateway keys for portable actors", async () => {
  const federation = createTestFederation(() => actorId);
  const ctx = federation.createContext(new URL(gateway));
  const activity = await signedPortableCreate();
  const { bodies, requests } = await capture(() =>
    ctx.sendActivity({ identifier: "alice" }, recipient, activity)
  );
  assertEquals(bodies.length, 1);
  assertEquals(signatureKeyId(requests[0]), gatewayKeyId.href);
  // The DID's proof is sent as is, without proofs or a Linked Data Signature
  // made with gateway keys:
  const proof = bodies[0].proof as Record<string, unknown>;
  assertEquals(Array.isArray(proof), false);
  assertEquals(proof.verificationMethod, didKeyId.href);
  assertEquals(bodies[0].signature, undefined);
});

test("Context.sendActivity() refuses portable activities gateway keys would sign", async () => {
  const federation = createTestFederation(() => actorId);
  const ctx = federation.createContext(new URL(gateway));
  // An unsigned portable activity can only be signed by its DID:
  await assertRejects(
    () =>
      ctx.sendActivity({ identifier: "alice" }, recipient, portableCreate()),
    TypeError,
  );
  // A portable actor's activity has to be a portable object of its DID:
  const httpActivity = new Create({
    id: new URL("https://example.com/activities/1"),
    actor: actorId,
    object: new URL("https://example.com/notes/1"),
  });
  await assertRejects(
    () => ctx.sendActivity({ identifier: "alice" }, recipient, httpActivity),
    TypeError,
  );
  // Even a single Ed25519 key that is not the DID's does not sign it:
  await assertRejects(
    () =>
      ctx.sendActivity(
        {
          keyId: new URL("https://example.com/key"),
          privateKey: ed25519PrivateKey,
        },
        recipient,
        portableCreate(),
      ),
    TypeError,
  );
  // The DID's key does:
  const { bodies } = await capture(() =>
    ctx.sendActivity(
      [
        { keyId: gatewayKeyId, privateKey: rsaPrivateKey2 },
        { keyId: didKeyId, privateKey: ed25519PrivateKey },
      ],
      recipient,
      portableCreate(),
    )
  );
  assertEquals(
    (bodies[0].proof as Record<string, unknown>).verificationMethod,
    didKeyId.href,
  );
});

test("Context.sendActivity() never signs documents with gateway keys", async () => {
  const federation = createTestFederation();
  const ctx = federation.createContext(new URL(gateway));
  const keys: SenderKeyPair[] = [
    { keyId: gatewayKeyId, privateKey: rsaPrivateKey2 },
    {
      keyId: new URL(`${compatibleActorId(gateway)}#key-2`),
      privateKey: ed25519GatewayKeyPair.privateKey,
    },
  ];
  const activity = new Create({
    id: new URL("https://example.com/activities/1"),
    actor: new URL("https://example.com/users/bob"),
    object: new URL("https://example.com/notes/1"),
  });
  const { bodies, requests } = await capture(() =>
    ctx.sendActivity(keys, recipient, activity)
  );
  assertEquals(signatureKeyId(requests[0]), gatewayKeyId.href);
  assertEquals(bodies[0].proof, undefined);
  assertEquals(bodies[0].signature, undefined);
});

test("Context.getDocumentLoader() signs requests with gateway keys for portable actors", async () => {
  const federation = createTestFederation(() => actorId);
  const ctx = federation.createContext(new URL(gateway));
  const documentLoader = await ctx.getDocumentLoader({ identifier: "alice" });
  let keyId: string | undefined;
  fetchMock.spyGlobal();
  try {
    fetchMock.get("https://example.com/notes/1", (cl) => {
      keyId = signatureKeyId(cl.request!);
      return new Response(JSON.stringify({ id: cl.request!.url }), {
        headers: { "Content-Type": "application/activity+json" },
      });
    });
    await documentLoader("https://example.com/notes/1");
  } finally {
    fetchMock.hardReset();
  }
  assertEquals(keyId, gatewayKeyId.href);
});

// Inbox

async function actorDocument(
  gateways: readonly string[],
  id: URL = actorId,
  signed = true,
): Promise<Record<string, unknown>> {
  const federation = createTestFederation(() => id);
  const keys = await federation.createContext(new URL(gateway))
    .getActorKeyPairs("alice");
  const json = await new Person({
    id,
    inbox: parseIri(`${id.href}/inbox`),
    gateways: gateways.map((g) => new URL(g)),
    publicKey: keys[0].cryptographicKey,
    assertionMethods: keys.map((k) => k.multikey),
  }).toJsonLd({
    format: "compact",
    contextLoader: mockDocumentLoader,
  }) as Record<string, unknown>;
  json["@context"] = [
    ...json["@context"] as unknown[],
    "https://w3id.org/security/data-integrity/v1",
  ];
  return signed ? await sign(json) : json;
}

function createLoader(responses: Record<string, unknown>): DocumentLoader {
  return (url: string): Promise<RemoteDocument> => {
    const document = responses[url.replace(/#.*$/, "")];
    if (document == null) return mockDocumentLoader(url);
    return Promise.resolve({
      contextUrl: null,
      documentUrl: url,
      document: structuredClone(document),
    });
  };
}

async function deliver(
  body: Record<string, unknown>,
  gateways: readonly string[],
  {
    kv = new MemoryKvStore(),
    httpSignature = true,
    actor,
  }: {
    kv?: MemoryKvStore;
    httpSignature?: boolean;
    actor?: Record<string, unknown>;
  } = {},
): Promise<{ status: number; dispatched: number }> {
  const documentLoader = createLoader({
    [compatibleActorId(gateway)]: actor ?? await actorDocument(gateways),
  });
  const unsigned = new Request("https://local.example/inbox", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/activity+json" },
  });
  const request = httpSignature
    ? await signRequest(unsigned, rsaPrivateKey2, gatewayKeyId)
    : unsigned;
  const federation = createFederation<void>({ kv: new MemoryKvStore() });
  const context = createRequestContext({
    federation,
    request,
    url: new URL(request.url),
    data: undefined,
    documentLoader,
    contextLoader: mockDocumentLoader,
  });
  let dispatched = 0;
  const inboxListeners = new ActivityListenerSet<InboxContext<void>>();
  inboxListeners.add(Create, () => {
    dispatched++;
  });
  const response = await handleInbox(request, {
    recipient: null,
    context,
    inboxContextFactory() {
      return createInboxContext({ ...context, clone: undefined });
    },
    kv,
    kvPrefixes: {
      activityIdempotence: ["_fedify", "activityIdempotence"],
      publicKey: ["_fedify", "publicKey"],
      acceptSignatureNonce: ["_fedify", "acceptSignatureNonce"],
    },
    actorDispatcher() {
      return null;
    },
    inboxListeners,
    onNotFound() {
      return new Response("Not found", { status: 404 });
    },
    signatureTimeWindow: { minutes: 5 },
    skipSignatureVerification: false,
  });
  lastResponseText = await response.text();
  return { status: response.status, dispatched };
}

let lastResponseText = "";

async function createJson(id: string): Promise<Record<string, unknown>> {
  return await portableCreate(id).toJsonLd({
    format: "compact",
    context: portableContext,
    contextLoader: mockDocumentLoader,
  }) as Record<string, unknown>;
}

test("handleInbox() requires proofs of portable actors despite gateway signatures", async () => {
  // The gateway's HTTP signature is valid, but it does not authenticate
  // the activity:
  const unsigned = await createJson("unsigned");
  assertEquals(await deliver(unsigned, [gateway]), {
    status: 401,
    dispatched: 0,
  });
  const tampered = {
    ...await sign(await createJson("tampered")),
    object: "https://remote.example/notes/2",
  };
  assertEquals(await deliver(tampered, [gateway]), {
    status: 401,
    dispatched: 0,
  });
  // A valid proof authenticates the activity:
  assertEquals(
    await deliver(await sign(await createJson("signed")), [gateway]),
    {
      status: 202,
      dispatched: 1,
    },
  );
});

test("handleInbox() does not need gateway signatures for portable actors", async () => {
  // This gateway is not listed, so its HTTP signature is not verified, but
  // the proof alone authenticates the activity:
  assertEquals(
    await deliver(await sign(await createJson("signed")), [otherGateway]),
    { status: 202, dispatched: 1 },
  );
  assertEquals(
    await deliver(await createJson("unsigned"), [otherGateway]),
    { status: 401, dispatched: 0 },
  );
});

test("handleInbox() does not take Linked Data Signatures for portable actors", async () => {
  // A key that Fedify would otherwise accept as the portable actor's for
  // a Linked Data Signature, e.g., from a stale key cache:
  const kv = new MemoryKvStore();
  await new KvKeyCache(kv, ["_fedify", "publicKey"]).set(
    rsaPublicKey2.id!,
    new CryptographicKey({
      id: rsaPublicKey2.id,
      owner: actorId,
      publicKey: rsaPublicKey2.publicKey,
    }),
  );
  const ldSign = (document: Record<string, unknown>) =>
    signJsonLd(document, rsaPrivateKey2, rsaPublicKey2.id!, {
      contextLoader: mockDocumentLoader,
    });
  assertEquals(
    await deliver(await ldSign(await createJson("ld-only")), [gateway], {
      kv,
      httpSignature: false,
    }),
    { status: 401, dispatched: 0 },
  );
  // Only a gateway key can belong to a portable actor, so the stale cache
  // entry is not taken, and the Linked Data Signature is not verified at all:
  assertEquals(lastResponseText, "Failed to verify the request signature.");
});

// Compatible-ID actors and activities

const otherKeyPair = await crypto.subtle.generateKey(
  "Ed25519",
  true,
  ["sign", "verify"],
) as CryptoKeyPair;
const otherDid = await exportDidKey(otherKeyPair.publicKey);

function compatibleCreateJson(
  id: string,
  activityDid: string = did,
): Record<string, unknown> {
  // As tootik's are, both the activity and the actor are identified by
  // compatible identifiers:
  return {
    "@context": portableContext,
    id: `${gateway}/.well-known/apgateway/${activityDid}/activities/${id}`,
    type: "Create",
    actor: compatibleActorId(gateway),
    object: "https://example.com/notes/1",
  };
}

test("handleInbox() does not trust compatible-ID actors by web origin", async () => {
  // The actor document is itself identified by its compatible identifier, as
  // tootik's are, and the request is signed with its key:
  const id = new URL(compatibleActorId(gateway));
  for (const signed of [true, false]) {
    const actor = await actorDocument([gateway], id, signed);
    assertEquals(
      await deliver(compatibleCreateJson(`unsigned-${signed}`), [gateway], {
        actor,
      }),
      { status: 401, dispatched: 0 },
      `actor document signed: ${signed}`,
    );
  }
  assertEquals(
    await deliver(await sign(compatibleCreateJson("signed")), [gateway], {
      actor: await actorDocument([gateway], id),
    }),
    { status: 202, dispatched: 1 },
  );
});

test("handleInbox() requires proofs of compatible-ID actors", async () => {
  // The gateway's HTTP signature is valid, but it does not authenticate
  // the activity of a compatible-ID actor either:
  assertEquals(
    await deliver(compatibleCreateJson("unsigned"), [gateway]),
    { status: 401, dispatched: 0 },
  );
  // A valid proof by the actor's DID authenticates it, with or without
  // HTTP signatures:
  assertEquals(
    await deliver(await sign(compatibleCreateJson("signed")), [gateway]),
    { status: 202, dispatched: 1 },
  );
  assertEquals(
    await deliver(await sign(compatibleCreateJson("unsigned-request")), [
      gateway,
    ], { httpSignature: false }),
    { status: 202, dispatched: 1 },
  );
});

test("handleInbox() checks the DIDs of compatible activity IDs", async () => {
  // An activity whose compatible ID names another DID, signed by the DID of
  // its actor, which the proof does authenticate:
  for (const actor of [actorId.href, compatibleActorId(gateway)]) {
    assertEquals(
      await deliver(
        await sign({ ...compatibleCreateJson("forged", otherDid), actor }),
        [gateway],
      ),
      { status: 401, dispatched: 0 },
      actor,
    );
  }
  // An activity whose ID is an ap: URI of another DID:
  assertEquals(
    await deliver(
      await sign({
        ...compatibleCreateJson("forged-ap"),
        id: `ap://${otherDid}/activities/forged-ap`,
      }),
      [gateway],
    ),
    { status: 401, dispatched: 0 },
  );
  // A malformed compatible activity ID:
  assertEquals(
    await deliver(
      await sign({
        ...compatibleCreateJson("malformed"),
        id:
          `https://user@example.com/.well-known/apgateway/${did}/activities/2`,
      }),
      [gateway],
    ),
    { status: 401, dispatched: 0 },
  );
});
