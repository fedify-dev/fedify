import {
  createTestMeterProvider,
  mockDocumentLoader,
  test,
} from "@fedify/fixture";
import { normalizeOutgoingActivityJsonLd } from "../compat/outgoing-jsonld.ts";
import {
  Create,
  type CryptographicKey,
  DataIntegrityProof,
  Document,
  Multikey,
  Note,
  Place,
  PUBLIC_COLLECTION,
  Translation,
} from "@fedify/vocab";
import {
  decodeMultibase,
  encodeMultibase,
  exportDidKey,
  exportMultibaseKey,
  formatIri,
  importMultibaseKey,
  parseIri,
} from "@fedify/vocab-runtime";
import {
  assert,
  assertEquals,
  assertFalse,
  assertGreaterOrEqual,
  assertInstanceOf,
  assertRejects,
} from "@std/assert";
import { decodeHex } from "byte-encodings/hex";
import serialize from "json-canon";
import {
  ed25519Multikey,
  ed25519PrivateKey,
  ed25519PublicKey,
  rsaPrivateKey2,
  rsaPublicKey2,
} from "../testing/keys.ts";
import type { KeyCache } from "./key.ts";
import {
  createProof,
  hasProofLike,
  signObject,
  verifyObject,
  type VerifyObjectOptions,
  verifyPortableObjectProof,
  verifyProof,
  type VerifyProofOptions,
} from "./proof.ts";

// Test vector from <https://codeberg.org/fediverse/fep/src/branch/main/fep/8b32/fep-8b32.feature>:
const fep8b32TestVectorPrivateKey = await crypto.subtle.importKey(
  "jwk",
  {
    "kty": "OKP",
    "crv": "Ed25519",
    // cSpell: disable
    "d": "yW756hDF5BTEcXI6_53nLDX6W3D66X6IMuysfS4rjtY",
    "x": "sA2Nk45_dz1RVlqtNqYj9TRPf10ZYPnPPo4SYg6igQ8",
    // cSpell: enable
    key_ops: ["sign"],
    ext: true,
  },
  "Ed25519",
  true,
  ["sign"],
);
const fep8b32TestVectorKeyId = new URL(
  "https://server.example/users/alice#ed25519-key",
);

const portableDid = await exportDidKey(ed25519PublicKey.publicKey);
const portableDidMethod = portableDid.substring("did:key:".length);
const portableKeyId = new URL(`${portableDid}#${portableDidMethod}`);
const portableContext = [
  "https://www.w3.org/ns/activitystreams",
  "https://w3id.org/security/data-integrity/v1",
];
const portableProofCreated = "2023-02-24T23:36:38Z";

