import { mockDocumentLoader, test } from "@fedify/fixture";
import { decodeMultibase, LanguageString } from "@fedify/vocab-runtime";
import {
  areAllScalarTypes,
  loadSchemaFiles,
  type PropertySchema,
  type TypeSchema,
} from "@fedify/vocab-tools";
import { pascalCase } from "es-toolkit";
import {
  deepStrictEqual,
  notDeepStrictEqual,
  ok,
  rejects,
  throws,
} from "node:assert/strict";
import { assertInstanceOf } from "./utils.ts";
import * as vocab from "./vocab.ts";
import {
  Activity,
  Announce,
  Collection,
  Create,
  CryptographicKey,
  type DataIntegrityProof,
  Follow,
  Hashtag,
  Link,
  Note,
  Object,
  OrderedCollectionPage,
  Person,
  Place,
  Question,
  Source,
} from "./vocab.ts";

test("new Object()", () => {
  const obj = new Object({
    name: "Test",
    contents: [
      new LanguageString("Hello", "en"),
      new LanguageString("你好", "zh"),
    ],
  });
  deepStrictEqual(obj.name, "Test");
  deepStrictEqual(obj.contents[0], new LanguageString("Hello", "en"));
  deepStrictEqual(obj.contents[1], new LanguageString("你好", "zh"));

  throws(
    () => new Object({ id: 123 as unknown as URL }),
    TypeError,
  );
  throws(
    () => new Object({ name: "singular", names: ["plural"] }),
    TypeError,
  );
  throws(
    () => new Object({ name: 123 as unknown as string }),
    TypeError,
  );
  throws(
    () => new Object({ names: "foo" as unknown as string[] }),
    TypeError,
  );
  throws(
    () => new Object({ names: ["foo", 123 as unknown as string] }),
    TypeError,
  );
});

test("Object.clone()", () => {
  const obj = new Object({
    id: new URL("https://example.com/"),
    name: "Test",
    contents: [
      new LanguageString("Hello", "en"),
      new LanguageString("你好", "zh"),
    ],
  });

  const clone = obj.clone({ content: "Modified" });
  assertInstanceOf(clone, Object);
  deepStrictEqual(clone.id, new URL("https://example.com/"));
  deepStrictEqual(clone.name, "Test");
  deepStrictEqual(clone.content, "Modified");

  const cloned2 = obj.clone({ id: new URL("https://example.com/modified") });
  assertInstanceOf(cloned2, Object);
  deepStrictEqual(cloned2.id, new URL("https://example.com/modified"));
  deepStrictEqual(cloned2.name, "Test");
  deepStrictEqual(cloned2.contents, [
    new LanguageString("Hello", "en"),
    new LanguageString("你好", "zh"),
  ]);

  throws(
    () => obj.clone({ id: 123 as unknown as URL }),
    TypeError,
  );
  throws(
    () => obj.clone({ name: "singular", names: ["plural"] }),
    TypeError,
  );
  throws(
    () => obj.clone({ name: 123 as unknown as string }),
    TypeError,
  );
  throws(
    () => obj.clone({ names: "foo" as unknown as string[] }),
    TypeError,
  );
  throws(
    () => obj.clone({ names: ["foo", 123 as unknown as string] }),
    TypeError,
  );
});

test("Object.fromJsonLd()", async () => {
  const obj = await Object.fromJsonLd({
    "@context": "https://www.w3.org/ns/activitystreams",
    "type": "Object",
    "name": "Test",
    "contentMap": {
      "en": "Hello",
      "zh": "你好",
    },
    "source": {
      "content": "Hello",
      "mediaType": "text/plain",
    },
    "published": "2025-01-01 12:34:56",
  }, { documentLoader: mockDocumentLoader, contextLoader: mockDocumentLoader });
  assertInstanceOf(obj, Object);
  deepStrictEqual(obj.name, "Test");
  deepStrictEqual(obj.contents, [
    new LanguageString("Hello", "en"),
    new LanguageString("你好", "zh"),
  ]);
  assertInstanceOf(obj.source, Source);
  deepStrictEqual(obj.source.content, "Hello");
  deepStrictEqual(obj.source.mediaType, "text/plain");
  deepStrictEqual(obj.published, Temporal.Instant.from("2025-01-01T12:34:56Z"));

  const createJsonLd = {
    "@context": "https://www.w3.org/ns/activitystreams",
    "type": "Create",
    "name": "Test",
    "contentMap": {
      "en": "Hello",
      "zh": "你好",
    },
    "object": {
      "type": "Note",
      "content": "Content",
    },
  };
  const create = await Object.fromJsonLd(
    createJsonLd,
    { documentLoader: mockDocumentLoader, contextLoader: mockDocumentLoader },
  );
  assertInstanceOf(create, Create);
  deepStrictEqual(create.name, "Test");
  deepStrictEqual(create.contents, [
    new LanguageString("Hello", "en"),
    new LanguageString("你好", "zh"),
  ]);
  deepStrictEqual(await create.toJsonLd(), createJsonLd);
  const note = await create.getObject();
  assertInstanceOf(note, Note);
  deepStrictEqual(note.content, "Content");

  const empty = await Object.fromJsonLd({});
  assertInstanceOf(empty, Object);

  await rejects(
    () => Object.fromJsonLd(null),
    TypeError,
  );
  await rejects(
    () => Object.fromJsonLd(undefined),
    TypeError,
  );
});

test("Object.toJsonLd()", async () => {
  const obj = new Object({
    name: "Test",
    contents: [
      new LanguageString("Hello", "en"),
      new LanguageString("你好", "zh"),
    ],
  });
  deepStrictEqual(
    await obj.toJsonLd({ format: "expand", contextLoader: mockDocumentLoader }),
    [
      {
        "@type": [
          "https://www.w3.org/ns/activitystreams#Object",
        ],
        "https://www.w3.org/ns/activitystreams#name": [
          { "@value": "Test" },
        ],
        "https://www.w3.org/ns/activitystreams#content": [
          { "@value": "Hello", "@language": "en" },
          { "@value": "你好", "@language": "zh" },
        ],
      },
    ],
  );
  deepStrictEqual(await obj.toJsonLd({ contextLoader: mockDocumentLoader }), {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/data-integrity/v1",
      {
        fedibird: "http://fedibird.com/ns#",
        sensitive: "as:sensitive",
        emojiReactions: {
          "@id": "fedibird:emojiReactions",
          "@type": "@id",
        },
      },
    ],
    type: "Object",
    name: "Test",
    contentMap: {
      en: "Hello",
      zh: "你好",
    },
  });
});

test("Note.toJsonLd()", async () => {
  const note = new Note({
    tags: [
      new Hashtag({
        name: "#Fedify",
        href: new URL("https://fedify.dev/"),
      }),
    ],
  });
  deepStrictEqual(await note.toJsonLd({ contextLoader: mockDocumentLoader }), {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/data-integrity/v1",
      {
        Emoji: "toot:Emoji",
        Hashtag: "as:Hashtag",
        _misskey_quote: "misskey:_misskey_quote",
        fedibird: "http://fedibird.com/ns#",
        misskey: "https://misskey-hub.net/ns#",
        quoteUri: "fedibird:quoteUri",
        quoteUrl: "as:quoteUrl",
        sensitive: "as:sensitive",
        toot: "http://joinmastodon.org/ns#",
        emojiReactions: {
          "@id": "fedibird:emojiReactions",
          "@type": "@id",
        },
      },
    ],
    tag: {
      "@context": [
        "https://www.w3.org/ns/activitystreams",
        {
          Hashtag: "as:Hashtag",
        },
      ],
      href: "https://fedify.dev/",
      name: "#Fedify",
      type: "Hashtag",
    },
    type: "Note",
  });

  const noteWithName = note.clone({
    name: "Test",
  });
  deepStrictEqual(
    await noteWithName.toJsonLd({ contextLoader: mockDocumentLoader }),
    await noteWithName.toJsonLd({
      contextLoader: mockDocumentLoader,
      format: "compact",
    }),
  );
});

