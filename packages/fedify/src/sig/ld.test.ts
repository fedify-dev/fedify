import { mockDocumentLoader, test } from "@fedify/fixture";
import { Create, CryptographicKey, Note } from "@fedify/vocab";
import jsonld from "@fedify/vocab-runtime/jsonld";
import { configure, type LogRecord, reset } from "@logtape/logtape";
import { assert } from "@std/assert/assert";
import { assertEquals } from "@std/assert/assert-equals";
import { assertFalse } from "@std/assert/assert-false";
import { assertInstanceOf } from "@std/assert/assert-instance-of";
import { assertRejects } from "@std/assert/assert-rejects";
import { assertThrows } from "@std/assert/assert-throws";
import { encodeBase64 } from "byte-encodings/base64";
import { ldSignatureWithoutCreated } from "../testing/ld-signature.ts";
import {
  ed25519Multikey,
  ed25519PrivateKey,
  rsaPrivateKey2,
  rsaPrivateKey3,
  rsaPublicKey2,
  rsaPublicKey3,
} from "../testing/keys.ts";
import { generateCryptoKeyPair } from "./key.ts";
import {
  attachSignature,
  compactJsonLd,
  createSignature,
  describeSignatureShape,
  detachSignature,
  hasSignature,
  hasVerifiableSignature,
  isInvalidUrlTypeError,
  type Signature,
  signJsonLd,
  UnsafeJsonLdError,
  verifyJsonLd,
  verifySignature,
} from "./ld.ts";

test("isInvalidUrlTypeError()", () => {
  assert(isInvalidUrlTypeError(new TypeError("Invalid URL string.")));
  assertFalse(isInvalidUrlTypeError(new Error("Invalid URL string.")));
  assertFalse(
    isInvalidUrlTypeError(new TypeError("Invalid URL string. Other error")),
  );
  assert(isInvalidUrlTypeError(new TypeError("Invalid URL: http://[")));
  assert(
    isInvalidUrlTypeError(
      new TypeError('"http://[" cannot be parsed as a URL.'),
    ),
  );
  const error = new TypeError("Failed to parse URL") as TypeError & {
    code?: string;
  };
  error.code = "ERR_INVALID_URL";
  assert(isInvalidUrlTypeError(error));
  assertFalse(isInvalidUrlTypeError(new TypeError("Failed to fetch")));
});

test("attachSignature()", () => {
  const sig: Signature = {
    "@context": "https://w3id.org/security/v1",
    type: "RsaSignature2017",
    creator: "https://activitypub.academy/users/brauca_darradiul#main-key",
    created: "2024-09-12T16:50:46Z",
    signatureValue: "asdf",
  };
  const signatureTerm = {
    "signature": "https://w3id.org/security#signature",
  };
  const doc = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: "https://example.com/1",
  };
  assertEquals(attachSignature(doc, sig), {
    ...doc,
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      signatureTerm,
    ],
    signature: sig,
  });
  const arrayDoc = {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/data-integrity/v1",
    ],
    id: "https://example.com/1",
  };
  assertEquals(attachSignature(arrayDoc, sig), {
    ...arrayDoc,
    "@context": [...arrayDoc["@context"], signatureTerm],
    signature: sig,
  });
  for (
    const context of [
      ["https://w3id.org/identity/v1", "https://www.w3.org/ns/activitystreams"],
      ["https://www.w3.org/ns/activitystreams", "https://w3id.org/security/v1"],
      ["https://www.w3.org/ns/activitystreams", signatureTerm],
      { "signature": "https://w3id.org/security#signature" },
    ]
  ) {
    const contextDoc = { "@context": context, id: "https://example.com/1" };
    assertEquals(attachSignature(contextDoc, sig), {
      ...contextDoc,
      signature: sig,
    });
  }
  assertEquals(
    attachSignature({ "@context": null, id: "https://example.com/1" }, sig),
    {
      "@context": [signatureTerm],
      id: "https://example.com/1",
      signature: sig,
    },
  );
  const resetDoc = {
    "@context": [
      "https://w3id.org/security/v1",
      null,
      "https://www.w3.org/ns/activitystreams",
    ],
    id: "https://example.com/1",
  };
  assertEquals(attachSignature(resetDoc, sig), {
    ...resetDoc,
    "@context": [...resetDoc["@context"], signatureTerm],
    signature: sig,
  });
  const disabledTermDoc = {
    "@context": [
      { "signature": { "@id": null } },
      "https://www.w3.org/ns/activitystreams",
    ],
    id: "https://example.com/1",
  };
  assertEquals(attachSignature(disabledTermDoc, sig), {
    ...disabledTermDoc,
    "@context": [...disabledTermDoc["@context"], signatureTerm],
    signature: sig,
  });
  assertEquals(attachSignature({ id: "https://example.com/1" }, sig), {
    id: "https://example.com/1",
    "@context": [signatureTerm],
    signature: sig,
  });
  assertThrows(() => attachSignature(null, sig), TypeError);
  assertThrows(() => attachSignature(1234, sig), TypeError);
  assertThrows(() => attachSignature([], sig), TypeError);
});