async function signPortableJsonLd(
  document: Record<string, unknown>,
  {
    privateKey = ed25519PrivateKey,
    verificationMethod = portableKeyId,
    proofOptions = {},
  }: {
    privateKey?: CryptoKey;
    verificationMethod?: URL;
    proofOptions?: Record<string, unknown>;
  } = {},
): Promise<Record<string, unknown>> {
  const proofConfig = {
    "@context": document["@context"],
    type: "DataIntegrityProof",
    cryptosuite: "eddsa-jcs-2022",
    verificationMethod: verificationMethod.href,
    proofPurpose: "assertionMethod",
    created: portableProofCreated,
    ...proofOptions,
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
  const digest = new Uint8Array(
    proofDigest.byteLength + messageDigest.byteLength,
  );
  digest.set(new Uint8Array(proofDigest), 0);
  digest.set(new Uint8Array(messageDigest), proofDigest.byteLength);
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

async function parsePortableProof(
  document: Record<string, unknown>,
): Promise<DataIntegrityProof> {
  const proof = document.proof;
  assert(
    typeof proof === "object" && proof != null && !Array.isArray(proof),
  );
  return await DataIntegrityProof.fromJsonLd({
    "@context": document["@context"],
    ...proof,
  }, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
}

async function assertPortableProofVerified(
  document: Record<string, unknown>,
  options: VerifyProofOptions,
): Promise<void> {
  const key = await verifyProof(
    document,
    await parsePortableProof(document),
    options,
  );
  assert(key != null);
  assertEquals(key.id, portableKeyId);
}
const fep8b32TestVectorActivity = new Create({
  id: new URL("https://server.example/activities/1"),
  actor: new URL("https://server.example/users/alice"),
  object: new Note({
    id: new URL("https://server.example/objects/1"),
    attribution: new URL("https://server.example/users/alice"),
    content: "Hello world",
    location: new Place({
      longitude: -71.184902,
      latitude: 25.273962,
    }),
  }),
});

test("createProof()", async () => {
  const create = new Create({
    actor: new URL("https://example.com/person"),
    object: new Note({
      content: "Hello, world!",
    }),
  });
  const created = Temporal.Instant.from("2023-02-24T23:36:38Z");
  const proof = await createProof(
    create,
    ed25519PrivateKey,
    ed25519PublicKey.id!,
    { created, contextLoader: mockDocumentLoader },
  );
  assertEquals(proof.cryptosuite, "eddsa-jcs-2022");
  assertEquals(proof.verificationMethodId, ed25519PublicKey.id);
  assertEquals(proof.proofPurpose, "assertionMethod");
  assertEquals(
    proof.proofValue,
    decodeHex(
      "0e63238fdb50a979a7fbd906b471d328a03504de7aa3a0409fad1500b85d6fec" +
        "afa2223bfde21ba2eac9446d36f6583c45cb55a98017a0a6a275f50262a4ea06",
    ),
  );
  assertEquals(proof.created, created);
  assertEquals(
    await verifyProof(
      await create.toJsonLd({
        format: "compact",
        contextLoader: mockDocumentLoader,
      }),
      proof,
      { documentLoader: mockDocumentLoader, contextLoader: mockDocumentLoader },
    ),
    ed25519Multikey,
  );

  // Test vector from <https://codeberg.org/fediverse/fep/src/branch/main/fep/8b32/fep-8b32.feature>:
  const proof2 = await createProof(
    fep8b32TestVectorActivity,
    fep8b32TestVectorPrivateKey,
    fep8b32TestVectorKeyId,
    {
      created,
      contextLoader: mockDocumentLoader,
      context: [
        "https://www.w3.org/ns/activitystreams",
        "https://w3id.org/security/data-integrity/v1",
      ],
    },
  );
  assertEquals(proof2.cryptosuite, "eddsa-jcs-2022");
  assertEquals(proof2.verificationMethodId, fep8b32TestVectorKeyId);
  assertEquals(proof2.proofPurpose, "assertionMethod");
  assertEquals(
    proof2.proofValue,
    decodeMultibase(
      // cSpell: disable
      "zLaewdp4H9kqtwyrLatK4cjY5oRHwVcw4gibPSUDYDMhi4M49v8pcYk3ZB6D69dNpAPbUmY8ocuJ3m9KhKJEEg7z",
      // cSpell: enable
    ),
  );
  assertEquals(proof2.created, created);

  await assertRejects(
    () =>
      createProof(create, rsaPrivateKey2, rsaPublicKey2.id!, {
        created,
        contextLoader: mockDocumentLoader,
      }),
    TypeError,
    "Unsupported algorithm",
  );
});

test("signObject()", async () => {
  const options = {
    format: "compact" as const,
    contextLoader: mockDocumentLoader,
    documentLoader: mockDocumentLoader,
    context: [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/data-integrity/v1",
    ],
  };
  const created = Temporal.Instant.from("2023-02-24T23:36:38Z");
  const signedObject = await signObject(
    fep8b32TestVectorActivity,
    fep8b32TestVectorPrivateKey,
    fep8b32TestVectorKeyId,
    { ...options, created },
  );
  assertEquals(
    await signedObject.toJsonLd(options),
    {
      "@context": [
        "https://www.w3.org/ns/activitystreams",
        "https://w3id.org/security/data-integrity/v1",
      ],
      id: "https://server.example/activities/1",
      type: "Create",
      actor: "https://server.example/users/alice",
      object: {
        id: "https://server.example/objects/1",
        type: "Note",
        attributedTo: "https://server.example/users/alice",
        content: "Hello world",
        location: {
          type: "Place",
          longitude: -71.184902,
          latitude: 25.273962,
        },
      },
      proof: {
        "@context": [
          "https://www.w3.org/ns/activitystreams",
          "https://w3id.org/security/data-integrity/v1",
        ],
        type: "DataIntegrityProof",
        cryptosuite: "eddsa-jcs-2022",
        verificationMethod: "https://server.example/users/alice#ed25519-key",
        proofPurpose: "assertionMethod",
        proofValue:
          // cSpell: disable
          "zLaewdp4H9kqtwyrLatK4cjY5oRHwVcw4gibPSUDYDMhi4M49v8pcYk3ZB6D69dNpAPbUmY8ocuJ3m9KhKJEEg7z",
        // cSpell: enable
        created: "2023-02-24T23:36:38Z",
      },
    },
  );

  const signedObject2 = await signObject(
    signedObject,
    ed25519PrivateKey,
    ed25519Multikey.id!,
    { ...options, created },
  );
  assertEquals(
    await signedObject2.toJsonLd(options),
    {
      "@context": [
        "https://www.w3.org/ns/activitystreams",
        "https://w3id.org/security/data-integrity/v1",
      ],
      id: "https://server.example/activities/1",
      type: "Create",
      actor: "https://server.example/users/alice",
      object: {
        id: "https://server.example/objects/1",
        type: "Note",
        attributedTo: "https://server.example/users/alice",
        content: "Hello world",
        location: {
          type: "Place",
          longitude: -71.184902,
          latitude: 25.273962,
        },
      },
      proof: [
        {
          "@context": [
            "https://www.w3.org/ns/activitystreams",
            "https://w3id.org/security/data-integrity/v1",
          ],
          type: "DataIntegrityProof",
          cryptosuite: "eddsa-jcs-2022",
          verificationMethod: "https://server.example/users/alice#ed25519-key",
          proofPurpose: "assertionMethod",
          proofValue:
            // cSpell: disable
            "zLaewdp4H9kqtwyrLatK4cjY5oRHwVcw4gibPSUDYDMhi4M49v8pcYk3ZB6D69dNpAPbUmY8ocuJ3m9KhKJEEg7z",
          // cSpell: enable
          created: "2023-02-24T23:36:38Z",
        },
        {
          "@context": [
            "https://www.w3.org/ns/activitystreams",
            "https://w3id.org/security/data-integrity/v1",
          ],
          created: "2023-02-24T23:36:38Z",
          cryptosuite: "eddsa-jcs-2022",
          proofPurpose: "assertionMethod",
          proofValue:
            // cSpell: disable
            "zVrcY69MxozB9V9hmMmsjoB4YLCXvn6ienKr6jsP2rztSEr1WhMJymPqujKofkrV3C7A2C9iKYnRNSvtPgDQBCw2",
          // cSpell: enable
          type: "DataIntegrityProof",
          verificationMethod: "https://example.com/person2#key4",
        },
      ],
    },
  );

  await assertRejects(
    () =>
      signObject(fep8b32TestVectorActivity, rsaPrivateKey2, rsaPublicKey2.id!, {
        created,
        contextLoader: mockDocumentLoader,
      }),
    TypeError,
    "Unsupported algorithm",
  );

  // The proof hashed during signObject() must cover the same JSON-LD bytes
  // that the activity serializes to on the wire—otherwise the outgoing
  // JSON-LD normalization applied before sending would break verifyProof()
  // for the eddsa-jcs-2022 cryptosuite, which canonicalises the JCS form
  // byte-for-byte rather than running URDNA2015.
  const publicActivity = new Create({
    id: new URL("https://server.example/activities/2"),
    actor: new URL("https://server.example/users/alice"),
    object: new Note({
      id: new URL("https://server.example/objects/2"),
      attribution: new URL("https://server.example/users/alice"),
      content: "Hello public",
      attachments: [
        new Document({
          mediaType: "image/png",
          url: new URL("https://server.example/objects/2/image.png"),
        }),
      ],
    }),
    tos: [PUBLIC_COLLECTION],
  });
  const signed = await signObject(
    publicActivity,
    fep8b32TestVectorPrivateKey,
    fep8b32TestVectorKeyId,
    { ...options, created },
  );
  const [proof] = await Array.fromAsync(signed.getProofs(options));
  assertInstanceOf(proof, DataIntegrityProof);
  const signedJson = await normalizeOutgoingActivityJsonLd(
    await signed.toJsonLd(options),
    mockDocumentLoader,
  ) as Record<string, unknown>;
  assertEquals(signedJson.to, PUBLIC_COLLECTION.href);
  const signedJsonObject = signedJson.object as Record<string, unknown>;
  assertEquals(Array.isArray(signedJsonObject.attachment), true);
  const verifyCache: Record<string, CryptographicKey | Multikey | null> = {};
  const verifyOptions: VerifyProofOptions = {
    contextLoader: mockDocumentLoader,
    documentLoader: mockDocumentLoader,
    keyCache: {
      get: (keyId) => Promise.resolve(verifyCache[keyId.href]),
      set: (keyId, key) => {
        verifyCache[keyId.href] = key;
        return Promise.resolve();
      },
    },
  };
  const verifyingKey = await verifyProof(signedJson, proof, verifyOptions);
  assertInstanceOf(verifyingKey, Multikey);

  // Round-trip regression guard: `signObject()` returns a vocab object
  // whose default `toJsonLd({ format: "compact" })` output still compacts
  // the public audience to the `as:Public` CURIE and single attachments to
  // scalars, even though the bytes signed by `createProof()` were first
  // normalized to the outgoing wire form.
  // `verifyProof()` must accept either form so the in-memory pipeline
  // (sign, reserialize, verify) continues to work without every caller
  // having to know about the outgoing JSON-LD compat helper.
  const signedJsonWithCurie = await signed.toJsonLd(options) as Record<
    string,
    unknown
  >;
  assertEquals(signedJsonWithCurie.to, "as:Public");
  const signedJsonWithCurieObject = signedJsonWithCurie.object as Record<
    string,
    unknown
  >;
  assertEquals(Array.isArray(signedJsonWithCurieObject.attachment), false);
  const verifyingKeyFromCurie = await verifyProof(
    signedJsonWithCurie,
    proof,
    verifyOptions,
  );
  assertInstanceOf(verifyingKeyFromCurie, Multikey);
});

test("hasProofLike()", () => {
  assert(hasProofLike({
    proof: {
      type: "DataIntegrityProof",
      verificationMethod: "https://example.com/users/alice#main-key",
      proofPurpose: "assertionMethod",
      proofValue: "signature",
    },
  }));
  assert(hasProofLike({
    proof: {
      type: "DataIntegrityProof",
      verificationMethod: { id: "https://example.com/users/alice#main-key" },
      proofPurpose: "assertionMethod",
      proofValue: "signature",
    },
  }));
  assert(hasProofLike({
    proof: [{
      type: "DataIntegrityProof",
      verificationMethod: { id: "https://example.com/users/alice#main-key" },
      proofPurpose: "assertionMethod",
      proofValue: "signature",
    }],
  }));
  assert(hasProofLike({
    proof: {
      type: ["https://w3id.org/security#DataIntegrityProof"],
      verificationMethod: [{
        "@id": "https://example.com/users/alice#main-key",
      }],
      proofPurpose: { "@id": "https://w3id.org/security#assertionMethod" },
      proofValue: "signature",
    },
  }));
  assert(hasProofLike({
    "https://w3id.org/security#proof": {
      type: "DataIntegrityProof",
      verificationMethod: { "@id": "https://example.com/users/alice#main-key" },
      proofPurpose: { "@id": "https://w3id.org/security#assertionMethod" },
      proofValue: "signature",
    },
  }));
  assert(hasProofLike({
    "https://w3id.org/security#proof": [{
      "@type": ["https://w3id.org/security#DataIntegrityProof"],
      "https://w3id.org/security#verificationMethod": [{
        "@id": "https://example.com/users/alice#main-key",
      }],
      "https://w3id.org/security#proofPurpose": [{
        "@id": "https://w3id.org/security#assertionMethod",
      }],
      "https://w3id.org/security#proofValue": [{ "@value": "signature" }],
    }],
  }));
  assertFalse(hasProofLike({
    proof: {
      type: "DataIntegrityProof",
      verificationMethod: { id: "https://example.com/users/alice#main-key" },
      proofPurpose: "assertionMethod",
    },
  }));
});

test("verifyProof()", async () => {
  const cache: Record<string, CryptographicKey | Multikey | null> = {};
  const options: VerifyProofOptions = {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
    keyCache: {
      get(keyId) {
        return Promise.resolve(cache[keyId.href]);
      },
      set(keyId, key) {
        cache[keyId.href] = key;
        return Promise.resolve();
      },
    } satisfies KeyCache,
  };
  // Test vector from <https://codeberg.org/fediverse/fep/src/branch/main/fep/8b32/fep-8b32.feature>:
  const jsonLd = {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/data-integrity/v1",
    ],
    id: "https://server.example/activities/1",
    type: "Create",
    actor: "https://server.example/users/alice",
    object: {
      id: "https://server.example/objects/1",
      type: "Note",
      attributedTo: "https://server.example/users/alice",
      content: "Hello world",
      location: {
        type: "Place",
        longitude: -71.184902,
        latitude: 25.273962,
      },
    },
  };
  const proof = new DataIntegrityProof({
    cryptosuite: "eddsa-jcs-2022",
    verificationMethod: new URL(
      "https://server.example/users/alice#ed25519-key",
    ),
    proofPurpose: "assertionMethod",
    proofValue: decodeMultibase(
      // cSpell: disable
      "zLaewdp4H9kqtwyrLatK4cjY5oRHwVcw4gibPSUDYDMhi4M49v8pcYk3ZB6D69dNpAPbUmY8ocuJ3m9KhKJEEg7z",
      // cSpell: enable
    ),
    created: Temporal.Instant.from("2023-02-24T23:36:38Z"),
  });
  const expectedKey = new Multikey({
    id: new URL("https://server.example/users/alice#ed25519-key"),
    controller: new URL("https://server.example/users/alice"),
    publicKey: await importMultibaseKey(
      "z6MkrJVnaZkeFzdQyMZu1cgjg7k1pZZ6pvBQ7XJPt4swbTQ2",
    ),
  });
  assertEquals(
    await verifyProof(jsonLd, proof, options),
    expectedKey,
  );
  assertEquals(
    cache["https://server.example/users/alice#ed25519-key"],
    expectedKey,
  );
  cache["https://server.example/users/alice#ed25519-key"] = ed25519Multikey;
  assertEquals(
    await verifyProof(jsonLd, proof, options),
    expectedKey,
  );
  assertEquals(
    cache["https://server.example/users/alice#ed25519-key"],
    expectedKey,
  );

  const jsonLd2 = { ...jsonLd, object: { ...jsonLd.object, content: "bye" } };
  assertEquals(await verifyProof(jsonLd2, proof, options), null);

  const wrongProof = proof.clone({ created: Temporal.Now.instant() });
  assertEquals(await verifyProof(jsonLd, wrongProof, options), null);

  // verifyProof() promises to ignore any proof already present on the
  // input; make sure the expanded JSON-LD form of that key
  // (`https://w3id.org/security#proof`) is stripped before JCS, not just
  // the compact `proof` alias, so callers passing JSON-LD in either
  // shape get the same message digest as the signer computed.
  const jsonLdWithExpandedProof: Record<string, unknown> = {
    ...jsonLd,
    "https://w3id.org/security#proof": {
      "@type": ["https://w3id.org/security#DataIntegrityProof"],
      "https://w3id.org/security#proofValue": [{ "@value": "stale" }],
    },
  };
  assertEquals(
    await verifyProof(jsonLdWithExpandedProof, proof, options),
    expectedKey,
  );

  // A top-level array is not a valid FEP-8b32 signed document: the
  // spread-into-object trick we use to drop the proof key before JCS
  // hashing would turn `[x, y]` into `{ "0": x, "1": y }`, which would
  // produce a misleading canonical form.  Reject the input outright.
  assertEquals(
    await verifyProof([jsonLd] as unknown, proof, options),
    null,
  );

  // verifyProof() runs on inbound, potentially adversarial JSON-LD, so
  // normalizeOutgoingActivityJsonLd() must not hand an attacker-controlled
  // `@context` URL to a network-capable document loader.  The attacker
  // input below would otherwise take the canonicalization path (its
  // `@context` is not drawn entirely from Fedify's preloaded set).
  // verifyProof() deliberately does not pass its own `contextLoader` to
  // normalizeOutgoingActivityJsonLd(), so that helper falls back to the
  // internal preloaded-only loader, rejects the attacker URL, and drops
  // the normalized candidate.  verify then tries the on-wire form against
  // a proof that was signed over a different activity and returns null
  // cleanly without any network request.
  const attackerInput = {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://attacker.example/ctx",
    ],
    id: "https://server.example/activities/attacker",
    type: "Create",
    actor: "https://server.example/users/alice",
    object: {
      id: "https://server.example/objects/attacker",
      type: "Note",
      attributedTo: "https://server.example/users/alice",
      content: "n/a",
      to: "as:Public",
    },
  };
  const contextLoaderCalls: string[] = [];
  assertEquals(
    await verifyProof(attackerInput, proof, {
      contextLoader: async (url) => {
        contextLoaderCalls.push(url);
        return await mockDocumentLoader(url);
      },
      documentLoader: mockDocumentLoader,
      keyCache: options.keyCache,
    }),
    null,
  );
  assertFalse(contextLoaderCalls.includes("https://attacker.example/ctx"));
});

test("verifyProof() authenticates the complete proof configuration", async (t) => {
  const jsonLd = {
    "@context": portableContext,
    id: "https://example.com/activities/complete-proof-options",
    type: "Create",
    actor: "https://example.com/users/alice",
    object: {
      type: "Note",
      content: "Every proof option is authenticated.",
    },
  };
  const options: VerifyProofOptions = {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  };

  await t.step("rejects an expires option added after signing", async () => {
    const signed = await signPortableJsonLd(jsonLd);
    const tampered = {
      ...signed,
      proof: {
        ...signed.proof as Record<string, unknown>,
        expires: "3000-01-01T00:00:00Z",
      },
    };
    assertEquals(
      await verifyProof(tampered, await parsePortableProof(tampered), options),
      null,
    );
  });

  await t.step("accepts an authenticated future expiration", async () => {
    const signed = await signPortableJsonLd(jsonLd, {
      proofOptions: { expires: "3000-01-01T00:00:00Z" },
    });
    await assertPortableProofVerified(signed, options);
  });

  await t.step("rejects an authenticated expired proof", async () => {
    const signed = await signPortableJsonLd(jsonLd, {
      proofOptions: { expires: "2000-01-01T00:00:00Z" },
    });
    assertEquals(
      await verifyProof(signed, await parsePortableProof(signed), options),
      null,
    );
  });

  await t.step("authenticates domain, challenge, and nonce", async () => {
    const signed = await signPortableJsonLd(jsonLd, {
      proofOptions: {
        domain: ["social.example", "https://social.example"],
        challenge: "challenge-123",
        nonce: "nonce-456",
      },
    });
    const proof = await parsePortableProof(signed);
    const matchingKey = await verifyProof(signed, proof, {
      ...options,
      domain: ["https://social.example", "social.example"],
      challenge: "challenge-123",
    });
    assert(matchingKey != null);
    assertEquals(matchingKey.id, portableKeyId);
    assertEquals(
      await verifyProof(signed, proof, {
        ...options,
        domain: ["social.example"],
        challenge: "challenge-123",
      }),
      null,
    );
    assertEquals(
      await verifyProof(signed, proof, {
        ...options,
        domain: ["https://social.example", "social.example"],
        challenge: "wrong-challenge",
      }),
      null,
    );

    for (
      const [property, value] of [
        ["domain", ["other.example"]],
        ["challenge", "tampered-challenge"],
        ["nonce", "tampered-nonce"],
      ] as const
    ) {
      const tampered = {
        ...signed,
        proof: {
          ...signed.proof as Record<string, unknown>,
          [property]: value,
        },
      };
      assertEquals(
        await verifyProof(
          tampered,
          await parsePortableProof(tampered),
          options,
        ),
        null,
      );
    }
  });

  await t.step("requires requested domain and challenge options", async () => {
    const signed = await signPortableJsonLd(jsonLd);
    const proof = await parsePortableProof(signed);
    assertEquals(
      await verifyProof(signed, proof, {
        ...options,
        domain: "social.example",
      }),
      null,
    );
    assertEquals(
      await verifyProof(signed, proof, {
        ...options,
        challenge: "challenge-123",
      }),
      null,
    );
  });

  await t.step("rejects malformed proof options", async () => {
    for (
      const proofOptions of [
        { expires: "not-a-date" },
        { domain: ["social.example", 42] },
        { challenge: 42 },
        { nonce: { value: "not-a-string" } },
        { nonce: ["not", "a", "string"] },
        { previousProof: ["urn:uuid:proof-1", 42] },
      ]
    ) {
      const signed = await signPortableJsonLd(jsonLd, { proofOptions });
      assertEquals(
        await verifyProof(signed, await parsePortableProof(signed), options),
        null,
      );
    }
  });

  await t.step("authenticates aliased and extension options", async () => {
    const aliasedJsonLd = {
      ...jsonLd,
      "@context": [
        ...portableContext,
        {
          validUntil: {
            "@id": "https://w3id.org/security#expiration",
            "@type": "http://www.w3.org/2001/XMLSchema#dateTime",
          },
          extensionOption: "https://example.com/security#extensionOption",
        },
      ],
    };
    const signed = await signPortableJsonLd(aliasedJsonLd, {
      proofOptions: {
        validUntil: "3000-01-01T00:00:00Z",
        extensionOption: { nested: ["one", "two"] },
      },
    });
    await assertPortableProofVerified(signed, options);

    for (
      const [property, value] of [
        ["validUntil", "2999-01-01T00:00:00Z"],
        ["extensionOption", { nested: ["one", "changed"] }],
      ] as const
    ) {
      const tampered = {
        ...signed,
        proof: {
          ...signed.proof as Record<string, unknown>,
          [property]: value,
        },
      };
      assertEquals(
        await verifyProof(
          tampered,
          await parsePortableProof(tampered),
          options,
        ),
        null,
      );
    }
  });

  await t.step(
    "distinguishes equivalent and ambiguous raw proof configurations",
    async () => {
      const signed = await signPortableJsonLd(jsonLd);
      const proof = signed.proof as Record<string, unknown>;
      const parsed = await parsePortableProof(signed);
      const identicalDuplicates = {
        ...signed,
        proof: [proof, structuredClone(proof)],
      };
      assert(
        await verifyProof(identicalDuplicates, parsed, options) != null,
      );

      const inheritedContextProof = structuredClone(proof);
      delete inheritedContextProof["@context"];
      const equivalentDuplicates = {
        ...signed,
        proof: [proof, inheritedContextProof],
      };
      assert(
        await verifyProof(equivalentDuplicates, parsed, options) != null,
      );

      const ambiguousDuplicates = {
        ...signed,
        proof: [
          proof,
          {
            ...structuredClone(proof),
            expires: "3000-01-01T00:00:00Z",
          },
        ],
      };
      assertEquals(
        await verifyProof(ambiguousDuplicates, parsed, options),
        null,
      );
    },
  );

  await t.step(
    "accepts literal proof fields with an unresolved extra context",
    async () => {
      const document = {
        ...jsonLd,
        "@context": [
          ...portableContext,
          "https://context.example/unrelated",
        ],
      };
      const signed = await signPortableJsonLd(document);
      const rawProof = signed.proof as Record<string, unknown>;
      const proof = new DataIntegrityProof({
        cryptosuite: "eddsa-jcs-2022",
        verificationMethod: portableKeyId,
        proofPurpose: "assertionMethod",
        proofValue: decodeMultibase(rawProof.proofValue as string),
        created: Temporal.Instant.from(portableProofCreated),
      });
      const key = await verifyProof(signed, proof, options);
      assert(key != null);
      assertEquals(key.id, portableKeyId);
    },
  );

  await t.step(
    "rejects aliases whose proof context cannot be resolved safely",
    async () => {
      const contextUrl = "https://context.example/proof-options";
      const document = {
        ...jsonLd,
        "@context": [...portableContext, contextUrl],
      };
      const signed = await signPortableJsonLd(document, {
        proofOptions: {
          validUntil: "2000-01-01T00:00:00Z",
        },
      });
      const rawProof = signed.proof as Record<string, unknown>;
      const proof = new DataIntegrityProof({
        cryptosuite: "eddsa-jcs-2022",
        verificationMethod: portableKeyId,
        proofPurpose: "assertionMethod",
        proofValue: decodeMultibase(rawProof.proofValue as string),
        created: Temporal.Instant.from(portableProofCreated),
      });
      const contextLoader = async (url: string) => {
        if (url !== contextUrl) return await mockDocumentLoader(url);
        return {
          contextUrl: null,
          documentUrl: url,
          document: {
            "@context": {
              validUntil: {
                "@id": "https://w3id.org/security#expiration",
                "@type": "http://www.w3.org/2001/XMLSchema#dateTime",
              },
            },
          },
        };
      };
      assertEquals(
        await verifyProof(signed, proof, {
          ...options,
          contextLoader,
        }),
        null,
      );
    },
  );
});

test("verifyProof() resolves did:key verification methods locally", async () => {
  const multibaseKey = (await exportDidKey(ed25519PublicKey.publicKey)).slice(
    "did:key:".length,
  );
  const did = `did:key:${multibaseKey}`;
  const keyId = new URL(`${did}#${multibaseKey}`);
  const created = Temporal.Instant.from("2023-02-24T23:36:38Z");
  const note = new Note({
    id: parseIri(`ap://did:key:${multibaseKey}/objects/1`),
    attribution: parseIri(`ap://did:key:${multibaseKey}/actor`),
    content: "Portable hello",
  });
  const proof = await createProof(
    note,
    ed25519PrivateKey,
    keyId,
    {
      created,
      contextLoader: mockDocumentLoader,
      context: [
        "https://www.w3.org/ns/activitystreams",
        "https://w3id.org/security/data-integrity/v1",
      ],
    },
  );
  const jsonLd = await note.toJsonLd({
    format: "compact",
    contextLoader: mockDocumentLoader,
    context: [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/data-integrity/v1",
    ],
  });
  let documentLoaderCalls = 0;
  const verifiedKey = await verifyProof(jsonLd, proof, {
    contextLoader: mockDocumentLoader,
    documentLoader() {
      documentLoaderCalls++;
      throw new TypeError("did:key must not use the document loader");
    },
  });
  assertEquals(
    verifiedKey,
    new Multikey({
      id: keyId,
      controller: new URL(did),
      publicKey: ed25519PublicKey.publicKey,
    }),
  );
  assertEquals(documentLoaderCalls, 0);

  const tampered = { ...(jsonLd as Record<string, unknown>) };
  tampered.content = "Portable goodbye";
  assertEquals(
    await verifyProof(tampered, proof, {
      contextLoader: mockDocumentLoader,
      documentLoader() {
        throw new TypeError("did:key must not use the document loader");
      },
    }),
    null,
  );

  const badProof = proof.clone({
    verificationMethod: new URL(
      `${did}#z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK`,
    ),
  });
  assertEquals(
    await verifyProof(jsonLd, badProof, {
      contextLoader: mockDocumentLoader,
      documentLoader() {
        throw new TypeError("did:key must not use the document loader");
      },
    }),
    null,
  );

  const unsupportedMultibaseKey = await exportMultibaseKey(
    rsaPublicKey2.publicKey,
  );
  const unsupportedDid = `did:key:${unsupportedMultibaseKey}`;
  const unsupportedProof = proof.clone({
    verificationMethod: new URL(
      `${unsupportedDid}#${unsupportedMultibaseKey}`,
    ),
  });
  let unsupportedDocumentLoaderCalls = 0;
  assertEquals(
    await verifyProof(jsonLd, unsupportedProof, {
      contextLoader: mockDocumentLoader,
      documentLoader() {
        unsupportedDocumentLoaderCalls++;
        throw new TypeError("did:key must not use the document loader");
      },
    }),
    null,
  );
  assertEquals(unsupportedDocumentLoaderCalls, 0);
});

test("verifyProof() records verification duration metric", async (t) => {
  const jsonLd = {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/data-integrity/v1",
    ],
    id: "https://server.example/activities/1",
    type: "Create",
    actor: "https://server.example/users/alice",
    object: {
      id: "https://server.example/objects/1",
      type: "Note",
      attributedTo: "https://server.example/users/alice",
      content: "Hello world",
      location: {
        type: "Place",
        longitude: -71.184902,
        latitude: 25.273962,
      },
    },
  };
  const proof = new DataIntegrityProof({
    cryptosuite: "eddsa-jcs-2022",
    verificationMethod: new URL(
      "https://server.example/users/alice#ed25519-key",
    ),
    proofPurpose: "assertionMethod",
    proofValue: decodeMultibase(
      // cSpell: disable
      "zLaewdp4H9kqtwyrLatK4cjY5oRHwVcw4gibPSUDYDMhi4M49v8pcYk3ZB6D69dNpAPbUmY8ocuJ3m9KhKJEEg7z",
      // cSpell: enable
    ),
    created: Temporal.Instant.from("2023-02-24T23:36:38Z"),
  });

  await t.step(
    "verified path records result=verified with bounded cryptosuite",
    async () => {
      const [meterProvider, recorder] = createTestMeterProvider();
      const key = await verifyProof(jsonLd, proof, {
        documentLoader: mockDocumentLoader,
        contextLoader: mockDocumentLoader,
        meterProvider,
      });
      assert(key != null);

      const measurements = recorder.getMeasurements(
        "activitypub.signature.verification.duration",
      );
      assertEquals(measurements.length, 1);
      const m = measurements[0];
      assertEquals(m.type, "histogram");
      assertGreaterOrEqual(m.value, 0);
      assertEquals(
        m.attributes["activitypub.signature.kind"],
        "object_integrity",
      );
      assertEquals(m.attributes["activitypub.signature.result"], "verified");
      assertEquals(
        m.attributes["object_integrity_proofs.cryptosuite"],
        "eddsa-jcs-2022",
      );
    },
  );

  await t.step("rejected path records result=rejected", async () => {
    const [meterProvider, recorder] = createTestMeterProvider();
    const tampered = {
      ...jsonLd,
      object: { ...jsonLd.object, content: "bye" },
    };
    const key = await verifyProof(tampered, proof, {
      documentLoader: mockDocumentLoader,
      contextLoader: mockDocumentLoader,
      meterProvider,
    });
    assertEquals(key, null);

    const measurements = recorder.getMeasurements(
      "activitypub.signature.verification.duration",
    );
    assertEquals(measurements.length, 1);
    assertEquals(
      measurements[0].attributes["activitypub.signature.result"],
      "rejected",
    );
    assertEquals(
      measurements[0].attributes["object_integrity_proofs.cryptosuite"],
      "eddsa-jcs-2022",
    );
  });

  await t.step("cached-key retry emits one measurement, not two", async () => {
    const [meterProvider, recorder] = createTestMeterProvider();
    const keyId = "https://server.example/users/alice#ed25519-key";
    // Prime the cache with a different valid Ed25519 Multikey for the same
    // keyId.  fetchKey returns it as cached=true, the Ed25519 algorithm
    // check passes, and verification fails because the key doesn't match
    // the proof, so verifyProofInternal goes through its
    // "signature failed with cached key" recursive retry.
    const cache: Record<string, CryptographicKey | Multikey | null> = {
      [keyId]: ed25519Multikey,
    };
    const key = await verifyProof(jsonLd, proof, {
      documentLoader: mockDocumentLoader,
      contextLoader: mockDocumentLoader,
      meterProvider,
      keyCache: {
        get(id) {
          return Promise.resolve(cache[id.href]);
        },
        set(id, k) {
          cache[id.href] = k;
          return Promise.resolve();
        },
      } satisfies KeyCache,
    });
    assert(key != null);
    assertEquals(
      recorder.getMeasurements(
        "activitypub.signature.verification.duration",
      ).length,
      1,
    );
    // The retry path is observable as a per-fetch sequence on
    // `activitypub.signature.key_fetch.duration`: a `hit` for the stale
    // cached attempt, then a `fetched` for the fresh refetch.  Mirrors the
    // LD cached-key retry test.
    const keyFetches = recorder.getMeasurements(
      "activitypub.signature.key_fetch.duration",
    );
    assertEquals(keyFetches.length, 2);
    assertEquals(
      keyFetches[0].attributes["activitypub.signature.key_fetch.result"],
      "hit",
    );
    assertEquals(
      keyFetches[1].attributes["activitypub.signature.key_fetch.result"],
      "fetched",
    );
  });

  await t.step(
    "key fetch records result=fetched on a cold cache",
    async () => {
      const [meterProvider, recorder] = createTestMeterProvider();
      const key = await verifyProof(jsonLd, proof, {
        documentLoader: mockDocumentLoader,
        contextLoader: mockDocumentLoader,
        meterProvider,
      });
      assert(key != null);

      const measurements = recorder.getMeasurements(
        "activitypub.signature.key_fetch.duration",
      );
      assertEquals(measurements.length, 1);
      assertGreaterOrEqual(measurements[0].value, 0);
      assertEquals(
        measurements[0].attributes["activitypub.signature.kind"],
        "object_integrity",
      );
      assertEquals(
        measurements[0].attributes[
          "activitypub.signature.key_fetch.result"
        ],
        "fetched",
      );
    },
  );

  await t.step(
    "key fetch records result=hit when served from the key cache",
    async () => {
      const [meterProvider, recorder] = createTestMeterProvider();
      const expectedKey = new Multikey({
        id: new URL("https://server.example/users/alice#ed25519-key"),
        controller: new URL("https://server.example/users/alice"),
        publicKey: await importMultibaseKey(
          "z6MkrJVnaZkeFzdQyMZu1cgjg7k1pZZ6pvBQ7XJPt4swbTQ2",
        ),
      });
      const cache: Record<string, CryptographicKey | Multikey | null> = {
        "https://server.example/users/alice#ed25519-key": expectedKey,
      };
      const key = await verifyProof(jsonLd, proof, {
        documentLoader: mockDocumentLoader,
        contextLoader: mockDocumentLoader,
        meterProvider,
        keyCache: {
          get(id) {
            return Promise.resolve(cache[id.href]);
          },
          set(id, k) {
            cache[id.href] = k;
            return Promise.resolve();
          },
        } satisfies KeyCache,
      });
      assert(key != null);

      const measurements = recorder.getMeasurements(
        "activitypub.signature.key_fetch.duration",
      );
      assertEquals(measurements.length, 1);
      assertEquals(
        measurements[0].attributes[
          "activitypub.signature.key_fetch.result"
        ],
        "hit",
      );
    },
  );

  await t.step(
    "verifyObject() wrapper emits one measurement per inner verifyProof()",
    async () => {
      const [meterProvider, recorder] = createTestMeterProvider();
      const serializedProof = await proof.toJsonLd({
        format: "compact",
        contextLoader: mockDocumentLoader,
      }) as Record<string, unknown>;
      const { "@context": _proofContext, ...embeddedProof } = serializedProof;
      const create = await verifyObject(Create, {
        ...jsonLd,
        proof: embeddedProof,
      }, {
        documentLoader: mockDocumentLoader,
        contextLoader: mockDocumentLoader,
        meterProvider,
      });
      assert(create != null);
      // The fixture has exactly one proof; the wrapper should not
      // double-instrument.
      assertEquals(
        recorder.getMeasurements(
          "activitypub.signature.verification.duration",
        ).length,
        1,
      );
    },
  );

  await t.step(
    "unknown cryptosuite omits the cryptosuite metric attribute",
    async () => {
      const [meterProvider, recorder] = createTestMeterProvider();
      // `DataIntegrityProof`'s constructor and `clone()` reject any
      // cryptosuite other than `eddsa-jcs-2022`, but `fromJsonLd()` does
      // not, so build the exotic proof through the JSON-LD path to
      // exercise the metric attribute whitelist on an inbound proof that
      // the validator would later reject.
      const exoticProof = await DataIntegrityProof.fromJsonLd({
        "@context": "https://w3id.org/security/data-integrity/v1",
        type: "DataIntegrityProof",
        cryptosuite: "made-up-suite-9999",
        verificationMethod: "https://server.example/users/alice#ed25519-key",
        proofPurpose: "assertionMethod",
        proofValue:
          // cSpell: disable
          "zLaewdp4H9kqtwyrLatK4cjY5oRHwVcw4gibPSUDYDMhi4M49v8pcYk3ZB6D69dNpAPbUmY8ocuJ3m9KhKJEEg7z",
        // cSpell: enable
        created: "2023-02-24T23:36:38Z",
      }, {
        documentLoader: mockDocumentLoader,
        contextLoader: mockDocumentLoader,
      });
      assertEquals(exoticProof.cryptosuite, "made-up-suite-9999");

      const key = await verifyProof(jsonLd, exoticProof, {
        documentLoader: mockDocumentLoader,
        contextLoader: mockDocumentLoader,
        meterProvider,
      });
      assertEquals(key, null);

      const measurements = recorder.getMeasurements(
        "activitypub.signature.verification.duration",
      );
      assertEquals(measurements.length, 1);
      assertEquals(
        measurements[0].attributes["activitypub.signature.result"],
        "rejected",
      );
      assertFalse(
        "object_integrity_proofs.cryptosuite" in measurements[0].attributes,
      );
    },
  );
});