test("Activity.fromJsonLd()", async () => {
  const follow = await Activity.fromJsonLd(
    {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: "https://activitypub.academy/80c50305-7405-4e38-809f-697647a1f679",
      type: "Follow",
      actor: "https://activitypub.academy/users/egulia_anbeiss",
      object: "https://example.com/users/hongminhee",
    },
    { documentLoader: mockDocumentLoader, contextLoader: mockDocumentLoader },
  );
  assertInstanceOf(follow, Follow);
  deepStrictEqual(
    follow.id,
    new URL("https://activitypub.academy/80c50305-7405-4e38-809f-697647a1f679"),
  );
  deepStrictEqual(
    follow.actorId,
    new URL("https://activitypub.academy/users/egulia_anbeiss"),
  );
  deepStrictEqual(
    follow.objectId,
    new URL("https://example.com/users/hongminhee"),
  );

  const create = await Activity.fromJsonLd(
    {
      "@context": [
        "https://www.w3.org/ns/activitystreams",
        "https://w3id.org/security/data-integrity/v1",
      ],
      type: "Create",
      actor: "https://server.example/users/alice",
      object: {
        type: "Note",
        content: "Hello world",
      },
      proof: {
        type: "DataIntegrityProof",
        cryptosuite: "eddsa-jcs-2022",
        verificationMethod: "https://server.example/users/alice#ed25519-key",
        proofPurpose: "assertionMethod",
        proofValue:
          // cSpell: disable
          "z3sXaxjKs4M3BRicwWA9peyNPJvJqxtGsDmpt1jjoHCjgeUf71TRFz56osPSfDErszyLp5Ks1EhYSgpDaNM977Rg2",
        // cSpell: enable
        created: "2023-02-24T23:36:38Z",
      },
    },
    { documentLoader: mockDocumentLoader, contextLoader: mockDocumentLoader },
  );
  const proofs: DataIntegrityProof[] = [];
  for await (const proof of create.getProofs()) proofs.push(proof);
  deepStrictEqual(proofs.length, 1);
  deepStrictEqual(proofs[0].cryptosuite, "eddsa-jcs-2022");
  deepStrictEqual(
    proofs[0].verificationMethodId,
    new URL("https://server.example/users/alice#ed25519-key"),
  );
  deepStrictEqual(proofs[0].proofPurpose, "assertionMethod");
  deepStrictEqual(
    proofs[0].proofValue,
    decodeMultibase(
      // cSpell: disable
      "z3sXaxjKs4M3BRicwWA9peyNPJvJqxtGsDmpt1jjoHCjgeUf71TRFz56osPSfDErszyLp5Ks1EhYSgpDaNM977Rg2",
      // cSpell: enable
    ),
  );
  deepStrictEqual(
    proofs[0].created,
    Temporal.Instant.from("2023-02-24T23:36:38Z"),
  );
});

test({
  name: "Activity.getObject()",
  permissions: { env: true, read: true },
  async fn() {
    const activity = new Activity({
      object: new URL("https://example.com/announce"),
    });
    const announce = await activity.getObject({
      documentLoader: mockDocumentLoader,
      contextLoader: mockDocumentLoader,
    });
    assertInstanceOf(announce, Announce);
    deepStrictEqual(announce.id, new URL("https://example.com/announce"));

    const object = await announce.getObject();
    assertInstanceOf(object, Object);
    deepStrictEqual(object.id, new URL("https://example.com/object"));
    deepStrictEqual(object.name, "Fetched object");

    // Is hydration applied to toJsonLd()?
    const jsonLd = await activity.toJsonLd();
    deepStrictEqual(jsonLd, {
      "@context": [
        "https://w3id.org/identity/v1",
        "https://www.w3.org/ns/activitystreams",
        "https://w3id.org/security/v1",
        "https://w3id.org/security/data-integrity/v1",
      ],
      type: "Activity",
      object: {
        id: "https://example.com/announce",
        type: "Announce",
        object: {
          type: "Object",
          id: "https://example.com/object",
          name: "Fetched object",
        },
      },
    });

    const activity2 = new Activity({
      object: new URL("https://example.com/not-found"),
    });
    deepStrictEqual(await activity2.getObject({ suppressError: true }), null);

    const activity3 = await Activity.fromJsonLd({
      "@context": "https://www.w3.org/ns/activitystreams",
      type: "Create",
      object: {
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Note",
        content: "Hello world",
      },
    });
    const object3 = await activity3.getObject();
    assertInstanceOf(object3, Note);
    deepStrictEqual(await object3.toJsonLd(), {
      "@context": "https://www.w3.org/ns/activitystreams",
      type: "Note",
      content: "Hello world",
    });
  },
});

test({
  name: "Activity.getObjects()",
  permissions: { env: true, read: true },
  async fn() {
    const activity = new Activity({
      objects: [
        new URL("https://example.com/object"),
        new Object({
          name: "Second object",
        }),
      ],
    });
    const objects = await Array.fromAsync(
      activity.getObjects({
        documentLoader: mockDocumentLoader,
        contextLoader: mockDocumentLoader,
      }),
    );
    deepStrictEqual(objects.length, 2);
    assertInstanceOf(objects[0], Object);
    deepStrictEqual(objects[0].id, new URL("https://example.com/object"));
    deepStrictEqual(objects[0].name, "Fetched object");
    assertInstanceOf(objects[1], Object);
    deepStrictEqual(objects[1].name, "Second object");

    const activity2 = new Activity({
      objects: [
        new URL("https://example.com/not-found"),
        new Object({
          name: "Second object",
        }),
      ],
    });
    const objects2 = await Array.fromAsync(
      activity2.getObjects({ suppressError: true }),
    );
    deepStrictEqual(objects2.length, 1);
    assertInstanceOf(objects2[0], Object);
    deepStrictEqual(objects2[0].name, "Second object");
  },
});

test("Activity.clone()", async () => {
  const activity = new Activity({
    actor: new Person({
      name: "John Doe",
    }),
    object: new Object({
      name: "Test",
    }),
    name: "Test",
    summary: "Test",
  });
  const clone = activity.clone({
    object: new Object({
      name: "Modified",
    }),
    summary: "Modified",
  });
  deepStrictEqual((await activity.getActor())?.name, "John Doe");
  deepStrictEqual((await clone.getActor())?.name, "John Doe");
  deepStrictEqual((await activity.getObject())?.name, "Test");
  deepStrictEqual((await clone.getObject())?.name, "Modified");
  deepStrictEqual(activity.name, "Test");
  deepStrictEqual(clone.name, "Test");
  deepStrictEqual(activity.summary, "Test");
  deepStrictEqual(clone.summary, "Modified");

  throws(
    () => activity.clone({ summary: "singular", summaries: ["plural"] }),
    TypeError,
  );
});

test("Question.voters", async () => {
  const question = new Question({
    voters: 123,
  });
  const json = await question.toJsonLd({ format: "compact" });
  ok(typeof json === "object" && json != null);
  ok("votersCount" in json);
  deepStrictEqual((json as Record<string, unknown>)["votersCount"], 123);
});

test({
  name: "Deno.inspect(Object)",
  ignore: !("Deno" in globalThis),
  fn() {
    const obj = new Object({
      id: new URL("https://example.com/"),
      attribution: new URL("https://example.com/foo"),
      name: "Test",
      contents: [
        new LanguageString("Hello", "en"),
        new LanguageString("你好", "zh"),
      ],
    });
    deepStrictEqual(
      Deno.inspect(obj, { colors: false, sorted: true, compact: false }),
      "Deno" in globalThis
        ? "Object {\n" +
          '  attribution: URL "https://example.com/foo",\n' +
          "  contents: [\n" +
          '    <en> "Hello",\n' +
          '    <zh> "你好"\n' +
          "  ],\n" +
          '  id: URL "https://example.com/",\n' +
          '  name: "Test"\n' +
          "}"
        : "Object {\n" +
          "  attribution: URL 'https://example.com/foo',\n" +
          "  contents: [\n" +
          "    <en> 'Hello',\n" +
          "    <zh> '你好'\n" +
          "  ],\n" +
          "  id: URL 'https://example.com/',\n" +
          "  name: 'Test'\n" +
          "}",
    );
  },
});

