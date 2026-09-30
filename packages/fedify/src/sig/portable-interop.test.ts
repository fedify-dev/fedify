import { mockDocumentLoader, test } from "@fedify/fixture";
import { Application, DataIntegrityProof, lookupObject } from "@fedify/vocab";
import { assert, assertEquals } from "@std/assert";
import actor from "../../test-vectors/fep-ef61/tootik-v0.25.4/actor.json" with {
  type: "json",
};
import { verifyPortableObjectProof, verifyProof } from "./proof.ts";
import { getKeyOwner } from "./owner.ts";
import { verifyPortableObject } from "./portable-collection.ts";

const options = {
  contextLoader: mockDocumentLoader,
  documentLoader() {
    throw new TypeError("The captured did:key proof must resolve locally");
  },
};

test("tootik v0.25.4 actor has a valid DID proof", async () => {
  const proof = await DataIntegrityProof.fromJsonLd(actor.proof, options);
  const key = await verifyProof(actor, proof, options);
  assert(key != null);
  assertEquals(key.id?.href, actor.proof.verificationMethod);
});

test("tootik v0.25.4 actor proof rejects tampering", async () => {
  const proof = await DataIntegrityProof.fromJsonLd(actor.proof, options);
  assertEquals(
    await verifyProof(
      { ...actor, preferredUsername: "tampered" },
      proof,
      options,
    ),
    null,
  );
});

test("tootik v0.25.4 actor retains its unmapped gateways", async () => {
  const original = structuredClone(actor);
  assertEquals(actor.gateways, ["https://tootik.example"]);
  const parsed = await Application.fromJsonLd(actor, options);
  assertEquals(parsed.id?.href, actor.id);
  assertEquals(parsed.gateways, [new URL("https://tootik.example")]);
  assert((await verifyPortableObjectProof(actor, options)).verified);
  assertEquals(actor, original);
});

const loadedOptions = {
  contextLoader: mockDocumentLoader,
  documentLoader(url: string) {
    assertEquals(url.split("#")[0], actor.id);
    return Promise.resolve({
      document: structuredClone(actor),
      documentUrl: actor.id,
      contextUrl: null,
    });
  },
};

test("tootik v0.25.4 actor can be looked up and own a gateway key", async () => {
  const parsed = await lookupObject(actor.id, {
    ...loadedOptions,
    verifyPortableObject: verifyPortableObjectProof,
  });
  assert(parsed instanceof Application);
  assertEquals(parsed.gateways, [new URL("https://tootik.example")]);
  const owner = await getKeyOwner(new URL(actor.publicKey.id), loadedOptions);
  assert(owner != null);
  assertEquals(owner.id?.href, actor.id);
  assertEquals(owner.gateways, [new URL("https://tootik.example")]);
});

test("tootik v0.25.4 actor authenticates its gateway for collections", async () => {
  // The collection is synthetic; its owner is the unchanged captured actor.
  const result = await verifyPortableObject({
    "@context": "https://www.w3.org/ns/activitystreams",
    id: actor.outbox,
    type: "OrderedCollection",
    attributedTo: actor.id,
    orderedItems: [],
  }, { ...loadedOptions, documentUrl: new URL(actor.outbox) });
  assert(result.verified);
  assertEquals(result.method, "gateway");
  if (result.method === "gateway") {
    assertEquals(result.gateway, new URL("https://tootik.example"));
  }
});

test("tootik v0.25.4 actor rejects tampered gateways", async () => {
  const result = await verifyPortableObjectProof({
    ...actor,
    gateways: ["https://attacker.example"],
  }, options);
  assertEquals(result, {
    verified: false,
    reason: { type: "invalidProof", proofIndex: 0 },
  });
});