test("verifyPortableObjectProof()", async (t) => {
  const options: VerifyProofOptions = {
    documentLoader() {
      throw new TypeError("did:key must not use the document loader");
    },
    contextLoader: mockDocumentLoader,
  };
  const objectId = `ap://did:key:${portableDidMethod}/objects/1`;
  const unsignedObject = {
    "@context": portableContext,
    id: objectId,
    type: "Note",
    attributedTo: `ap://did:key:${portableDidMethod}/actor`,
    content: "Portable note",
  };

  await t.step(
    "verifies a portable object with a matching DID proof",
    async () => {
      const result = await verifyPortableObjectProof(
        await signPortableJsonLd(unsignedObject),
        options,
      );
      assert(result.verified);
      assertEquals(result.keys.length, 1);
      assertEquals(result.keys[0].id, portableKeyId);
    },
  );

  await t.step(
    "rejects unauthenticated and expired proof options",
    async () => {
      const signed = await signPortableJsonLd(unsignedObject);
      const tampered = {
        ...signed,
        proof: {
          ...signed.proof as Record<string, unknown>,
          expires: "3000-01-01T00:00:00Z",
        },
      };
      const tamperedResult = await verifyPortableObjectProof(
        tampered,
        options,
      );
      assertFalse(tamperedResult.verified);
      assertEquals(tamperedResult.reason, {
        type: "invalidProof",
        proofIndex: 0,
      });

      const expiredResult = await verifyPortableObjectProof(
        await signPortableJsonLd(unsignedObject, {
          proofOptions: { expires: "2000-01-01T00:00:00Z" },
        }),
        options,
      );
      assertFalse(expiredResult.verified);
      assertEquals(expiredResult.reason, {
        type: "invalidProof",
        proofIndex: 0,
      });
    },
  );

  await t.step("verifies aliased proof properties", async () => {
    const proofAlias = "integrityProof";
    const proofIri = "https://w3id.org/security#proof";
    for (
      const { context, proofProperty, typeProperty, type } of [
        {
          context: { [proofAlias]: proofIri },
          proofProperty: proofAlias,
          typeProperty: "type",
          type: "Note",
        },
        {
          context: {
            PortableNote: {
              "@id": "https://www.w3.org/ns/activitystreams#Note",
              "@context": { [proofAlias]: proofIri },
            },
          },
          proofProperty: proofAlias,
          typeProperty: "type",
          type: "PortableNote",
        },
        {
          context: {
            kind: "@type",
            PortableNote: {
              "@id": "https://www.w3.org/ns/activitystreams#Note",
              "@context": { [proofAlias]: proofIri },
            },
          },
          proofProperty: proofAlias,
          typeProperty: "kind",
          type: "PortableNote",
        },
        {
          context: { sec: "https://w3id.org/security#" },
          proofProperty: "sec:proof",
          typeProperty: "type",
          type: "Note",
        },
        {
          context: {
            sec: {
              "@id": "https://w3id.org/security#",
              "@prefix": true,
            },
          },
          proofProperty: "sec:proof",
          typeProperty: "type",
          type: "Note",
        },
      ]
    ) {
      const document: Record<string, unknown> = {
        ...unsignedObject,
        "@context": [...portableContext, context],
      };
      delete document.type;
      document[typeProperty] = type;
      const { proof, ...signed } = await signPortableJsonLd(document);
      const result = await verifyPortableObjectProof({
        ...signed,
        [proofProperty]: proof,
      }, options);
      assert(result.verified);
      assertEquals(result.keys.length, 1);
      assertEquals(result.keys[0].id, portableKeyId);
    }
  });

  await t.step(
    "verifies proof aliases from caller-loaded contexts",
    async () => {
      const contextUrl = "https://context.example/security";
      const proofAlias = "integrityProof";
      const proofIri = "https://w3id.org/security#proof";
      let contextLoads = 0;
      const contextLoader = async (url: string) => {
        if (url !== contextUrl) return await mockDocumentLoader(url);
        contextLoads++;
        return {
          contextUrl: null,
          documentUrl: url,
          document: {
            "@context": { [proofAlias]: proofIri },
          },
        };
      };
      const document = {
        ...unsignedObject,
        "@context": [...portableContext, contextUrl],
      };
      const { proof, ...signed } = await signPortableJsonLd(document);
      const result = await verifyPortableObjectProof({
        ...signed,
        [proofAlias]: proof,
      }, {
        ...options,
        contextLoader,
      });
      assert(result.verified);
      assertEquals(result.keys.length, 1);
      assertEquals(result.keys[0].id, portableKeyId);
      assertEquals(contextLoads, 1);
    },
  );

  await t.step("verifies portable actors and activities by shape", async () => {
    for (
      const document of [
        {
          "@context": portableContext,
          id: `ap+ef61://did:key:${portableDidMethod}/actor`,
          type: "UnknownActorType",
          inbox: "https://gateway.example/users/alice/inbox",
          outbox: "https://gateway.example/users/alice/outbox",
        },
        {
          "@context": portableContext,
          id: `ap://did:key:${portableDidMethod}/activities/1`,
          type: "UnknownActivityType",
          actor: `ap://did:key:${portableDidMethod}/actor`,
          object: objectId,
        },
      ]
    ) {
      const result = await verifyPortableObjectProof(
        await signPortableJsonLd(document),
        options,
      );
      assert(result.verified);
      assertEquals(result.keys.length, 1);
    }
  });

  await t.step("uses the normative FEP-2277 precedence order", async () => {
    for (
      const document of [
        {
          "@context": portableContext,
          id: `ap://did:key:${portableDidMethod}/actor`,
          type: "Collection",
          inbox: "https://gateway.example/users/alice/inbox",
          outbox: "https://gateway.example/users/alice/outbox",
          totalItems: 0,
        },
        {
          "@context": portableContext,
          id: `ap://did:key:${portableDidMethod}/activities/1`,
          type: "Collection",
          actor: `ap://did:key:${portableDidMethod}/actor`,
          totalItems: 0,
        },
      ]
    ) {
      assertEquals(
        await verifyPortableObjectProof(document, options),
        { verified: false, reason: { type: "missingProof" } },
      );
    }
  });

  await t.step(
    "accepts portable URI spelling and location-hint variants",
    async () => {
      const variants = [
        `ap+ef61://did%3Akey%3A${portableDidMethod}/objects/1`,
        `AP://did:key:${portableDidMethod}/objects/1`,
        `ap://did:key:${portableDidMethod}/objects/1?%40gateway=${
          encodeURIComponent("https://gateway.example")
        }`,
        `ap://did:key:${portableDidMethod}/objects/1#content`,
      ];
      for (const id of variants) {
        const result = await verifyPortableObjectProof(
          await signPortableJsonLd({ ...unsignedObject, id }),
          options,
        );
        assert(result.verified, id);
      }
    },
  );

  await t.step(
    "supports matching DID methods resolved by a caller",
    async () => {
      const verificationMethod = new URL("did:web:example.com#key");
      const document = {
        ...unsignedObject,
        id: "ap://did:web:example.com/objects/1",
      };
      let fetches = 0;
      const result = await verifyPortableObjectProof(
        await signPortableJsonLd(document, { verificationMethod }),
        {
          contextLoader: mockDocumentLoader,
          documentLoader: async (url) => {
            fetches++;
            assertEquals(url, verificationMethod.href);
            return {
              contextUrl: null,
              documentUrl: url,
              document: {
                "@context": "https://w3id.org/security/multikey/v1",
                id: verificationMethod.href,
                type: "Multikey",
                controller: "did:web:example.com",
                publicKeyMultibase: await exportMultibaseKey(
                  ed25519PublicKey.publicKey,
                ),
              },
            };
          },
        },
      );
      assert(result.verified);
      assertEquals(fetches, 1);
    },
  );

  await t.step("reports a missing proof on portable objects", async () => {
    assertEquals(
      await verifyPortableObjectProof(unsignedObject, options),
      { verified: false, reason: { type: "missingProof" } },
    );
  });

  await t.step("keeps non-portable documents outside the policy", async () => {
    for (
      const document of [
        { ...unsignedObject, id: "https://social.example/objects/1" },
        {
          ...unsignedObject,
          id:
            "https://gateway.example/.well-known/apgateway/did:key:z6MkAlice/objects/1",
        },
        {
          "@context": portableContext,
          type: "Note",
          content: "Object without an ID",
        },
      ]
    ) {
      assertEquals(
        await verifyPortableObjectProof(document, options),
        { verified: false, reason: { type: "notPortableObject" } },
      );
    }
  });

  await t.step(
    "short-circuits clearly non-portable raw IDs",
    async () => {
      let contextLoads = 0;
      const result = await verifyPortableObjectProof({
        "@context": "https://attacker.example/context",
        "@id": "https://social.example/objects/1",
      }, {
        ...options,
        contextLoader() {
          contextLoads++;
          throw new TypeError("unexpected context load");
        },
      });
      assertEquals(result, {
        verified: false,
        reason: { type: "notPortableObject" },
      });
      assertEquals(contextLoads, 0);
    },
  );

  await t.step("distinguishes unsecured and signed collections", async () => {
    const collection = {
      "@context": portableContext,
      id: `ap://did:key:${portableDidMethod}/collections/1`,
      type: "Note",
      totalItems: 0,
    };
    assertEquals(
      await verifyPortableObjectProof(collection, options),
      { verified: false, reason: { type: "unsecuredCollection" } },
    );
    const result = await verifyPortableObjectProof(
      await signPortableJsonLd(collection),
      options,
    );
    assert(result.verified);
  });

  await t.step(
    "classifies unsupported core types without using type",
    async () => {
      const cases = [
        {
          document: { ...unsignedObject, href: "https://example.com/" },
          objectType: "link",
        },
        {
          document: {
            ...unsignedObject,
            "https://w3id.org/security#publicKeyMultibase":
              "z6MkrJVnaZkeFzdQyMZu1cgjg7k1pZZ6pvBQ7XJPt4swbTQ2",
          },
          objectType: "verificationMethod",
        },
        {
          document: {
            ...unsignedObject,
            "https://w3id.org/security#publicKeyPem": "not-a-real-key",
          },
          objectType: "publicKey",
        },
      ] as const;
      for (const { document, objectType } of cases) {
        assertEquals(
          await verifyPortableObjectProof(document, options),
          {
            verified: false,
            reason: { type: "unsupportedObjectType", objectType },
          },
        );
      }
    },
  );

  await t.step(
    "rejects non-DID verification methods before fetching",
    async () => {
      let fetched = false;
      const verificationMethod = new URL(
        "https://attacker.example/keys/ed25519",
      );
      const result = await verifyPortableObjectProof(
        await signPortableJsonLd(unsignedObject, { verificationMethod }),
        {
          contextLoader: mockDocumentLoader,
          documentLoader() {
            fetched = true;
            throw new TypeError("unexpected fetch");
          },
        },
      );
      assertFalse(result.verified);
      assertEquals(result.reason, {
        type: "unsupportedVerificationMethod",
        proofIndex: 0,
        verificationMethod,
      });
      assertFalse(fetched);
    },
  );

  await t.step("rejects malformed DID verification methods", async () => {
    const verificationMethod = new URL("did:invalid");
    const result = await verifyPortableObjectProof(
      await signPortableJsonLd(unsignedObject, { verificationMethod }),
      options,
    );
    assertFalse(result.verified);
    assertEquals(result.reason, {
      type: "unsupportedVerificationMethod",
      proofIndex: 0,
      verificationMethod,
    });
  });

  await t.step("rejects a proof from another DID before fetching", async () => {
    let fetched = false;
    const verificationMethod = new URL(
      "did:key:z6MkMallory#z6MkMallory",
    );
    const result = await verifyPortableObjectProof(
      await signPortableJsonLd(unsignedObject, { verificationMethod }),
      {
        contextLoader: mockDocumentLoader,
        documentLoader() {
          fetched = true;
          throw new TypeError("unexpected fetch");
        },
      },
    );
    assertFalse(result.verified);
    assertEquals(result.reason, {
      type: "verificationMethodMismatch",
      proofIndex: 0,
      objectId: parseIri(objectId),
      verificationMethod,
    });
    assertFalse(fetched);
  });

  await t.step(
    "rejects proofs with multiple verification methods",
    async () => {
      const signed = await signPortableJsonLd(unsignedObject);
      const proof = signed.proof as Record<string, unknown>;
      for (
        const additionalVerificationMethod of [
          "did:key:z6MkMallory#z6MkMallory",
          "https://attacker.example/key",
        ]
      ) {
        assertEquals(
          await verifyPortableObjectProof({
            ...signed,
            proof: {
              ...proof,
              verificationMethod: [
                portableKeyId.href,
                additionalVerificationMethod,
              ],
            },
          }, options),
          {
            verified: false,
            reason: { type: "invalidProof", proofIndex: 0 },
          },
        );
      }
    },
  );

  await t.step(
    "rejects multiple values in functional proof fields",
    async () => {
      const signed = await signPortableJsonLd(unsignedObject);
      const proof = signed.proof as Record<string, unknown>;
      const cases: readonly (readonly [string, unknown])[] = [
        ["cryptosuite", "eddsa-jcs-2022"],
        ["proofPurpose", "authentication"],
        ["proofValue", proof.proofValue],
        ["created", "2024-01-01T00:00:00Z"],
      ];
      for (
        const [field, additionalValue] of cases
      ) {
        const originalValue = proof[field];
        assert(originalValue != null);
        assertEquals(
          await verifyPortableObjectProof({
            ...signed,
            proof: {
              ...proof,
              [field]: [originalValue, additionalValue],
            },
          }, options),
          {
            verified: false,
            reason: { type: "invalidProof", proofIndex: 0 },
          },
        );
      }
    },
  );

  await t.step(
    "requires exactly the DataIntegrityProof type",
    async () => {
      const signed = await signPortableJsonLd(unsignedObject);
      const proof = signed.proof as Record<string, unknown>;
      const missingType = { ...proof };
      delete missingType.type;
      for (
        const invalidProof of [
          missingType,
          { ...proof, type: "Object" },
          { ...proof, type: ["DataIntegrityProof", "Object"] },
        ]
      ) {
        assertEquals(
          await verifyPortableObjectProof({
            ...signed,
            proof: invalidProof,
          }, options),
          {
            verified: false,
            reason: { type: "invalidProof", proofIndex: 0 },
          },
        );
      }
    },
  );

  await t.step("reports cryptographic failures separately", async () => {
    const signed = await signPortableJsonLd(unsignedObject);
    const tampered = { ...signed, content: "Tampered" };
    assertEquals(
      await verifyPortableObjectProof(tampered, options),
      {
        verified: false,
        reason: { type: "invalidProof", proofIndex: 0 },
      },
    );
  });

  await t.step("reports malformed proof structures as invalid", async () => {
    for (
      const proof of [
        { type: "DataIntegrityProof" },
        {
          type: "DataIntegrityProof",
          cryptosuite: "eddsa-jcs-2022",
          verificationMethod: portableKeyId.href,
          proofPurpose: "assertionMethod",
          proofValue: "zInvalid",
          created: "not-an-instant",
        },
      ]
    ) {
      assertEquals(
        await verifyPortableObjectProof({
          ...unsignedObject,
          proof,
        }, options),
        {
          verified: false,
          reason: { type: "invalidProof", proofIndex: 0 },
        },
      );
    }
  });

  await t.step("accepts multiple valid proofs in input order", async () => {
    const signed = await signPortableJsonLd(unsignedObject);
    const proof = signed.proof as Record<string, unknown>;
    const result = await verifyPortableObjectProof({
      ...signed,
      proof: [proof, structuredClone(proof)],
    }, options);
    assert(result.verified);
    assertEquals(result.keys.length, 2);
    assertEquals(result.keys.map((key) => key.id), [
      portableKeyId,
      portableKeyId,
    ]);
  });

  await t.step("rejects a tampered duplicate proof", async () => {
    const signed = await signPortableJsonLd(unsignedObject);
    const proof = signed.proof as Record<string, unknown>;
    const result = await verifyPortableObjectProof({
      ...signed,
      proof: [
        proof,
        {
          ...structuredClone(proof),
          expires: "3000-01-01T00:00:00Z",
        },
      ],
    }, options);
    assertFalse(result.verified);
  });

  await t.step("matches proofs across aliased properties", async () => {
    const document = {
      ...unsignedObject,
      "@context": [
        ...portableContext,
        {
          firstProof: "https://w3id.org/security#proof",
          secondProof: "https://w3id.org/security#proof",
        },
      ],
    };
    const firstSigned = await signPortableJsonLd(document, {
      proofOptions: { domain: "first.example" },
    });
    const secondSigned = await signPortableJsonLd(document, {
      proofOptions: { domain: "second.example" },
    });
    const result = await verifyPortableObjectProof({
      ...document,
      secondProof: secondSigned.proof,
      firstProof: firstSigned.proof,
    }, options);
    assert(result.verified);
    assertEquals(result.keys.length, 2);
  });

  await t.step(
    "canonicalizes the document only once for multiple proofs",
    async () => {
      async function countContentReads(proofCount: number): Promise<number> {
        const signed = await signPortableJsonLd(unsignedObject);
        const proof = signed.proof as Record<string, unknown>;
        const document = {
          ...signed,
          proof: Array.from(
            { length: proofCount },
            () => structuredClone(proof),
          ),
        };
        let contentReads = 0;
        Object.defineProperty(document, "content", {
          configurable: true,
          enumerable: true,
          get() {
            contentReads++;
            return unsignedObject.content;
          },
        });
        const result = await verifyPortableObjectProof(document, options);
        assert(result.verified);
        assertEquals(result.keys.length, proofCount);
        return contentReads;
      }

      assertEquals(await countContentReads(3), await countContentReads(1));
    },
  );

  await t.step("requires every proof to verify", async () => {
    const signed = await signPortableJsonLd(unsignedObject);
    const proof = signed.proof as Record<string, unknown>;
    const result = await verifyPortableObjectProof({
      ...signed,
      proof: [
        proof,
        { ...proof, proofValue: "zInvalid" },
      ],
    }, options);
    assertEquals(result, {
      verified: false,
      reason: { type: "invalidProof", proofIndex: 1 },
    });
  });

  await t.step("checks every proof policy before resolving keys", async () => {
    const didWebId = "ap://did:web:example.com/objects/1";
    const didWebMethod = new URL("did:web:example.com#key");
    const didWebSigned = await signPortableJsonLd(
      { ...unsignedObject, id: didWebId },
      { verificationMethod: didWebMethod },
    );
    const httpMethod = new URL("https://attacker.example/key");
    const httpSigned = await signPortableJsonLd(
      { ...unsignedObject, id: didWebId },
      { verificationMethod: httpMethod },
    );
    let fetched = false;
    const result = await verifyPortableObjectProof({
      ...didWebSigned,
      proof: [didWebSigned.proof, httpSigned.proof],
    }, {
      contextLoader: mockDocumentLoader,
      documentLoader() {
        fetched = true;
        throw new TypeError("unexpected fetch");
      },
    });
    assertFalse(result.verified);
    assertEquals(result.reason, {
      type: "unsupportedVerificationMethod",
      proofIndex: 1,
      verificationMethod: httpMethod,
    });
    assertFalse(fetched);
  });

  await t.step("accepts the expanded proof property", async () => {
    const signed = await signPortableJsonLd(unsignedObject);
    const { proof, ...document } = signed;
    const parsedProof = await DataIntegrityProof.fromJsonLd(proof, {
      contextLoader: mockDocumentLoader,
      documentLoader: mockDocumentLoader,
    });
    const expandedProof = await parsedProof.toJsonLd({
      format: "expand",
      contextLoader: mockDocumentLoader,
    });
    const result = await verifyPortableObjectProof({
      ...document,
      "https://w3id.org/security#proof": expandedProof,
    }, options);
    assert(result.verified);
  });

  await t.step(
    "classifies JSON-LD aliases by their expanded properties",
    async () => {
      const aliasedActivity = {
        "@context": [
          ...portableContext,
          { performedBy: "https://www.w3.org/ns/activitystreams#actor" },
        ],
        id: `ap://did:key:${portableDidMethod}/activities/aliased`,
        type: "UnknownActivity",
        performedBy: `ap://did:key:${portableDidMethod}/actor`,
      };
      const result = await verifyPortableObjectProof(
        await signPortableJsonLd(aliasedActivity),
        options,
      );
      assert(result.verified);
    },
  );

  await t.step(
    "does not claim to verify embedded portable objects",
    async () => {
      const outer = {
        "@context": portableContext,
        id: `ap://did:key:${portableDidMethod}/activities/outer`,
        type: "Create",
        actor: `ap://did:key:${portableDidMethod}/actor`,
        object: {
          id: `ap://did:key:${portableDidMethod}/objects/embedded`,
          type: "Note",
          content: "Unsigned embedded object",
        },
      };
      const result = await verifyPortableObjectProof(
        await signPortableJsonLd(outer),
        options,
      );
      assert(result.verified);
    },
  );

  await t.step("rejects malformed roots and portable IDs", async () => {
    await assertRejects(
      () => verifyPortableObjectProof([], options),
      TypeError,
      "single JSON-LD object",
    );
    await assertRejects(
      () =>
        verifyPortableObjectProof({
          ...unsignedObject,
          id: `ap://did:key:${portableDidMethod}`,
        }, options),
      TypeError,
    );
    await assertRejects(
      () =>
        verifyPortableObjectProof({
          ...unsignedObject,
          id: "ap://did%ZZkey/objects/1",
        }, options),
      TypeError,
    );
  });

  await t.step(
    "emits metrics only for attempted proof verification",
    async () => {
      const [meterProvider, recorder] = createTestMeterProvider();
      const signed = await signPortableJsonLd(unsignedObject);
      const proof = signed.proof as Record<string, unknown>;
      const verified = await verifyPortableObjectProof({
        ...signed,
        proof: [proof, structuredClone(proof)],
      }, { ...options, meterProvider });
      assert(verified.verified);
      assertEquals(
        recorder.getMeasurements(
          "activitypub.signature.verification.duration",
        ).length,
        2,
      );

      const [rejectedMeterProvider, rejectedRecorder] =
        createTestMeterProvider();
      await verifyPortableObjectProof(unsignedObject, {
        ...options,
        meterProvider: rejectedMeterProvider,
      });
      assertEquals(
        rejectedRecorder.getMeasurements(
          "activitypub.signature.verification.duration",
        ).length,
        0,
      );
    },
  );
});