test("Person.fromJsonLd()", async () => {
  const person = await Person.fromJsonLd({
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/v1",
    ],
    "id": "https://todon.eu/users/hongminhee",
    "publicKey": {
      "id": "https://todon.eu/users/hongminhee#main-key",
      "owner": "https://todon.eu/users/hongminhee",
      // cSpell: disable
      "publicKeyPem": "-----BEGIN PUBLIC KEY-----\n" +
        "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxsRuvCkgJtflBTl4OVsm\n" +
        "nt/J1mQfZasfJtN33dcZ3d1lJroxmgmMu69zjGEAwkNbMQaWNLqC4eogkJaeJ4RR\n" +
        "5MHYXkL9nNilVoTkjX5BVit3puzs7XJ7WQnKQgQMI+ezn24GHsZ/v1JIo77lerX5\n" +
        "k4HNwTNVt+yaZVQWaOMR3+6FwziQR6kd0VuG9/a9dgAnz2cEoORRC1i4W7IZaB1s\n" +
        "Znh1WbHbevlGd72HSXll5rocPIHn8gq6xpBgpHwRphlRsgn4KHaJ6brXDIJjrnQh\n" +
        "Ie/YUBOGj/ImSEXhRwlFerKsoAVnZ0Hwbfa46qk44TAt8CyoPMWmpK6pt0ng4pQ2\n" +
        "uwIDAQAB\n" +
        "-----END PUBLIC KEY-----\n",
      // cSpell: enable
    },
  }, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
    baseUrl: new URL("https://todon.eu/"),
  });
  deepStrictEqual(
    person.publicKeyId,
    new URL("https://todon.eu/users/hongminhee#main-key"),
  );
  const publicKey = await person.getPublicKey({
    documentLoader: mockDocumentLoader,
  });
  assertInstanceOf(publicKey, CryptographicKey);
  deepStrictEqual(
    publicKey?.ownerId,
    new URL("https://todon.eu/users/hongminhee"),
  );

  const person2 = await Person.fromJsonLd({
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      {
        alsoKnownAs: {
          "@id": "as:alsoKnownAs",
          "@type": "@id",
        },
      },
    ],
    "type": "Person",
    // cSpell: disable
    "alsoKnownAs": "at://did:plc:x7xdowahlhm5xulzqw4ehv6q",
    // cSpell: enable
  });
  deepStrictEqual(
    person2.aliasId,
    // cSpell: disable
    new URL("at://did%3Aplc%3Ax7xdowahlhm5xulzqw4ehv6q"),
    // cSpell: enable
  );
});

test("Person.toJsonLd()", async () => {
  const person = new Person({
    aliases: [new URL("https://example.com/alias")],
  });
  deepStrictEqual(await person.toJsonLd(), {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/v1",
      "https://w3id.org/security/data-integrity/v1",
      "https://www.w3.org/ns/did/v1",
      "https://w3id.org/security/multikey/v1",
      {
        PropertyValue: "schema:PropertyValue",
        alsoKnownAs: {
          "@id": "as:alsoKnownAs",
          "@type": "@id",
        },
        movedTo: {
          "@id": "as:movedTo",
          "@type": "@id",
        },
        discoverable: "toot:discoverable",
        featured: {
          "@id": "toot:featured",
          "@type": "@id",
        },
        featuredTags: {
          "@id": "toot:featuredTags",
          "@type": "@id",
        },
        indexable: "toot:indexable",
        _misskey_followedMessage: "misskey:_misskey_followedMessage",
        isCat: "misskey:isCat",
        manuallyApprovesFollowers: "as:manuallyApprovesFollowers",
        memorial: "toot:memorial",
        misskey: "https://misskey-hub.net/ns#",
        schema: "http://schema.org#",
        suspended: "toot:suspended",
        toot: "http://joinmastodon.org/ns#",
        value: "schema:value",
        Emoji: "toot:Emoji",
      },
    ],
    alsoKnownAs: "https://example.com/alias",
    type: "Person",
  });
});

test("Collection.fromJsonLd()", async () => {
  const collection = await Collection.fromJsonLd({
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/fep/5711",
    ],
    "type": "Collection",
    "id": "https://example.com/collection/jzc50wc28l",
    "inboxOf": "https://example.com/person/bup9a8eqm",
  });
  deepStrictEqual(
    collection.id,
    new URL("https://example.com/collection/jzc50wc28l"),
  );
  deepStrictEqual(
    collection.inboxOfId,
    new URL("https://example.com/person/bup9a8eqm"),
  );
});

test("Note.quoteUrl", async () => {
  const note = new Note({
    quoteUrl: new URL("https://example.com/object"),
  });
  const expected = {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/data-integrity/v1",
      {
        Emoji: "toot:Emoji",
        Hashtag: "as:Hashtag",
        _misskey_quote: "misskey:_misskey_quote",
        fedibird: "http://fedibird.com/ns#",
        misskey: "https://misskey-hub.net/ns#",
        quoteUri: "fedibird:quoteUri",
        quoteUrl: "as:quoteUrl",
        sensitive: "as:sensitive",
        toot: "http://joinmastodon.org/ns#",
        emojiReactions: {
          "@id": "fedibird:emojiReactions",
          "@type": "@id",
        },
      },
    ],
    _misskey_quote: "https://example.com/object",
    quoteUri: "https://example.com/object",
    quoteUrl: "https://example.com/object",
    type: "Note",
  };
  deepStrictEqual(await note.toJsonLd(), expected);
  deepStrictEqual(await note.toJsonLd({ format: "compact" }), expected);

  const jsonLd: Record<string, unknown> = {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      {
        _misskey_quote: "misskey:_misskey_quote",
        fedibird: "http://fedibird.com/ns#",
        misskey: "https://misskey-hub.net/ns#",
        quoteUri: "fedibird:quoteUri",
        quoteUrl: "as:quoteUrl",
      },
    ],
    type: "Note",
    quoteUrl: "https://example.com/object",
    _misskey_quote: "https://example.com/object2",
    quoteUri: "https://example.com/object3",
  };
  const loaded = await Note.fromJsonLd(jsonLd);
  deepStrictEqual(loaded.quoteUrl, new URL("https://example.com/object"));

  delete jsonLd.quoteUrl;
  const loaded2 = await Note.fromJsonLd(jsonLd);
  deepStrictEqual(loaded2.quoteUrl, new URL("https://example.com/object2"));

  delete jsonLd._misskey_quote;
  const loaded3 = await Note.fromJsonLd(jsonLd);
  deepStrictEqual(loaded3.quoteUrl, new URL("https://example.com/object3"));
});

