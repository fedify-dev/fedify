import { assertEquals, assertInstanceOf, assertRejects } from "@std/assert";
import { decodeHex, encodeHex } from "byte-encodings/hex";
import { importMultibaseKey } from "../runtime/key.ts";
import { decode } from "../runtime/multibase/index.ts";
import { mockDocumentLoader } from "../testing/docloader.ts";
import {
  ed25519Multikey,
  ed25519PrivateKey,
  ed25519PublicKey,
  rsaPrivateKey2,
  rsaPublicKey2,
} from "../testing/keys.ts";
import { test } from "../testing/mod.ts";
import {
  Create,
  type CryptographicKey,
  DataIntegrityProof,
  Multikey,
  Note,
  Place,
} from "../vocab/vocab.ts";
import type { KeyCache } from "./key.ts";
import {
  createProof,
  signObject,
  verifyObject,
  type VerifyObjectOptions,
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
  console.log(encodeHex(proof.proofValue!));
  assertEquals(
    proof.proofValue,
    decodeHex(
      "203e6afc5b7c6affe08d2d67ad100cc6cdcf1f5a438063d16766204956aa8fdd" +
        "67cc04088ccf69de36225cab19377b5a032542fd2454b9b9dd001ffbdef5aa03",
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
    decode(
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
    proofValue: decode(
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
