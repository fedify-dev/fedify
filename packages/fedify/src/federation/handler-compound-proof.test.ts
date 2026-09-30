import { mockDocumentLoader, test } from "@fedify/fixture";
import {
  Create,
  CryptographicKey,
  Multikey,
  Person,
  Update,
} from "@fedify/vocab";
import { encodeMultibase, exportDidKey, parseIri } from "@fedify/vocab-runtime";
import { assertEquals } from "@std/assert";
import serialize from "json-canon";
import vector from "../../test-vectors/fep-8b32/map-local-create-note.json" with {
  type: "json",
};
import {
  createInboxContext,
  createRequestContext,
} from "../testing/context.ts";
import {
  ed25519PrivateKey,
  ed25519PublicKey,
  rsaPrivateKey3,
  rsaPublicKey2,
  rsaPublicKey3,
} from "../testing/keys.ts";
import { signRequest } from "../sig/http.ts";
import { compactJsonLd, signJsonLd, verifyCompactJsonLd } from "../sig/ld.ts";
import { ActivityListenerSet } from "./activity-listener.ts";
import type { InboxContext } from "./context.ts";
import { createFederation } from "./middleware.ts";
import { handleInbox } from "./handler.ts";
import { MemoryKvStore } from "./kv.ts";

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
}

async function secureDocument(
  unsecuredDocument: Record<string, unknown>,
  privateJwk: JsonWebKey,
  verificationMethod: string,
): Promise<Record<string, unknown>> {
  const proofConfiguration = {
    "@context": unsecuredDocument["@context"],
    type: "DataIntegrityProof",
    cryptosuite: "eddsa-jcs-2022",
    verificationMethod,
    proofPurpose: "assertionMethod",
    created: "2023-02-24T23:36:38Z",
  };
  const proofHash = await sha256(serialize(proofConfiguration));
  const documentHash = await sha256(serialize(unsecuredDocument));
  const input = new Uint8Array(64);
  input.set(proofHash);
  input.set(documentHash, proofHash.length);
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    privateJwk,
    "Ed25519",
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("Ed25519", privateKey, input),
  );
  return {
    ...unsecuredDocument,
    proof: {
      ...proofConfiguration,
      proofValue: new TextDecoder().decode(
        encodeMultibase("base58btc", signature),
      ),
    },
  };
}