test("Key.publicKey", async () => {
  const jwk = {
    kty: "RSA",
    alg: "RS256",
    // cSpell: disable
    n: "xsRuvCkgJtflBTl4OVsmnt_J1mQfZasfJtN33dcZ3d1lJroxmgmMu69zjGEAwkNbMQaWN" +
      "LqC4eogkJaeJ4RR5MHYXkL9nNilVoTkjX5BVit3puzs7XJ7WQnKQgQMI-ezn24GHsZ_v1J" +
      "Io77lerX5k4HNwTNVt-yaZVQWaOMR3-6FwziQR6kd0VuG9_a9dgAnz2cEoORRC1i4W7IZa" +
      "B1sZnh1WbHbevlGd72HSXll5rocPIHn8gq6xpBgpHwRphlRsgn4KHaJ6brXDIJjrnQhIe_" +
      "YUBOGj_ImSEXhRwlFerKsoAVnZ0Hwbfa46qk44TAt8CyoPMWmpK6pt0ng4pQ2uw",
    e: "AQAB",
    // cSpell: enable
    key_ops: ["verify"],
    ext: true,
  };
  const key = new CryptographicKey({
    publicKey: await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      true,
      ["verify"],
    ),
  });
  const jsonLd = await key.toJsonLd({ contextLoader: mockDocumentLoader });
  deepStrictEqual(jsonLd, {
    "@context": "https://w3id.org/security/v1",
    publicKeyPem: "-----BEGIN PUBLIC KEY-----\n" +
      // cSpell: disable
      "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxsRuvCkgJtflBTl4OVsm\n" +
      "nt/J1mQfZasfJtN33dcZ3d1lJroxmgmMu69zjGEAwkNbMQaWNLqC4eogkJaeJ4RR\n" +
      "5MHYXkL9nNilVoTkjX5BVit3puzs7XJ7WQnKQgQMI+ezn24GHsZ/v1JIo77lerX5\n" +
      "k4HNwTNVt+yaZVQWaOMR3+6FwziQR6kd0VuG9/a9dgAnz2cEoORRC1i4W7IZaB1s\n" +
      "Znh1WbHbevlGd72HSXll5rocPIHn8gq6xpBgpHwRphlRsgn4KHaJ6brXDIJjrnQh\n" +
      "Ie/YUBOGj/ImSEXhRwlFerKsoAVnZ0Hwbfa46qk44TAt8CyoPMWmpK6pt0ng4pQ2\n" +
      "uwIDAQAB\n" +
      // cSpell: enable
      "-----END PUBLIC KEY-----\n",
    type: "CryptographicKey",
  });
  const loadedKey = await CryptographicKey.fromJsonLd(jsonLd, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  notDeepStrictEqual(loadedKey.publicKey, null);
  deepStrictEqual(
    await crypto.subtle.exportKey("jwk", loadedKey.publicKey!),
    jwk,
  );
});

test("Place.fromJsonLd()", async () => {
  const place = await Place.fromJsonLd({
    "@context": "https://www.w3.org/ns/activitystreams",
    type: "Place",
    name: "Fresno Area",
    latitude: 36.75,
    longitude: 119.7667,
    radius: 15,
    units: "miles",
  }, { documentLoader: mockDocumentLoader, contextLoader: mockDocumentLoader });
  assertInstanceOf(place, Place);
  deepStrictEqual(place.name, "Fresno Area");
  deepStrictEqual(place.latitude, 36.75);
  deepStrictEqual(place.longitude, 119.7667);
  deepStrictEqual(place.radius, 15);
  deepStrictEqual(place.units, "miles");

  let jsonLd = await place.toJsonLd({ contextLoader: mockDocumentLoader });
  deepStrictEqual(jsonLd, {
    "@context": "https://www.w3.org/ns/activitystreams",
    type: "Place",
    name: "Fresno Area",
    latitude: 36.75,
    longitude: 119.7667,
    radius: 15,
    units: "miles",
  });

  jsonLd = await place.toJsonLd({
    format: "compact",
    contextLoader: mockDocumentLoader,
  });
  deepStrictEqual(jsonLd, {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/data-integrity/v1",
    ],
    type: "Place",
    name: "Fresno Area",
    latitude: 36.75,
    longitude: 119.7667,
    radius: 15,
    units: "miles",
  });
});

test("Actor.getOutbox()", async () => {
  const person = new Person({
    outbox: new URL("https://example.com/orderedcollectionpage"),
  });
  const outbox = await person.getOutbox({ documentLoader: mockDocumentLoader });
  assertInstanceOf(outbox, OrderedCollectionPage);
  deepStrictEqual(outbox.totalItems, 1);
});

test("Link.fromJsonLd()", async () => {
  const link = await Link.fromJsonLd({
    "@context": "https://www.w3.org/ns/activitystreams",
    "type": "Link",
    "rel": "canonical",
    "href":
      "at://did:plc:ia76kvnndjutgedggx2ibrem/app.bsky.feed.post/3lyxjjs27jkqg",
  });
  deepStrictEqual(link.rel, "canonical");
  deepStrictEqual(
    link.href,
    new URL(
      "at://did%3Aplc%3Aia76kvnndjutgedggx2ibrem/app.bsky.feed.post/3lyxjjs27jkqg",
    ),
  );

  const link2 = await Link.fromJsonLd({
    "@context": "https://www.w3.org/ns/activitystreams",
    "type": "Link",
    "href": "at://bnewbold.bsky.team/app.bsky.feed.post/3jwdwj2ctlk26",
  });
  deepStrictEqual(
    link2.href,
    new URL("at://bnewbold.bsky.team/app.bsky.feed.post/3jwdwj2ctlk26"),
  );

  const link3 = await Link.fromJsonLd({
    "@context": "https://www.w3.org/ns/activitystreams",
    "type": "Link",
    "href": "at://did:plc:ia76kvnndjutgedggx2ibrem",
  });
  deepStrictEqual(
    link3.href,
    new URL("at://did%3Aplc%3Aia76kvnndjutgedggx2ibrem"),
  );
});

test("Person.fromJsonLd() with relative URLs", async () => {
  const json = {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/v1",
    ],
    id: "https://example.com/ap/actors/019382d3-63d7-7cf7-86e8-91e2551c306c",
    type: "Person",
    name: "Test User",
    icon: { type: "Image", url: "/avatars/test-avatar.jpg" },
  };

  const person = await Person.fromJsonLd(json, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });

  const icon = await person.getIcon();
  deepStrictEqual(
    icon?.url,
    new URL("https://example.com/avatars/test-avatar.jpg"),
  );

  const json2 = {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/v1",
    ],
    id: "https://example.com/ap/actors/019382d3-63d7-7cf7-86e8-91e2551c306c",
    type: "Person",
    name: "Test User",
    icon: {
      id: "https://media.example.com/avatars/test-avatar.jpg",
      type: "Image",
      url: "/avatars/test-avatar.jpg",
    },
  };

  const person2 = await Person.fromJsonLd(json2, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });

  const icon2 = await person2.getIcon();
  deepStrictEqual(
    icon2?.url,
    new URL("https://media.example.com/avatars/test-avatar.jpg"),
  );
});

test("Person.fromJsonLd() with relative URLs and baseUrl", async () => {
  const json = {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/v1",
    ],
    "id": "https://example.com/ap/actors/019382d3-63d7-7cf7-86e8-91e2551c306c",
    "type": "Person",
    "name": "Test User",
    "icon": {
      "type": "Image",
      "url": "/avatars/test-avatar.jpg",
    },
  };

  const personWithBase = await Person.fromJsonLd(json, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
    baseUrl: new URL("https://example.com"),
  });

  const icon = await personWithBase.getIcon();
  deepStrictEqual(
    icon?.url,
    new URL("https://example.com/avatars/test-avatar.jpg"),
  );
});

test("FEP-fe34: Trust tracking in object construction", async () => {
  // Test that objects created with embedded objects have trust set
  const note = new Note({
    id: new URL("https://example.com/note"),
    content: "Hello World",
  });

  const create = new Create({
    id: new URL("https://example.com/create"),
    actor: new URL("https://example.com/actor"),
    object: note, // Embedded object should be trusted
  });

  // Trust should be automatically set for embedded objects during construction
  // We can verify this by checking that the object is returned immediately
  // without requiring remote fetching
  deepStrictEqual(create.objectId, new URL("https://example.com/note"));

  // Should return the embedded object directly (no remote fetch needed)
  const result = await create.getObject();
  deepStrictEqual(result, note);
  deepStrictEqual(result?.content, "Hello World");
});

