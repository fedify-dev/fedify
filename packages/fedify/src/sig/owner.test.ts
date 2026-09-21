import {
  createTestTracerProvider,
  mockDocumentLoader,
  test,
} from "@fedify/fixture";
import { Create, CryptographicKey, lookupObject } from "@fedify/vocab";
import { assert, assertEquals, assertFalse } from "@std/assert";
import { rsaPublicKey1, rsaPublicKey2 } from "../testing/keys.ts";
import { doesActorOwnKey, getKeyOwner } from "./owner.ts";

test("doesActorOwnKey()", async () => {
  const options = {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  };
  const activity = new Create({ actor: new URL("https://example.com/person") });
  assert(await doesActorOwnKey(activity, rsaPublicKey1, options));
  assert(await doesActorOwnKey(activity, rsaPublicKey2, options));

  const activity2 = new Create({
    actor: new URL("https://example.com/hong-gildong"),
  });
  assertFalse(await doesActorOwnKey(activity2, rsaPublicKey1, options));
  assertFalse(await doesActorOwnKey(activity2, rsaPublicKey2, options));
});

test("getKeyOwner()", async () => {
  const options = {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  };
  const owner = await getKeyOwner(
    new URL("https://example.com/users/handle#main-key"),
    options,
  );
  assertEquals(
    owner,
    await lookupObject("https://example.com/users/handle", options),
  );

  const owner2 = await getKeyOwner(
    new URL("https://example.com/key"),
    options,
  );
  assertEquals(
    owner2,
    await lookupObject("https://example.com/person", options),
  );

  const owner3 = await getKeyOwner(rsaPublicKey1, options);
  assertEquals(owner3, owner2);

  const noOwner = await getKeyOwner(
    new URL("https://example.com/key2"),
    options,
  );
  assertEquals(noOwner, null);

  const noOwner2 = await getKeyOwner(
    new URL("https://example.com/object"),
    options,
  );
  assertEquals(noOwner2, null);
});

test("doesActorOwnKey() records OpenTelemetry span", async () => {
  const [tracerProvider, exporter] = createTestTracerProvider();

  const activity = new Create({
    id: new URL("https://example.com/activity"),
    actor: new URL("https://example.com/person"),
  });

  const key = new CryptographicKey({
    id: new URL("https://example.com/key"),
    owner: new URL("https://example.com/person"),
  });

  const result = await doesActorOwnKey(activity, key, {
    documentLoader: mockDocumentLoader,
    tracerProvider,
  });

  assert(result);

  // Check that the span was recorded
  const spans = exporter.getSpans("activitypub.verify_key_ownership");
  assertEquals(spans.length, 1);
  const span = spans[0];

  // Check span attributes
  assertEquals(
    span.attributes["activitypub.actor.id"],
    "https://example.com/person",
  );
  assertEquals(
    span.attributes["activitypub.key.id"],
    "https://example.com/key",
  );
  assertEquals(span.attributes["activitypub.key_ownership.verified"], true);
  assertEquals(
    span.attributes["activitypub.key_ownership.method"],
    "key_owner",
  );
});

test("doesActorOwnKey() rejects a key that only claims to be owned", async () => {
  const options = {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  };
  // A key document is served by the same host that wrote the `owner` claim
  // inside it, so an attacker can name any actor at all.  The claim only
  // counts once that actor's own document lists the key, which the
  // impersonated actor here does not.  See GHSA-q9f8-5hc7-898f.
  const activity = new Create({ actor: new URL("https://example.com/person") });
  const forgedKey = new CryptographicKey({
    id: new URL("https://attacker.example/key"),
    owner: new URL("https://example.com/person"),
  });
  assertFalse(await doesActorOwnKey(activity, forgedKey, options));

  // The impersonated actor does not even have to be resolvable.
  const unresolvable = new URL("https://impersonated.invalid/users/victim");
  const activity2 = new Create({ actor: unresolvable });
  const forgedKey2 = new CryptographicKey({
    id: new URL("https://attacker.example/key"),
    owner: unresolvable,
  });
  assertFalse(await doesActorOwnKey(activity2, forgedKey2, options));
});

