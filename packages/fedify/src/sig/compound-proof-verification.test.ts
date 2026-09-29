import { mockDocumentLoader, test } from "@fedify/fixture";
import { CryptographicKey, Multikey, Person } from "@fedify/vocab";
import { encodeMultibase, exportDidKey, parseIri } from "@fedify/vocab-runtime";
import { assert, assertEquals } from "@std/assert";
import serialize from "json-canon";
import vector from "../../test-vectors/fep-8b32/map-local-create-note.json" with {
  type: "json",
};
import conflictVector from "../../test-vectors/fep-8b32/map-local-context-conflict.json" with {
  type: "json",
};
import {
  ed25519PrivateKey,
  ed25519PublicKey,
  rsaPublicKey2,
} from "../testing/keys.ts";
import {
  type CompoundProofDiscoveryLimits,
  containsCompoundPortableObject,
  inspectCompoundPortableObjectApplicability,
  verifyCompoundPortableObjectProofs,
  verifyCompoundProofDocuments,
} from "./compound-proof.ts";
import {
  verifyMapLocalProof,
  verifyPortableObjectProofPolicy,
} from "./proof.ts";

const limits: CompoundProofDiscoveryLimits = {
  maxDepth: 16,
  maxMaps: 32,
  maxProofs: 8,
  maxBytes: 16_384,
};
const options = {
  contextLoader: mockDocumentLoader,
  documentLoader() {
    throw new TypeError("did:key must not use the document loader");
  },
};