test("FEP-fe34: Trust tracking in object cloning", () => {
  const originalNote = new Note({
    id: new URL("https://example.com/note"),
    content: "Original content",
  });

  const create = new Create({
    id: new URL("https://example.com/create"),
    actor: new URL("https://example.com/actor"),
    object: originalNote,
  });

  const newNote = new Note({
    id: new URL("https://example.com/new-note"),
    content: "New content",
  });

  // Clone with a new embedded object - should establish new trust
  const clonedCreate = create.clone({
    object: newNote,
  });

  deepStrictEqual(
    clonedCreate.objectId,
    new URL("https://example.com/new-note"),
  );
});

test("FEP-fe34: crossOrigin ignore behavior (default)", async () => {
  // Create a mock document loader that returns objects with different origins
  // deno-lint-ignore require-await
  const crossOriginDocumentLoader = async (url: string) => {
    if (url === "https://different-origin.com/note") {
      return {
        documentUrl: url,
        contextUrl: null,
        document: {
          "@context": "https://www.w3.org/ns/activitystreams",
          "@type": "Note",
          "@id": "https://malicious.com/fake-note", // Different origin!
          "content": "This is a spoofed note",
        },
      };
    }
    throw new Error("Document not found");
  };

  const create = new Create({
    id: new URL("https://example.com/create"),
    actor: new URL("https://example.com/actor"),
    object: new URL("https://different-origin.com/note"),
  });

  // Default behavior should ignore cross-origin objects and return null
  const result = await create.getObject({
    documentLoader: crossOriginDocumentLoader,
  });
  deepStrictEqual(result, null);
});

test("FEP-fe34: crossOrigin throw behavior", async () => {
  // deno-lint-ignore require-await
  const crossOriginDocumentLoader = async (url: string) => {
    if (url === "https://different-origin.com/note") {
      return {
        documentUrl: url,
        contextUrl: null,
        document: {
          "@context": "https://www.w3.org/ns/activitystreams",
          "@type": "Note",
          "@id": "https://malicious.com/fake-note", // Different origin!
          "content": "This is a spoofed note",
        },
      };
    }
    throw new Error("Document not found");
  };

  const create = new Create({
    id: new URL("https://example.com/create"),
    actor: new URL("https://example.com/actor"),
    object: new URL("https://different-origin.com/note"),
  });

  // Should throw an error when encountering cross-origin objects
  await rejects(
    () =>
      create.getObject({
        documentLoader: crossOriginDocumentLoader,
        crossOrigin: "throw",
      }),
    Error,
  );
});

test("FEP-fe34: crossOrigin trust behavior", async () => {
  // deno-lint-ignore require-await
  const crossOriginDocumentLoader = async (url: string) => {
    if (url === "https://different-origin.com/note") {
      return {
        documentUrl: url,
        contextUrl: null,
        document: {
          "@context": "https://www.w3.org/ns/activitystreams",
          "@type": "Note",
          "@id": "https://malicious.com/fake-note", // Different origin!
          "content": "This is a spoofed note",
        },
      };
    }
    throw new Error("Document not found");
  };

  const create = new Create({
    id: new URL("https://example.com/create"),
    actor: new URL("https://example.com/actor"),
    object: new URL("https://different-origin.com/note"),
  });

  // Should bypass origin checks and return the object
  const result = await create.getObject({
    documentLoader: crossOriginDocumentLoader,
    crossOrigin: "trust",
  });

  assertInstanceOf(result, Note);
  deepStrictEqual(result?.id, new URL("https://malicious.com/fake-note"));
  deepStrictEqual(result?.content, "This is a spoofed note");
});

test("FEP-fe34: Same origin objects are trusted", async () => {
  // deno-lint-ignore require-await
  const sameOriginDocumentLoader = async (url: string) => {
    if (url === "https://example.com/note") {
      return {
        documentUrl: url,
        contextUrl: null,
        document: {
          "@context": "https://www.w3.org/ns/activitystreams",
          "@type": "Note",
          "@id": "https://example.com/note", // Same origin
          "content": "This is a legitimate note",
        },
      };
    }
    throw new Error("Document not found");
  };

  const create = new Create({
    id: new URL("https://example.com/create"),
    actor: new URL("https://example.com/actor"),
    object: new URL("https://example.com/note"),
  });

  // Same origin objects should be returned normally
  const result = await create.getObject({
    documentLoader: sameOriginDocumentLoader,
  });

  assertInstanceOf(result, Note);
  deepStrictEqual(result?.id, new URL("https://example.com/note"));
  deepStrictEqual(result?.content, "This is a legitimate note");
});

test(
  "FEP-fe34: Embedded cross-origin objects from JSON-LD are ignored by default",
  async () => {
    // Mock document loader for creating the Create object from JSON-LD
    // deno-lint-ignore require-await
    const createDocumentLoader = async (url: string) => {
      if (url === "https://example.com/create") {
        return {
          documentUrl: url,
          contextUrl: null,
          document: {
            "@context": "https://www.w3.org/ns/activitystreams",
            "@type": "Create",
            "@id": "https://example.com/create",
            "actor": "https://example.com/actor",
            "object": {
              "@type": "Note",
              // Different origin from parent!
              "@id": "https://different-origin.com/note",
              "content": "Embedded note from JSON-LD",
            },
          },
        };
      }
      throw new Error("Document not found");
    };

    // Create object from JSON-LD (embedded objects won't be trusted)
    const create = await Create.fromJsonLd(
      await createDocumentLoader("https://example.com/create").then((r) =>
        r.document
      ),
      { documentLoader: createDocumentLoader },
    );

    // Mock document loader that would return the "legitimate" version
    // deno-lint-ignore require-await
    const objectDocumentLoader = async (url: string) => {
      if (url === "https://different-origin.com/note") {
        return {
          documentUrl: url,
          contextUrl: null,
          document: {
            "@context": "https://www.w3.org/ns/activitystreams",
            "@type": "Note",
            "@id": "https://different-origin.com/note",
            "content": "Legitimate note from origin",
          },
        };
      }
      throw new Error("Document not found");
    };

    // Should fetch from origin instead of trusting embedded object
    const result = await create.getObject({
      documentLoader: objectDocumentLoader,
    });
    assertInstanceOf(result, Note);
    deepStrictEqual(result?.content, "Legitimate note from origin");
  },
);

test("FEP-fe34: Constructor vs JSON-LD parsing trust difference", async () => {
  // 1. Constructor-created objects: embedded objects are trusted
  const constructorCreate = new Create({
    id: new URL("https://example.com/create"),
    actor: new URL("https://example.com/actor"),
    object: new Note({
      id: new URL("https://different-origin.com/note"), // Different origin!
      content: "Constructor embedded note",
    }),
  });

  // Should return the embedded object directly (trusted)
  const constructorResult = await constructorCreate.getObject();
  deepStrictEqual(constructorResult?.content, "Constructor embedded note");

  // 2. JSON-LD parsed objects: embedded objects are NOT trusted
  const jsonLdCreate = await Create.fromJsonLd({
    "@context": "https://www.w3.org/ns/activitystreams",
    "@type": "Create",
    "@id": "https://example.com/create",
    "actor": "https://example.com/actor",
    "object": {
      "@type": "Note",
      "@id": "https://different-origin.com/note", // Same different origin!
      "content": "JSON-LD embedded note",
    },
  });

  // Mock document loader for the cross-origin fetch
  // deno-lint-ignore require-await
  const documentLoader = async (url: string) => {
    if (url === "https://different-origin.com/note") {
      return {
        documentUrl: url,
        contextUrl: null,
        document: {
          "@context": "https://www.w3.org/ns/activitystreams",
          "@type": "Note",
          "@id": "https://different-origin.com/note",
          "content": "Fetched from origin",
        },
      };
    }
    throw new Error("Document not found");
  };

  // Should fetch from origin instead of using embedded object (not trusted)
  const jsonLdResult = await jsonLdCreate.getObject({ documentLoader });
  deepStrictEqual(jsonLdResult?.content, "Fetched from origin");
});