test("verifyObject()", async () => {
  const options: VerifyObjectOptions = {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  };
  const create = await verifyObject(Create, {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/data-integrity/v1",
    ],
    id: "https://server.example/activities/1",
    type: "Create",
    actor: "https://server.example/users/alice",
    object: {
      id: "https://server.example/objects/1",
      type: "Note",
      attributedTo: "https://server.example/users/alice",
      content: "Hello world",
      location: {
        type: "Place",
        longitude: -71.184902,
        latitude: 25.273962,
      },
    },
    proof: [
      {
        type: "DataIntegrityProof",
        cryptosuite: "eddsa-jcs-2022",
        verificationMethod: "https://server.example/users/alice#ed25519-key",
        proofPurpose: "assertionMethod",
        proofValue:
          // cSpell: disable
          "zLaewdp4H9kqtwyrLatK4cjY5oRHwVcw4gibPSUDYDMhi4M49v8pcYk3ZB6D69dNpAPbUmY8ocuJ3m9KhKJEEg7z",
        // cSpell: enable
        created: "2023-02-24T23:36:38Z",
      },
      {
        created: "2023-02-24T23:36:38Z",
        cryptosuite: "eddsa-jcs-2022",
        proofPurpose: "assertionMethod",
        proofValue:
          // cSpell: disable
          "zVrcY69MxozB9V9hmMmsjoB4YLCXvn6ienKr6jsP2rztSEr1WhMJymPqujKofkrV3C7A2C9iKYnRNSvtPgDQBCw2",
        // cSpell: enable
        type: "DataIntegrityProof",
        verificationMethod: "https://example.com/person2#key4",
      },
    ],
  }, options);
  assertInstanceOf(create, Create);
  assertEquals(create.actorId, new URL("https://server.example/users/alice"));
  const note = await create.getObject(options);
  assertInstanceOf(note, Note);
  assertEquals(note.content, "Hello world");
});

