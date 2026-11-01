import { test } from "@fedify/fixture";
import { deepStrictEqual, ok } from "node:assert/strict";
import {
  Application,
  Group,
  type Object as ASObject,
  Organization,
  Person,
  Service,
  Update,
} from "./mod.ts";

const AS = "https://www.w3.org/ns/activitystreams";
const MASTODON = "http://joinmastodon.org/ns";
const aliceId = new URL("https://social.example/users/alice");
const updateId = new URL("https://social.example/activities/1");

interface ActorLike extends ASObject {
  attributionDomains: string[];
}

interface ActorConstructor {
  new (values: {
    id: URL;
    attributionDomains: string[];
  }): ActorLike;
  fromJsonLd(
    document: unknown,
    options?: { documentLoader?: DocumentLoader },
  ): Promise<ActorLike>;
}

interface DocumentLoader {
  (url: string): Promise<{
    contextUrl: string | null;
    documentUrl: string;
    document: unknown;
  }>;
}

function record(value: unknown): Record<string, unknown> {
  ok(value != null && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

test("attributionDomains round-trips through every actor type", async () => {
  const actorTypes: [string, ActorConstructor][] = [
    ["Application", Application],
    ["Group", Group],
    ["Organization", Organization],
    ["Person", Person],
    ["Service", Service],
  ];
  for (const [name, Actor] of actorTypes) {
    const id = new URL(`https://social.example/${name.toLowerCase()}/alice`);
    const actor = new Actor({
      id,
      attributionDomains: ["blog.example", "photos.example"],
    });
    const json = record(await actor.toJsonLd());
    deepStrictEqual(json.attributionDomains, [
      "blog.example",
      "photos.example",
    ]);

    const context = json["@context"] as unknown[];
    deepStrictEqual(record(context.at(-1))["attributionDomains"], {
      "@id": "toot:attributionDomains",
      "@container": "@set",
    });

    const parsed = await Actor.fromJsonLd(json);
    deepStrictEqual(parsed.id, id);
    deepStrictEqual(parsed.attributionDomains, [
      "blog.example",
      "photos.example",
    ]);
  }
});

test("attributionDomains single value fast path and compact form", async () => {
  const person = new Person({
    id: aliceId,
    attributionDomains: ["blog.example"],
  });
  const compactDefault = record(await person.toJsonLd());
  deepStrictEqual(compactDefault.attributionDomains, "blog.example");

  const compact = record(await person.toJsonLd({ format: "compact" }));
  deepStrictEqual(compact.attributionDomains, ["blog.example"]);
});

test("attributionDomains omitted when missing or empty", async () => {
  for (
    const person of [
      new Person({ id: aliceId }),
      new Person({ id: aliceId, attributionDomains: [] }),
    ]
  ) {
    const json = record(await person.toJsonLd());
    ok(!("attributionDomains" in json));
  }

  const parsed = await Person.fromJsonLd({
    "@context": AS,
    id: aliceId.href,
    type: "Person",
  });
  deepStrictEqual(parsed.attributionDomains, []);
});

test("attributionDomains ignores non-string values", async () => {
  const person = await Person.fromJsonLd({
    "@context": [AS, MASTODON],
    id: aliceId.href,
    type: "Person",
    attributionDomains: [42, "blog.example", true, { "@value": null }],
  });
  deepStrictEqual(person.attributionDomains, ["blog.example"]);
});

test("Update serializes the bare attributionDomains key in its object", async () => {
  const alice = new Person({
    id: aliceId,
    attributionDomains: ["blog.example"],
  });
  const update = new Update({
    id: updateId,
    actor: aliceId,
    object: alice,
  });
  const json = record(await update.toJsonLd());
  const object = record(json.object);
  deepStrictEqual(object.attributionDomains, ["blog.example"]);
  ok(!("toot:attributionDomains" in object));
});

test("parses Mastodon's published actor shape with a single string", async () => {
  const document = {
    "@context": [
      AS,
      "https://w3id.org/security/v1",
      {
        toot: `${MASTODON}#`,
        attributionDomains: {
          "@id": "toot:attributionDomains",
          "@container": "@set",
        },
        discoverable: "toot:discoverable",
        indexable: "toot:indexable",
      },
    ],
    id: aliceId.href,
    type: "Person",
    preferredUsername: "alice",
    inbox: `${aliceId.href}/inbox`,
    outbox: `${aliceId.href}/outbox`,
    attributionDomains: "blog.example",
  };

  const person = await Person.fromJsonLd(document);
  deepStrictEqual(person.attributionDomains, ["blog.example"]);
});

test("parses attributionDomains through the preloaded Mastodon context", async () => {
  const document = {
    "@context": [AS, MASTODON],
    id: aliceId.href,
    type: "Person",
    attributionDomains: ["blog.example"],
  };
  const person = await Person.fromJsonLd(document);
  deepStrictEqual(person.attributionDomains, ["blog.example"]);

  const json = record(await person.toJsonLd({ format: "compact" }));
  deepStrictEqual(json.attributionDomains, ["blog.example"]);
});