test("FEP-fe34: Array properties respect cross-origin policy", async () => {
  // deno-lint-ignore require-await
  const crossOriginDocumentLoader = async (url: string) => {
    if (url === "https://different-origin.com/note1") {
      return {
        documentUrl: url,
        contextUrl: null,
        document: {
          "@context": "https://www.w3.org/ns/activitystreams",
          "@type": "Note",
          "@id": "https://malicious.com/fake-note1", // Different origin!
          "content": "Fake note 1",
        },
      };
    } else if (url === "https://example.com/note2") {
      return {
        documentUrl: url,
        contextUrl: null,
        document: {
          "@context": "https://www.w3.org/ns/activitystreams",
          "@type": "Note",
          "@id": "https://example.com/note2", // Same origin
          "content": "Legitimate note 2",
        },
      };
    }
    throw new Error("Document not found");
  };

  const collection = new Collection({
    id: new URL("https://example.com/collection"),
    items: [
      new URL("https://different-origin.com/note1"), // Cross-origin
      new URL("https://example.com/note2"), // Same origin
    ],
  });

  const items = [];
  for await (
    const item of collection.getItems({
      documentLoader: crossOriginDocumentLoader,
    })
  ) {
    items.push(item);
  }

  // Should only get the same-origin item, cross-origin item should be filtered out
  deepStrictEqual(items.length, 1);
  assertInstanceOf(items[0], Note);
  deepStrictEqual((items[0] as Note).content, "Legitimate note 2");
});

test("FEP-fe34: Array properties with crossOrigin trust option", async () => {
  // deno-lint-ignore require-await
  const crossOriginDocumentLoader = async (url: string) => {
    if (url === "https://different-origin.com/note1") {
      return {
        documentUrl: url,
        contextUrl: null,
        document: {
          "@context": "https://www.w3.org/ns/activitystreams",
          "@type": "Note",
          "@id": "https://malicious.com/fake-note1", // Different origin!
          "content": "Fake note 1",
        },
      };
    } else if (url === "https://example.com/note2") {
      return {
        documentUrl: url,
        contextUrl: null,
        document: {
          "@context": "https://www.w3.org/ns/activitystreams",
          "@type": "Note",
          "@id": "https://example.com/note2", // Same origin
          "content": "Legitimate note 2",
        },
      };
    }
    throw new Error("Document not found");
  };

  const collection = new Collection({
    id: new URL("https://example.com/collection"),
    items: [
      new URL("https://different-origin.com/note1"), // Cross-origin
      new URL("https://example.com/note2"), // Same origin
    ],
  });

  const items = [];
  for await (
    const item of collection.getItems({
      documentLoader: crossOriginDocumentLoader,
      crossOrigin: "trust",
    })
  ) {
    items.push(item);
  }

  // Should get both items when trust mode is enabled
  deepStrictEqual(items.length, 2);
  assertInstanceOf(items[0], Note);
  assertInstanceOf(items[1], Note);
  deepStrictEqual((items[0] as Note).content, "Fake note 1");
  deepStrictEqual((items[1] as Note).content, "Legitimate note 2");
});

test(
  "FEP-fe34: Embedded objects in arrays from JSON-LD respect cross-origin policy",
  async () => {
    // Mock document loader for creating the Collection object from JSON-LD
    // deno-lint-ignore require-await
    const collectionDocumentLoader = async (url: string) => {
      if (url === "https://example.com/collection") {
        return {
          documentUrl: url,
          contextUrl: null,
          document: {
            "@context": "https://www.w3.org/ns/activitystreams",
            "@type": "Collection",
            "@id": "https://example.com/collection",
            "items": [
              {
                "@type": "Note",
                "@id": "https://example.com/trusted-note", // Same origin
                "content": "Trusted embedded note from JSON-LD",
              },
              {
                "@type": "Note",
                "@id": "https://different-origin.com/untrusted-note", // Different origin!
                "content": "Untrusted embedded note from JSON-LD",
              },
            ],
          },
        };
      }
      throw new Error("Document not found");
    };

    // Create collection from JSON-LD (embedded objects won't be trusted)
    const collection = await Collection.fromJsonLd(
      await collectionDocumentLoader("https://example.com/collection").then((
        r,
      ) => r.document),
      { documentLoader: collectionDocumentLoader },
    );

    // Mock document loader for fetching objects
    // deno-lint-ignore require-await
    const itemDocumentLoader = async (url: string) => {
      if (url === "https://example.com/trusted-note") {
        return {
          documentUrl: url,
          contextUrl: null,
          document: {
            "@context": "https://www.w3.org/ns/activitystreams",
            "@type": "Note",
            "@id": "https://example.com/trusted-note",
            "content": "Trusted note from origin",
          },
        };
      } else if (url === "https://different-origin.com/untrusted-note") {
        return {
          documentUrl: url,
          contextUrl: null,
          document: {
            "@context": "https://www.w3.org/ns/activitystreams",
            "@type": "Note",
            "@id": "https://different-origin.com/untrusted-note",
            "content": "Legitimate note from actual origin",
          },
        };
      }
      throw new Error("Document not found");
    };

    const items = [];
    for await (
      const item of collection.getItems({ documentLoader: itemDocumentLoader })
    ) {
      items.push(item);
    }

    // Should get both items
    deepStrictEqual(items.length, 2);

    // First item (same origin) - should use embedded object since it's same-origin as parent
    assertInstanceOf(items[0], Note);
    deepStrictEqual(
      (items[0] as Note).content,
      "Trusted embedded note from JSON-LD",
    );

    // Second item (cross-origin) - should be fetched from origin, not embedded version
    assertInstanceOf(items[1], Note);
    deepStrictEqual(
      (items[1] as Note).content,
      "Legitimate note from actual origin",
    );
  },
);

function getAllProperties(
  type: TypeSchema,
  types: Record<string, TypeSchema>,
): PropertySchema[] {
  const props: PropertySchema[] = type.properties;
  if (type.extends != null) {
    props.push(...getAllProperties(types[type.extends], types));
  }
  return props;
}

const ed25519PublicKey = new CryptographicKey({
  id: new URL("https://example.com/person2#key4"),
  owner: new URL("https://example.com/person2"),
  publicKey: await crypto.subtle.importKey(
    "jwk",
    {
      crv: "Ed25519",
      ext: true,
      key_ops: ["verify"],
      kty: "OKP",
      // cSpell: disable
      x: "LR8epAGDe-cVq5p2Tx49CCfphpk1rNhkNoY9i-XEUfg",
      // cSpell: enable
    },
    "Ed25519",
    true,
    ["verify"],
  ),
}) as CryptographicKey & { publicKey: CryptoKey };

const rsaPublicKey = new CryptographicKey({
  id: new URL("https://example.com/key"),
  owner: new URL("https://example.com/person"),
  publicKey: await crypto.subtle.importKey(
    "jwk",
    {
      kty: "RSA",
      alg: "RS256",
      // cSpell: disable
      n: "yIB9rotX8G6r6_6toT-x24BUiQ_HaPH1Em9dOt4c94s-OPFoEdH7DY7Iym9A8Ll" +
        "H4JaGF8KD38bLHWe1S4x0jV3gHJKhK7veJfGZCKUENcQecBZ-YWUs5HWvUIX1vVB" +
        "__0luHrg6BQKGOrSOE-WIAxyr0qsWCFfZzQrvSnUD2yvg1arJX2xhms14uxoRd5K" +
        "g9efKSCmmQaNEapicARUmFWrIEpGFa_nUUnqimssAGw1eZFqf3wA4TjhsuARBhGa" +
        "Jtv_3KEa016eMZxy3kDlOjZnXZTaTgWkXdodwUvy8563fes3Al6BlcS2iJ9qbtha" +
        "8rSm0FHqoUKH73JsLPKQIwQ",
      e: "AQAB",
      // cSpell: enable
      key_ops: ["verify"],
      ext: true,
    },
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    true,
    ["verify"],
  ),
}) as CryptographicKey & { publicKey: CryptoKey };