test("verifyObject() accepts did:key proofs for matching portable attribution origin", async () => {
  const did = await exportDidKey(ed25519PublicKey.publicKey);
  const keyId = new URL(`${did}#${did.substring("did:key:".length)}`);
  const note = new Note({
    id: parseIri(`ap://did:key:${did.substring("did:key:".length)}/objects/1`),
    attribution: parseIri(
      `ap://did:key:${did.substring("did:key:".length)}/actor`,
    ),
    content: "Portable note",
  });
  const signed = await signObject(note, ed25519PrivateKey, keyId, {
    contextLoader: mockDocumentLoader,
    context: [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/data-integrity/v1",
    ],
  });
  const jsonLd = await signed.toJsonLd({
    format: "compact",
    contextLoader: mockDocumentLoader,
    context: [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/data-integrity/v1",
    ],
  });

  const verified = await verifyObject(Note, jsonLd, {
    documentLoader() {
      throw new TypeError("did:key must not use the document loader");
    },
    contextLoader: mockDocumentLoader,
  });

  assertInstanceOf(verified, Note);
  assertEquals(verified.content, "Portable note");

  assert(
    typeof jsonLd === "object" && jsonLd != null && !Array.isArray(jsonLd),
  );
  const rawProof = (jsonLd as Record<string, unknown>).proof;
  assert(
    typeof rawProof === "object" && rawProof != null &&
      !Array.isArray(rawProof),
  );
  assertEquals(
    await verifyObject(Note, {
      ...jsonLd as Record<string, unknown>,
      proof: [
        rawProof,
        {
          ...structuredClone(rawProof),
          expires: "3000-01-01T00:00:00Z",
        },
      ],
    }, {
      documentLoader() {
        throw new TypeError("did:key must not use the document loader");
      },
      contextLoader: mockDocumentLoader,
    }),
    null,
  );

  async function verifyRemotelyReferencedProof(
    proofOptions: Record<string, unknown> = {},
    proofUrl = "https://proof.example/proofs/1",
  ): Promise<Note | null> {
    const remotelyReferencedJsonLd = {
      ...jsonLd as Record<string, unknown>,
    };
    delete remotelyReferencedJsonLd.proof;
    remotelyReferencedJsonLd["https://w3id.org/security#proof"] = [
      { "@graph": [rawProof] },
      { "@graph": [{ "@id": proofUrl }] },
    ];
    let proofFetches = 0;
    const result = await verifyObject(Note, remotelyReferencedJsonLd, {
      documentLoader(url) {
        if (url !== formatIri(parseIri(proofUrl))) {
          throw new TypeError(`unexpected document URL: ${url}`);
        }
        proofFetches++;
        return Promise.resolve({
          contextUrl: null,
          document: {
            "@context": (jsonLd as Record<string, unknown>)["@context"],
            ...structuredClone(rawProof as Record<string, unknown>),
            ...proofOptions,
          },
          documentUrl: url,
        });
      },
      contextLoader: mockDocumentLoader,
    });
    assertEquals(proofFetches, 1);
    return result;
  }

  assertInstanceOf(
    await verifyRemotelyReferencedProof(),
    Note,
  );
  assertInstanceOf(
    await verifyRemotelyReferencedProof(
      {},
      `ap://did:key:${did.substring("did:key:".length)}/proofs/1`,
    ),
    Note,
  );
  assertEquals(
    await verifyRemotelyReferencedProof({
      expires: "3000-01-01T00:00:00Z",
    }),
    null,
  );
});