test("createSignature()", async () => {
  const doc = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: "https://example.com/1",
    type: "Create",
  };
  const sig = await createSignature(doc, rsaPrivateKey2, rsaPublicKey2.id!, {
    contextLoader: mockDocumentLoader,
  });
  assertEquals(typeof sig.created, "string");
  assert(hasSignature(attachSignature(doc, sig)));
  assertEquals(sig["@context"], "https://w3id.org/security/v1");
  const key = await verifySignature(attachSignature(doc, sig), {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  assertEquals(key, rsaPublicKey2);

  assertRejects(
    () =>
      createSignature(doc, rsaPublicKey2.publicKey!, rsaPublicKey2.id!, {
        contextLoader: mockDocumentLoader,
      }),
    TypeError,
  );
  assertRejects(
    () =>
      createSignature(doc, ed25519PrivateKey, ed25519Multikey.id!, {
        contextLoader: mockDocumentLoader,
      }),
    TypeError,
  );
});

test("signJsonLd()", async () => {
  const doc = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: "https://example.com/1",
    type: "Create",
    actor: "https://example.com/person2",
  };
  const signed = await signJsonLd(doc, rsaPrivateKey3, rsaPublicKey3.id!, {
    contextLoader: mockDocumentLoader,
  });
  assert(hasSignature(signed));
  assertEquals(typeof signed.signature.created, "string");
  const verified = await verifyJsonLd(signed, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  assert(verified);
});

test("signJsonLd() defines the signature term when the context lacks it", async () => {
  const doc = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: "https://example.com/notes/1",
    type: "Note",
    content: "Hello",
  };
  const signed = await signJsonLd(doc, rsaPrivateKey2, rsaPublicKey2.id!, {
    contextLoader: mockDocumentLoader,
  }) as Record<string, unknown>;
  assert(Array.isArray(signed["@context"]));
  assertEquals(
    (signed["@context"] as unknown[])[1],
    { "signature": "https://w3id.org/security#signature" },
  );
  const quads = await jsonld.canonize(signed, {
    format: "application/n-quads",
    documentLoader: mockDocumentLoader,
  });
  assert(quads.includes("<https://w3id.org/security#signature>"));
  const key = await verifySignature(signed, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  assertEquals(key, rsaPublicKey2);
});

test("signJsonLd() signs documents that use the signature term", async () => {
  const signatureTerm = { "signature": "https://w3id.org/security#signature" };
  for (
    const object of [
      { type: "Note", signature: "nested value" },
      { type: "signature" },
    ]
  ) {
    const doc = {
      "@context": [
        "https://www.w3.org/ns/activitystreams",
        { "@vocab": "https://example.com/" },
      ],
      id: "https://example.com/1",
      type: "Create",
      object,
    };
    const signed = await signJsonLd(doc, rsaPrivateKey2, rsaPublicKey2.id!, {
      contextLoader: mockDocumentLoader,
    }) as Record<string, unknown>;
    assertEquals(signed["@context"], [...doc["@context"], signatureTerm]);
    assertEquals(signed["object"], object);
    const key = await verifySignature(signed, {
      documentLoader: mockDocumentLoader,
      contextLoader: mockDocumentLoader,
    });
    assertEquals(key, rsaPublicKey2);
  }
});

test("signJsonLd() does not share the inline signature definition", async () => {
  const doc = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: "https://example.com/notes/1",
    type: "Note",
  };
  const first = await signJsonLd(doc, rsaPrivateKey2, rsaPublicKey2.id!, {
    contextLoader: mockDocumentLoader,
  }) as Record<string, unknown>;
  const firstContext = first["@context"] as Record<string, unknown>[];
  firstContext[1]["signature"] = "https://example.com/signature";
  const second = await signJsonLd(doc, rsaPrivateKey2, rsaPublicKey2.id!, {
    contextLoader: mockDocumentLoader,
  }) as Record<string, unknown>;
  assertEquals((second["@context"] as unknown[])[1], {
    "signature": "https://w3id.org/security#signature",
  });
});

test("signJsonLd() respects a protected null signature definition", async () => {
  for (
    const context of [
      { "@protected": true, "signature": { "@id": null } },
      { "signature": { "@id": null, "@protected": true } },
    ]
  ) {
    const doc = {
      "@context": ["https://www.w3.org/ns/activitystreams", context],
      id: "https://example.com/1",
      type: "Note",
    };
    const signed = await signJsonLd(doc, rsaPrivateKey2, rsaPublicKey2.id!, {
      contextLoader: mockDocumentLoader,
    }) as Record<string, unknown>;
    assertEquals(signed["@context"], doc["@context"]);
    const key = await verifySignature(signed, {
      documentLoader: mockDocumentLoader,
      contextLoader: mockDocumentLoader,
    });
    assertEquals(key, rsaPublicKey2);
  }
});

test("signJsonLd() respects protection from imported contexts", async () => {
  const importUrl = "https://example.com/contexts/imported-protected";
  const contextLoader = async (url: string) => {
    if (new URL(url).href === importUrl) {
      return {
        contextUrl: null,
        documentUrl: url,
        document: {
          "@context": {
            "@protected": true,
            "name": "https://example.com/name",
          },
        },
      };
    }
    return await mockDocumentLoader(url);
  };
  for (const signature of [null, { "@id": null }]) {
    const doc = {
      "@context": [
        "https://www.w3.org/ns/activitystreams",
        { "@import": importUrl, signature },
      ],
      id: "https://example.com/1",
      type: "Note",
      name: "Alice",
    };
    const signed = await signJsonLd(doc, rsaPrivateKey2, rsaPublicKey2.id!, {
      contextLoader,
    }) as Record<string, unknown>;
    assertEquals(signed["@context"], doc["@context"]);
    const key = await verifySignature(signed, {
      documentLoader: mockDocumentLoader,
      contextLoader,
    });
    assertEquals(key, rsaPublicKey2);
  }
});

test("signJsonLd() leaves unrecognized remote contexts unchanged", async () => {
  const contextUrl = "https://example.com/contexts/custom";
  const contextLoader = async (url: string) => {
    if (new URL(url).href === contextUrl) {
      return {
        contextUrl: null,
        documentUrl: url,
        document: {
          "@context": {
            "@protected": true,
            "signature": {
              "@id": "https://w3id.org/security#signature",
              "@type": "@id",
            },
          },
        },
      };
    }
    return await mockDocumentLoader(url);
  };
  const doc = {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      contextUrl,
    ],
    id: "https://example.com/1",
    type: "Note",
  };
  const signed = await signJsonLd(doc, rsaPrivateKey2, rsaPublicKey2.id!, {
    contextLoader,
  }) as Record<string, unknown>;
  assertEquals(signed["@context"], doc["@context"]);
  const key = await verifySignature(signed, {
    documentLoader: mockDocumentLoader,
    contextLoader,
  });
  assertEquals(key, rsaPublicKey2);
});

const document = {
  "@context": [
    "https://www.w3.org/ns/activitystreams",
    {
      "ostatus": "http://ostatus.org#",
      "atomUri": "ostatus:atomUri",
      "inReplyToAtomUri": "ostatus:inReplyToAtomUri",
      "conversation": "ostatus:conversation",
      "sensitive": "as:sensitive",
      "toot": "http://joinmastodon.org/ns#",
      "votersCount": "toot:votersCount",
    },
  ],
  "id":
    "https://activitypub.academy/users/brauca_darradiul/statuses/113125611605598678/activity",
  "type": "Create",
  "actor": "https://activitypub.academy/users/brauca_darradiul",
  "published": "2024-09-12T16:50:45Z",
  "to": [
    "https://www.w3.org/ns/activitystreams#Public",
  ],
  "cc": [
    "https://activitypub.academy/users/brauca_darradiul/followers",
  ],
  "object": {
    "id":
      "https://activitypub.academy/users/brauca_darradiul/statuses/113125611605598678",
    "type": "Note",
    "summary": null,
    "inReplyTo": null,
    "published": "2024-09-12T16:50:45Z",
    "url": "https://activitypub.academy/@brauca_darradiul/113125611605598678",
    "attributedTo": "https://activitypub.academy/users/brauca_darradiul",
    "to": [
      "https://www.w3.org/ns/activitystreams#Public",
    ],
    "cc": [
      "https://activitypub.academy/users/brauca_darradiul/followers",
    ],
    "sensitive": false,
    "atomUri":
      "https://activitypub.academy/users/brauca_darradiul/statuses/113125611605598678",
    "inReplyToAtomUri": null,
    "conversation":
      "tag:activitypub.academy,2024-09-12:objectId=187606:objectType=Conversation",
    "content": "<p>Test</p>",
    "contentMap": {
      "en": "<p>Test</p>",
    },
    "attachment": [],
    "tag": [],
    "replies": {
      "id":
        "https://activitypub.academy/users/brauca_darradiul/statuses/113125611605598678/replies",
      "type": "Collection",
      "first": {
        "type": "CollectionPage",
        "next":
          "https://activitypub.academy/users/brauca_darradiul/statuses/113125611605598678/replies?only_other_accounts=true&page=true",
        "partOf":
          "https://activitypub.academy/users/brauca_darradiul/statuses/113125611605598678/replies",
        "items": [],
      },
    },
  },
};