// deno-lint-ignore no-explicit-any
const sampleValues: Record<string, any> = {
  "http://www.w3.org/2001/XMLSchema#boolean": true,
  "http://www.w3.org/2001/XMLSchema#integer": -123,
  "http://www.w3.org/2001/XMLSchema#nonNegativeInteger": 123,
  "http://www.w3.org/2001/XMLSchema#float": 12.34,
  "http://www.w3.org/2001/XMLSchema#string": "hello",
  "http://www.w3.org/2001/XMLSchema#anyURI": new URL("https://example.com/"),
  "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString": new LanguageString(
    "hello",
    "en",
  ),
  "http://www.w3.org/2001/XMLSchema#dateTime": Temporal.Instant.from(
    "2024-03-03T08:30:06.796196096Z",
  ),
  "http://www.w3.org/2001/XMLSchema#duration": Temporal.Duration.from({
    hours: 1,
  }),
  "https://w3id.org/security#cryptosuiteString": "eddsa-jcs-2022",
  // deno-fmt-ignore
  "https://w3id.org/security#multibase": new Uint8Array([
    0x8f, 0x9b, 0x5a, 0xc9, 0x14, 0x17, 0xd0, 0xd1, 0x88, 0xbe, 0xfa, 0x85,
    0x8f, 0x74, 0x44, 0x98, 0x1d, 0xc8, 0x79, 0xda, 0xba, 0x50, 0x98, 0x3c,
    0x43, 0xeb, 0xcf, 0x72, 0x5f, 0x38, 0x58, 0x11, 0x9f, 0x23, 0xc5, 0xbf,
    0x84, 0x23, 0x76, 0xa2, 0x1d, 0x53, 0xc0, 0xbe, 0x1a, 0xaa, 0x96, 0x6e,
    0x30, 0x65, 0x59, 0x76, 0xf0, 0xb0, 0xdb, 0x78, 0x0d, 0xf5, 0xc1, 0xad,
    0x3f, 0xbd, 0xf3, 0x07,
  ]),
  "fedify:langTag": new Intl.Locale("en-Latn-US"),
  "fedify:url": new URL("https://fedify.dev/"),
  "fedify:publicKey": rsaPublicKey.publicKey,
  "fedify:multibaseKey": ed25519PublicKey.publicKey,
  "fedify:proofPurpose": "assertionMethod",
  "fedify:units": "m",
};

const types: Record<string, TypeSchema> =
  navigator?.userAgent === "Cloudflare-Workers"
    ? {} // FIXME: Cloudflare Workers does not support async I/O within global scope
    : await loadSchemaFiles(import.meta.dirname!);
for (const typeUri in types) {
  const type = types[typeUri];
  // @ts-ignore: classes are all different
  const cls = vocab[type.name];
  sampleValues[typeUri] = new cls({
    "@id": "https://example.com/",
    "@type": typeUri,
  });
}

const { assertSnapshot } = await import("@std/testing/snapshot").catch(
  () => ({ assertSnapshot: () => Promise.resolve() }),
);

