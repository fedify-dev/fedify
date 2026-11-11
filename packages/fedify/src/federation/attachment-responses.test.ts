import { mockDocumentLoader, test } from "@fedify/fixture";
import {
  Note,
  Object as ASObject,
  OrderedCollection,
  PropertyValue,
  Service,
  Update,
} from "@fedify/vocab";
import { assert, assertEquals } from "@std/assert";
import { signObject, verifyProof } from "../sig/proof.ts";
import { ed25519Multikey, ed25519PrivateKey } from "../testing/keys.ts";
import { respondWithObject, respondWithObjectIfAcceptable } from "./handler.ts";
import { MemoryKvStore } from "./kv.ts";
import { createFederation } from "./middleware.ts";

const ACCEPTS = [
  "application/activity+json",
  'application/ld+json; profile="https://www.w3.org/ns/activitystreams"',
];

function profile(count: number): Service {
  return new Service({
    id: new URL("https://example.com/actors/app"),
    preferredUsername: "app",
    attachments: Array.from(
      { length: count },
      (_, i) =>
        new PropertyValue({
          name: `Field ${i}`,
          value: `https://example.com/${i}`,
        }),
    ),
  });
}

function attachmentValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(attachmentValues);
  if (typeof value !== "object" || value == null) return [];
  return Object.entries(value).flatMap(([key, item]) =>
    key === "@context"
      ? []
      : key === "attachment"
      ? [item]
      : attachmentValues(item)
  );
}

test("attachment responses: actor, object, collections and pages negotiate both media types", async () => {
  for (const count of [1, 2]) {
    const actor = profile(count);
    const update = new Update({
      id: new URL("https://example.com/updates/1"),
      actor: actor.id,
      object: actor,
    });
    const federation = createFederation<void>({ kv: new MemoryKvStore() });
    federation.setActorDispatcher("/actors/{identifier}", () => actor);
    federation.setObjectDispatcher(
      Note,
      "/notes/{id}",
      () =>
        new Note({
          attachments: Array.from({ length: count }, () =>
            new Note({ content: "attachment" })),
        }),
    );
    federation.setFollowersDispatcher(
      "/actors/{identifier}/followers",
      () => ({ items: [actor] }),
    );
    federation.setCollectionDispatcher(
      "objects",
      ASObject,
      "/collections/{id}",
      () => ({ items: [update] }),
    );
    federation.setOrderedCollectionDispatcher(
      "ordered",
      ASObject,
      "/ordered/{id}",
      () => ({ items: [update] }),
    );
    for (const accept of ACCEPTS) {
      for (
        const path of [
          "/actors/app",
          "/notes/1",
          "/actors/app/followers",
          "/actors/app/followers?cursor=a",
          "/collections/1",
          "/collections/1?cursor=a",
          "/ordered/1",
          "/ordered/1?cursor=a",
        ]
      ) {
        const response = await federation.fetch(
          new Request(`https://example.com${path}`, {
            headers: { Accept: accept },
          }),
          { contextData: undefined },
        );
        assertEquals(response.status, 200, path);
        assertEquals(
          response.headers.get("Content-Type"),
          "application/activity+json",
        );
        assertEquals(response.headers.get("Vary"), "Accept");
        const values = attachmentValues(await response.json());
        assert(values.length > 0, path);
        for (const value of values) {
          assert(Array.isArray(value), path);
          assertEquals(
            value.length,
            count,
            path,
          );
        }
      }
    }
  }
});

test("attachment responses: helpers normalize without changing the vocabulary cache", async () => {
  const json = await profile(1).toJsonLd();
  const actor = await Service.fromJsonLd(json, {
    contextLoader: mockDocumentLoader,
  });
  const before = structuredClone(await actor.toJsonLd());
  for (const options of [undefined, { contextLoader: mockDocumentLoader }]) {
    const response = await respondWithObject(actor, options);
    assert(
      Array.isArray(
        ((await response.json()) as Record<string, unknown>).attachment,
      ),
    );
    for (const accept of ACCEPTS) {
      const acceptable = await respondWithObjectIfAcceptable(
        actor,
        new Request("https://example.com/", { headers: { Accept: accept } }),
        options,
      );
      assert(acceptable != null);
      assert(
        Array.isArray(
          ((await acceptable.json()) as Record<string, unknown>).attachment,
        ),
      );
      assertEquals(acceptable.headers.get("Vary"), "Accept");
    }
  }
  assertEquals(await actor.toJsonLd(), before);
  assertEquals(
    await respondWithObjectIfAcceptable(
      actor,
      new Request("https://example.com/", { headers: { Accept: "text/html" } }),
    ),
    null,
  );
});