const signature = {
  "type": "RsaSignature2017",
  "creator": "https://activitypub.academy/users/brauca_darradiul#main-key",
  "created": "2024-09-12T16:50:46Z",
  "signatureValue":
    "osp9n4Pubp8XFvBi0iwrpCjDkIpuuUr2klp+r8Jp289ISqRNlUPeHVvNrQSE2vqNm4j/cJGuQruIqZPTAmTjjB3HtqgawoAG11DA7OPpY6mJLruKnbqadV1cy5V0DJI9CRJXEBuEmMTJRO9gi1cyzlM4QxK30YrjmtQNLoU9th97da4lumsl+a5cAue38MDuJZvLWDOTZ1EGixwhLP8FevdnZ+jqwctGu9KrgDImBIpBkQaqHFTTGrbE7FlXsj1pneOUQTuRDa9zlk2DmgXeEBWN2OJZDjgJ4iBsF2JHtCn6PccKbuI9s2VLhnobPtLB8YdHYKqIPLmv0UOjAM8XrQ==",
};

const testVector = { ...document, signature };

test("detachSignature()", () => {
  assertEquals(detachSignature(testVector), document);
  assertEquals(detachSignature(document), document);
});

test("verifySignature()", async () => {
  const doc = { ...testVector };
  const key = await verifySignature(doc, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  assertEquals(doc, testVector);
  assertEquals(
    key,
    await CryptographicKey.fromJsonLd({
      "@context": [
        "https://www.w3.org/ns/activitystreams",
        "https://w3id.org/security/v1",
      ],
      id: "https://activitypub.academy/users/brauca_darradiul#main-key",
      owner: "https://activitypub.academy/users/brauca_darradiul",
      publicKeyPem:
        "-----BEGIN PUBLIC KEY----- MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA5W/9rYXddIjKo9Ury/LK XqQYbj0cOx/c+T1uRHJzced8JbvXdiBCNZXVVrIaygy3G/MOvxMW4kbA1bqeiSYY V9TXBMI6gVVDnl5VG64uGxswcvUWqQU5Q1mwuwyGCPhexAq3BKe/7uH64AZgx11e KLl3W3WcIMKmunYn8+z6hm0003hMensXMNpMVfqLoXaeuro7pYnwOSWoHFS3AxWK llMwAoa5waulgai8gD7/uA5Y9Hvguk/OBYBh9YnIX5N5jScsmY/EYuesNIH2Ct9s E3aVkTjZUt55JtXnk8Q9eTnrcB/98RtLWH4pJTKJhzxv19i3aZT3yDApPk0Q/biI JQIDAQAB -----END PUBLIC KEY----- ",
    }),
  );

  // Test invalid signature (wrong base64):
  const doc2 = {
    ...testVector,
    signature: { ...testVector.signature, signatureValue: "!" },
  };
  const key2 = await verifySignature(doc2, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  assertEquals(doc2, {
    ...testVector,
    signature: { ...testVector.signature, signatureValue: "!" },
  });
  assertEquals(key2, null);

  // Test incorrect signature:
  const incorrectSig = encodeBase64(new Uint8Array([1, 2, 3, 4]));
  const doc3 = {
    ...testVector,
    signature: { ...testVector.signature, signatureValue: incorrectSig },
  };
  const key3 = await verifySignature(doc3, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  assertEquals(doc3, {
    ...testVector,
    signature: { ...testVector.signature, signatureValue: incorrectSig },
  });
  assertEquals(key3, null);

  // Test outdated key cache:
  const doc4 = { ...testVector };
  const key4 = await verifySignature(doc4, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
    keyCache: {
      async get(keyId: URL) {
        return new CryptographicKey({
          id: keyId,
          owner: new URL("https://activitypub.academy/users/brauca_darradiul"),
          publicKey:
            (await generateCryptoKeyPair("RSASSA-PKCS1-v1_5")).publicKey,
        });
      },
      set(_keyId: URL, _key: CryptographicKey) {
        return Promise.resolve();
      },
    },
  });
  assertEquals(doc4, testVector);
  assertEquals(key4, key);
});

test("verifyJsonLd()", async () => {
  const verified = await verifyJsonLd(testVector, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  assert(verified);

  const doc = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: "https://example.com/1",
    type: "Create",
    actor: "https://example.com/person2",
  };
  // rsaPublicKey2 has no owner
  const signed = await signJsonLd(doc, rsaPrivateKey2, rsaPublicKey2.id!, {
    contextLoader: mockDocumentLoader,
  });
  const verified2 = await verifyJsonLd(signed, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  assertFalse(verified2);
});

test("verifyJsonLd() tolerates unmapped document and signature properties", async () => {
  const options = {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  };
  const canonize = (input: unknown) =>
    jsonld.canonize(input, {
      format: "application/n-quads",
      documentLoader: mockDocumentLoader,
      safe: false,
    });
  // Keep the captured Mastodon signature: these added properties contribute
  // nothing to the signed graph, independently of Fedify's signing code.
  const withQuote = {
    ...document,
    object: { ...document.object, quoteUri: "https://example.com/quoted" },
  };
  const sigOptions = {
    "@context": "https://w3id.org/identity/v1",
    creator: signature.creator,
    created: signature.created,
  };
  const extraOption = { quoteUri: "https://example.com/quoted" };
  assertEquals(await canonize(withQuote), await canonize(document));
  assertEquals(
    await canonize({ ...sigOptions, ...extraOption }),
    await canonize(sigOptions),
  );
  for (const input of [withQuote, { ...sigOptions, ...extraOption }]) {
    await assertRejects(
      () =>
        jsonld.canonize(input, {
          format: "application/n-quads",
          documentLoader: mockDocumentLoader,
          safe: true,
        }),
      Error,
      "Safe mode validation error.",
    );
  }
  const expectedKey = await verifySignature(testVector, options);
  assertInstanceOf(expectedKey, CryptographicKey);
  for (
    const signed of [
      { ...withQuote, signature },
      { ...document, signature: { ...signature, ...extraOption } },
      { ...withQuote, signature: { ...signature, ...extraOption } },
    ]
  ) {
    assertEquals(await verifySignature(signed, options), expectedKey);
    assert(await verifyJsonLd(signed, options));
  }
  const tampered = {
    ...withQuote,
    object: { ...withQuote.object, content: "<p>Forged</p>" },
    signature,
  };
  assertEquals(await verifySignature(tampered, options), null);
  assertFalse(await verifyJsonLd(tampered, options));
});

test("verifyJsonLd() rejects relative IRIs despite unmapped properties", async () => {
  const options = {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  };
  const canonize = (input: unknown) =>
    jsonld.canonize(input, {
      format: "application/n-quads",
      documentLoader: mockDocumentLoader,
      safe: false,
    });
  const withRelativeUrl = {
    ...document,
    object: { ...document.object, url: [document.object.url, "/evil"] },
  };
  // RDF drops the relative URL, but the vocabulary parser resolves it.  A
  // blanket safe:false would authenticate this altered interpretation.
  const activity = await Create.fromJsonLd(withRelativeUrl, options);
  const note = await activity.getObject(options);
  assertInstanceOf(note, Note);
  assertEquals(note.urls.map((url) => url instanceof URL ? url.href : null), [
    document.object.url,
    "https://activitypub.academy/evil",
  ]);
  for (
    const input of [
      withRelativeUrl,
      { ...document, "https://example.com/extension": { "@id": "relative" } },
    ]
  ) {
    assertEquals(await canonize(input), await canonize(document));
    for (const extra of [{}, { quoteUri: "https://example.com/quoted" }]) {
      const signed = { ...input, ...extra, signature };
      assertEquals(await verifySignature(signed, options), null);
      assertFalse(await verifyJsonLd(signed, options));
    }
  }
  // A mapped option with a relative value is dropped from the options graph
  // too, but must remain rejected alongside an unmapped option.
  const relativeOptions = {
    ...testVector,
    signature: {
      ...signature,
      nonce: { "@id": "relative" },
      quoteUri: "https://example.com/quoted",
    },
  };
  const sigOptions = {
    "@context": "https://w3id.org/identity/v1",
    creator: signature.creator,
    created: signature.created,
  };
  assertEquals(
    await canonize({
      ...sigOptions,
      nonce: relativeOptions.signature.nonce,
      quoteUri: relativeOptions.signature.quoteUri,
    }),
    await canonize(sigOptions),
  );
  assertEquals(await verifySignature(relativeOptions, options), null);
  assertFalse(await verifyJsonLd(relativeOptions, options));
});

test("signing still rejects unmapped properties", async () => {
  const input = { ...document, quoteUri: "https://example.com/quoted" };
  const options = { contextLoader: mockDocumentLoader };
  await assertRejects(
    () => createSignature(input, rsaPrivateKey3, rsaPublicKey3.id!, options),
    Error,
    "Safe mode validation error.",
  );
  await assertRejects(
    () => signJsonLd(input, rsaPrivateKey3, rsaPublicKey3.id!, options),
    Error,
    "Safe mode validation error.",
  );
});

test("verification still rejects malformed JSON-LD", async () => {
  const malformed = { ...testVector, "@context": 42 };
  const options = {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  };
  assertEquals(await verifySignature(malformed, options), null);
  const error = await assertRejects(
    () => verifyJsonLd(malformed, options),
    Error,
  );
  assertEquals(error.name, "jsonld.SyntaxError");
});

test("Linked Data verification without created", async (t) => {
  const options = {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  };
  await t.step("verifies the independently signed options", async () => {
    assertFalse(hasSignature(ldSignatureWithoutCreated));
    assertEquals(
      await verifySignature(ldSignatureWithoutCreated, options),
      rsaPublicKey3,
    );
    assert(await verifyJsonLd(ldSignatureWithoutCreated, options));
  });
  await t.step(
    "uses normalization contexts with a restrictive loader",
    async () => {
      assert(
        await verifyJsonLd(ldSignatureWithoutCreated, {
          ...options,
          contextLoader: async (url) => {
            if (
              url !== "https://w3id.org/security/v1" &&
              url !== "https://w3id.org/security/data-integrity/v1"
            ) return await mockDocumentLoader(url);
            throw new Error(`Unexpected context: ${url}`);
          },
        }),
      );
    },
  );
  await t.step(
    "rejects tampering with the signed timestamp or content",
    async () => {
      const inserted = {
        ...ldSignatureWithoutCreated,
        signature: {
          ...ldSignatureWithoutCreated.signature,
          created: "2024-09-12T16:50:46Z",
        },
      };
      const removed = structuredClone(testVector);
      Reflect.deleteProperty(removed.signature, "created");
      const changed = structuredClone(testVector);
      changed.signature.created = "2024-09-13T16:50:46Z";
      const changedContent = structuredClone(ldSignatureWithoutCreated);
      changedContent.object.content = "tampered";
      for (const doc of [inserted, removed, changed, changedContent]) {
        assertEquals(await verifySignature(doc, options), null);
        assertFalse(await verifyJsonLd(doc, options));
      }
    },
  );
  await t.step("still rejects graph restructuring", async () => {
    const { signature, ...document } = ldSignatureWithoutCreated;
    await assertRejects(
      () =>
        verifyJsonLd({
          "@context": document["@context"],
          "@graph": [document],
          signature,
        }, options),
      UnsafeJsonLdError,
      "Unsupported JSON-LD keyword: @graph.",
    );
  });
});

test("Linked Data verification distinguishes malformed and absent signatures", async () => {
  const signature = {
    type: "RsaSignature2017",
    creator: "https://example.com/private-creator-sentinel#key",
    signatureValue: "private-signature-sentinel",
  };
  assert(hasVerifiableSignature({ signature }));
  assertFalse(hasSignature({ signature }));
  for (const created of ["2024-09-12T16:50:46Z", "not a date", ""]) {
    const doc = { signature: { ...signature, created } };
    assert(hasVerifiableSignature(doc));
    assert(hasSignature(doc));
  }
  const malformed: unknown[] = [
    null,
    [],
    "signature",
    {},
    { ...signature, type: "OtherSignature" },
    { ...signature, type: ["RsaSignature2017"] },
    { ...signature, creator: {} },
    { ...signature, signatureValue: 1 },
    ...[undefined, null, 123, {}, []].map((created) => ({
      ...signature,
      created,
    })),
  ];
  const records: LogRecord[] = [];
  await configure({
    sinks: { buffer: (record) => records.push(record) },
    loggers: [
      {
        category: ["fedify", "sig", "ld"],
        sinks: ["buffer"],
        lowestLevel: "debug",
      },
      { category: ["logtape", "meta"], sinks: [] },
    ],
    reset: true,
  });
  let keyLoads = 0;
  const options = {
    documentLoader: (url: string) => {
      keyLoads++;
      return mockDocumentLoader(url);
    },
    contextLoader: mockDocumentLoader,
  };
  try {
    for (const value of malformed) {
      const doc = { signature: value };
      assertFalse(hasVerifiableSignature(doc));
      assertEquals(await verifySignature(doc, options), null);
    }
    assertEquals(keyLoads, 0);
    assertEquals(records.length, malformed.length);
    for (const record of records) {
      assertEquals(record.level, "debug");
      assertFalse(JSON.stringify(record).includes(signature.creator));
      assertFalse(JSON.stringify(record).includes(signature.signatureValue));
    }
    assertEquals(records.at(-1)?.properties, {
      signatureKind: "object",
      signatureProperties: ["created", "creator", "signatureValue", "type"],
      signaturePropertyCount: 4,
    });
    for (const absent of [null, [], 1, {}, { type: "Create" }]) {
      assertEquals(await verifySignature(absent, options), null);
      assertFalse(hasVerifiableSignature(absent));
      assertEquals(describeSignatureShape(absent), null);
    }
    assertEquals(records.length, malformed.length);
    // A parseable malformed signature also gets one diagnostic through the API.
    assertFalse(
      await verifyJsonLd({
        ...ldSignatureWithoutCreated,
        signature: { ...signature, created: 123 },
      }, options),
    );
    assertEquals(records.length, malformed.length + 1);
    assertEquals(keyLoads, 0);
  } finally {
    await reset();
  }
  const manyProperties = globalThis.Object.fromEntries(
    Array.from(
      { length: 30 },
      (_, i) => [`field${i}`.padEnd(200, "x"), "secret"],
    ),
  );
  const shape = describeSignatureShape({ signature: manyProperties });
  assertEquals(shape?.signaturePropertyCount, 30);
  assertEquals(shape?.signatureProperties.length, 20);
  assert(shape?.signatureProperties.every((name) => name.length === 80));
  assertEquals(
    describeSignatureShape({ signature: null })?.signatureKind,
    "null",
  );
  assertEquals(
    describeSignatureShape({ signature: [] })?.signatureKind,
    "array",
  );
});

test("compactJsonLd() with restrictive context loader", async () => {
  const restrictiveContextLoader = async (resource: string) => {
    const url = new URL(resource).href;
    if (
      url === "https://www.w3.org/ns/activitystreams" ||
      url === "https://w3id.org/identity/v1"
    ) {
      return await mockDocumentLoader(url);
    }
    throw new Error(`Unexpected context: ${url}`);
  };
  const doc = {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/identity/v1",
      "https://w3id.org/security/v1",
      "https://w3id.org/security/data-integrity/v1",
    ],
    id: "https://example.com/1",
    type: "Create",
    actor: "https://example.com/person2",
  };
  const signed = await signJsonLd(doc, rsaPrivateKey3, rsaPublicKey3.id!, {
    contextLoader: mockDocumentLoader,
  });
  const compacted = await compactJsonLd(signed, restrictiveContextLoader);
  assertEquals(compacted, {
    "@context": [
      "https://w3id.org/identity/v1",
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/v1",
      "https://w3id.org/security/data-integrity/v1",
    ],
    id: "https://example.com/1",
    type: "Create",
    actor: "https://example.com/person2",
    signature: signed.signature,
  });
});

test(
  "compactJsonLd() caches repeated remote contexts across graph scan and compaction",
  async () => {
    const remoteUrl = "https://example.com/context";
    let calls = 0;
    const countingLoader = async (resource: string) => {
      const url = new URL(resource).href;
      if (url === remoteUrl) {
        calls++;
        return {
          contextUrl: null,
          documentUrl: url,
          document: {
            "@context": {
              extra: "https://example.com/extra",
            },
          },
        };
      }
      return await mockDocumentLoader(url);
    };
    await compactJsonLd(
      {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: "https://example.com/activities/remote-contexts",
        type: "Create",
        actor: "https://example.com/person2",
        object: [
          {
            "@context": [
              "https://www.w3.org/ns/activitystreams",
              remoteUrl,
            ],
            type: "Note",
            content: "one",
          },
          {
            "@context": [
              "https://www.w3.org/ns/activitystreams",
              remoteUrl,
            ],
            type: "Note",
            content: "two",
          },
          {
            "@context": [
              "https://www.w3.org/ns/activitystreams",
              remoteUrl,
            ],
            type: "Note",
            content: "three",
          },
        ],
      },
      countingLoader,
    );
    // The normalization loader is request-scoped and memoized, so the
    // pre-compaction safety scan and jsonld.compact() should both reuse the
    // same fetched remote context payload.
    assertEquals(calls, 1);
  },
);

test(
  "compactJsonLd() reuses the same remote context response for graph scan and compaction",
  async () => {
    const remoteUrl = "https://example.com/context";
    let calls = 0;
    const compacted = await compactJsonLd(
      {
        "@context": [
          remoteUrl,
          "https://www.w3.org/ns/activitystreams",
        ],
        id: "https://example.com/activities/memoized-remote-context",
        type: "Create",
        actor: "https://example.com/person2",
        graph: "https://example.com/custom-graph",
        object: "https://example.com/notes/1",
      },
      async (resource: string) => {
        const url = new URL(resource).href;
        if (url === remoteUrl) {
          calls++;
          if (calls > 1) {
            throw new Error(
              `Remote context should not be fetched twice: ${url}`,
            );
          }
          return {
            contextUrl: null,
            documentUrl: url,
            document: {
              "@context": {
                graph: "https://example.com/graph",
              },
            },
          };
        }
        return await mockDocumentLoader(url);
      },
    );
    assertEquals(calls, 1);
    assertEquals(compacted, {
      "@context": [
        "https://w3id.org/identity/v1",
        "https://www.w3.org/ns/activitystreams",
        "https://w3id.org/security/v1",
        "https://w3id.org/security/data-integrity/v1",
      ],
      id: "https://example.com/activities/memoized-remote-context",
      type: "Create",
      actor: "https://example.com/person2",
      "https://example.com/graph": "https://example.com/custom-graph",
      object: "https://example.com/notes/1",
    });
  },
);

test(
  "compactJsonLd() preserves opaque top-level ids and resolves relative " +
    "remote contexts against documentUrl during graph scan",
  async () => {
    const rootContextId = "opaque-root";
    const rootContextUrl = "https://example.com/contexts/root";
    const childContextUrl = "https://example.com/contexts/child";
    const calls: string[] = [];
    const customLoader = async (resource: string) => {
      calls.push(resource);
      if (resource === rootContextId) {
        return {
          contextUrl: null,
          documentUrl: rootContextUrl,
          document: {
            "@context": {
              "@import": "./child",
              ext: "https://example.com/ext",
            },
          },
        };
      }
      if (resource === childContextUrl || resource === "child") {
        return {
          contextUrl: null,
          documentUrl: childContextUrl,
          document: {
            "@context": {
              child: "https://example.com/child",
            },
          },
        };
      }
      return await mockDocumentLoader(resource);
    };
    const compacted = await compactJsonLd(
      {
        "@context": [
          rootContextId,
          "https://www.w3.org/ns/activitystreams",
        ],
        id: "https://example.com/activities/custom-loader-contexts",
        type: "Create",
        actor: "https://example.com/person2",
        ext: "preserve-me",
        object: {
          type: "Note",
          content: "Hello",
        },
      },
      customLoader,
    );
    assertEquals(compacted, {
      "@context": [
        "https://w3id.org/identity/v1",
        "https://www.w3.org/ns/activitystreams",
        "https://w3id.org/security/v1",
        "https://w3id.org/security/data-integrity/v1",
      ],
      id: "https://example.com/activities/custom-loader-contexts",
      type: "Create",
      actor: "https://example.com/person2",
      "https://example.com/ext": "preserve-me",
      object: {
        type: "Note",
        content: "Hello",
      },
    });
    assert(calls.includes(rootContextId));
    assert(calls.includes(childContextUrl));
    assertFalse(calls.includes("./child"));
  },
);

test(
  "compactJsonLd() preserves base URLs for property-scoped remote contexts",
  async () => {
    const rootContextId = "opaque-root";
    const rootContextUrl = "https://example.com/contexts/root";
    const childContextUrl = "https://example.com/contexts/child";
    const calls: string[] = [];
    const customLoader = async (resource: string) => {
      calls.push(resource);
      if (resource === rootContextId) {
        return {
          contextUrl: null,
          documentUrl: rootContextUrl,
          document: {
            "@context": {
              p: {
                "@id": "https://example.com/p",
                "@context": "./child",
              },
            },
          },
        };
      }
      if (resource === childContextUrl) {
        return {
          contextUrl: null,
          documentUrl: childContextUrl,
          document: {
            "@context": {
              nested: "https://example.com/nested",
            },
          },
        };
      }
      return await mockDocumentLoader(resource);
    };
    const compacted = await compactJsonLd(
      {
        "@context": [
          rootContextId,
          "https://www.w3.org/ns/activitystreams",
        ],
        id: "https://example.com/activities/property-scoped-contexts",
        type: "Create",
        actor: "https://example.com/person2",
        p: {
          nested: "value",
        },
        object: "https://example.com/notes/1",
      },
      customLoader,
    );
    assertEquals(compacted, {
      "@context": [
        "https://w3id.org/identity/v1",
        "https://www.w3.org/ns/activitystreams",
        "https://w3id.org/security/v1",
        "https://w3id.org/security/data-integrity/v1",
      ],
      id: "https://example.com/activities/property-scoped-contexts",
      type: "Create",
      actor: "https://example.com/person2",
      "https://example.com/p": {
        "https://example.com/nested": "value",
      },
      object: "https://example.com/notes/1",
    });
    assert(calls.includes(rootContextId));
    assert(calls.includes(childContextUrl));
    assertFalse(calls.includes("./child"));
  },
);

test("compactJsonLd() ignores unsafe-looking keys inside @json values", async () => {
  const remoteContextUrl = "https://example.com/contexts/json";
  const compacted = await compactJsonLd(
    {
      "@context": [
        remoteContextUrl,
        "https://www.w3.org/ns/activitystreams",
      ],
      id: "https://example.com/activities/json-blob",
      type: "Create",
      actor: "https://example.com/person2",
      blob: {
        graph: {
          nested: true,
        },
        "@reverse": {
          nope: true,
        },
        "@included": [
          {
            still: "raw-json",
          },
        ],
      },
      object: "https://example.com/notes/1",
    },
    async (resource: string) => {
      const url = new URL(resource).href;
      if (url === remoteContextUrl) {
        return {
          contextUrl: null,
          documentUrl: url,
          document: {
            "@context": {
              blob: {
                "@id": "https://example.com/blob",
                "@type": "@json",
              },
              graph: "@graph",
            },
          },
        };
      }
      return await mockDocumentLoader(url);
    },
  );
  assertEquals(compacted, {
    "@context": [
      "https://w3id.org/identity/v1",
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/v1",
      "https://w3id.org/security/data-integrity/v1",
    ],
    id: "https://example.com/activities/json-blob",
    type: "Create",
    "https://example.com/blob": {
      type: "@json",
      "@value": {
        graph: {
          nested: true,
        },
        "@reverse": {
          nope: true,
        },
        "@included": [
          {
            still: "raw-json",
          },
        ],
      },
    },
    actor: "https://example.com/person2",
    object: "https://example.com/notes/1",
  });
});

test(
  "compactJsonLd() ignores unsafe-looking keys inside inline @json value wrappers",
  async () => {
    const remoteContextUrl = "https://example.com/contexts/inline-json";
    const compacted = await compactJsonLd(
      {
        "@context": [
          remoteContextUrl,
          "https://www.w3.org/ns/activitystreams",
        ],
        id: "https://example.com/activities/inline-json-blob",
        type: "Create",
        actor: "https://example.com/person2",
        blob: {
          "@value": {
            graph: {
              nested: true,
            },
            "@reverse": {
              nope: true,
            },
            "@included": [
              {
                still: "raw-json",
              },
            ],
          },
          "@type": "@json",
        },
        object: "https://example.com/notes/1",
      },
      async (resource: string) => {
        const url = new URL(resource).href;
        if (url === remoteContextUrl) {
          return {
            contextUrl: null,
            documentUrl: url,
            document: {
              "@context": {
                blob: "https://example.com/blob",
                graph: "@graph",
              },
            },
          };
        }
        return await mockDocumentLoader(url);
      },
    );
    assertEquals(compacted, {
      "@context": [
        "https://w3id.org/identity/v1",
        "https://www.w3.org/ns/activitystreams",
        "https://w3id.org/security/v1",
        "https://w3id.org/security/data-integrity/v1",
      ],
      id: "https://example.com/activities/inline-json-blob",
      type: "Create",
      "https://example.com/blob": {
        type: "@json",
        "@value": {
          graph: {
            nested: true,
          },
          "@reverse": {
            nope: true,
          },
          "@included": [
            {
              still: "raw-json",
            },
          ],
        },
      },
      actor: "https://example.com/person2",
      object: "https://example.com/notes/1",
    });
  },
);

test("verifyJsonLd() respects @graph alias overrides", async () => {
  const doc = {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      { graph: "@graph" },
      { graph: "https://example.com/graph" },
    ],
    id: "https://example.com/activities/1",
    type: "Create",
    actor: "https://example.com/person2",
    object: "https://example.com/notes/1",
    graph: "https://example.com/custom-graph",
  };
  const signed = await signJsonLd(doc, rsaPrivateKey3, rsaPublicKey3.id!, {
    contextLoader: mockDocumentLoader,
  });
  const verified = await verifyJsonLd(signed, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  assert(verified);
});

test("compactJsonLd() respects nested @context scope for @graph aliases", async () => {
  const doc = {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      {
        graph: "https://example.com/graph",
        meta: {
          "@id": "https://example.com/meta",
          "@context": { graph: "@graph" },
        },
      },
    ],
    id: "https://example.com/activities/2",
    type: "Create",
    actor: "https://example.com/person2",
    object: "https://example.com/notes/2",
    graph: "https://example.com/custom-graph",
    meta: { value: "ok" },
  };
  const compacted = await compactJsonLd(doc, mockDocumentLoader);
  assertEquals(compacted, {
    "@context": [
      "https://w3id.org/identity/v1",
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/v1",
      "https://w3id.org/security/data-integrity/v1",
    ],
    id: "https://example.com/activities/2",
    type: "Create",
    "https://example.com/graph": "https://example.com/custom-graph",
    actor: "https://example.com/person2",
    object: "https://example.com/notes/2",
    "https://example.com/meta": { value: "ok" },
  });
});

test("compactJsonLd() resets inherited @graph aliases on @context: null", async () => {
  const doc = {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      { g: "@graph" },
    ],
    id: "https://example.com/activities/3",
    type: "Create",
    actor: "https://example.com/person2",
    object: {
      "@context": null,
      g: "literal",
    },
  };
  const compacted = await compactJsonLd(doc, mockDocumentLoader);
  assertEquals(compacted, {
    "@context": [
      "https://w3id.org/identity/v1",
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/v1",
      "https://w3id.org/security/data-integrity/v1",
    ],
    id: "https://example.com/activities/3",
    type: "Create",
    actor: "https://example.com/person2",
    object: {},
  });
});