test("verifyObject() hydrates pending proof references", async () => {
  const did = await exportDidKey(ed25519PublicKey.publicKey);
  const method = did.substring("did:key:".length);
  const keyId = new URL(`${did}#${method}`);
  const proofUrl = `ap://did:key:${method}/proofs/1`;
  const signed = await signPortableJsonLd({
    "@context": portableContext,
    id: `ap://did:key:${method}/objects/1`,
    type: "Note",
    attributedTo: `ap://did:key:${method}/actor`,
    content: "Portable note with a referenced proof",
  }, {
    verificationMethod: keyId,
    proofOptions: { id: proofUrl },
  });
  const rawProof = signed.proof as Record<string, unknown>;
  const remotelyReferencedJsonLd = { ...signed };
  delete remotelyReferencedJsonLd.proof;
  remotelyReferencedJsonLd["https://w3id.org/security#proof"] = [
    { "@graph": [rawProof] },
    { "@graph": [{ "@id": proofUrl }] },
  ];

  let proofFetches = 0;
  const verified = await verifyObject(Note, remotelyReferencedJsonLd, {
    documentLoader(url) {
      assertEquals(url, formatIri(parseIri(proofUrl)));
      proofFetches++;
      return Promise.resolve({
        contextUrl: null,
        document: structuredClone(rawProof),
        documentUrl: url,
      });
    },
    contextLoader: mockDocumentLoader,
  });

  assertEquals(proofFetches, 1);
  assertInstanceOf(verified, Note);
});