test("doesActorOwnKey() ignores an actor embedded in the activity", async () => {
  const { publicKeyPem } = await rsaPublicKey1.toJsonLd({
    contextLoader: mockDocumentLoader,
  }) as { publicKeyPem: string };
  // The embedded actor shares its origin with the activity's own id, so the
  // vocabulary would hand it over without fetching anything—but it is the
  // sender who wrote it, and the `publicKey` list inside it therefore
  // authenticates nothing.
  const activity = await Create.fromJsonLd({
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/v1",
    ],
    id: "https://example.com/activity",
    type: "Create",
    actor: {
      id: "https://example.com/person",
      type: "Person",
      publicKey: {
        id: "https://attacker.example/key",
        type: "CryptographicKey",
        owner: "https://example.com/person",
        publicKeyPem,
      },
    },
  }, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  assertEquals(activity.actorId, new URL("https://example.com/person"));
  const forgedKey = new CryptographicKey({
    id: new URL("https://attacker.example/key"),
  });
  assertFalse(
    await doesActorOwnKey(activity, forgedKey, {
      documentLoader: mockDocumentLoader,
      contextLoader: mockDocumentLoader,
    }),
  );
});

test("getKeyOwner() rejects an actor document from another origin", async () => {
  const keyId = "https://attacker.example/key";
  const { publicKeyPem } = await rsaPublicKey1.toJsonLd({
    contextLoader: mockDocumentLoader,
  }) as { publicKeyPem: string };
  // Dressing a key document up as somebody else's actor document must not
  // make that somebody the key's owner: only the host serving an actor id
  // can speak for it.  Reached through Context.getSignedKeyOwner(), this
  // would have handed an attacker the identity of any actor on an
  // authorized fetch.
  const options = {
    documentLoader(resource: string) {
      if (resource === keyId) {
        return Promise.resolve({
          contextUrl: null,
          documentUrl: resource,
          document: {
            "@context": [
              "https://www.w3.org/ns/activitystreams",
              "https://w3id.org/security/v1",
            ],
            id: "https://example.com/person",
            type: "Person",
            publicKey: [
              { id: keyId, type: "CryptographicKey", publicKeyPem },
            ],
          },
        });
      }
      return mockDocumentLoader(resource);
    },
    contextLoader: mockDocumentLoader,
  };
  assertEquals(await getKeyOwner(new URL(keyId), options), null);
});

test("doesActorOwnKey() matches a key that leaves its id implicit", async () => {
  const actorId = "https://example.com/implicit-key-actor";
  const { publicKeyPem } = await rsaPublicKey1.toJsonLd({
    contextLoader: mockDocumentLoader,
  }) as { publicKeyPem: string };
  const options = {
    documentLoader(resource: string) {
      if (resource === actorId) {
        return Promise.resolve({
          contextUrl: null,
          documentUrl: resource,
          document: {
            "@context": [
              "https://www.w3.org/ns/activitystreams",
              "https://w3id.org/security/v1",
            ],
            id: actorId,
            type: "Person",
            publicKey: [
              { type: "CryptographicKey", owner: actorId, publicKeyPem },
            ],
          },
        });
      }
      return mockDocumentLoader(resource);
    },
    contextLoader: mockDocumentLoader,
  };
  const activity = new Create({ actor: new URL(actorId) });
  // An actor document may leave its key's id implicit, and then there is no
  // id for the actor to link to; the key material is all the two share.
  assert(
    await doesActorOwnKey(
      activity,
      new CryptographicKey({
        owner: new URL(actorId),
        publicKey: rsaPublicKey1.publicKey!,
      }),
      options,
    ),
  );
  // A key the actor does not carry is still not the actor's, however much it
  // claims otherwise.
  assertFalse(
    await doesActorOwnKey(
      activity,
      new CryptographicKey({
        owner: new URL(actorId),
        publicKey: rsaPublicKey2.publicKey!,
      }),
      options,
    ),
  );
});