function createInlineProofContext(): Record<string, unknown> {
  return {
    id: "@id",
    type: "@type",
    Note: "https://www.w3.org/ns/activitystreams#Note",
    attributedTo: {
      "@id": "https://www.w3.org/ns/activitystreams#attributedTo",
      "@type": "@id",
    },
    content: "https://www.w3.org/ns/activitystreams#content",
    DataIntegrityProof: "https://w3id.org/security#DataIntegrityProof",
    cryptosuite: "https://w3id.org/security#cryptosuite",
    verificationMethod: {
      "@id": "https://w3id.org/security#verificationMethod",
      "@type": "@id",
    },
    proofPurpose: {
      "@id": "https://w3id.org/security#proofPurpose",
      "@type": "@vocab",
    },
    assertionMethod: "https://w3id.org/security#assertionMethod",
    created: {
      "@id": "http://purl.org/dc/terms/created",
      "@type": "http://www.w3.org/2001/XMLSchema#dateTime",
    },
    proofValue: "https://w3id.org/security#proofValue",
    proof: "https://w3id.org/security#proof",
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  assert(value != null && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
}

async function secureRawDocument(
  unsecuredDocument: Record<string, unknown>,
  privateJwk: JsonWebKey,
  verificationMethod: string,
  proofContext: unknown = unsecuredDocument["@context"],
): Promise<Record<string, unknown>> {
  const proofConfiguration = {
    "@context": structuredClone(proofContext),
    type: "DataIntegrityProof",
    cryptosuite: "eddsa-jcs-2022",
    verificationMethod,
    proofPurpose: "assertionMethod",
    created: "2023-02-24T23:36:38Z",
  };
  const proofDigest = await sha256(serialize(proofConfiguration));
  const documentDigest = await sha256(serialize(unsecuredDocument));
  const input = new Uint8Array(proofDigest.length + documentDigest.length);
  input.set(proofDigest);
  input.set(documentDigest, proofDigest.length);
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

test("verifyCompoundProofDocuments() verifies the recorded maps independently", async () => {
  for (const fixture of [vector, conflictVector]) {
    const input = structuredClone(fixture.documents.finalSecuredCompound);
    const result = await verifyCompoundProofDocuments(input, limits, options);

    assertEquals(result.status, "ok");
    if (result.status !== "ok") continue;
    assert(result.verified);
    assertEquals(
      result.documents.map(({ path, verified }) => ({ path, verified })),
      [
        { path: "/object", verified: true },
        { path: "", verified: true },
      ],
    );
    assertEquals(
      result.documents.map((document) =>
        document.verified ? document.key.id?.href : null
      ),
      [
        fixture.keys.inner.verificationMethod,
        fixture.keys.outer.verificationMethod,
      ],
    );
    assertEquals(result.snapshot, input);
  }
});

test("verifyCompoundProofDocuments() does not verify an empty proof set", async () => {
  const result = await verifyCompoundProofDocuments(
    {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: "https://example.com/notes/unsigned",
      type: "Note",
    },
    limits,
    options,
  );

  assertEquals(result.status, "ok");
  if (result.status !== "ok") return;
  assertEquals(result.verified, false);
  assertEquals(result.documents, []);
  assertEquals(result.statistics.proofCount, 0);
});

test("verifyCompoundProofDocuments() reports tampering and proof replacement per map", async () => {
  const tampered = structuredClone(vector.documents.finalSecuredCompound);
  asRecord(tampered.object).content = "Tampered after both proofs";
  const tamperedResult = await verifyCompoundProofDocuments(
    tampered,
    limits,
    options,
  );
  assertEquals(tamperedResult.status, "ok");
  if (tamperedResult.status === "ok") {
    assertEquals(tamperedResult.verified, false);
    assertEquals(
      tamperedResult.documents.map(({ path, verified }) => ({
        path,
        verified,
      })),
      [
        { path: "/object", verified: false },
        { path: "", verified: false },
      ],
    );
  }

  const replaced = structuredClone(vector.documents.finalSecuredCompound);
  asRecord(replaced.object).proof = structuredClone(
    vector.documents.replacementInnerProof,
  );
  const replacedResult = await verifyCompoundProofDocuments(
    replaced,
    limits,
    options,
  );
  assertEquals(replacedResult.status, "ok");
  if (replacedResult.status === "ok") {
    assertEquals(replacedResult.verified, false);
    assertEquals(
      replacedResult.documents.map(({ path, verified }) => ({
        path,
        verified,
      })),
      [
        { path: "/object", verified: true },
        { path: "", verified: false },
      ],
    );
  }
});

test("verifyCompoundProofDocuments() requires a local context on nested secured maps", async () => {
  const input = structuredClone(vector.documents.finalSecuredCompound);
  delete asRecord(input.object)["@context"];
  const result = await verifyCompoundProofDocuments(input, limits, options);

  assertEquals(result.status, "ok");
  if (result.status !== "ok") return;
  assertEquals(result.verified, false);
  assertEquals(result.documents[0], {
    path: "/object",
    id: vector.documents.securedInner.id,
    depth: 1,
    verified: false,
    reason: { type: "missingContext" },
  });
});

test("verifyCompoundProofDocuments() preserves proof aliases in the JCS input", async () => {
  const context = [
    "https://www.w3.org/ns/activitystreams",
    "https://w3id.org/security/data-integrity/v1",
    { integrityProof: "https://w3id.org/security#proof" },
  ];
  const unsecured = {
    "@context": context,
    id: "https://example.com/notes/alias-bound",
    type: "Note",
    content: "Alias-bound content",
    integrityProof: "This value is signed data, not the direct proof.",
  };
  const secured = await secureRawDocument(
    unsecured,
    vector.keys.outer.testPrivateKeyJwk,
    vector.keys.outer.verificationMethod,
  );

  const result = await verifyCompoundProofDocuments(secured, limits, options);
  assertEquals(result.status, "ok");
  if (result.status !== "ok") return;
  assert(result.verified);

  const tampered = structuredClone(secured);
  tampered.integrityProof = "Changed after signing";
  const tamperedResult = await verifyCompoundProofDocuments(
    tampered,
    limits,
    options,
  );
  assertEquals(tamperedResult.status, "ok");
  if (tamperedResult.status === "ok") {
    assertEquals(tamperedResult.verified, false);
  }
});

test("verifyCompoundProofDocuments() preserves the received document context", async () => {
  const proofContext = [
    "https://www.w3.org/ns/activitystreams",
    "https://w3id.org/security/data-integrity/v1",
  ];
  const documentContext = [
    ...proofContext,
    { ex: "https://example.com/ns#" },
  ];
  const secured = await secureRawDocument(
    {
      "@context": documentContext,
      id: "https://example.com/notes/distinct-contexts",
      type: "Note",
      content: "The document context is part of the signed input.",
    },
    vector.keys.outer.testPrivateKeyJwk,
    vector.keys.outer.verificationMethod,
    proofContext,
  );

  const result = await verifyCompoundProofDocuments(secured, limits, options);
  assertEquals(result.status, "ok");
  if (result.status !== "ok") return;
  assert(result.verified);
});

test("verifyCompoundProofDocuments() authenticates only received JSON values", async () => {
  const secured = await secureRawDocument(
    {
      "@context": [
        "https://www.w3.org/ns/activitystreams",
        "https://w3id.org/security/data-integrity/v1",
      ],
      id: "https://example.com/notes/attachment-array",
      type: "Note",
      attachment: ["https://example.com/images/1"],
    },
    vector.keys.outer.testPrivateKeyJwk,
    vector.keys.outer.verificationMethod,
  );
  const verified = await verifyCompoundProofDocuments(secured, limits, options);
  assertEquals(verified.status, "ok");
  if (verified.status !== "ok") return;
  assert(verified.verified);

  const tampered = structuredClone(secured);
  tampered.attachment = "https://example.com/images/1";
  const result = await verifyCompoundProofDocuments(tampered, limits, options);
  assertEquals(result.status, "ok");
  if (result.status === "ok") assertEquals(result.verified, false);
});

test("verifyCompoundProofDocuments() contains malformed contexts per map", async () => {
  const valid = await secureRawDocument(
    {
      "@context": [
        "https://www.w3.org/ns/activitystreams",
        "https://w3id.org/security/data-integrity/v1",
      ],
      id: "https://example.com/notes/valid-sibling",
      type: "Note",
      content: "This sibling must still produce a result.",
    },
    vector.keys.outer.testPrivateKeyJwk,
    vector.keys.outer.verificationMethod,
  );
  const malformed = structuredClone(valid);
  malformed["@context"] = 42;
  malformed.id = "https://example.com/notes/malformed-context";
  malformed.proof = {
    "@context": [],
    "@type": ["https://w3id.org/security#DataIntegrityProof"],
    "https://w3id.org/security#cryptosuite": [{
      "@value": "eddsa-jcs-2022",
    }],
    "https://w3id.org/security#verificationMethod": [{
      "@id": vector.keys.outer.verificationMethod,
    }],
    "https://w3id.org/security#proofPurpose": [{
      "@id": "https://w3id.org/security#assertionMethod",
    }],
    "http://purl.org/dc/terms/created": [{
      "@value": "2023-02-24T23:36:38Z",
      "@type": "http://www.w3.org/2001/XMLSchema#dateTime",
    }],
    "https://w3id.org/security#proofValue": [{
      "@value": asRecord(valid.proof).proofValue,
    }],
  };

  const result = await verifyCompoundProofDocuments(
    { malformed, valid },
    limits,
    options,
  );
  assertEquals(result.status, "ok");
  if (result.status !== "ok") return;
  assertEquals(result.verified, false);
  assertEquals(
    result.documents.map((document) => ({
      path: document.path,
      verified: document.verified,
      reason: document.verified ? undefined : document.reason.type,
    })),
    [
      { path: "/malformed", verified: false, reason: "invalidProof" },
      { path: "/valid", verified: true, reason: undefined },
    ],
  );
});

test("verifyCompoundProofDocuments() does not fetch proof contexts", async () => {
  let contextLoads = 0;
  const result = await verifyCompoundProofDocuments(
    {
      "@context": "https://attacker.example/context",
      id: "https://example.com/notes/remote-context",
      type: "Note",
      proof: {
        type: "DataIntegrityProof",
        cryptosuite: "eddsa-jcs-2022",
        verificationMethod: vector.keys.outer.verificationMethod,
        proofPurpose: "assertionMethod",
        created: "2023-02-24T23:36:38Z",
        proofValue: vector.proofValues.outer,
      },
    },
    limits,
    {
      ...options,
      contextLoader() {
        contextLoads++;
        throw new TypeError("unexpected context fetch");
      },
    },
  );

  assertEquals(result.status, "ok");
  if (result.status === "ok") assertEquals(result.verified, false);
  assertEquals(contextLoads, 0);
});

test("verifyCompoundPortableObjectProofs() applies policy to every portable map", async () => {
  let contextLoads = 0;
  const result = await verifyCompoundPortableObjectProofs(
    vector.documents.finalSecuredCompound,
    limits,
    {
      ...options,
      contextLoader() {
        contextLoads++;
        throw new TypeError("unexpected context fetch");
      },
    },
  );

  assertEquals(result.status, "ok");
  if (result.status !== "ok") return;
  assert(result.verified);
  assertEquals(contextLoads, 0);
  assertEquals(
    result.portableObjects.map((document) => ({
      path: document.path,
      verified: document.verified,
      keys: document.verified ? document.keys.map((key) => key.id?.href) : [],
    })),
    [
      {
        path: "/object",
        verified: true,
        keys: [vector.keys.inner.verificationMethod],
      },
      {
        path: "",
        verified: true,
        keys: [vector.keys.outer.verificationMethod],
      },
    ],
  );
});

test("verifyCompoundPortableObjectProofs() reports unsigned portable maps", async () => {
  const context = [
    "https://www.w3.org/ns/activitystreams",
    "https://w3id.org/security/data-integrity/v1",
  ];
  const result = await verifyCompoundPortableObjectProofs(
    {
      "@context": context,
      id: vector.documents.outerUnsecuredDocument.id,
      type: "Create",
      actor: vector.documents.outerUnsecuredDocument.actor,
      object: {
        "@context": structuredClone(context),
        id: vector.documents.innerUnsecuredDocument.id,
        type: "Note",
        attributedTo: vector.documents.innerUnsecuredDocument.attributedTo,
        content: "Unsigned portable child",
      },
    },
    limits,
    options,
  );

  assertEquals(result.status, "ok");
  if (result.status !== "ok") return;
  assertEquals(result.verified, false);
  assertEquals(result.proofs, []);
  assertEquals(
    result.portableObjects.map((document) => ({
      path: document.path,
      verified: document.verified,
      reason: document.verified ? undefined : document.reason.type,
    })),
    [
      { path: "/object", verified: false, reason: "missingProof" },
      { path: "", verified: false, reason: "missingProof" },
    ],
  );
});

test("verifyCompoundPortableObjectProofs() reports policy before crypto failure", async () => {
  const mismatched = structuredClone(vector.documents.finalSecuredCompound);
  asRecord(mismatched.object).id = vector.documents.outerUnsecuredDocument.id;
  const result = await verifyCompoundPortableObjectProofs(
    mismatched,
    limits,
    options,
  );

  assertEquals(result.status, "ok");
  if (result.status !== "ok") return;
  assertEquals(result.verified, false);
  const inner = result.portableObjects.find(({ path }) => path === "/object");
  assert(inner != null && !inner.verified);
  assertEquals(inner.reason.type, "verificationMethodMismatch");
});

test("verifyCompoundPortableObjectProofs() finds unsigned portable maps in arrays", async () => {
  const result = await verifyCompoundPortableObjectProofs(
    {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: "https://social.example/activities/1",
      type: "Create",
      attachment: [{
        "@context": [
          "https://www.w3.org/ns/activitystreams",
          "https://w3id.org/security/data-integrity/v1",
        ],
        id: vector.documents.innerUnsecuredDocument.id,
        type: "Note",
        content: "Unsigned portable attachment",
      }],
    },
    limits,
    options,
  );

  assertEquals(result.status, "ok");
  if (result.status !== "ok") return;
  assertEquals(result.verified, false);
  assertEquals(
    result.portableObjects.map((document) => ({
      path: document.path,
      reason: document.verified ? undefined : document.reason.type,
    })),
    [{ path: "/attachment/0", reason: "missingProof" }],
  );
});

test("verifyCompoundPortableObjectProofs() ignores context definitions", async () => {
  const result = await verifyCompoundPortableObjectProofs(
    {
      "@context": {
        portable: {
          "@id": vector.documents.innerUnsecuredDocument.id,
          "@context": {
            proof: "https://w3id.org/security#proof",
          },
        },
      },
      id: "https://social.example/objects/1",
      type: "Note",
    },
    limits,
    options,
  );

  assertEquals(result.status, "ok");
  if (result.status !== "ok") return;
  assertEquals(result.verified, false);
  assertEquals(result.proofs, []);
  assertEquals(result.portableObjects, []);
});

test("verifyCompoundPortableObjectProofs() contains malformed portable IDs", async () => {
  const result = await verifyCompoundPortableObjectProofs(
    {
      "@context": [
        "https://www.w3.org/ns/activitystreams",
        "https://w3id.org/security/data-integrity/v1",
      ],
      id: "ap://did%ZZkey/objects/1",
      type: "Note",
    },
    limits,
    options,
  );

  assertEquals(result.status, "ok");
  if (result.status !== "ok") return;
  assertEquals(result.verified, false);
  assertEquals(result.portableObjects.length, 1);
  const [object] = result.portableObjects;
  assert(!object.verified);
  assertEquals(object.reason, { type: "invalidPortableObject" });
});

test("verifyPortableObjectProofPolicy() binds policy to the verified key", async () => {
  const outerKey = await verifyMapLocalProof(
    vector.documents.finalSecuredCompound,
    options,
  );
  assert(outerKey != null);
  assertEquals(
    await verifyPortableObjectProofPolicy(
      vector.documents.securedInner,
      outerKey,
      options,
    ),
    { verified: false, reason: { type: "invalidProof", proofIndex: 0 } },
  );
});

test("verifyPortableObjectProofPolicy() binds policy to the verified proof", async () => {
  const context = createInlineProofContext();
  context.proof = {
    "@id": "https://w3id.org/security#proof",
    "@context": {
      assertionMethod: "https://w3id.org/security#authentication",
    },
  };
  const secured = await secureRawDocument(
    {
      "@context": context,
      id: vector.documents.innerUnsecuredDocument.id,
      type: "Note",
      attributedTo: vector.documents.innerUnsecuredDocument.attributedTo,
      content: "Property-scoped proof purpose",
    },
    vector.keys.inner.testPrivateKeyJwk,
    vector.keys.inner.verificationMethod,
  );
  delete asRecord(secured.proof)["@context"];

  const key = await verifyMapLocalProof(secured, options);
  assert(key != null);
  assertEquals(
    await verifyPortableObjectProofPolicy(secured, key, options),
    { verified: false, reason: { type: "invalidProof", proofIndex: 0 } },
  );
});

test("verifyCompoundPortableObjectProofs() reports the policy-validated ID", async () => {
  const context = createInlineProofContext();
  context.id = "https://example.com/id";
  const secured = await secureRawDocument(
    {
      "@context": context,
      id: vector.documents.outerUnsecuredDocument.id,
      "@id": vector.documents.innerUnsecuredDocument.id,
      type: "Note",
      content: "Conflicting raw ID",
    },
    vector.keys.inner.testPrivateKeyJwk,
    vector.keys.inner.verificationMethod,
  );

  const result = await verifyCompoundPortableObjectProofs(
    secured,
    limits,
    options,
  );
  assertEquals(result.status, "ok");
  if (result.status !== "ok") return;
  assert(result.verified);
  assertEquals(result.portableObjects.length, 1);
  assertEquals(
    result.portableObjects[0].id,
    vector.documents.innerUnsecuredDocument.id,
  );
});

// FEP-ef61 compatible identifiers

const compatibleDid = await exportDidKey(ed25519PublicKey.publicKey);
const compatibleVerificationMethod = `${compatibleDid}#${
  compatibleDid.slice("did:key:".length)
}`;
const compatibleActorId =
  `https://gw.example/.well-known/apgateway/${compatibleDid}/actor`;
const compatibleContext = [
  "https://www.w3.org/ns/activitystreams",
  "https://w3id.org/security/data-integrity/v1",
];

async function signCompatible(
  document: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return await secureRawDocument(
    document,
    await crypto.subtle.exportKey("jwk", ed25519PrivateKey),
    compatibleVerificationMethod,
  );
}

async function compatibleActor(
  id: string = compatibleActorId,
  keyBase: string = compatibleActorId,
): Promise<Record<string, unknown>> {
  const actorId = parseIri(id);
  const json = await new Person({
    id: actorId,
    inbox: new URL(`${keyBase}/inbox`),
    outbox: new URL(`${keyBase}/outbox`),
    gateways: [new URL("https://gw.example")],
    publicKey: new CryptographicKey({
      id: new URL(`${keyBase}#main-key`),
      owner: actorId,
      publicKey: rsaPublicKey2.publicKey,
    }),
    assertionMethods: [
      new Multikey({
        id: new URL(`${keyBase}#ed25519-key`),
        controller: actorId,
        publicKey: ed25519PublicKey.publicKey,
      }),
    ],
  }).toJsonLd({
    format: "compact",
    contextLoader: mockDocumentLoader,
  }) as Record<string, unknown>;
  return json;
}

test("verifyCompoundPortableObjectProofs() treats compatible-ID maps as portable", async () => {
  const note = {
    "@context": [...compatibleContext],
    id: `${compatibleActorId}/notes/1`,
    type: "Note",
    attributedTo: compatibleActorId,
    content: "Hello",
  };
  // An ordinary activity embedding an unsigned compatible-ID object:
  const ordinary = {
    "@context": [...compatibleContext],
    id: "https://social.example/activities/1",
    type: "Announce",
    actor: "https://social.example/users/bob",
    object: note,
  };
  assertEquals(
    inspectCompoundPortableObjectApplicability(ordinary, limits),
    "present",
  );
  assert(containsCompoundPortableObject(ordinary));
  const result = await verifyCompoundPortableObjectProofs(
    ordinary,
    limits,
    options,
  );
  assert(result.status === "ok");
  assertEquals(result.verified, false);
  assertEquals(
    result.portableObjects.map((o) => [o.path, o.verified]),
    [["/object", false]],
  );
  // The same object signed by its DID passes:
  const signed = await verifyCompoundPortableObjectProofs(
    { ...ordinary, object: await signCompatible(note) },
    limits,
    options,
  );
  assert(signed.status === "ok");
  assert(signed.verified);
});

test("verifyCompoundPortableObjectProofs() checks compatible activity IDs", async () => {
  const create = (did: string) => ({
    "@context": [...compatibleContext],
    id: `https://gw.example/.well-known/apgateway/${did}/activities/1`,
    type: "Create",
    actor: compatibleActorId,
    object: "https://social.example/notes/1",
  });
  const own = await verifyCompoundPortableObjectProofs(
    await signCompatible(create(compatibleDid)),
    limits,
    options,
  );
  assert(own.status === "ok");
  assert(own.verified);
  // An activity whose compatible ID names Bob's DID, signed by Alice:
  const bob = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK";
  const forged = await verifyCompoundPortableObjectProofs(
    await signCompatible(create(bob)),
    limits,
    options,
  );
  assert(forged.status === "ok");
  assertEquals(forged.verified, false);
  const [object] = forged.portableObjects;
  assert(!object.verified);
  assertEquals(object.reason.type, "verificationMethodMismatch");
});

test("verifyCompoundPortableObjectProofs() exempts keys embedded in portable actors", async () => {
  // A compatible-ID actor, as tootik's are:
  let result = await verifyCompoundPortableObjectProofs(
    await signCompatible(await compatibleActor()),
    limits,
    options,
  );
  assert(result.status === "ok");
  assert(result.verified);
  assertEquals(result.portableObjects.map((o) => o.path), [""]);
  // An ap: actor with gateway keys at compatible identifiers, as Fedify's
  // own portable actors have:
  result = await verifyCompoundPortableObjectProofs(
    await signCompatible(
      await compatibleActor(`ap://${compatibleDid}/actor`),
    ),
    limits,
    options,
  );
  assert(result.status === "ok");
  assert(result.verified);
  // Embedded in a signed Update:
  result = await verifyCompoundPortableObjectProofs(
    {
      "@context": [...compatibleContext],
      id: "https://social.example/activities/2",
      type: "Update",
      actor: "https://social.example/users/bob",
      object: await signCompatible(await compatibleActor()),
    },
    limits,
    options,
  );
  assert(result.status === "ok");
  assert(result.verified);
});

test("verifyCompoundPortableObjectProofs() exempts only keys of the parent itself", async () => {
  const actor = await compatibleActor();
  const otherActorId =
    "https://gw.example/.well-known/apgateway/did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK/actor";
  const publicKey = actor.publicKey as Record<string, unknown>;
  const cases: Record<string, Record<string, unknown>> = {
    "a key of another actor": {
      ...actor,
      publicKey: {
        ...publicKey,
        id: `${otherActorId}#main-key`,
        owner: otherActorId,
      },
    },
    "a key owned by another actor": {
      ...actor,
      publicKey: { ...publicKey, owner: otherActorId },
    },
    "a non-key object": {
      ...actor,
      publicKey: {
        id: `${compatibleActorId}#note`,
        type: "Note",
        content: "Not a key",
      },
    },
    "a key with extra content": {
      ...actor,
      publicKey: { ...publicKey, name: "Extra" },
    },
    "a key under another property": {
      ...actor,
      attachment: structuredClone(publicKey),
    },
    "a parent context with a keyword alias": {
      ...actor,
      "@context": [
        ...actor["@context"] as unknown[],
        { kind: "@type" },
      ],
    },
    "a key with a scoped context": {
      ...actor,
      publicKey: {
        ...publicKey,
        "@context": {
          CryptographicKey: {
            "@id": "https://w3id.org/security#Key",
            "@context": {},
          },
        },
      },
    },
  };
  for (const [name, document] of Object.entries(cases)) {
    const result = await verifyCompoundPortableObjectProofs(
      await signCompatible(document),
      limits,
      options,
    );
    assert(result.status === "ok", name);
    assertEquals(result.verified, false, name);
    // The actor itself is verified; it is the key that is not exempt:
    const root = result.portableObjects.find((o) => o.path === "");
    assert(root?.verified, name);
    assert(
      result.portableObjects.some((o) => o.path !== "" && !o.verified),
      name,
    );
  }
});

/**
 * Rewrites the IDs of a {@link compatibleActor}'s keys as they are written,
 * e.g., as `ap:` URIs, which the serializer would canonicalize otherwise.
 */
function withKeyIds(
  actor: Record<string, unknown>,
  keyBase: string,
  { id = actor.id as string, owner = id }: { id?: string; owner?: string } = {},
): Record<string, unknown> {
  const [multikey] = actor.assertionMethod as Record<string, unknown>[];
  return {
    ...actor,
    id,
    publicKey: {
      ...asRecord(actor.publicKey),
      id: `${keyBase}#main-key`,
      owner,
    },
    assertionMethod: [
      { ...multikey, id: `${keyBase}#ed25519-key`, controller: owner },
    ],
  };
}

const apActorId = `ap://${compatibleDid}/actor`;

test("verifyCompoundPortableObjectProofs() exempts keys at ap: URIs embedded in portable actors", async () => {
  const actor = await compatibleActor();
  const encodedDid = encodeURIComponent(compatibleDid);
  const cases: Record<string, [string, string]> = {
    // As FEP-ae97 clients and Mitra identify the keys of portable actors:
    "ap: keys of an ap: actor": [apActorId, apActorId],
    "ap: keys of a compatible-ID actor": [compatibleActorId, apActorId],
    "ap+ef61: keys": [apActorId, `ap+ef61://${compatibleDid}/actor`],
    "keys with percent-encoded DIDs": [apActorId, `ap://${encodedDid}/actor`],
    "ap+ef61: keys of a percent-encoded actor": [
      `ap+ef61://${encodedDid}/actor`,
      `ap+ef61://${encodedDid}/actor`,
    ],
    "keys with an uppercase scheme": [apActorId, `AP://${compatibleDid}/actor`],
    "keys with location hints": [
      apActorId,
      `${apActorId}?@gateway=https%3A%2F%2Fgw.example`,
    ],
  };
  for (const [name, [id, keyBase]] of Object.entries(cases)) {
    const result = await verifyCompoundPortableObjectProofs(
      await signCompatible(withKeyIds(actor, keyBase, { id })),
      limits,
      options,
    );
    assert(result.status === "ok", name);
    assert(result.verified, name);
    assertEquals(result.portableObjects.map((o) => o.path), [""], name);
  }
  // Keys identified by @id rather than id:
  const apActor = withKeyIds(actor, apActorId, { id: apActorId });
  const atIdKeys = (key: unknown) => {
    const { id, ...rest } = asRecord(key);
    return { ...rest, "@id": id };
  };
  const withAtIds = await verifyCompoundPortableObjectProofs(
    await signCompatible({
      ...apActor,
      publicKey: atIdKeys(apActor.publicKey),
      assertionMethod: (apActor.assertionMethod as unknown[]).map(atIdKeys),
    }),
    limits,
    options,
  );
  assert(withAtIds.status === "ok");
  assert(withAtIds.verified);
  assertEquals(withAtIds.portableObjects.map((o) => o.path), [""]);
  // A context that defines an ap term does not turn ap: URIs into compact
  // IRIs:
  const withApTerm = await verifyCompoundPortableObjectProofs(
    await signCompatible({
      ...withKeyIds(actor, apActorId, { id: apActorId }),
      "@context": [
        ...actor["@context"] as unknown[],
        { ap: "https://ap.example/" },
      ],
    }),
    limits,
    options,
  );
  assert(withApTerm.status === "ok");
  assert(withApTerm.verified);
  assertEquals(withApTerm.portableObjects.map((o) => o.path), [""]);
  // Embedded in a signed Update, as an FEP-ae97 client publishes one after
  // registering its actor:
  const update = await signCompatible({
    "@context": [...compatibleContext],
    id: `ap://${compatibleDid}/activities/1`,
    type: "Update",
    actor: apActorId,
    object: await signCompatible(
      withKeyIds(actor, apActorId, { id: apActorId }),
    ),
  });
  const result = await verifyCompoundPortableObjectProofs(
    update,
    limits,
    options,
  );
  assert(result.status === "ok");
  assert(result.verified);
  assertEquals(result.portableObjects.map((o) => o.path), ["/object", ""]);
});

test("verifyCompoundPortableObjectProofs() exempts only ap: keys of the parent itself", async () => {
  const actor = withKeyIds(await compatibleActor(), apActorId, {
    id: apActorId,
  });
  const publicKey = asRecord(actor.publicKey);
  const otherDid = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK";
  const keyIds: Record<string, string> = {
    "a key of another actor": `ap://${compatibleDid}/other#main-key`,
    "a key of another DID": `ap://${otherDid}/actor#main-key`,
    "a key without a fragment": apActorId,
    "a key with an empty fragment": `${apActorId}#`,
    "a key with dot segments": `ap://${compatibleDid}/x/../actor#main-key`,
    "a key with encoded dot segments":
      `ap://${compatibleDid}/x/%2E%2E/actor#main-key`,
    "a key with an encoded slash": `${apActorId}%2F#main-key`,
    "a key with an encoded fragment delimiter": `${apActorId}%23main-key`,
    "a compatible key with dot segments":
      `https://gw.example/.well-known/apgateway/${compatibleDid}/x/../actor#main-key`,
  };
  const cases: Record<string, Record<string, unknown>> = {};
  for (const [name, id] of Object.entries(keyIds)) {
    cases[name] = { ...actor, publicKey: { ...publicKey, id } };
  }
  Object.assign(cases, {
    "a key owned by another actor": {
      ...actor,
      publicKey: { ...publicKey, owner: `ap://${otherDid}/actor` },
    },
    "a key controlled by another actor": {
      ...actor,
      assertionMethod: (actor.assertionMethod as Record<string, unknown>[])
        .map((key) => ({ ...key, controller: `ap://${otherDid}/actor` })),
    },
    "a key with extra content": {
      ...actor,
      publicKey: { ...publicKey, name: "Extra" },
    },
    "a key with a scoped context": {
      ...actor,
      publicKey: {
        ...publicKey,
        "@context": {
          CryptographicKey: {
            "@id": "https://w3id.org/security#Key",
            "@context": {},
          },
        },
      },
    },
  });
  for (const [name, document] of Object.entries(cases)) {
    const result = await verifyCompoundPortableObjectProofs(
      await signCompatible(document),
      limits,
      options,
    );
    assert(result.status === "ok", name);
    assertEquals(result.verified, false, name);
    // The actor itself is verified; it is the key that is not exempt:
    const root = result.portableObjects.find((o) => o.path === "");
    assert(root?.verified, name);
    assert(
      result.portableObjects.some((o) => o.path !== "" && !o.verified),
      name,
    );
  }
  // A key whose id and @id differ makes the actor itself invalid:
  const conflicting = await verifyCompoundPortableObjectProofs(
    await signCompatible({
      ...actor,
      publicKey: {
        ...publicKey,
        "@id": `ap://${compatibleDid}/other#main-key`,
      },
    }),
    limits,
    options,
  );
  assert(conflicting.status === "ok");
  assertEquals(conflicting.verified, false);
});

test("verifyCompoundPortableObjectProofs() exempts ap: keys only of verified actors", async () => {
  const actor = withKeyIds(await compatibleActor(), apActorId, {
    id: apActorId,
  });
  const signed = await signCompatible(actor);
  // The keys of an unverified actor are checked on their own, and fail:
  const unverified = {
    "": true,
    "/object": false,
    "/object/publicKey": false,
    "/object/assertionMethod/0": false,
  };
  const cases: Record<
    string,
    [Record<string, unknown>, Record<string, boolean>]
  > = {
    "an unsigned actor": [actor, unverified],
    "a tampered actor": [{ ...signed, name: "Tampered" }, unverified],
    // A key that carries its own proof is verified by that proof instead:
    "an actor with a key with an invalid proof": [
      await signCompatible({
        ...actor,
        publicKey: {
          ...asRecord(actor.publicKey),
          "@context": [...compatibleContext],
          proof: asRecord(signed.proof),
        },
      }),
      { "": true, "/object": true, "/object/publicKey": false },
    ],
  };
  for (const [name, [object, expected]] of Object.entries(cases)) {
    const result = await verifyCompoundPortableObjectProofs(
      await signCompatible({
        "@context": [...compatibleContext],
        id: `ap://${compatibleDid}/activities/1`,
        type: "Update",
        actor: apActorId,
        object,
      }),
      limits,
      options,
    );
    assert(result.status === "ok", name);
    assertEquals(result.verified, false, name);
    assertEquals(
      Object.fromEntries(
        result.portableObjects.map((o) => [o.path, o.verified]),
      ),
      expected,
      name,
    );
  }
});

test("verifyCompoundPortableObjectProofs() leaves keys at DID URLs alone", async () => {
  // A key identified by a DID URL is not a portable object, so it needs no
  // exemption:
  const result = await verifyCompoundPortableObjectProofs(
    await signCompatible(
      withKeyIds(await compatibleActor(), compatibleDid, { id: apActorId }),
    ),
    limits,
    options,
  );
  assert(result.status === "ok");
  assert(result.verified);
  assertEquals(result.portableObjects.map((o) => o.path), [""]);
});