function requestFor(body: Record<string, unknown>): Request {
  return new Request("https://example.com/inbox", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function handle(
  requestOrBody: Request | Record<string, unknown>,
  dispatched?: { count: number },
): Promise<Response> {
  const request = requestOrBody instanceof Request
    ? requestOrBody
    : requestFor(requestOrBody);
  const federation = createFederation<void>({ kv: new MemoryKvStore() });
  const context = createRequestContext({
    federation,
    request,
    url: new URL(request.url),
    data: undefined,
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  const inboxListeners = new ActivityListenerSet<InboxContext<void>>();
  const count = () => {
    if (dispatched != null) dispatched.count++;
  };
  inboxListeners.add(Create, count);
  inboxListeners.add(Update, count);
  return await handleInbox(request, {
    recipient: null,
    context,
    inboxContextFactory() {
      return createInboxContext({ ...context, clone: undefined });
    },
    kv: new MemoryKvStore(),
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
}

test("handleInbox() enforces portable compound proofs atomically", async () => {
  const valid = structuredClone(
    vector.documents.finalSecuredCompound,
  ) as Record<string, unknown>;
  assertEquals((await handle(valid)).status, 202);

  const unsignedInner = structuredClone(
    vector.documents.outerUnsecuredDocument,
  ) as Record<string, unknown>;
  delete (unsignedInner.object as Record<string, unknown>).proof;
  const validOuterOnly = await secureDocument(
    unsignedInner,
    vector.keys.outer.testPrivateKeyJwk,
    vector.keys.outer.verificationMethod,
  );
  const rejected = await handle(validOuterOnly);
  assertEquals(
    [rejected.status, await rejected.text()],
    [401, "Failed to verify compound portable Object Integrity Proofs."],
  );

  const tamperedInner = structuredClone(
    vector.documents.outerUnsecuredDocument,
  ) as Record<string, unknown>;
  (tamperedInner.object as Record<string, unknown>).content = "Tampered";
  const validOuterWithInvalidInner = await secureDocument(
    tamperedInner,
    vector.keys.outer.testPrivateKeyJwk,
    vector.keys.outer.verificationMethod,
  );
  assertEquals((await handle(validOuterWithInvalidInner)).status, 401);

  const changedAfterSigning = structuredClone(valid);
  changedAfterSigning.summary = "Added after signing";
  assertEquals((await handle(changedAfterSigning)).status, 401);
});

test("handleInbox() enforces compounds after alternate outer auth", async () => {
  const createBody = (object: Record<string, unknown>) => ({
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/data-integrity/v1",
    ],
    id: "https://example.com/activities/compound",
    type: "Create",
    actor: rsaPublicKey3.ownerId!.href,
    object,
  });
  const validInner = structuredClone(
    vector.documents.securedInner,
  ) as Record<string, unknown>;
  const unsignedInner = structuredClone(validInner);
  delete unsignedInner.proof;

  for (const authentication of ["http", "ld"] as const) {
    const sign = async (body: Record<string, unknown>): Promise<Request> => {
      if (authentication === "http") {
        return await signRequest(
          requestFor(body),
          rsaPrivateKey3,
          rsaPublicKey3.id!,
        );
      }
      const signed = await signJsonLd(
        body,
        rsaPrivateKey3,
        rsaPublicKey3.id!,
        { contextLoader: mockDocumentLoader },
      );
      return requestFor(signed);
    };

    const acceptedDispatch = { count: 0 };
    const accepted = await handle(
      await sign(createBody(structuredClone(validInner))),
      acceptedDispatch,
    );
    assertEquals([accepted.status, acceptedDispatch.count], [202, 1]);

    const rejectedDispatch = { count: 0 };
    const rejected = await handle(
      await sign(createBody(structuredClone(unsignedInner))),
      rejectedDispatch,
    );
    assertEquals([rejected.status, rejectedDispatch.count], [401, 0]);
  }

  const proofSetInner = structuredClone(validInner);
  proofSetInner.proof = [proofSetInner.proof];
  const unsupportedDispatch = { count: 0 };
  const unsupported = await handle(
    await signRequest(
      requestFor(createBody(proofSetInner)),
      rsaPrivateKey3,
      rsaPublicKey3.id!,
    ),
    unsupportedDispatch,
  );
  assertEquals([unsupported.status, unsupportedDispatch.count], [401, 0]);
});

test("handleInbox() preserves ordinary top-level proof behavior", async () => {
  const activity = await secureDocument(
    {
      "@context": [
        "https://www.w3.org/ns/activitystreams",
        "https://w3id.org/security/data-integrity/v1",
      ],
      id: "https://example.com/activities/ordinary",
      type: "Create",
      actor: vector.keys.outer.controller,
      object: {
        id: "https://example.com/notes/ordinary",
        type: "Note",
        attributedTo: vector.keys.outer.controller,
        content: "An ordinary note",
      },
    },
    vector.keys.outer.testPrivateKeyJwk,
    vector.keys.outer.verificationMethod,
  );
  assertEquals((await handle(activity)).status, 202);
});

async function signLd(
  document: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return await signJsonLd(document, rsaPrivateKey3, rsaPublicKey3.id!, {
    contextLoader: mockDocumentLoader,
  }) as Record<string, unknown>;
}

async function isLdSignatureVerified(
  document: Record<string, unknown>,
): Promise<boolean> {
  return await verifyCompactJsonLd(
    await compactJsonLd(document, mockDocumentLoader),
    {
      contextLoader: mockDocumentLoader,
      documentLoader: mockDocumentLoader,
    },
  );
}

async function handleDispatched(
  body: Record<string, unknown>,
): Promise<[number, string, number]> {
  const dispatched = { count: 0 };
  const response = await handle(body, dispatched);
  return [response.status, await response.text(), dispatched.count];
}

const COMPOUND_FAILURE =
  "Failed to verify compound portable Object Integrity Proofs.";

test("handleInbox() ignores a portable activity's Linked Data Signature", async () => {
  const signed = await signLd(
    structuredClone(vector.documents.finalSecuredCompound),
  );
  // The key owner is not the portable actor, so only the DID proof
  // authenticates the activity:
  assertEquals(await isLdSignatureVerified(signed), false);
  assertEquals(await handleDispatched(signed), [202, "", 1]);

  const bogus = structuredClone(
    vector.documents.finalSecuredCompound,
  ) as Record<string, unknown>;
  bogus.signature = {
    type: "RsaSignature2017",
    creator: "https://example.com/keys/1",
    created: "2023-02-24T23:36:38Z",
    signatureValue: "not-a-signature",
  };
  assertEquals(await handleDispatched(bogus), [202, "", 1]);

  const tampered = structuredClone(
    vector.documents.finalSecuredCompound,
  ) as Record<string, unknown>;
  tampered.object = {
    ...tampered.object as Record<string, unknown>,
    content: "Tampered",
  };
  assertEquals((await handleDispatched(await signLd(tampered)))[0], 401);

  const invalidInner = structuredClone(
    vector.documents.outerUnsecuredDocument,
  ) as Record<string, unknown>;
  (invalidInner.object as Record<string, unknown>).content = "Tampered";
  assertEquals(
    await handleDispatched(
      await signLd(
        await secureDocument(
          invalidInner,
          vector.keys.outer.testPrivateKeyJwk,
          vector.keys.outer.verificationMethod,
        ),
      ),
    ),
    [401, COMPOUND_FAILURE, 0],
  );
});

test("handleInbox() verifies compounds with verified Linked Data Signatures", async () => {
  const createBody = (object: Record<string, unknown>) => ({
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/data-integrity/v1",
    ],
    id: "https://example.com/activities/compound-ld",
    type: "Create",
    actor: rsaPublicKey3.ownerId!.href,
    object,
  });
  const privateJwk = await crypto.subtle.exportKey("jwk", ed25519PrivateKey);
  const sign = async (object: Record<string, unknown>) =>
    await signLd(
      await secureDocument(
        createBody(object),
        privateJwk,
        ed25519PublicKey.id!.href,
      ),
    );

  const valid = await sign(structuredClone(vector.documents.securedInner));
  assertEquals(await isLdSignatureVerified(valid), true);
  assertEquals(await handleDispatched(valid), [202, "", 1]);

  const invalidInner = structuredClone(
    vector.documents.securedInner,
  ) as Record<string, unknown>;
  invalidInner.content = "Tampered";
  const invalid = await sign(invalidInner);
  assertEquals(await isLdSignatureVerified(invalid), true);
  assertEquals(await handleDispatched(invalid), [401, COMPOUND_FAILURE, 0]);
});

test("handleInbox() keeps embedded signature properties in proof inputs", async () => {
  const innerWithSignature = await secureDocument(
    {
      ...vector.documents.innerUnsecuredDocument,
      "@context": [
        "https://w3id.org/security/v1",
        ...vector.documents.innerUnsecuredDocument["@context"],
      ],
      signature: {
        type: "https://example.com/ns#ExampleSignature",
        signatureValue: "covered by the inner proof",
      },
    },
    vector.keys.inner.testPrivateKeyJwk,
    vector.keys.inner.verificationMethod,
  );
  const sign = async (object: Record<string, unknown>) =>
    await signLd(
      await secureDocument(
        { ...vector.documents.outerUnsecuredDocument, object },
        vector.keys.outer.testPrivateKeyJwk,
        vector.keys.outer.verificationMethod,
      ),
    );

  assertEquals(
    await handleDispatched(await sign(structuredClone(innerWithSignature))),
    [202, "", 1],
  );

  const innerWithoutSignature = structuredClone(innerWithSignature);
  delete innerWithoutSignature.signature;
  assertEquals(
    await handleDispatched(await sign(innerWithoutSignature)),
    [401, COMPOUND_FAILURE, 0],
  );
});

test("handleInbox() inspects compounds without the Linked Data Signature", async () => {
  const activity = await secureDocument(
    {
      "@context": [
        "https://www.w3.org/ns/activitystreams",
        "https://w3id.org/security/data-integrity/v1",
      ],
      id: "https://example.com/activities/ordinary-ld",
      type: "Create",
      actor: vector.keys.outer.controller,
      object: {
        id: "https://example.com/notes/ordinary-ld",
        type: "Note",
        attributedTo: vector.keys.outer.controller,
        content: "An ordinary note",
      },
    },
    vector.keys.outer.testPrivateKeyJwk,
    vector.keys.outer.verificationMethod,
  );
  activity.signature = {
    id: vector.documents.innerUnsecuredDocument.id,
    type: "RsaSignature2017",
    creator: "https://example.com/keys/1",
    created: "2023-02-24T23:36:38Z",
    signatureValue: "not-a-signature",
  };
  assertEquals(await handleDispatched(activity), [202, "", 1]);
});

test("handleInbox() accepts portable actors with keys at ap: URIs", async () => {
  // An FEP-ae97 client identifies the keys of its actor by ap: URIs, and
  // publishes an Update of the actor after registering it on a gateway:
  const did = await exportDidKey(ed25519PublicKey.publicKey);
  const verificationMethod = `${did}#${did.slice("did:key:".length)}`;
  const privateJwk = await crypto.subtle.exportKey("jwk", ed25519PrivateKey);
  const actorId = `ap://${did}/actor`;
  const inboxId = `https://gw.example/.well-known/apgateway/${did}/actor/inbox`;
  const actor = await new Person({
    id: parseIri(actorId),
    inbox: new URL(inboxId),
    gateways: [new URL("https://gw.example")],
    publicKey: new CryptographicKey({
      id: parseIri(`${actorId}#main-key`),
      owner: parseIri(actorId),
      publicKey: rsaPublicKey2.publicKey,
    }),
    assertionMethods: [
      new Multikey({
        id: parseIri(`${actorId}#ed25519-key`),
        controller: parseIri(actorId),
        publicKey: ed25519PublicKey.publicKey,
      }),
    ],
  }).toJsonLd({
    format: "compact",
    contextLoader: mockDocumentLoader,
  }) as Record<string, unknown>;
  const update = async (keyBase: string) => {
    const [multikey] = actor.assertionMethod as Record<string, unknown>[];
    return await secureDocument(
      {
        "@context": [
          "https://www.w3.org/ns/activitystreams",
          "https://w3id.org/security/data-integrity/v1",
        ],
        id: `ap://${did}/activities/update`,
        type: "Update",
        actor: actorId,
        object: await secureDocument(
          {
            ...actor,
            id: actorId,
            publicKey: {
              ...actor.publicKey as Record<string, unknown>,
              id: `${keyBase}#main-key`,
              owner: actorId,
            },
            assertionMethod: [
              {
                ...multikey,
                id: `${keyBase}#ed25519-key`,
                controller: actorId,
              },
            ],
          },
          privateJwk,
          verificationMethod,
        ),
      },
      privateJwk,
      verificationMethod,
    );
  };

  for (
    const keyBase of [
      actorId,
      `ap+ef61://${encodeURIComponent(did)}/actor`,
    ]
  ) {
    const dispatched = { count: 0 };
    const response = await handle(await update(keyBase), dispatched);
    assertEquals([response.status, dispatched.count], [202, 1], keyBase);
  }

  // Keys at ap: URIs of another DID are not the actor's:
  const dispatched = { count: 0 };
  const response = await handle(
    await update(
      "ap://did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK/actor",
    ),
    dispatched,
  );
  assertEquals([response.status, dispatched.count], [401, 0]);
});

test("handleInbox() rejects embedded portable actors without valid gateways", async () => {
  const did = await exportDidKey(ed25519PublicKey.publicKey);
  const verificationMethod = `${did}#${did.slice("did:key:".length)}`;
  const privateJwk = await crypto.subtle.exportKey("jwk", ed25519PrivateKey);
  const actorId = `ap://${did}/actor`;
  const update = async (gateways: Record<string, unknown>) =>
    await secureDocument(
      {
        "@context": [
          "https://www.w3.org/ns/activitystreams",
          "https://w3id.org/security/data-integrity/v1",
        ],
        id: `ap://${did}/activities/update`,
        type: "Update",
        actor: actorId,
        // The embedded actor is signed separately, before the activity:
        object: await secureDocument(
          {
            "@context": [
              "https://www.w3.org/ns/activitystreams",
              "https://w3id.org/security/data-integrity/v1",
              "https://w3id.org/fep/ef61",
            ],
            id: actorId,
            type: "Person",
            inbox: `${actorId}/inbox`,
            outbox: `${actorId}/outbox`,
            ...gateways,
          },
          privateJwk,
          verificationMethod,
        ),
      },
      privateJwk,
      verificationMethod,
    );
  const cases: [Record<string, unknown>, number, number][] = [
    [{ gateways: ["https://gw.example"] }, 202, 1],
    [{}, 401, 0],
    [{ gateways: [] }, 401, 0],
    // The vocabulary cannot even parse a gateway with a path, so the activity
    // is rejected as malformed rather than as unverified:
    [{ gateways: ["https://gw.example/path"] }, 400, 0],
  ];
  for (const [gateways, status, count] of cases) {
    const dispatched = { count: 0 };
    const response = await handle(await update(gateways), dispatched);
    assertEquals(
      [response.status, dispatched.count],
      [status, count],
      JSON.stringify(gateways),
    );
  }
});
