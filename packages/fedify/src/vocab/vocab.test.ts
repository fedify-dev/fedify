import { parseLanguageTag } from "@phensley/language-tag";
import {
  assert,
  assertEquals,
  assertFalse,
  assertInstanceOf,
  assertNotEquals,
  assertRejects,
  assertThrows,
} from "@std/assert";
import { pascalCase } from "es-toolkit";
import {
  loadSchemaFiles,
  type PropertySchema,
  type TypeSchema,
} from "../codegen/schema.ts";
import { areAllScalarTypes } from "../codegen/type.ts";
import { LanguageString } from "../runtime/langstr.ts";
import { decode } from "../runtime/multibase/index.ts";
import { mockDocumentLoader } from "../testing/docloader.ts";
import { ed25519PublicKey, rsaPublicKey1 } from "../testing/keys.ts";
import { test } from "../testing/mod.ts";
import * as vocab from "./vocab.ts";
import {
  Activity,
  Announce,
  Create,
  CryptographicKey,
  type DataIntegrityProof,
  Follow,
  Hashtag,
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
  assertEquals(obj.name, "Test");
  assertEquals(obj.contents[0], new LanguageString("Hello", "en"));
  assertEquals(obj.contents[1], new LanguageString("你好", "zh"));

  assertThrows(
    () => new Object({ id: 123 as unknown as URL }),
    TypeError,
    "The id must be a URL.",
  );
  assertThrows(
    () => new Object({ name: "singular", names: ["plural"] }),
    TypeError,
    "Cannot initialize both name and names at the same time.",
  );
  assertThrows(
    () => new Object({ name: 123 as unknown as string }),
    TypeError,
    "The name must be of type string | LanguageString.",
  );
  assertThrows(
    () => new Object({ names: "foo" as unknown as string[] }),
    TypeError,
    "The names must be an array of type string | LanguageString.",
  );
  assertThrows(
    () => new Object({ names: ["foo", 123 as unknown as string] }),
    TypeError,
    "The names must be an array of type string | LanguageString.",
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
  assertEquals(clone.id, new URL("https://example.com/"));
  assertEquals(clone.name, "Test");
  assertEquals(clone.content, "Modified");

  const cloned2 = obj.clone({ id: new URL("https://example.com/modified") });
  assertInstanceOf(cloned2, Object);
  assertEquals(cloned2.id, new URL("https://example.com/modified"));
  assertEquals(cloned2.name, "Test");
  assertEquals(cloned2.contents, [
    new LanguageString("Hello", "en"),
    new LanguageString("你好", "zh"),
  ]);

  assertThrows(
    () => obj.clone({ id: 123 as unknown as URL }),
    TypeError,
    "The id must be a URL.",
  );
  assertThrows(
    () => obj.clone({ name: "singular", names: ["plural"] }),
    TypeError,
    "Cannot update both name and names at the same time.",
  );
  assertThrows(
    () => obj.clone({ name: 123 as unknown as string }),
    TypeError,
    "The name must be of type string | LanguageString.",
  );
  assertThrows(
    () => obj.clone({ names: "foo" as unknown as string[] }),
    TypeError,
    "The names must be an array of type string | LanguageString.",
  );
  assertThrows(
    () => obj.clone({ names: ["foo", 123 as unknown as string] }),
    TypeError,
    "The names must be an array of type string | LanguageString.",
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
  assertEquals(obj.name, "Test");
  assertEquals(obj.contents, [
    new LanguageString("Hello", "en"),
    new LanguageString("你好", "zh"),
  ]);
  assertInstanceOf(obj.source, Source);
  assertEquals(obj.source.content, "Hello");
  assertEquals(obj.source.mediaType, "text/plain");
  assertEquals(obj.published, Temporal.Instant.from("2025-01-01T12:34:56Z"));

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
  assertEquals(create.name, "Test");
  assertEquals(create.contents, [
    new LanguageString("Hello", "en"),
    new LanguageString("你好", "zh"),
  ]);
  assertEquals(await create.toJsonLd(), createJsonLd);
  const note = await create.getObject();
  assertInstanceOf(note, Note);
  assertEquals(note.content, "Content");

  const empty = await Object.fromJsonLd({});
  assertInstanceOf(empty, Object);

  await assertRejects(
    () => Object.fromJsonLd(null),
    TypeError,
    "Invalid JSON-LD: null.",
  );
  await assertRejects(
    () => Object.fromJsonLd(undefined),
    TypeError,
    "Invalid JSON-LD: undefined.",
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
  assertEquals(
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
  assertEquals(await obj.toJsonLd({ contextLoader: mockDocumentLoader }), {
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
  assertEquals(await note.toJsonLd({ contextLoader: mockDocumentLoader }), {
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
  assertEquals(
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
  assertEquals(
    follow.id,
    new URL("https://activitypub.academy/80c50305-7405-4e38-809f-697647a1f679"),
  );
  assertEquals(
    follow.actorId,
    new URL("https://activitypub.academy/users/egulia_anbeiss"),
  );
  assertEquals(
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
  assertEquals(proofs.length, 1);
  assertEquals(proofs[0].cryptosuite, "eddsa-jcs-2022");
  assertEquals(
    proofs[0].verificationMethodId,
    new URL("https://server.example/users/alice#ed25519-key"),
  );
  assertEquals(proofs[0].proofPurpose, "assertionMethod");
  assertEquals(
    proofs[0].proofValue,
    decode(
      // cSpell: disable
      "z3sXaxjKs4M3BRicwWA9peyNPJvJqxtGsDmpt1jjoHCjgeUf71TRFz56osPSfDErszyLp5Ks1EhYSgpDaNM977Rg2",
      // cSpell: enable
    ),
  );
  assertEquals(
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
    assertEquals(announce.id, new URL("https://example.com/announce"));

    const object = await announce.getObject();
    assertInstanceOf(object, Object);
    assertEquals(object.id, new URL("https://example.com/object"));
    assertEquals(object.name, "Fetched object");

    // Is hydration applied to toJsonLd()?
    const jsonLd = await activity.toJsonLd();
    assertEquals(jsonLd, {
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
    assertEquals(await activity2.getObject({ suppressError: true }), null);

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
    assertEquals(await object3.toJsonLd(), {
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
    assertEquals(objects.length, 2);
    assertInstanceOf(objects[0], Object);
    assertEquals(objects[0].id, new URL("https://example.com/object"));
    assertEquals(objects[0].name, "Fetched object");
    assertInstanceOf(objects[1], Object);
    assertEquals(objects[1].name, "Second object");

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
    assertEquals(objects2.length, 1);
    assertInstanceOf(objects2[0], Object);
    assertEquals(objects2[0].name, "Second object");
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
  assertEquals((await activity.getActor())?.name, "John Doe");
  assertEquals((await clone.getActor())?.name, "John Doe");
  assertEquals((await activity.getObject())?.name, "Test");
  assertEquals((await clone.getObject())?.name, "Modified");
  assertEquals(activity.name, "Test");
  assertEquals(clone.name, "Test");
  assertEquals(activity.summary, "Test");
  assertEquals(clone.summary, "Modified");

  assertThrows(
    () => activity.clone({ summary: "singular", summaries: ["plural"] }),
    TypeError,
    "Cannot update both summary and summaries at the same time.",
  );
});

test("Question.voters", async () => {
  const question = new Question({
    voters: 123,
  });
  const json = await question.toJsonLd({ format: "compact" });
  assert(typeof json === "object" && json != null);
  assert("votersCount" in json);
  assertEquals(json["votersCount"], 123);
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
    assertEquals(
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
  }, { documentLoader: mockDocumentLoader, contextLoader: mockDocumentLoader });
  assertEquals(
    person.publicKeyId,
    new URL("https://todon.eu/users/hongminhee#main-key"),
  );
  const publicKey = await person.getPublicKey({
    documentLoader: mockDocumentLoader,
  });
  assertInstanceOf(publicKey, CryptographicKey);
  assertEquals(
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
  assertEquals(
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
  assertEquals(await person.toJsonLd(), {
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
  assertEquals(await note.toJsonLd(), expected);
  assertEquals(await note.toJsonLd({ format: "compact" }), expected);

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
  assertEquals(loaded.quoteUrl, new URL("https://example.com/object"));

  delete jsonLd.quoteUrl;
  const loaded2 = await Note.fromJsonLd(jsonLd);
  assertEquals(loaded2.quoteUrl, new URL("https://example.com/object2"));

  delete jsonLd._misskey_quote;
  const loaded3 = await Note.fromJsonLd(jsonLd);
  assertEquals(loaded3.quoteUrl, new URL("https://example.com/object3"));
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
  assertEquals(jsonLd, {
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
  assertNotEquals(loadedKey.publicKey, null);
  assertEquals(await crypto.subtle.exportKey("jwk", loadedKey.publicKey!), jwk);
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
  assertEquals(place.name, "Fresno Area");
  assertEquals(place.latitude, 36.75);
  assertEquals(place.longitude, 119.7667);
  assertEquals(place.radius, 15);
  assertEquals(place.units, "miles");

  let jsonLd = await place.toJsonLd({ contextLoader: mockDocumentLoader });
  assertEquals(jsonLd, {
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
  assertEquals(jsonLd, {
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
  assertEquals(outbox.totalItems, 1);
});

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
  "fedify:langTag": parseLanguageTag("en"),
  "fedify:url": new URL("https://fedify.dev/"),
  "fedify:publicKey": rsaPublicKey1.publicKey,
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
          assertEquals(
            instance[property.singularName],
            sampleValues[property.range[0]],
          );
        }
        if (!property.functional) {
          assertEquals(
            instance[property.pluralName],
            property.range.map((t) => sampleValues[t]),
          );
        }
      } else {
        if (property.functional || property.singularAccessor) {
          assertEquals(
            await instance[`get${pascalCase(property.singularName)}`].call(
              instance,
              { documentLoader: mockDocumentLoader },
            ),
            sampleValues[property.range[0]],
          );
          assertEquals(
            instance[`${property.singularName}Id`],
            sampleValues[property.range[0]].id,
          );
        }
        if (!property.functional) {
          assertEquals(
            await Array.fromAsync(
              instance[`get${pascalCase(property.pluralName)}`].call(
                instance,
                { documentLoader: mockDocumentLoader },
              ),
            ),
            property.range.map((t) => sampleValues[t]),
          );
          assertEquals(
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
            assertEquals(empty[property.singularName], null);
          }
          if (!property.functional) {
            assertEquals(empty[property.pluralName], []);
          }
        } else {
          if (property.functional || property.singularAccessor) {
            assertEquals(
              await empty[`get${pascalCase(property.singularName)}`].call(
                empty,
                { documentLoader: mockDocumentLoader },
              ),
              null,
            );
            assertEquals(empty[`${property.singularName}Id`], null);
          }
          if (!property.functional) {
            assertEquals(
              await Array.fromAsync(
                empty[`get${pascalCase(property.pluralName)}`].call(
                  empty,
                  { documentLoader: mockDocumentLoader },
                ),
              ),
              [],
            );
            assertEquals(empty[`${property.singularName}Ids`], []);
          }
        }
      }
    }

    for (const property of allProperties) {
      if (!property.functional && property.singularAccessor) {
        assertThrows(
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
        assertEquals(
          instance2[`${property.singularName}Id`],
          new URL("https://example.com/test"),
        );
      }
      if (!property.functional) {
        assertEquals(
          instance2[`${property.singularName}Ids`],
          [new URL("https://example.com/test")],
        );
      }
    }

    assertThrows(
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
      assertThrows(() => new cls(wrongValues), TypeError);
    }
  });

  test(`${type.name}.clone() [auto]`, () => {
    const instance = new cls({});
    for (const property of allProperties) {
      if (!property.functional && property.singularAccessor) {
        assertThrows(
          () =>
            instance.clone({
              [property.singularName]: sampleValues[property.range[0]],
              [property.pluralName]: property.range.map((t) => sampleValues[t]),
            }),
          TypeError,
        );
      }
    }

    assertThrows(
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
      assertThrows(() => instance.clone(wrongValues), TypeError);
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
      test(`${type.name}.get${pascalCase(property.singularName)}() [auto]`, async () => {
        const instance = new cls({
          [property.singularName]: new URL("https://example.com/test"),
        });
        const value = await instance[`get${pascalCase(property.singularName)}`]
          .call(instance, { documentLoader: docLoader });
        assertEquals(value, sampleValues[property.range[0]]);

        if (property.untyped) return;
        const wrongRef = new cls({
          [property.singularName]: new URL("https://example.com/wrong-type"),
        });
        await assertRejects(
          () =>
            wrongRef[`get${pascalCase(property.singularName)}`].call(
              wrongRef,
              {
                documentLoader: mockDocumentLoader,
              },
            ),
          TypeError,
        );
      });
    }
    if (!property.functional) {
      test(`${type.name}.get${pascalCase(property.pluralName)}() [auto]`, async () => {
        const instance = new cls({
          [property.pluralName]: [new URL("https://example.com/test")],
        });
        const value = instance[`get${pascalCase(property.pluralName)}`].call(
          instance,
          { documentLoader: docLoader },
        );
        assertEquals(await Array.fromAsync(value), [
          sampleValues[property.range[0]],
        ]);

        if (property.untyped) return;
        const wrongRef = new cls({
          [property.pluralName]: [new URL("https://example.com/wrong-type")],
        });
        await assertRejects(
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
      });
    }
  }

  test(`${type.name}.fromJsonLd() [auto]`, async () => {
    const instance = await cls.fromJsonLd(
      {
        "@id": "https://example.com/",
        "@type": typeUri,
      },
      { documentLoader: mockDocumentLoader, contextLoader: mockDocumentLoader },
    );
    assertInstanceOf(instance, cls);
    assertEquals(instance.id, new URL("https://example.com/"));
    assertEquals(
      await instance.toJsonLd(),
      {
        "@id": "https://example.com/",
        "@type": typeUri,
      },
    );
    assertEquals(
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
      await assertRejects(() =>
        cls.fromJsonLd({
          "@id": "https://example.com/",
          "@type": "https://example.com/",
        }), TypeError);
    }

    await assertRejects(() => cls.fromJsonLd(null), TypeError);
    await assertRejects(() => cls.fromJsonLd(undefined), TypeError);
  });

  test(`${type.name}.toJsonLd() [auto]`, async () => {
    const instance = new cls({
      id: new URL("https://example.com/"),
      ...initValues,
    });
    const jsonLd = await instance.toJsonLd({
      contextLoader: mockDocumentLoader,
    });
    assertEquals(jsonLd["@context"], type.defaultContext);
    assertEquals(jsonLd.id, "https://example.com/");
    const restored = await cls.fromJsonLd(jsonLd, {
      documentLoader: mockDocumentLoader,
      contextLoader: mockDocumentLoader,
    });
    assertEquals(restored, instance);
    assertEquals(
      await restored.toJsonLd({ contextLoader: mockDocumentLoader }),
      jsonLd,
    );

    const jsonLd2 = await instance.toJsonLd({
      contextLoader: mockDocumentLoader,
      format: "compact",
      context: "https://www.w3.org/ns/activitystreams",
    });
    assertEquals(jsonLd2["@context"], "https://www.w3.org/ns/activitystreams");
    assertEquals(jsonLd2.id, "https://example.com/");
    const restored2 = await cls.fromJsonLd(jsonLd2, {
      documentLoader: mockDocumentLoader,
      contextLoader: mockDocumentLoader,
    });
    assertEquals(restored2, instance);

    const expanded = await instance.toJsonLd({
      contextLoader: mockDocumentLoader,
      format: "expand",
    });
    const restored3 = await cls.fromJsonLd(expanded, {
      documentLoader: mockDocumentLoader,
      contextLoader: mockDocumentLoader,
    });
    assertEquals(restored3, instance);

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
    assertEquals(restored4, instance2);

    assertRejects(
      () =>
        instance.toJsonLd({ context: "https://www.w3.org/ns/activitystreams" }),
      TypeError,
    );
    assertRejects(
      () =>
        instance.toJsonLd({
          format: "expand",
          context: "https://www.w3.org/ns/activitystreams",
        }),
      TypeError,
    );
  });

  if ("Deno" in globalThis) {
    const { assertSnapshot } = await import("@std/testing/snapshot").catch(
      () => ({ assertSnapshot: () => Promise.resolve() }),
    );

    test(`Deno.inspect(${type.name}) [auto]`, async (t) => {
      const empty = new cls({});
      assertEquals(Deno.inspect(empty), `${type.name} {}`);

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
              assertFalse(p.functional);
              return [
                p.pluralName,
                [sampleValues[p.range[0]], sampleValues[p.range[0]]],
              ];
            },
          ),
        ),
      );
      await assertSnapshot(t, Deno.inspect(instance3));
    });
  }

  test(`${type.name}.typeId`, () => {
    assertEquals(cls.typeId, new URL(type.uri));
  });
}