test("verifyObject() accepts multiple portable attributions from the same did:key origin", async () => {
  const did = await exportDidKey(ed25519PublicKey.publicKey);
  const method = did.substring("did:key:".length);
  const keyId = new URL(`${did}#${method}`);
  const create = new Create({
    id: parseIri(`ap://did:key:${method}/activities/1`),
    actor: parseIri(`ap://did:key:${method}/actor`),
    attribution: parseIri(`ap://did:key:${method}/profile`),
    object: new Note({
      id: parseIri(`ap://did:key:${method}/objects/1`),
      content: "Portable note",
    }),
  });
  const signed = await signObject(create, ed25519PrivateKey, keyId, {
    contextLoader: mockDocumentLoader,
    context: [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/data-integrity/v1",
    ],
  });
  const jsonLd = await signed.toJsonLd({
    format: "compact",
    contextLoader: mockDocumentLoader,
    context: [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/data-integrity/v1",
    ],
  });

  const verified = await verifyObject(Create, jsonLd, {
    documentLoader() {
      throw new TypeError("did:key must not use the document loader");
    },
    contextLoader: mockDocumentLoader,
  });

  assertInstanceOf(verified, Create);
  assertEquals(verified.actorId, parseIri(`ap://did:key:${method}/actor`));
  assertEquals(
    verified.attributionId,
    parseIri(`ap://did:key:${method}/profile`),
  );
});

