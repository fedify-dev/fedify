import { test } from "@fedify/fixture";
import { CryptographicKey, Person } from "@fedify/vocab";
import { exportDidKey, parseIri } from "@fedify/vocab-runtime";
import { assert, assertEquals, assertFalse } from "@std/assert";
import { ed25519PublicKey, rsaPublicKey2 } from "../testing/keys.ts";
import {
  attachKeyOwnerEvidence,
  getVerifiedKeyOwnerEvidence,
  parseKeyOwnerEvidence,
  promoteKeyOwnerEvidence,
} from "./key-owner-evidence.ts";
import { getCanonicalPortableId } from "./portable-key-id.ts";

const did = await exportDidKey(ed25519PublicKey.publicKey);
const rawActorId = `ap://${did}/actors/alice`;
const actorId = parseIri(rawActorId);
const keyId = new URL(
  `https://gw.example/.well-known/apgateway/${did}/actors/alice#main-key`,
);
const document = {
  "@id": rawActorId,
  "@type": ["https://www.w3.org/ns/activitystreams#Person"],
  "https://www.w3.org/ns/activitystreams#name": [{ "@value": "Alice" }],
};
const expires = Temporal.Now.instant().add({ hours: 1 });

function createKey(owner: URL = actorId): CryptographicKey {
  // Keys hold the very URLs they are given, which some tests change:
  return new CryptographicKey({
    id: new URL(keyId.href),
    owner: parseIri(owner.href),
    publicKey: rsaPublicKey2.publicKey!,
  });
}

test("getVerifiedKeyOwnerEvidence() only returns promoted evidence", () => {
  const key = createKey();
  assert(attachKeyOwnerEvidence(key, document, expires));
  // The key has not verified any signature yet:
  assertEquals(getVerifiedKeyOwnerEvidence(key), undefined);
  promoteKeyOwnerEvidence(key);
  const evidence = getVerifiedKeyOwnerEvidence(key);
  assertEquals(evidence?.ownerId, getCanonicalPortableId(actorId));
  assertEquals(evidence?.keyId, keyId.href);
  assertEquals(evidence?.expires, expires);
  // A key without evidence is not promoted by accident:
  const other = createKey();
  promoteKeyOwnerEvidence(other);
  assertEquals(getVerifiedKeyOwnerEvidence(other), undefined);
});

test("attachKeyOwnerEvidence() refuses evidence about other actors", () => {
  const otherActorId = parseIri(`ap://${did}/actors/bob`);
  // The key claims another owner than the key ID's actor:
  assertFalse(
    attachKeyOwnerEvidence(createKey(otherActorId), {
      ...document,
      "@id": otherActorId.href,
    }, expires),
  );
  // The document is about another actor than the key's owner:
  assertFalse(
    attachKeyOwnerEvidence(createKey(), {
      ...document,
      "@id": `ap://${did}/actors/bob`,
    }, expires),
  );
  // The document's ID would identify another actor once parsed:
  assertFalse(
    attachKeyOwnerEvidence(createKey(), {
      ...document,
      "@id": `ap://${did}/x/../actors/alice`,
    }, expires),
  );
  assertFalse(attachKeyOwnerEvidence(createKey(), {}, expires));
  assertFalse(attachKeyOwnerEvidence(createKey(), [document], expires));
});

test("getVerifiedKeyOwnerEvidence() ignores expired evidence", () => {
  const key = createKey();
  attachKeyOwnerEvidence(key, document, expires);
  promoteKeyOwnerEvidence(key);
  assert(getVerifiedKeyOwnerEvidence(key, expires.subtract({ seconds: 1 })));
  assertEquals(getVerifiedKeyOwnerEvidence(key, expires), undefined);
});

test("getVerifiedKeyOwnerEvidence() ignores keys changed since", () => {
  const key = createKey();
  attachKeyOwnerEvidence(key, document, expires);
  promoteKeyOwnerEvidence(key);
  // Clones share the URLs of the original key:
  key.clone({}).ownerId!.href = parseIri(`ap://${did}/actors/bob`).href;
  assertEquals(getVerifiedKeyOwnerEvidence(key), undefined);
  // Nor may the owner become another ID of the same actor, e.g., on another
  // gateway:
  const moved = createKey();
  attachKeyOwnerEvidence(moved, document, expires);
  promoteKeyOwnerEvidence(moved);
  moved.ownerId!.href =
    `https://other.example/.well-known/apgateway/${did}/actors/alice`;
  assertEquals(getVerifiedKeyOwnerEvidence(moved), undefined);
  // Nor is a clone the key that was verified:
  const verified = createKey();
  attachKeyOwnerEvidence(verified, document, expires);
  promoteKeyOwnerEvidence(verified);
  assertEquals(getVerifiedKeyOwnerEvidence(verified.clone({})), undefined);
});

test("parseKeyOwnerEvidence() parses a new actor every time", async () => {
  const key = createKey();
  const doc = structuredClone(document);
  attachKeyOwnerEvidence(key, doc, expires);
  promoteKeyOwnerEvidence(key);
  // Changing the document afterwards does not change the evidence:
  doc["@id"] = `ap://${did}/actors/bob`;
  const evidence = getVerifiedKeyOwnerEvidence(key)!;
  const actor = await parseKeyOwnerEvidence(evidence);
  assert(actor instanceof Person);
  assertEquals(actor.id?.href, actorId.href);
  assertEquals(actor.name?.toString(), "Alice");
  actor.id!.href = parseIri(`ap://${did}/actors/bob`).href;
  const again = await parseKeyOwnerEvidence(evidence);
  assertEquals(again?.id?.href, actorId.href);
});