test("attachment responses: cached actor with deep JSON data remains servable", async () => {
  let data: unknown = "leaf";
  for (let i = 0; i < 70; i++) data = { child: data };
  const original = {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      { data: { "@id": "https://example.com/data", "@type": "@json" } },
    ],
    type: "Service",
    id: "https://example.com/actors/app",
    preferredUsername: "app",
    attachment: { type: "Note", content: "cached attachment" },
    data,
  };
  const actor = await Service.fromJsonLd(original, {
    contextLoader: mockDocumentLoader,
  });
  const before = structuredClone(await actor.toJsonLd());
  const federation = createFederation<void>({ kv: new MemoryKvStore() });
  federation.setActorDispatcher("/actors/{identifier}", () => actor);
  for (const accept of ACCEPTS) {
    const response = await federation.fetch(
      new Request("https://example.com/actors/app", {
        headers: { Accept: accept },
      }),
      { contextData: undefined },
    );
    assertEquals(response.status, 200);
    // The normalizer's depth budget leaves this valid cached JSON unchanged.
    assertEquals(await response.json(), before);
  }
  assertEquals(await actor.toJsonLd(), before);
});

test("attachment responses: uncached collections serve unsigned cached children with deep or large JSON data", async () => {
  let deep: unknown = "leaf";
  for (let i = 0; i < 70; i++) deep = { child: deep };
  for (const data of [deep, Array.from({ length: 100_001 }, () => "leaf")]) {
    const original = {
      "@context": [
        "https://www.w3.org/ns/activitystreams",
        { data: { "@id": "https://example.com/data", "@type": "@json" } },
      ],
      type: "Note",
      id: "https://example.com/notes/cached",
      content: "unsigned cached child",
      data,
    };
    const note = await Note.fromJsonLd(original, {
      contextLoader: mockDocumentLoader,
    });
    const before = structuredClone(await note.toJsonLd());
    const collection = new OrderedCollection({ items: [note] });
    const options = { contextLoader: mockDocumentLoader };
    const serialized = structuredClone(await collection.toJsonLd(options));
    for (
      const response of [
        await respondWithObject(collection, options),
        ...await Promise.all(
          ACCEPTS.map((accept) =>
            respondWithObjectIfAcceptable(
              collection,
              new Request("https://example.com/", {
                headers: { Accept: accept },
              }),
              options,
            )
          ),
        ),
      ]
    ) {
      assert(response != null);
      assertEquals(response.status, 200);
      assertEquals(await response.json(), serialized);
    }
    assertEquals(await note.toJsonLd(), before);
  }
});

test("attachment responses: large cached collection remains servable", async () => {
  const original = {
    "@context": "https://www.w3.org/ns/activitystreams",
    type: "OrderedCollection",
    id: "https://example.com/collection",
    orderedItems: Array.from(
      { length: 100_001 },
      (_, i) => `https://example.com/items/${i}`,
    ),
  };
  const collection = await OrderedCollection.fromJsonLd(original, {
    contextLoader: mockDocumentLoader,
  });
  const before = structuredClone(await collection.toJsonLd());
  const response = await respondWithObject(collection, {
    contextLoader: mockDocumentLoader,
  });
  assertEquals(response.status, 200);
  assertEquals(await response.json(), before);
  assertEquals(await collection.toJsonLd(), before);
});

test("attachment responses: cached signed roots pass through without invalidating their JCS proof", async () => {
  const signed = await signObject(
    new Note({
      id: new URL("https://example.com/notes/signed"),
      attachments: [new Note({ content: "signed attachment" })],
    }),
    ed25519PrivateKey,
    ed25519Multikey.id!,
    { contextLoader: mockDocumentLoader },
  );
  const json = await signed.toJsonLd({
    format: "compact",
    contextLoader: mockDocumentLoader,
  }) as Record<string, unknown>;
  const cached = await Note.fromJsonLd(json, {
    contextLoader: mockDocumentLoader,
  });
  const proofs = [];
  for await (const proof of signed.getProofs()) proofs.push(proof);
  assertEquals(proofs.length, 1);
  const verification = {
    contextLoader: mockDocumentLoader,
    documentLoader: mockDocumentLoader,
  };
  assert(await verifyProof(json, proofs[0], verification) != null);
  const options = { contextLoader: mockDocumentLoader };
  for (
    const response of [
      await respondWithObject(cached, options),
      ...await Promise.all(
        ACCEPTS.map((accept) =>
          respondWithObjectIfAcceptable(
            cached,
            new Request("https://example.com/", {
              headers: { Accept: accept },
            }),
            options,
          )
        ),
      ),
    ]
  ) {
    assert(response != null);
    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body, json);
    assert(await verifyProof(body, proofs[0], verification) != null);
  }
  assertEquals(await cached.toJsonLd(), json);
});