test("verifyObject() rejects HTTPS keys claiming a portable DID controller", async () => {
  const victimDid = "did:key:z6MkVictim";
  const keyId = new URL("https://attacker.example/keys/ed25519");
  const note = new Note({
    id: parseIri("ap://did:key:z6MkVictim/objects/1"),
    attribution: parseIri("ap://did:key:z6MkVictim/actor"),
    content: "Spoofed portable note",
  });
  const signed = await signObject(note, ed25519PrivateKey, keyId, {
    contextLoader: mockDocumentLoader,
    context: [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/data-integrity/v1",
    ],
  });
  const jsonLd = await signed.toJsonLd({
    format: "compact",
    contextLoader: mockDocumentLoader,
    context: [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/data-integrity/v1",
    ],
  });

  const verified = await verifyObject(Note, jsonLd, {
    documentLoader: async (url) => {
      if (url === keyId.href) {
        return {
          documentUrl: url,
          contextUrl: null,
          document: {
            "@context": "https://w3id.org/security/multikey/v1",
            id: keyId.href,
            type: "Multikey",
            controller: victimDid,
            publicKeyMultibase: await exportMultibaseKey(
              ed25519PublicKey.publicKey,
            ),
          },
        };
      }
      throw new TypeError(`Unexpected fetch: ${url}`);
    },
    contextLoader: mockDocumentLoader,
  });

  assertEquals(verified, null);
});

test("verifyObject() rejects HTTPS keys claiming an exact DID attribution", async () => {
  const victimDid = "did:key:z6MkVictim";
  const keyId = new URL("https://attacker.example/keys/ed25519");
  const note = new Note({
    id: parseIri("ap://did:key:z6MkVictim/objects/1"),
    attribution: new URL(victimDid),
    content: "Spoofed DID-attributed note",
  });
  const signed = await signObject(note, ed25519PrivateKey, keyId, {
    contextLoader: mockDocumentLoader,
    context: [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/data-integrity/v1",
    ],
  });
  const jsonLd = await signed.toJsonLd({
    format: "compact",
    contextLoader: mockDocumentLoader,
    context: [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/data-integrity/v1",
    ],
  });

  const verified = await verifyObject(Note, jsonLd, {
    documentLoader: async (url) => {
      if (url === keyId.href) {
        return {
          documentUrl: url,
          contextUrl: null,
          document: {
            "@context": "https://w3id.org/security/multikey/v1",
            id: keyId.href,
            type: "Multikey",
            controller: victimDid,
            publicKeyMultibase: await exportMultibaseKey(
              ed25519PublicKey.publicKey,
            ),
          },
        };
      }
      throw new TypeError(`Unexpected fetch: ${url}`);
    },
    contextLoader: mockDocumentLoader,
  });

  assertEquals(verified, null);
});

test("verifyObject() rejects did:key proofs from another portable attribution origin", async () => {
  const did = await exportDidKey(ed25519PublicKey.publicKey);
  const keyId = new URL(`${did}#${did.substring("did:key:".length)}`);
  const note = new Note({
    id: parseIri(`ap://did:key:${did.substring("did:key:".length)}/objects/1`),
    attribution: parseIri("ap://did:key:z6MkOther/actor"),
    content: "Portable note",
  });
  const signed = await signObject(note, ed25519PrivateKey, keyId, {
    contextLoader: mockDocumentLoader,
    context: [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/data-integrity/v1",
    ],
  });
  const jsonLd = await signed.toJsonLd({
    format: "compact",
    contextLoader: mockDocumentLoader,
    context: [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/data-integrity/v1",
    ],
  });

  assertEquals(
    await verifyObject(Note, jsonLd, {
      documentLoader() {
        throw new TypeError("did:key must not use the document loader");
      },
      contextLoader: mockDocumentLoader,
    }),
    null,
  );
});

test("signObject() preserves FEP-22cd contexts through proof verification", async () => {
  const did = await exportDidKey(ed25519PublicKey.publicKey);
  const keyId = new URL(`${did}#${did.substring("did:key:".length)}`);
  const id = parseIri(`ap://${did}/objects/translation`);
  const note = new Note({
    id,
    attribution: parseIri(`ap://${did}/actor`),
    content: "A translated note",
    translations: [
      new Translation({
        language: new Intl.Locale("ko"),
        translator: new URL("https://example.com/translator"),
        original: id,
      }),
    ],
  });
  const signed = await signObject(note, ed25519PrivateKey, keyId);
  const json = await signed.toJsonLd({ format: "compact" });
  assert(
    typeof json === "object" && json != null && "@context" in json &&
      "proof" in json,
  );
  assertEquals(
    (json.proof as Record<string, unknown>)["@context"],
    json["@context"],
  );
  const verified = await verifyObject(Note, json, {
    documentLoader() {
      throw new Error("No document fetch expected");
    },
  });
  assertInstanceOf(verified, Note);
  assertEquals(verified.translations[0].language?.baseName, "ko");
});