test("compactJsonLd() rejects same-object forward @graph alias chains", async () => {
  await assertRejects(
    () =>
      compactJsonLd(
        {
          "@context": [
            "https://www.w3.org/ns/activitystreams",
            { a: "b", b: "@graph" },
          ],
          id: "https://example.com/activities/forward-graph-alias",
          type: "Create",
          actor: "https://example.com/person2",
          a: [
            {
              id: "https://example.com/notes/forward-graph-alias",
              type: "Note",
              content: "Hello",
            },
          ],
        },
        mockDocumentLoader,
      ),
    UnsafeJsonLdError,
    "Unsupported JSON-LD keyword: @graph.",
  );
});

test("compactJsonLd() preserves captured @graph aliases across later overrides", async () => {
  await assertRejects(
    () =>
      compactJsonLd(
        {
          "@context": [
            "https://www.w3.org/ns/activitystreams",
            { b: "@graph" },
            { a: "b" },
            { b: "https://example.com/b" },
          ],
          id: "https://example.com/activities/captured-graph-alias",
          type: "Create",
          actor: "https://example.com/person2",
          a: [
            {
              id: "https://example.com/notes/captured-graph-alias",
              type: "Note",
              content: "Hello",
            },
          ],
        },
        mockDocumentLoader,
      ),
    UnsafeJsonLdError,
    "Unsupported JSON-LD keyword: @graph.",
  );
});

