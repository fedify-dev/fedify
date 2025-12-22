import { CryptographicKey } from "@fedify/vocab";
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
import { generateCryptoKeyPair } from "./key.ts";
import {
  attachSignature,
  createSignature,
  detachSignature,
  type Signature,
  signJsonLd,
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

// cSpell: ignore ostatus
