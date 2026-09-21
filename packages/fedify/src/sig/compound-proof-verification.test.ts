import { mockDocumentLoader, test } from "@fedify/fixture";
import { encodeMultibase } from "@fedify/vocab-runtime";
import { assert, assertEquals } from "@std/assert";
import serialize from "json-canon";
import vector from "../../test-vectors/fep-8b32/map-local-create-note.json" with {
  type: "json",
};
import conflictVector from "../../test-vectors/fep-8b32/map-local-context-conflict.json" with {
  type: "json",
};
import {
  type CompoundProofDiscoveryLimits,
  verifyCompoundProofDocuments,
} from "./compound-proof.ts";

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