test("compactJsonLd() does not retroactively apply later @graph aliases", async () => {
  const compacted = await compactJsonLd(
    {
      "@context": [
        "https://www.w3.org/ns/activitystreams",
        { a: "b" },
        { b: "@graph" },
      ],
      id: "https://example.com/activities/non-retroactive-graph-alias",
      type: "Create",
      actor: "https://example.com/person2",
      a: [
        {
          id: "https://example.com/notes/non-retroactive-graph-alias",
          type: "Note",
          content: "Hello",
        },
      ],
    },
    mockDocumentLoader,
  );
  assertEquals(compacted, {
    "@context": [
      "https://w3id.org/identity/v1",
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/v1",
      "https://w3id.org/security/data-integrity/v1",
    ],
    id: "https://example.com/activities/non-retroactive-graph-alias",
    type: "Create",
    b: {
      id: "https://example.com/notes/non-retroactive-graph-alias",
      type: "Note",
      content: "Hello",
    },
    actor: "https://example.com/person2",
  });
});

test("verifyJsonLd() rejects unsafe JSON-LD keywords", async () => {
  const original = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: "https://example.com/activities/undo",
    type: "Undo",
    actor: "https://example.com/person2",
    object: {
      id: "https://example.com/activities/announce",
      type: "Announce",
      actor: "https://example.com/person2",
      object: "https://example.com/status/1",
    },
  };
  const signed = await signJsonLd(
    original,
    rsaPrivateKey3,
    rsaPublicKey3.id!,
    { contextLoader: mockDocumentLoader },
  );
  const options = {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  };
  const cases: [string, unknown][] = [
    [
      "@reverse",
      {
        "@context": [
          "https://www.w3.org/ns/activitystreams",
          { rev: "@reverse" },
        ],
        id: "https://example.com/activities/announce",
        type: "Announce",
        actor: "https://example.com/person2",
        object: "https://example.com/status/1",
        rev: {
          object: {
            id: "https://example.com/activities/undo",
            type: "Undo",
            actor: "https://example.com/person2",
          },
        },
        signature: signed.signature,
      },
    ],
    [
      "@included",
      {
        "@context": [
          "https://www.w3.org/ns/activitystreams",
          { inc: "@included" },
        ],
        id: "https://example.com/activities/announce",
        type: "Announce",
        actor: "https://example.com/person2",
        object: "https://example.com/status/1",
        inc: [{
          id: "https://example.com/activities/undo",
          type: "Undo",
          actor: "https://example.com/person2",
          object: "https://example.com/activities/announce",
        }],
        signature: signed.signature,
      },
    ],
    [
      "@graph",
      {
        "@context": [
          "https://www.w3.org/ns/activitystreams",
          { graph: "@graph" },
        ],
        graph: [original],
        signature: signed.signature,
      },
    ],
    [
      "@graph",
      {
        "@context": [
          "https://www.w3.org/ns/activitystreams",
          { graph: "@graph" },
        ],
        id: "https://example.com/activities/announce",
        type: "Announce",
        actor: "https://example.com/person2",
        object: "https://example.com/status/1",
        graph: [{
          id: "https://example.com/activities/undo",
          type: "Undo",
          actor: "https://example.com/person2",
          object: "https://example.com/activities/announce",
        }],
        signature: signed.signature,
      },
    ],
  ];

  for (const [keyword, jsonLd] of cases) {
    for (const extra of [{}, { quoteUri: "https://example.com/quoted" }]) {
      await assertRejects(
        () =>
          verifyJsonLd(
            { ...jsonLd as Record<string, unknown>, ...extra },
            options,
          ),
        UnsafeJsonLdError,
        `Unsupported JSON-LD keyword: ${keyword}.`,
      );
    }
  }
});

