import { assert } from "@std/assert/assert";
import { assertEquals } from "@std/assert/assert-equals";
import { assertFalse } from "@std/assert/assert-false";
import { assertRejects } from "@std/assert/assert-rejects";
import { assertThrows } from "@std/assert/assert-throws";
import { encodeBase64 } from "byte-encodings/base64";
import { mockDocumentLoader } from "../testing/docloader.ts";
import {
  ed25519Multikey,
  ed25519PrivateKey,
  rsaPrivateKey2,
  rsaPrivateKey3,
  rsaPublicKey2,
  rsaPublicKey3,
} from "../testing/keys.ts";
import { test } from "../testing/mod.ts";
import { CryptographicKey } from "../vocab/vocab.ts";
import { generateCryptoKeyPair } from "./key.ts";
import {
  attachSignature,
  compactJsonLd,
  createSignature,
  detachSignature,
  type Signature,
  signJsonLd,
  UnsafeJsonLdError,
  verifyJsonLd,
  verifySignature,
} from "./ld.ts";

test("attachSignature()", () => {
  const sig: Signature = {
    "@context": "https://w3id.org/identity/v1",
    type: "RsaSignature2017",
    creator: "https://activitypub.academy/users/brauca_darradiul#main-key",
    created: "2024-09-12T16:50:46Z",
    signatureValue: "asdf",
  };
  const doc = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: "https://example.com/1",
  };
  assertEquals(attachSignature(doc, sig), {
    ...doc,
    signature: sig,
  });
  assertThrows(() => attachSignature(null, sig), TypeError);
  assertThrows(() => attachSignature(1234, sig), TypeError);
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
  const verified = await verifyJsonLd(signed, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  assert(verified);
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
    await assertRejects(
      () => verifyJsonLd(jsonLd, options),
      UnsafeJsonLdError,
      `Unsupported JSON-LD keyword: ${keyword}.`,
    );
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