for (const typeUri in types) {
  const type = types[typeUri];
  // @ts-ignore: classes are all different
  const cls = vocab[type.name];
  const allProperties = getAllProperties(type, types);
  const initValues = globalThis.Object.fromEntries(
    allProperties.map((property) =>
      !property.functional
        ? [property.pluralName, property.range.map((t) => sampleValues[t])]
        : [property.singularName, sampleValues[property.range[0]]]
    ),
  );

  test(`new ${type.name}() [auto]`, async () => {
    const instance = new cls(initValues);
    for (const property of allProperties) {
      if (areAllScalarTypes(property.range, types)) {
        if (property.functional || property.singularAccessor) {
          deepStrictEqual(
            instance[property.singularName],
            sampleValues[property.range[0]],
          );
        }
        if (!property.functional) {
          deepStrictEqual(
            instance[property.pluralName],
            property.range.map((t) => sampleValues[t]),
          );
        }
      } else {
        if (property.functional || property.singularAccessor) {
          deepStrictEqual(
            await instance[`get${pascalCase(property.singularName)}`].call(
              instance,
              { documentLoader: mockDocumentLoader },
            ),
            sampleValues[property.range[0]],
          );
          deepStrictEqual(
            instance[`${property.singularName}Id`],
            sampleValues[property.range[0]].id,
          );
        }
        if (!property.functional) {
          deepStrictEqual(
            await Array.fromAsync(
              instance[`get${pascalCase(property.pluralName)}`].call(
                instance,
                { documentLoader: mockDocumentLoader },
              ),
            ),
            property.range.map((t) => sampleValues[t]),
          );
          deepStrictEqual(
            instance[`${property.singularName}Ids`],
            property.range.map((t) => sampleValues[t].id).filter((i) =>
              i != null
            ),
          );
        }
      }

      const empty = new cls({});
      for (const property of allProperties) {
        if (areAllScalarTypes(property.range, types)) {
          if (property.functional || property.singularAccessor) {
            deepStrictEqual(empty[property.singularName], null);
          }
          if (!property.functional) {
            deepStrictEqual(empty[property.pluralName], []);
          }
        } else {
          if (property.functional || property.singularAccessor) {
            deepStrictEqual(
              await empty[`get${pascalCase(property.singularName)}`].call(
                empty,
                { documentLoader: mockDocumentLoader },
              ),
              null,
            );
            deepStrictEqual(empty[`${property.singularName}Id`], null);
          }
          if (!property.functional) {
            deepStrictEqual(
              await Array.fromAsync(
                empty[`get${pascalCase(property.pluralName)}`].call(
                  empty,
                  { documentLoader: mockDocumentLoader },
                ),
              ),
              [],
            );
            deepStrictEqual(empty[`${property.singularName}Ids`], []);
          }
        }
      }
    }

    for (const property of allProperties) {
      if (!property.functional && property.singularAccessor) {
        throws(
          () =>
            new cls({
              [property.singularName]: sampleValues[property.range[0]],
              [property.pluralName]: property.range.map((t) => sampleValues[t]),
            }),
          TypeError,
        );
      }
    }

    const instance2 = new cls({
      id: new URL("https://example.com/"),
      ...globalThis.Object.fromEntries(
        allProperties.filter((p) => !areAllScalarTypes(p.range, types)).map(
          (p) =>
            p.functional
              ? [p.singularName, new URL("https://example.com/test")]
              : [p.pluralName, [new URL("https://example.com/test")]],
        ),
      ),
    });
    for (const property of allProperties) {
      if (areAllScalarTypes(property.range, types)) continue;
      if (property.functional || property.singularAccessor) {
        deepStrictEqual(
          instance2[`${property.singularName}Id`],
          new URL("https://example.com/test"),
        );
      }
      if (!property.functional) {
        deepStrictEqual(
          instance2[`${property.singularName}Ids`],
          [new URL("https://example.com/test")],
        );
      }
    }

    throws(
      () => new cls({ id: 123 as unknown as URL }),
      TypeError,
      "The id must be a URL.",
    );

    for (const property of allProperties) {
      const wrongValues = globalThis.Object.fromEntries(
        globalThis.Object.entries(initValues),
      );
      if (property.functional) {
        wrongValues[property.singularName] = {};
      } else {
        wrongValues[property.pluralName] = [{}];
      }
      throws(() => new cls(wrongValues), TypeError);
    }
  });

  test(`${type.name}.clone() [auto]`, () => {
    const instance = new cls({});
    for (const property of allProperties) {
      if (!property.functional && property.singularAccessor) {
        throws(
          () =>
            instance.clone({
              [property.singularName]: sampleValues[property.range[0]],
              [property.pluralName]: property.range.map((t) => sampleValues[t]),
            }),
          TypeError,
        );
      }
    }

    throws(
      () => instance.clone({ id: 123 as unknown as URL }),
      TypeError,
      "The id must be a URL.",
    );
    for (const property of allProperties) {
      const wrongValues = globalThis.Object.fromEntries(
        globalThis.Object.entries(initValues),
      );
      if (property.functional) {
        wrongValues[property.singularName] = {};
      } else {
        wrongValues[property.pluralName] = [{}];
      }
      throws(() => instance.clone(wrongValues), TypeError);
    }
  });

  for (const property of allProperties) {
    if (areAllScalarTypes(property.range, types)) continue;

    const docLoader = async (url: string) => {
      if (url !== `https://example.com/test`) throw new Error("Not Found");
      return {
        documentUrl: url,
        contextUrl: null,
        document: await sampleValues[property.range[0]].toJsonLd({
          contextLoader: mockDocumentLoader,
        }),
      };
    };

    if (property.functional || property.singularAccessor) {
      test(
        `${type.name}.get${pascalCase(property.singularName)}() [auto]`,
        async () => {
          const instance = new cls({
            [property.singularName]: new URL("https://example.com/test"),
          });
          const value =
            await instance[`get${pascalCase(property.singularName)}`]
              .call(instance, { documentLoader: docLoader });
          deepStrictEqual(value, sampleValues[property.range[0]]);

          if (property.untyped) return;
          const wrongRef = new cls({
            [property.singularName]: new URL("https://example.com/wrong-type"),
          });
          await rejects(
            () =>
              wrongRef[`get${pascalCase(property.singularName)}`].call(
                wrongRef,
                {
                  documentLoader: mockDocumentLoader,
                },
              ),
            TypeError,
          );
        },
      );
    }
    if (!property.functional) {
      test(
        `${type.name}.get${pascalCase(property.pluralName)}() [auto]`,
        async () => {
          const instance = new cls({
            [property.pluralName]: [new URL("https://example.com/test")],
          });
          const value = instance[`get${pascalCase(property.pluralName)}`].call(
            instance,
            { documentLoader: docLoader },
          );
          deepStrictEqual(await Array.fromAsync(value), [
            sampleValues[property.range[0]],
          ]);

          if (property.untyped) return;
          const wrongRef = new cls({
            [property.pluralName]: [new URL("https://example.com/wrong-type")],
          });
          await rejects(
            () =>
              Array.fromAsync(
                wrongRef[`get${pascalCase(property.pluralName)}`].call(
                  wrongRef,
                  {
                    documentLoader: mockDocumentLoader,
                  },
                ),
              ),
            TypeError,
          );
        },
      );
    }
  }

  test(`${type.name}.fromJsonLd() [auto]`, async () => {
    const instance = await cls.fromJsonLd(
      {
        "@id": "https://example.com/",
        "@type": typeUri,
      },
      { documentLoader: mockDocumentLoader, contextLoader: mockDocumentLoader },
    ) as vocab.Object;
    assertInstanceOf(instance, cls);
    deepStrictEqual(instance.id, new URL("https://example.com/"));
    deepStrictEqual(
      await instance.toJsonLd(),
      {
        "@id": "https://example.com/",
        "@type": typeUri,
      },
    );
    deepStrictEqual(
      await instance.toJsonLd({
        format: "compact",
        contextLoader: mockDocumentLoader,
      }),
      {
        "@context": type.defaultContext,
        "id": "https://example.com/",
        "type": type.compactName ??
          (type.name === "DataIntegrityProof" ? type.name : type.uri),
      },
    );

    if (type.extends != null) {
      await rejects(() =>
        cls.fromJsonLd({
          "@id": "https://example.com/",
          "@type": "https://example.com/",
        }), TypeError);
    }

    await rejects(() => cls.fromJsonLd(null), TypeError);
    await rejects(() => cls.fromJsonLd(undefined), TypeError);
  });

  test(`${type.name}.toJsonLd() [auto]`, async () => {
    const instance = new cls({
      id: new URL("https://example.com/"),
      ...initValues,
    });
    const jsonLd = await instance.toJsonLd({
      contextLoader: mockDocumentLoader,
    });
    deepStrictEqual(jsonLd["@context"], type.defaultContext);
    deepStrictEqual(jsonLd.id, "https://example.com/");
    const restored = await cls.fromJsonLd(jsonLd, {
      documentLoader: mockDocumentLoader,
      contextLoader: mockDocumentLoader,
    });
    deepStrictEqual(restored, instance);
    deepStrictEqual(
      await restored.toJsonLd({ contextLoader: mockDocumentLoader }),
      jsonLd,
    );

    const jsonLd2 = await instance.toJsonLd({
      contextLoader: mockDocumentLoader,
      format: "compact",
      context: "https://www.w3.org/ns/activitystreams",
    });
    deepStrictEqual(
      jsonLd2["@context"],
      "https://www.w3.org/ns/activitystreams",
    );
    deepStrictEqual(jsonLd2.id, "https://example.com/");
    const restored2 = await cls.fromJsonLd(jsonLd2, {
      documentLoader: mockDocumentLoader,
      contextLoader: mockDocumentLoader,
    });
    deepStrictEqual(restored2, instance);

    const expanded = await instance.toJsonLd({
      contextLoader: mockDocumentLoader,
      format: "expand",
    });
    const restored3 = await cls.fromJsonLd(expanded, {
      documentLoader: mockDocumentLoader,
      contextLoader: mockDocumentLoader,
    });
    deepStrictEqual(restored3, instance);

    const instance2 = new cls({
      id: new URL("https://example.com/"),
      ...initValues,
      ...globalThis.Object.fromEntries(
        allProperties.filter((p) => !areAllScalarTypes(p.range, types)).map(
          (p) =>
            p.functional
              ? [p.singularName, new URL("https://example.com/test")]
              : [p.pluralName, [new URL("https://example.com/test")]],
        ),
      ),
    });
    const jsonLd3 = await instance2.toJsonLd({
      contextLoader: mockDocumentLoader,
    });
    const restored4 = await cls.fromJsonLd(jsonLd3, {
      documentLoader: mockDocumentLoader,
      contextLoader: mockDocumentLoader,
    });
    deepStrictEqual(restored4, instance2);

    rejects(
      () =>
        instance.toJsonLd({ context: "https://www.w3.org/ns/activitystreams" }),
      TypeError,
    );
    rejects(
      () =>
        instance.toJsonLd({
          format: "expand",
          context: "https://www.w3.org/ns/activitystreams",
        }),
      TypeError,
    );
  });

  if ("Deno" in globalThis) {
    Deno.test(`Deno.inspect(${type.name}) [auto]`, async (t) => {
      const empty = new cls({});
      deepStrictEqual(Deno.inspect(empty), `${type.name} {}`);

      const instance = new cls({
        id: new URL("https://example.com/"),
        ...initValues,
      });
      await assertSnapshot(t, Deno.inspect(instance));

      const instance2 = instance.clone(
        globalThis.Object.fromEntries(
          type.properties.filter((p) => !areAllScalarTypes(p.range, types)).map(
            (p) =>
              p.functional
                ? [p.singularName, new URL("https://example.com/")]
                : [p.pluralName, [new URL("https://example.com/")]],
          ),
        ),
      );
      await assertSnapshot(t, Deno.inspect(instance2));

      const instance3 = instance.clone(
        globalThis.Object.fromEntries(
          type.properties.filter((p) => !p.functional).map(
            (p) => {
              ok(!p.functional);
              return [
                p.pluralName,
                [sampleValues[p.range[0]], sampleValues[p.range[0]]],
              ];
            },
          ),
        ),
      );
      // @ts-ignore: t is TestContext in node:test but Deno.TestContext in Deno
      await assertSnapshot(t, Deno.inspect(instance3));
    });
  }

  test(`${type.name}.typeId`, () => {
    deepStrictEqual(cls.typeId, new URL(type.uri));
  });
}