test(
  "compactJsonLd() rejects unsafe JSON-LD keywords inside signature objects",
  async () => {
    const signed = await signJsonLd(
      {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: "https://example.com/activities/signed-signature-keywords",
        type: "Create",
        actor: "https://example.com/person2",
        object: "https://example.com/notes/1",
      },
      rsaPrivateKey3,
      rsaPublicKey3.id!,
      { contextLoader: mockDocumentLoader },
    );
    const cases: [string, unknown][] = [
      [
        "@reverse",
        {
          object: {
            id: "https://example.com/activities/reverse-inside-signature",
            type: "Undo",
          },
        },
      ],
      [
        "@included",
        [{
          id: "https://example.com/activities/included-inside-signature",
          type: "Undo",
        }],
      ],
      [
        "@graph",
        [{
          id: "https://example.com/activities/graph-inside-signature",
          type: "Undo",
        }],
      ],
    ];

    for (const [keyword, value] of cases) {
      await assertRejects(
        () =>
          compactJsonLd(
            {
              ...signed,
              signature: {
                ...signed.signature,
                [keyword]: value,
              },
            },
            mockDocumentLoader,
          ),
        UnsafeJsonLdError,
        `Unsupported JSON-LD keyword: ${keyword}.`,
      );
    }
  },
);

test("compactJsonLd() rejects inputs that compact into @graph wrappers", async () => {
  await assertRejects(
    () =>
      compactJsonLd(
        [
          {
            "@context": "https://www.w3.org/ns/activitystreams",
            id: "https://example.com/notes/graph-wrapper-1",
            type: "Note",
            content: "one",
          },
          {
            "@context": "https://www.w3.org/ns/activitystreams",
            id: "https://example.com/notes/graph-wrapper-2",
            type: "Note",
            content: "two",
          },
        ],
        mockDocumentLoader,
      ),
    UnsafeJsonLdError,
    "Unsupported JSON-LD keyword: @graph.",
  );
});

// cSpell: ignore ostatus

test("verifyJsonLd() rejects a key that claims a forged owner", async () => {
  // Linked Data Signatures clear an activity's attributions with the `owner`
  // the signing key declares about itself, and this path needs no HTTP
  // signature at all.  See GHSA-q9f8-5hc7-898f.
  const keyId = new URL("https://attacker.example/key");
  const impersonated = "https://example.com/person";
  const { publicKeyPem } = await rsaPublicKey2.toJsonLd({
    contextLoader: mockDocumentLoader,
  }) as { publicKeyPem: string };
  const doc = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: "https://attacker.example/activities/1",
    type: "Create",
    actor: impersonated,
  };
  const signed = await signJsonLd(doc, rsaPrivateKey2, keyId, {
    contextLoader: mockDocumentLoader,
  });
  const serveKeyOwnedBy = (owner: string) => (resource: string) => {
    if (resource === keyId.href) {
      return Promise.resolve({
        contextUrl: null,
        documentUrl: resource,
        document: {
          "@context": "https://w3id.org/security/v1",
          id: keyId.href,
          type: "CryptographicKey",
          owner,
          publicKeyPem,
        },
      });
    }
    if (resource === "https://attacker.example/actor") {
      return Promise.resolve({
        contextUrl: null,
        documentUrl: resource,
        document: {
          "@context": [
            "https://www.w3.org/ns/activitystreams",
            "https://w3id.org/security/v1",
          ],
          id: resource,
          type: "Person",
          publicKey: [keyId.href],
        },
      });
    }
    return mockDocumentLoader(resource);
  };

  assertEquals(
    await verifySignature(signed, {
      documentLoader: serveKeyOwnedBy(impersonated),
      contextLoader: mockDocumentLoader,
    }),
    null,
  );
  assertFalse(
    await verifyJsonLd(signed, {
      documentLoader: serveKeyOwnedBy(impersonated),
      contextLoader: mockDocumentLoader,
    }),
  );

  // The signature itself is sound: served under an owner that really does
  // link back to the key, the same signature verifies.  What it authenticates
  // is that owner, though, and not the actor the activity claims.
  const honestLoader = serveKeyOwnedBy("https://attacker.example/actor");
  assertInstanceOf(
    await verifySignature(signed, {
      documentLoader: honestLoader,
      contextLoader: mockDocumentLoader,
    }),
    CryptographicKey,
  );
  assertFalse(
    await verifyJsonLd(signed, {
      documentLoader: honestLoader,
      contextLoader: mockDocumentLoader,
    }),
  );
});

test("verifyJsonLd() rejects a key whose owner redirects to another actor", async () => {
  // Alice's actor id redirects to Mallory's document, which lists Mallory's
  // key; the key names Alice as its owner.  An activity by Alice signed with
  // Mallory's key must not verify.  See GHSA-8863-8468-7hq7.
  const keyId = new URL("https://evil.example/keys/1");
  const victim = "https://victim.example/users/alice";
  const mallory = "https://evil.example/users/mallory";
  const { publicKeyPem } = await rsaPublicKey3.toJsonLd({
    contextLoader: mockDocumentLoader,
  }) as { publicKeyPem: string };
  const signed = await signJsonLd(
    {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: "https://victim.example/activities/forged",
      type: "Create",
      actor: victim,
      object: { type: "Note", content: "forged" },
    },
    rsaPrivateKey3,
    keyId,
    { contextLoader: mockDocumentLoader },
  );
  const options = {
    documentLoader(resource: string) {
      if (resource === keyId.href) {
        return Promise.resolve({
          contextUrl: null,
          documentUrl: resource,
          document: {
            "@context": "https://w3id.org/security/v1",
            id: keyId.href,
            type: "CryptographicKey",
            owner: victim,
            publicKeyPem,
          },
        });
      }
      if (resource === victim || resource === mallory) {
        return Promise.resolve({
          contextUrl: null,
          documentUrl: mallory,
          document: {
            "@context": [
              "https://www.w3.org/ns/activitystreams",
              "https://w3id.org/security/v1",
            ],
            id: mallory,
            type: "Person",
            publicKey: keyId.href,
          },
        });
      }
      return mockDocumentLoader(resource);
    },
    contextLoader: mockDocumentLoader,
  };
  assertEquals(await verifySignature(signed, options), null);
  assertFalse(await verifyJsonLd(signed, options));
});
