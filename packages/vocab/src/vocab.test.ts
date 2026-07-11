import { mockDocumentLoader, test } from "@fedify/fixture";
import {
  decodeMultibase,
  type DocumentLoader,
  LanguageString,
  parseDecimal,
  type RemoteDocument,
} from "@fedify/vocab-runtime";
import {
  areAllScalarTypes,
  loadSchemaFiles,
  type PropertySchema,
  type TypeSchema,
} from "@fedify/vocab-tools";
import { configure, type LogRecord, reset } from "@logtape/logtape";
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
  Accept,
  Activity,
  Agreement,
  Announce,
  Application,
  Collection,
  Commitment,
  Create,
  CryptographicKey,
  type DataIntegrityProof,
  Delete,
  Document,
  Endpoints,
  FeatureAuthorization,
  FeaturedCollection,
  FeaturedItem,
  FeatureRequest,
  Follow,
  Group,
  Hashtag,
  Image,
  Intent,
  InteractionPolicy,
  InteractionRule,
  Link,
  Measure,
  Multikey,
  Note,
  Object,
  Offer,
  OrderedCollectionPage,
  Organization,
  Person,
  Place,
  Proposal,
  Question,
  QuoteAuthorization,
  QuoteRequest,
  Reject,
  Service,
  Source,
  Tombstone,
} from "./vocab.ts";

const NOTE_QUOTE_CONTEXT = [
  "https://www.w3.org/ns/activitystreams",
  "https://w3id.org/security/data-integrity/v1",
  "https://gotosocial.org/ns",
  {
    Emoji: "toot:Emoji",
    Hashtag: "as:Hashtag",
    _misskey_quote: "misskey:_misskey_quote",
    QuoteAuthorization: "https://w3id.org/fep/044f#QuoteAuthorization",
    fedibird: "http://fedibird.com/ns#",
    misskey: "https://misskey-hub.net/ns#",
    quote: {
      "@id": "https://w3id.org/fep/044f#quote",
      "@type": "@id",
    },
    quoteAuthorization: {
      "@id": "https://w3id.org/fep/044f#quoteAuthorization",
      "@type": "@id",
    },
    quoteUri: "fedibird:quoteUri",
    quoteUrl: "as:quoteUrl",
    sensitive: "as:sensitive",
    toot: "http://joinmastodon.org/ns#",
    emojiReactions: {
      "@id": "fedibird:emojiReactions",
      "@type": "@id",
    },
  },
] as const;

const QUOTE_REQUEST_CONTEXT = [
  "https://w3id.org/identity/v1",
  "https://www.w3.org/ns/activitystreams",
  "https://w3id.org/security/data-integrity/v1",
  "https://gotosocial.org/ns",
  {
    ...NOTE_QUOTE_CONTEXT[3],
    ChatMessage: "http://litepub.social/ns#ChatMessage",
    QuoteRequest: "https://w3id.org/fep/044f#QuoteRequest",
    votersCount: {
      "@id": "toot:votersCount",
      "@type": "http://www.w3.org/2001/XMLSchema#nonNegativeInteger",
    },
  },
] as const;

const FEATURE_CONTEXT = [
  "https://www.w3.org/ns/activitystreams",
  "https://w3id.org/security/data-integrity/v1",
  "https://gotosocial.org/ns",
  "https://w3id.org/fep/7aa9",
] as const;

const FEATURED_COLLECTION_CONTEXT = [
  ...FEATURE_CONTEXT,
  {
    Hashtag: "as:Hashtag",
    discoverable: "toot:discoverable",
    sensitive: "as:sensitive",
    toot: "http://joinmastodon.org/ns#",
  },
] as const;

const DELETE_QUOTE_REQUEST_CONTEXT = [
  "https://w3id.org/identity/v1",
  "https://www.w3.org/ns/activitystreams",
  "https://w3id.org/security/data-integrity/v1",
  "https://gotosocial.org/ns",
  {
    ChatMessage: "http://litepub.social/ns#ChatMessage",
    Emoji: "toot:Emoji",
    Hashtag: "as:Hashtag",
    QuoteAuthorization: "https://w3id.org/fep/044f#QuoteAuthorization",
    QuoteRequest: "https://w3id.org/fep/044f#QuoteRequest",
    _misskey_quote: "misskey:_misskey_quote",
    fedibird: "http://fedibird.com/ns#",
    misskey: "https://misskey-hub.net/ns#",
    quote: {
      "@id": "https://w3id.org/fep/044f#quote",
      "@type": "@id",
    },
    quoteAuthorization: {
      "@id": "https://w3id.org/fep/044f#quoteAuthorization",
      "@type": "@id",
    },
    quoteUri: "fedibird:quoteUri",
    quoteUrl: "as:quoteUrl",
    sensitive: "as:sensitive",
    toot: "http://joinmastodon.org/ns#",
    votersCount: {
      "@id": "toot:votersCount",
      "@type": "http://www.w3.org/2001/XMLSchema#nonNegativeInteger",
    },
  },
] as const;

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

test(
  // Regression test for
  // https://github.com/fedify-dev/fedify/issues/767:
  // values produced by a `Temporal` implementation other than the one bundled
  // with Fedify (e.g. Node.js 26+ native `Temporal`) must be accepted as
  // long as they conform to the spec-mandated `Symbol.toStringTag`.
  "new Object() accepts foreign Temporal.Instant (issue #767)",
  () => {
    const foreignInstant = globalThis.Object.create(
      globalThis.Object.prototype,
      {
        [Symbol.toStringTag]: { value: "Temporal.Instant" },
        epochNanoseconds: { value: 0n },
        toString: { value: () => "1970-01-01T00:00:00Z" },
      },
    ) as Temporal.Instant;
    const obj = new Object({ published: foreignInstant });
    ok(obj.published === foreignInstant);
  },
);

test(
  "Object.clone() accepts foreign Temporal.Instant (issue #767)",
  () => {
    const foreignInstant = globalThis.Object.create(
      globalThis.Object.prototype,
      {
        [Symbol.toStringTag]: { value: "Temporal.Instant" },
        epochNanoseconds: { value: 0n },
        toString: { value: () => "1970-01-01T00:00:00Z" },
      },
    ) as Temporal.Instant;
    const obj = new Object({}).clone({ published: foreignInstant });
    ok(obj.published === foreignInstant);
  },
);

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
      "https://gotosocial.org/ns",
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
    "@context": NOTE_QUOTE_CONTEXT,
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

test("fromJsonLd() handles portable ActivityPub IRIs", async () => {
  const did = "did:key:z6Mkabc";
  const portableActor =
    `ap://${did}/actor?gateways=https%3A%2F%2Fserver.example`;
  const portableObject =
    `ap://${did}/objects/1?gateways=https%3A%2F%2Fserver.example`;
  const uppercasePortableObject =
    `AP://${did}/objects/1?gateways=https%3A%2F%2Fserver.example`;
  const portablePage = `ap://${did}/actor/outbox?page=2`;

  const note = await Note.fromJsonLd({
    "@context": "https://www.w3.org/ns/activitystreams",
    type: "Note",
    id: uppercasePortableObject,
    attributedTo: `ap+ef61://${
      encodeURIComponent(did)
    }/actor?gateways=https%3A%2F%2Fserver.example`,
  }, { documentLoader: mockDocumentLoader, contextLoader: mockDocumentLoader });
  deepStrictEqual(
    note.id,
    new URL(
      "ap+ef61://did%3Akey%3Az6Mkabc/objects/1?gateways=https%3A%2F%2Fserver.example",
    ),
  );
  deepStrictEqual(
    note.attributionId,
    new URL(
      "ap+ef61://did%3Akey%3Az6Mkabc/actor?gateways=https%3A%2F%2Fserver.example",
    ),
  );
  const noteJson = await note.toJsonLd({
    contextLoader: mockDocumentLoader,
  }) as Record<string, unknown>;
  deepStrictEqual(noteJson.type, "Note");
  deepStrictEqual(
    noteJson.id,
    "ap+ef61://did:key:z6Mkabc/objects/1?gateways=https%3A%2F%2Fserver.example",
  );
  deepStrictEqual(
    noteJson.attributedTo,
    "ap+ef61://did:key:z6Mkabc/actor?gateways=https%3A%2F%2Fserver.example",
  );

  const activity = await Activity.fromJsonLd({
    "@context": "https://www.w3.org/ns/activitystreams",
    type: "Create",
    actor: portableActor,
    object: portableObject,
  }, { documentLoader: mockDocumentLoader, contextLoader: mockDocumentLoader });
  deepStrictEqual(
    activity.actorId,
    new URL(
      "ap+ef61://did%3Akey%3Az6Mkabc/actor?gateways=https%3A%2F%2Fserver.example",
    ),
  );
  const activityJson = await activity.toJsonLd({
    contextLoader: mockDocumentLoader,
  }) as Record<string, unknown>;
  deepStrictEqual(activityJson.type, "Create");
  deepStrictEqual(
    activityJson.actor,
    "ap+ef61://did:key:z6Mkabc/actor?gateways=https%3A%2F%2Fserver.example",
  );
  deepStrictEqual(
    activityJson.object,
    "ap+ef61://did:key:z6Mkabc/objects/1?gateways=https%3A%2F%2Fserver.example",
  );

  const person = await Person.fromJsonLd({
    "@context": "https://www.w3.org/ns/activitystreams",
    type: "Person",
    inbox: `ap+ef61://${did}/actor/inbox`,
    outbox: `ap+ef61://${did}/actor/outbox`,
  }, { documentLoader: mockDocumentLoader, contextLoader: mockDocumentLoader });
  deepStrictEqual(
    person.inboxId,
    new URL("ap+ef61://did%3Akey%3Az6Mkabc/actor/inbox"),
  );
  deepStrictEqual(
    person.outboxId,
    new URL("ap+ef61://did%3Akey%3Az6Mkabc/actor/outbox"),
  );
  const personJson = await person.toJsonLd({
    contextLoader: mockDocumentLoader,
  }) as Record<string, unknown>;
  deepStrictEqual(personJson.type, "Person");
  deepStrictEqual(personJson.inbox, "ap+ef61://did:key:z6Mkabc/actor/inbox");
  deepStrictEqual(
    personJson.outbox,
    "ap+ef61://did:key:z6Mkabc/actor/outbox",
  );

  const page = await OrderedCollectionPage.fromJsonLd({
    "@context": "https://www.w3.org/ns/activitystreams",
    type: "OrderedCollectionPage",
    next: portablePage,
    prev: `ap+ef61://${encodeURIComponent(did)}/actor/outbox?page=1`,
  }, { documentLoader: mockDocumentLoader, contextLoader: mockDocumentLoader });
  deepStrictEqual(
    page.nextId,
    new URL("ap+ef61://did%3Akey%3Az6Mkabc/actor/outbox?page=2"),
  );
  deepStrictEqual(
    page.prevId,
    new URL("ap+ef61://did%3Akey%3Az6Mkabc/actor/outbox?page=1"),
  );
  const pageJson = await page.toJsonLd({
    contextLoader: mockDocumentLoader,
  }) as Record<string, unknown>;
  deepStrictEqual(pageJson.type, "OrderedCollectionPage");
  deepStrictEqual(
    pageJson.next,
    "ap+ef61://did:key:z6Mkabc/actor/outbox?page=2",
  );
  deepStrictEqual(
    pageJson.prev,
    "ap+ef61://did:key:z6Mkabc/actor/outbox?page=1",
  );
});

test("FEP-ef61: actor gateways round-trip as an ordered URI list", async () => {
  const actorClasses = [Application, Group, Organization, Person, Service];
  const gateways = [
    new URL("https://server1.example/"),
    new URL("https://server2.example/"),
  ];

  for (const ActorClass of actorClasses) {
    const actor = await ActorClass.fromJsonLd({
      "@context": [
        "https://www.w3.org/ns/activitystreams",
        "https://w3id.org/fep/ef61",
      ],
      type: ActorClass.name,
      id: "ap+ef61://did:key:z6Mkabc/actor",
      gateways: gateways.map((gateway) => gateway.href),
    });
    deepStrictEqual(actor.gateways, gateways);

    const jsonLd = await actor.toJsonLd() as Record<string, unknown>;
    deepStrictEqual(jsonLd.type, ActorClass.name);
    deepStrictEqual(jsonLd.gateways, gateways.map((gateway) => gateway.href));

    const restored = await ActorClass.fromJsonLd(jsonLd);
    deepStrictEqual(restored.gateways, gateways);
  }
});

test("FEP-ef61: actor gateways preserve single, empty, and invalid cases", async () => {
  const singleGateway = new Person({
    id: new URL("ap+ef61://did%3Akey%3Az6Mkabc/actor"),
    gateways: [new URL("https://server.example/")],
  });
  deepStrictEqual(
    (await singleGateway.toJsonLd() as Record<string, unknown>).gateways,
    ["https://server.example/"],
  );

  const noGateways = new Person({
    id: new URL("ap+ef61://did%3Akey%3Az6Mkabc/actor"),
    gateways: [],
  });
  ok(!("gateways" in (await noGateways.toJsonLd() as Record<string, unknown>)));

  await rejects(
    () =>
      Person.fromJsonLd({
        "@context": [
          "https://www.w3.org/ns/activitystreams",
          "https://w3id.org/fep/ef61",
        ],
        type: "Person",
        gateways: ["not a uri"],
      }),
    TypeError,
  );
});

test("FEP-ef61: actor gateways accept @id typed JSON-LD references", async () => {
  const actor = await Person.fromJsonLd({
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      {
        gateways: {
          "@id": "https://w3id.org/fep/ef61/gateways",
          "@type": "@id",
          "@container": "@list",
        },
      },
    ],
    type: "Person",
    id: "ap+ef61://did:key:z6Mkabc/actor",
    gateways: ["https://gateway.example/"],
  });

  deepStrictEqual(actor.gateways, [new URL("https://gateway.example/")]);
});

test("FEP-ef61: actor gateways must be HTTP(S) base URIs", async () => {
  const validGateways = [
    new URL("https://server.example/"),
    new URL("http://server.example/"),
  ];
  const actor = new Person({
    id: new URL("ap+ef61://did%3Akey%3Az6Mkabc/actor"),
    gateways: validGateways,
  });
  deepStrictEqual(actor.gateways, validGateways);

  for (
    const gateway of [
      "ftp://server.example/",
      "https://user:pass@server.example/",
      "https://user@server.example/",
      "https://server.example/path",
      "https://server.example/?x=1",
      "https://server.example/#fragment",
    ]
  ) {
    throws(
      () =>
        new Person({
          id: new URL("ap+ef61://did%3Akey%3Az6Mkabc/actor"),
          gateways: [new URL(gateway)],
        }),
      TypeError,
    );

    await rejects(
      () =>
        Person.fromJsonLd({
          "@context": [
            "https://www.w3.org/ns/activitystreams",
            "https://w3id.org/fep/ef61",
          ],
          type: "Person",
          gateways: [gateway],
        }),
      TypeError,
    );
  }
});

test("FEP-ef61: digestMultibase round-trips on links and media objects", async () => {
  const digestMultibase = "zQmdfTbBqBPQ7VNxZEYEj14VmRuZBkqFbiwReogJgS1zR1n";

  const link = await Link.fromJsonLd({
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/fep/ef61",
    ],
    type: "Link",
    href: "hl:zQmdfTbBqBPQ7VNxZEYEj14VmRuZBkqFbiwReogJgS1zR1n",
    digestMultibase,
  });
  deepStrictEqual(link.digestMultibase, digestMultibase);
  deepStrictEqual(
    (await link.toJsonLd() as Record<string, unknown>).digestMultibase,
    digestMultibase,
  );

  for (const cls of [Document, Image]) {
    const media = await cls.fromJsonLd({
      "@context": [
        "https://www.w3.org/ns/activitystreams",
        "https://w3id.org/fep/ef61",
      ],
      type: cls.name,
      url: "hl:zQmdfTbBqBPQ7VNxZEYEj14VmRuZBkqFbiwReogJgS1zR1n",
      mediaType: "image/png",
      digestMultibase,
    });
    deepStrictEqual(media.digestMultibase, digestMultibase);
    const jsonLd = await media.toJsonLd() as Record<string, unknown>;
    deepStrictEqual(jsonLd.type, cls.name);
    deepStrictEqual(jsonLd.digestMultibase, digestMultibase);
  }
});

test("FEP-ef61: digestMultibase avoids Data Integrity context conflicts", async () => {
  const digestMultibase = "zQmdfTbBqBPQ7VNxZEYEj14VmRuZBkqFbiwReogJgS1zR1n";
  const image = new Image({
    url: new URL("hl:zQmdfTbBqBPQ7VNxZEYEj14VmRuZBkqFbiwReogJgS1zR1n"),
    mediaType: "image/png",
    digestMultibase,
  });

  const expanded = await image.toJsonLd({ format: "expand" });
  deepStrictEqual(
    (expanded as Record<string, unknown>[])[0][
      "https://www.w3.org/ns/credentials/v2#digestMultibase"
    ],
    [{ "@value": digestMultibase }],
  );
  ok(
    !(
      "https://w3id.org/security#digestMultibase" in
        (expanded as Record<string, unknown>[])[0]
    ),
  );

  const compact = await image.toJsonLd() as Record<string, unknown>;
  deepStrictEqual(compact.digestMultibase, digestMultibase);
  ok(
    !(compact["@context"] as unknown[]).includes("https://w3id.org/fep/ef61"),
  );
  ok(
    (compact["@context"] as unknown[]).some((context) =>
      context != null && typeof context === "object" &&
      (context as Record<string, unknown>).digestMultibase ===
        "https://www.w3.org/ns/credentials/v2#digestMultibase"
    ),
  );
});

test("FEP-ef61: digestMultibase parses after Data Integrity v1 contexts", async () => {
  const digestMultibase = "zQmdfTbBqBPQ7VNxZEYEj14VmRuZBkqFbiwReogJgS1zR1n";
  const image = await Image.fromJsonLd({
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/data-integrity/v1",
      "https://w3id.org/fep/ef61",
    ],
    type: "Image",
    url: "hl:zQmdfTbBqBPQ7VNxZEYEj14VmRuZBkqFbiwReogJgS1zR1n",
    mediaType: "image/png",
    digestMultibase,
  });

  deepStrictEqual(image.digestMultibase, digestMultibase);
});

test("FEP-ef61: Link image normalization preserves digestMultibase", async () => {
  const digestMultibase = "zQmdfTbBqBPQ7VNxZEYEj14VmRuZBkqFbiwReogJgS1zR1n";
  const obj = await Object.fromJsonLd({
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/data-integrity/v1",
      "https://w3id.org/fep/ef61",
    ],
    type: "Note",
    image: {
      type: "Link",
      href: "hl:zQmdfTbBqBPQ7VNxZEYEj14VmRuZBkqFbiwReogJgS1zR1n",
      mediaType: "image/png",
      digestMultibase,
    },
  });
  const images = [];
  for await (const img of obj.getImages()) {
    images.push(img);
  }

  deepStrictEqual(images[0]?.digestMultibase, digestMultibase);
});

test("fromJsonLd() caches text that mentions portable ActivityPub IRIs", async () => {
  const noteJson = {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      { extra: "https://example.com/ns#extra" },
    ],
    type: "Note",
    id: "https://example.com/notes/1",
    content: "This is text about ap://did:key:z6Mkabc/actor.",
    extra: "This extension property should stay cached.",
  };

  const note = await Note.fromJsonLd(noteJson, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });

  deepStrictEqual(await note.toJsonLd(), noteJson);
});

test("fromJsonLd() preserves extensions with portable ActivityPub IRIs", async () => {
  const note = await Note.fromJsonLd({
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      { extra: "https://example.com/ns#extra" },
    ],
    type: "Note",
    id: "ap://did:key:z6Mkabc/objects/1",
    extra: "This extension property should stay cached.",
  }, { documentLoader: mockDocumentLoader, contextLoader: mockDocumentLoader });

  const jsonLd = await note.toJsonLd() as Record<string, unknown>;
  deepStrictEqual(jsonLd.extra, "This extension property should stay cached.");
  deepStrictEqual(jsonLd.id, "ap+ef61://did:key:z6Mkabc/objects/1");
});

test("fromJsonLd() preserves unmapped terms with portable IRIs", async () => {
  const note = await Note.fromJsonLd({
    "@context": "https://www.w3.org/ns/activitystreams",
    type: "Note",
    id: "ap://did:key:z6Mkabc/objects/1",
    extra: "This unmapped property should stay cached.",
  }, { documentLoader: mockDocumentLoader, contextLoader: mockDocumentLoader });

  const jsonLd = await note.toJsonLd() as Record<string, unknown>;
  deepStrictEqual(
    jsonLd.extra,
    "This unmapped property should stay cached.",
  );
  deepStrictEqual(jsonLd.id, "ap+ef61://did:key:z6Mkabc/objects/1");
});

test("fromJsonLd() preserves expanded arrays with portable IRIs", async () => {
  const expanded = [
    {
      "@id": "https://example.com/activities/1",
      "@type": ["https://www.w3.org/ns/activitystreams#Create"],
      "https://www.w3.org/ns/activitystreams#actor": [
        { "@id": "ap://did:key:z6Mkabc/actor" },
      ],
      "https://www.w3.org/ns/activitystreams#object": [
        { "@id": "https://example.com/objects/1" },
      ],
    },
    {
      "@id": "https://example.com/objects/1",
      "@type": ["https://www.w3.org/ns/activitystreams#Note"],
      "https://www.w3.org/ns/activitystreams#content": [
        { "@value": "Sibling node should stay cached." },
      ],
    },
  ];

  const activity = await Activity.fromJsonLd(expanded, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });

  deepStrictEqual(
    activity.actorId,
    new URL("ap+ef61://did%3Akey%3Az6Mkabc/actor"),
  );
  deepStrictEqual(await activity.toJsonLd(), [
    {
      "@id": "https://example.com/activities/1",
      "@type": ["https://www.w3.org/ns/activitystreams#Create"],
      "https://www.w3.org/ns/activitystreams#actor": [
        { "@id": "ap+ef61://did:key:z6Mkabc/actor" },
      ],
      "https://www.w3.org/ns/activitystreams#object": [
        { "@id": "https://example.com/objects/1" },
      ],
    },
    {
      "@id": "https://example.com/objects/1",
      "@type": ["https://www.w3.org/ns/activitystreams#Note"],
      "https://www.w3.org/ns/activitystreams#content": [
        { "@value": "Sibling node should stay cached." },
      ],
    },
  ]);
  deepStrictEqual(expanded[0]["https://www.w3.org/ns/activitystreams#actor"], [
    { "@id": "ap://did:key:z6Mkabc/actor" },
  ]);
});

test("fromJsonLd() preserves single-node expanded arrays with portable IRIs", async () => {
  const expanded = [
    {
      "@id": "ap://did:key:z6Mkabc/objects/1",
      "@type": ["https://www.w3.org/ns/activitystreams#Note"],
      "https://www.w3.org/ns/activitystreams#attributedTo": [
        { "@id": "ap://did:key:z6Mkabc/actor" },
      ],
      "https://www.w3.org/ns/activitystreams#content": [
        { "@value": "Single expanded node should stay cached as an array." },
      ],
    },
  ];

  const note = await Note.fromJsonLd(expanded, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });

  deepStrictEqual(await note.toJsonLd(), [
    {
      "@id": "ap+ef61://did:key:z6Mkabc/objects/1",
      "@type": ["https://www.w3.org/ns/activitystreams#Note"],
      "https://www.w3.org/ns/activitystreams#attributedTo": [
        { "@id": "ap+ef61://did:key:z6Mkabc/actor" },
      ],
      "https://www.w3.org/ns/activitystreams#content": [
        { "@value": "Single expanded node should stay cached as an array." },
      ],
    },
  ]);
  deepStrictEqual(expanded[0]["@id"], "ap://did:key:z6Mkabc/objects/1");
});

test("fromJsonLd() preserves no-context object shape with portable IRIs", async () => {
  const expanded = {
    "@id": "ap://did:key:z6Mkabc/objects/1",
    "@type": ["https://www.w3.org/ns/activitystreams#Note"],
    "https://www.w3.org/ns/activitystreams#attributedTo": [
      { "@id": "ap://did:key:z6Mkabc/actor" },
    ],
    "https://www.w3.org/ns/activitystreams#content": [
      { "@value": "No-context object shape should stay cached." },
    ],
  };

  const note = await Note.fromJsonLd(expanded, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });

  deepStrictEqual(await note.toJsonLd(), {
    "@id": "ap+ef61://did:key:z6Mkabc/objects/1",
    "@type": ["https://www.w3.org/ns/activitystreams#Note"],
    "https://www.w3.org/ns/activitystreams#attributedTo": [
      { "@id": "ap+ef61://did:key:z6Mkabc/actor" },
    ],
    "https://www.w3.org/ns/activitystreams#content": [
      { "@value": "No-context object shape should stay cached." },
    ],
  });
  deepStrictEqual(expanded["@id"], "ap://did:key:z6Mkabc/objects/1");
});

test("fromJsonLd() preserves expanded subtype cache types", async () => {
  const expanded = [
    {
      "@id": "https://example.com/activities/1",
      "@type": ["https://www.w3.org/ns/activitystreams#Create"],
      "https://www.w3.org/ns/activitystreams#actor": [
        { "@id": "https://example.com/actors/alice" },
      ],
      "https://www.w3.org/ns/activitystreams#object": [
        { "@id": "https://example.com/objects/1" },
      ],
    },
    {
      "@id": "https://example.com/objects/1",
      "@type": ["https://www.w3.org/ns/activitystreams#Note"],
      "https://www.w3.org/ns/activitystreams#attributedTo": [
        { "@id": "ap://did:key:z6Mkabc/actor" },
      ],
    },
  ];

  const activity = await Activity.fromJsonLd(expanded, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });

  deepStrictEqual(await activity.toJsonLd(), [
    {
      "@id": "https://example.com/activities/1",
      "@type": ["https://www.w3.org/ns/activitystreams#Create"],
      "https://www.w3.org/ns/activitystreams#actor": [
        { "@id": "https://example.com/actors/alice" },
      ],
      "https://www.w3.org/ns/activitystreams#object": [
        { "@id": "https://example.com/objects/1" },
      ],
    },
    {
      "@id": "https://example.com/objects/1",
      "@type": ["https://www.w3.org/ns/activitystreams#Note"],
      "https://www.w3.org/ns/activitystreams#attributedTo": [
        { "@id": "ap+ef61://did:key:z6Mkabc/actor" },
      ],
    },
  ]);
  deepStrictEqual(expanded[0]["@type"], [
    "https://www.w3.org/ns/activitystreams#Create",
  ]);
});

test("fromJsonLd() preserves compact array contexts with portable IRIs", async () => {
  const note = await Note.fromJsonLd([{
    "@context": "https://www.w3.org/ns/activitystreams",
    type: "Note",
    id: "ap://did:key:z6Mkabc/objects/1",
  }], {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });

  deepStrictEqual(await note.toJsonLd(), [{
    "@context": "https://www.w3.org/ns/activitystreams",
    type: "Note",
    id: "ap+ef61://did:key:z6Mkabc/objects/1",
  }]);
});

test("fromJsonLd() preserves compact single-item arrays with portable IRIs", async () => {
  const createJson = {
    "@context": "https://www.w3.org/ns/activitystreams",
    type: "Create",
    actor: ["ap://did:key:z6Mkabc/actor"],
    object: "https://example.com/objects/1",
  };

  const create = await Create.fromJsonLd(createJson, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });

  deepStrictEqual(await create.toJsonLd(), {
    "@context": "https://www.w3.org/ns/activitystreams",
    type: "Create",
    actor: ["ap+ef61://did:key:z6Mkabc/actor"],
    object: "https://example.com/objects/1",
  });
  deepStrictEqual(createJson.actor, ["ap://did:key:z6Mkabc/actor"]);
});

test("fromJsonLd() preserves compact multi-node arrays with portable IRIs", async () => {
  const activityJson = [
    {
      "@context": "https://www.w3.org/ns/activitystreams",
      type: "Create",
      id: "https://example.com/activities/1",
      actor: "https://example.com/actors/alice",
      object: "https://example.com/objects/1",
    },
    {
      "@context": "https://www.w3.org/ns/activitystreams",
      type: "Note",
      id: "https://example.com/objects/1",
      attributedTo: "ap://did:key:z6Mkabc/actor",
    },
  ];

  const activity = await Activity.fromJsonLd(activityJson, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });

  deepStrictEqual(await activity.toJsonLd(), [
    {
      "@context": "https://www.w3.org/ns/activitystreams",
      type: "Create",
      id: "https://example.com/activities/1",
      actor: "https://example.com/actors/alice",
      object: "https://example.com/objects/1",
    },
    {
      "@context": "https://www.w3.org/ns/activitystreams",
      type: "Note",
      id: "https://example.com/objects/1",
      attributedTo: "ap+ef61://did:key:z6Mkabc/actor",
    },
  ]);
});

test("fromJsonLd() preserves nested unmapped terms with portable IRIs", async () => {
  const noteJson = {
    "@context": "https://www.w3.org/ns/activitystreams",
    type: "Note",
    id: "ap://did:key:z6Mkabc/objects/1",
    attachment: {
      type: "Object",
      name: "Attachment with an unmapped extension.",
      extra: "This nested unmapped property should stay cached.",
    },
  };

  const note = await Note.fromJsonLd(noteJson, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });

  deepStrictEqual(await note.toJsonLd(), {
    "@context": "https://www.w3.org/ns/activitystreams",
    type: "Note",
    id: "ap+ef61://did:key:z6Mkabc/objects/1",
    attachment: {
      type: "Object",
      name: "Attachment with an unmapped extension.",
      extra: "This nested unmapped property should stay cached.",
    },
  });
});

test("fromJsonLd() preserves compact array item extension contexts with portable IRIs", async () => {
  const activityJson = [
    {
      "@context": "https://www.w3.org/ns/activitystreams",
      type: "Create",
      id: "https://example.com/activities/1",
      actor: "https://example.com/actors/alice",
      object: "https://example.com/objects/1",
    },
    {
      "@context": [
        "https://www.w3.org/ns/activitystreams",
        {
          extraRef: {
            "@id": "https://example.com/ns#extraRef",
            "@type": "@id",
          },
        },
      ],
      type: "Note",
      id: "https://example.com/objects/1",
      extraRef: "ap://did:key:z6Mkabc/extra",
    },
  ];

  const activity = await Activity.fromJsonLd(activityJson, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });

  deepStrictEqual(await activity.toJsonLd(), [
    {
      "@context": "https://www.w3.org/ns/activitystreams",
      type: "Create",
      id: "https://example.com/activities/1",
      actor: "https://example.com/actors/alice",
      object: "https://example.com/objects/1",
    },
    {
      "@context": [
        "https://www.w3.org/ns/activitystreams",
        {
          extraRef: {
            "@id": "https://example.com/ns#extraRef",
            "@type": "@id",
          },
        },
      ],
      type: "Note",
      id: "https://example.com/objects/1",
      extraRef: "ap+ef61://did:key:z6Mkabc/extra",
    },
  ]);
});

test("fromJsonLd() formats portable IRIs in JSON-LD containers", async () => {
  const note = await Note.fromJsonLd({
    "@context": "https://www.w3.org/ns/activitystreams",
    type: "Note",
    id: "https://example.com/notes/1",
    attributedTo: {
      "@list": ["ap://did:key:z6Mkabc/actor"],
    },
    to: {
      "@set": ["ap://did:key:z6Mkabc/followers"],
    },
  }, { documentLoader: mockDocumentLoader, contextLoader: mockDocumentLoader });

  const jsonLd = await note.toJsonLd() as Record<string, unknown>;
  deepStrictEqual(jsonLd.attributedTo, {
    "@list": ["ap+ef61://did:key:z6Mkabc/actor"],
  });
  deepStrictEqual(jsonLd.to, "ap+ef61://did:key:z6Mkabc/followers");
});

test("fromJsonLd() formats portable IRIs hidden behind JSON-LD aliases", async () => {
  const activity = await Activity.fromJsonLd({
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      {
        as: {
          "@id": "https://www.w3.org/ns/activitystreams#",
          "@prefix": true,
        },
        extra: "https://example.com/ns#extra",
        extraRef: {
          "@id": "https://example.com/ns#extraRef",
          "@type": "@id",
        },
        actorRef: {
          "@id": "as:actor",
          "@type": "@id",
        },
        targetRef: {
          "@id": "as:target",
          "@type": "@id",
        },
      },
    ],
    type: "Create",
    actorRef: "ap://did:key:z6Mkabc/actor",
    object: "https://example.com/objects/1",
    targetRef: "ap://did:key:z6Mkabc/target",
    extra: "This extension property should stay cached.",
    extraRef: "ap://did:key:z6Mkabc/extra",
  }, { documentLoader: mockDocumentLoader, contextLoader: mockDocumentLoader });

  deepStrictEqual(
    activity.actorId,
    new URL("ap+ef61://did%3Akey%3Az6Mkabc/actor"),
  );
  deepStrictEqual(
    activity.targetId,
    new URL("ap+ef61://did%3Akey%3Az6Mkabc/target"),
  );
  const jsonLd = await activity.toJsonLd({
    contextLoader: mockDocumentLoader,
  }) as Record<string, unknown>;
  deepStrictEqual(jsonLd.actor, "ap+ef61://did:key:z6Mkabc/actor");
  deepStrictEqual("actorRef" in jsonLd, false);
  deepStrictEqual(jsonLd.target, "ap+ef61://did:key:z6Mkabc/target");
  deepStrictEqual("targetRef" in jsonLd, false);
  deepStrictEqual(jsonLd.extra, "This extension property should stay cached.");
  deepStrictEqual(jsonLd.extraRef, "ap+ef61://did:key:z6Mkabc/extra");
});

test("fromJsonLd() preserves portable IRIs in @id extension terms", async () => {
  const note = await Note.fromJsonLd({
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      {
        extraRef: {
          "@id": "https://example.com/ns#extraRef",
          "@type": "@id",
        },
      },
    ],
    type: "Note",
    id: "https://example.com/notes/1",
    extraRef: "ap://did:key:z6Mkabc/extra",
  }, { documentLoader: mockDocumentLoader, contextLoader: mockDocumentLoader });

  const jsonLd = await note.toJsonLd({
    contextLoader: mockDocumentLoader,
  }) as Record<string, unknown>;
  deepStrictEqual(jsonLd.extraRef, "ap+ef61://did:key:z6Mkabc/extra");
});

test("fromJsonLd() ignores malformed portable IRIs in extension cache terms", async () => {
  const noteJson = {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      {
        extraRef: {
          "@id": "https://example.com/ns#extraRef",
          "@type": "@id",
        },
      },
    ],
    type: "Note",
    id: "https://example.com/notes/1",
    extraRef: "ap://example.com/not-portable",
  };

  const note = await Note.fromJsonLd(noteJson, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });

  deepStrictEqual(await note.toJsonLd(), noteJson);
});

test("fromJsonLd() preserves portable IRIs in @id typed terms", async () => {
  const note = await Note.fromJsonLd({
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      {
        "@vocab": "https://example.com/ns#",
        extraRef: { "@type": "@id" },
      },
    ],
    type: "Note",
    id: "https://example.com/notes/1",
    content: "This text mentions ap://did:key:z6Mkabc/text.",
    extraRef: "ap://did:key:z6Mkabc/extra",
  }, { documentLoader: mockDocumentLoader, contextLoader: mockDocumentLoader });

  const jsonLd = await note.toJsonLd({
    contextLoader: mockDocumentLoader,
  }) as Record<string, unknown>;
  deepStrictEqual(
    jsonLd.content,
    "This text mentions ap://did:key:z6Mkabc/text.",
  );
  deepStrictEqual(jsonLd.extraRef, "ap+ef61://did:key:z6Mkabc/extra");
});

test("fromJsonLd() preserves portable IRIs hidden behind remote contexts", async () => {
  const contextUrl = "https://example.com/contexts/portable-iris";
  const contextLoader: DocumentLoader = async (
    resource: string,
    options,
  ): Promise<RemoteDocument> => {
    if (resource === contextUrl) {
      return {
        contextUrl: null,
        documentUrl: resource,
        document: {
          "@context": [
            "https://www.w3.org/ns/activitystreams",
            {
              "@vocab": "https://example.com/ns#",
              extra: "https://example.com/ns#extra",
              extraRef: { "@type": "@id" },
            },
          ],
        },
      };
    }
    return await mockDocumentLoader(resource, options);
  };
  const note = await Note.fromJsonLd({
    "@context": contextUrl,
    type: "Note",
    id: "https://example.com/notes/1",
    content: "This text mentions ap://did:key:z6Mkabc/text.",
    extra: "This extension property should stay cached.",
    extraRef: "ap://did:key:z6Mkabc/extra",
  }, { documentLoader: mockDocumentLoader, contextLoader });

  const jsonLd = await note.toJsonLd({ contextLoader }) as Record<
    string,
    unknown
  >;
  deepStrictEqual(
    jsonLd.content,
    "This text mentions ap://did:key:z6Mkabc/text.",
  );
  deepStrictEqual(jsonLd.extra, "This extension property should stay cached.");
  deepStrictEqual(jsonLd.extraRef, "ap+ef61://did:key:z6Mkabc/extra");
});

test("fromJsonLd() formats portable IRIs hidden behind nested remote contexts", async () => {
  const rootContextUrl = "https://example.com/contexts/nested-portable-iris";
  const nestedContextUrl = "https://example.com/contexts/nested-portable-ref";
  const contextLoader: DocumentLoader = async (
    resource: string,
    options,
  ): Promise<RemoteDocument> => {
    if (resource === rootContextUrl) {
      return {
        contextUrl: null,
        documentUrl: resource,
        document: {
          "@context": [
            "https://www.w3.org/ns/activitystreams",
            {
              "@vocab": "https://example.com/ns#",
              extraContainer: "https://example.com/ns#extraContainer",
            },
          ],
        },
      };
    }
    if (resource === nestedContextUrl) {
      return {
        contextUrl: null,
        documentUrl: resource,
        document: {
          "@context": {
            "@vocab": "https://example.com/ns#",
            extra: "https://example.com/ns#extra",
            extraRef: { "@type": "@id" },
          },
        },
      };
    }
    return await mockDocumentLoader(resource, options);
  };
  const note = await Note.fromJsonLd({
    "@context": rootContextUrl,
    type: "Note",
    id: "https://example.com/notes/1",
    extraContainer: {
      "@context": nestedContextUrl,
      content: "This text mentions ap://did:key:z6Mkabc/text.",
      extra: "This nested extension object should stay cached.",
      extraRef: "ap://did:key:z6Mkabc/extra",
    },
  }, { documentLoader: mockDocumentLoader, contextLoader });

  const jsonLd = await note.toJsonLd({ contextLoader }) as Record<
    string,
    unknown
  >;
  deepStrictEqual(jsonLd.extraContainer, {
    "@context": nestedContextUrl,
    content: "This text mentions ap://did:key:z6Mkabc/text.",
    extra: "This nested extension object should stay cached.",
    extraRef: { id: "ap+ef61://did:key:z6Mkabc/extra" },
  });
});

test("fromJsonLd() formats portable IRIs in sibling remote-context objects", async () => {
  const rootContextUrl = "https://example.com/contexts/sibling-containers";
  const nestedContextUrl = "https://example.com/contexts/sibling-extra-ref";
  const contextLoader: DocumentLoader = async (
    resource: string,
    options,
  ): Promise<RemoteDocument> => {
    if (resource === rootContextUrl) {
      return {
        contextUrl: null,
        documentUrl: resource,
        document: {
          "@context": [
            "https://www.w3.org/ns/activitystreams",
            {
              "@vocab": "https://example.com/ns#",
              firstExtraContainer: "https://example.com/ns#firstExtraContainer",
              secondExtraContainer:
                "https://example.com/ns#secondExtraContainer",
            },
          ],
        },
      };
    }
    if (resource === nestedContextUrl) {
      return {
        contextUrl: null,
        documentUrl: resource,
        document: {
          "@context": {
            "@vocab": "https://example.com/ns#",
            extraRef: { "@type": "@id" },
          },
        },
      };
    }
    return await mockDocumentLoader(resource, options);
  };
  const note = await Note.fromJsonLd({
    "@context": rootContextUrl,
    type: "Note",
    id: "https://example.com/notes/1",
    firstExtraContainer: {
      "@context": nestedContextUrl,
      content: "No portable IRI here.",
    },
    secondExtraContainer: {
      "@context": nestedContextUrl,
      extraRef: "ap://did:key:z6Mkabc/second",
    },
  }, { documentLoader: mockDocumentLoader, contextLoader });

  const jsonLd = await note.toJsonLd({ contextLoader }) as Record<
    string,
    unknown
  >;
  deepStrictEqual(jsonLd.firstExtraContainer, {
    "@context": nestedContextUrl,
    content: "No portable IRI here.",
  });
  deepStrictEqual(jsonLd.secondExtraContainer, {
    "@context": nestedContextUrl,
    extraRef: { id: "ap+ef61://did:key:z6Mkabc/second" },
  });
});

test("fromJsonLd() batches unmapped portable IRI term checks", async () => {
  const contextUrl = "https://example.com/contexts/batched-portable-aliases";
  let contextLoads = 0;
  const contextLoader: DocumentLoader = async (
    resource: string,
    options,
  ): Promise<RemoteDocument> => {
    if (resource === contextUrl) {
      contextLoads++;
      return {
        contextUrl: null,
        documentUrl: resource,
        document: {
          "@context": [
            "https://www.w3.org/ns/activitystreams",
            {
              as: {
                "@id": "https://www.w3.org/ns/activitystreams#",
                "@prefix": true,
              },
              actorRef0: { "@id": "as:actor", "@type": "@id" },
              actorRef1: { "@id": "as:actor", "@type": "@id" },
              targetRef0: { "@id": "as:target", "@type": "@id" },
              targetRef1: { "@id": "as:target", "@type": "@id" },
              objectRef0: { "@id": "as:object", "@type": "@id" },
              objectRef1: { "@id": "as:object", "@type": "@id" },
            },
          ],
        },
      };
    }
    return await mockDocumentLoader(resource, options);
  };

  const activity = await Activity.fromJsonLd({
    "@context": contextUrl,
    type: "Create",
    actorRef0: "ap://did:key:z6Mkabc/actor0",
    actorRef1: "ap://did:key:z6Mkabc/actor1",
    targetRef0: "ap://did:key:z6Mkabc/target0",
    targetRef1: "ap://did:key:z6Mkabc/target1",
    objectRef0: "https://example.com/objects/0",
    objectRef1: "https://example.com/objects/1",
  }, { documentLoader: mockDocumentLoader, contextLoader });

  await activity.toJsonLd({ contextLoader });

  ok(contextLoads <= 5);
});

test("fromJsonLd() falls back when portable IRI cache merge fails", async () => {
  const contextUrl = "https://example.com/contexts/failing-cache-merge";
  let contextLoads = 0;
  const contextLoader: DocumentLoader = async (
    resource: string,
    options,
  ): Promise<RemoteDocument> => {
    if (resource === contextUrl) {
      contextLoads++;
      if (contextLoads > 1) throw new Error("merge context unavailable");
      return {
        contextUrl: null,
        documentUrl: resource,
        document: {
          "@context": [
            "https://www.w3.org/ns/activitystreams",
            {
              "@vocab": "https://example.com/ns#",
              extraRef: { "@type": "@id" },
            },
          ],
        },
      };
    }
    return await mockDocumentLoader(resource, options);
  };

  const note = await Note.fromJsonLd({
    "@context": contextUrl,
    type: "Note",
    id: "ap://did:key:z6Mkabc/objects/1",
    extraRef: "ap://did:key:z6Mkabc/extra",
  }, { documentLoader: mockDocumentLoader, contextLoader });

  const jsonLd = await note.toJsonLd({
    contextLoader: mockDocumentLoader,
  }) as Record<string, unknown>;

  deepStrictEqual(jsonLd.type, "Note");
  deepStrictEqual(jsonLd.id, "ap+ef61://did:key:z6Mkabc/objects/1");
});

test("fromJsonLd() formats portable IRIs in scalar URL values", async () => {
  const note = await Note.fromJsonLd({
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://gotosocial.org/ns",
      { quoteUrl: "as:quoteUrl" },
    ],
    type: "Note",
    id: "https://example.com/notes/1",
    quoteUrl: "ap://did:key:z6Mkabc/objects/1",
  }, { documentLoader: mockDocumentLoader, contextLoader: mockDocumentLoader });

  deepStrictEqual(
    note.quoteUrl,
    new URL("ap+ef61://did%3Akey%3Az6Mkabc/objects/1"),
  );
  const jsonLd = await note.toJsonLd({
    contextLoader: mockDocumentLoader,
  }) as Record<string, unknown>;
  deepStrictEqual(jsonLd.quoteUrl, "ap+ef61://did:key:z6Mkabc/objects/1");
});

test("fromJsonLd() formats portable IRIs in URL value lists", async () => {
  const note = await Note.fromJsonLd({
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://gotosocial.org/ns",
      { quoteUrl: "as:quoteUrl" },
    ],
    type: "Note",
    id: "https://example.com/notes/1",
    quoteUrl: {
      "@list": [
        { "@value": "ap://did:key:z6Mkabc/objects/1" },
      ],
    },
  }, { documentLoader: mockDocumentLoader, contextLoader: mockDocumentLoader });

  deepStrictEqual(
    note.quoteUrl,
    new URL("ap+ef61://did%3Akey%3Az6Mkabc/objects/1"),
  );
  const jsonLd = await note.toJsonLd({
    contextLoader: mockDocumentLoader,
  }) as Record<string, unknown>;
  deepStrictEqual(jsonLd.quoteUrl, {
    "@list": [
      "ap+ef61://did:key:z6Mkabc/objects/1",
    ],
  });
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
        "https://gotosocial.org/ns",
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

test("Activity.getObject() fetches canonical portable IRIs", async () => {
  const fetchedUrls: string[] = [];
  // deno-lint-ignore require-await
  const documentLoader: DocumentLoader = async (url) => {
    fetchedUrls.push(url);
    return {
      contextUrl: null,
      documentUrl: url,
      document: {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: url,
        type: "Note",
        content: "Fetched portable object",
      },
    };
  };
  const activity = await Activity.fromJsonLd({
    "@context": "https://www.w3.org/ns/activitystreams",
    type: "Create",
    object: "ap://did:key:z6Mkabc/objects/1",
  }, { documentLoader, contextLoader: mockDocumentLoader });

  const object = await activity.getObject({
    documentLoader,
    contextLoader: mockDocumentLoader,
  });

  assertInstanceOf(object, Note);
  deepStrictEqual(fetchedUrls, ["ap+ef61://did:key:z6Mkabc/objects/1"]);
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
      "https://w3id.org/fep/ef61",
      "https://w3id.org/security/v1",
      "https://w3id.org/security/data-integrity/v1",
      "https://www.w3.org/ns/did/v1",
      "https://w3id.org/security/multikey/v1",
      "https://gotosocial.org/ns",
      "https://w3id.org/fep/7aa9",
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
        featuredCollections: {
          "@id": "https://w3id.org/fep/7aa9#featuredCollections",
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

test("Tombstone.toJsonLd() serializes formerType", async () => {
  const deleted = Temporal.Instant.from("2024-01-15T00:00:00Z");
  const tombstone = new Tombstone({
    id: new URL("https://example.com/users/alice"),
    formerType: Person,
    deleted,
  });

  deepStrictEqual(
    await tombstone.toJsonLd({ contextLoader: mockDocumentLoader }),
    {
      "@context": [
        "https://www.w3.org/ns/activitystreams",
        "https://w3id.org/security/data-integrity/v1",
        "https://gotosocial.org/ns",
      ],
      id: "https://example.com/users/alice",
      type: "Tombstone",
      formerType: "as:Person",
      deleted: "2024-01-15T00:00:00Z",
    },
  );

  const expanded = await tombstone.toJsonLd({
    format: "expand",
    contextLoader: mockDocumentLoader,
  }) as Record<string, unknown>[];
  deepStrictEqual(expanded, [{
    "@id": "https://example.com/users/alice",
    "@type": ["https://www.w3.org/ns/activitystreams#Tombstone"],
    "https://www.w3.org/ns/activitystreams#formerType": [{
      "@id": "https://www.w3.org/ns/activitystreams#Person",
    }],
    "https://www.w3.org/ns/activitystreams#deleted": [{
      "@type": "http://www.w3.org/2001/XMLSchema#dateTime",
      "@value": "2024-01-15T00:00:00Z",
    }],
  }]);
});

test("Tombstone.fromJsonLd() restores formerType", async () => {
  const tombstone = await Tombstone.fromJsonLd({
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/data-integrity/v1",
      "https://gotosocial.org/ns",
    ],
    id: "https://example.com/users/alice",
    type: "Tombstone",
    formerType: "as:Person",
    deleted: "2024-01-15T00:00:00Z",
  }, {
    contextLoader: mockDocumentLoader,
  });

  deepStrictEqual(tombstone.formerType, Person);
  deepStrictEqual(tombstone.formerTypes, [Person]);
  deepStrictEqual(
    tombstone.deleted,
    Temporal.Instant.from("2024-01-15T00:00:00Z"),
  );
});

test("Tombstone.fromJsonLd() ignores unknown formerType values", async () => {
  const records: LogRecord[] = [];
  await reset();
  try {
    await configure({
      sinks: {
        buffer(record: LogRecord): void {
          records.push(record);
        },
      },
      filters: {},
      loggers: [{ category: [], sinks: ["buffer"] }],
    });

    const tombstone = await Tombstone.fromJsonLd({
      "@id": "https://example.com/users/alice",
      "@type": ["https://www.w3.org/ns/activitystreams#Tombstone"],
      "https://www.w3.org/ns/activitystreams#formerType": [{
        "@id": "https://example.com/ns#Widget",
      }],
      "https://www.w3.org/ns/activitystreams#deleted": [{
        "@type": "http://www.w3.org/2001/XMLSchema#dateTime",
        "@value": "2024-01-15T00:00:00Z",
      }],
    });

    deepStrictEqual(tombstone.formerTypes, []);
    deepStrictEqual(
      tombstone.deleted,
      Temporal.Instant.from("2024-01-15T00:00:00Z"),
    );
    deepStrictEqual(
      records.some((record) =>
        record.rawMessage ===
          "Ignoring unknown vocabulary entity type reference: {typeId}" &&
        record.properties.typeId === "https://example.com/ns#Widget"
      ),
      true,
    );
  } finally {
    await reset();
  }
});

test("Tombstone.fromJsonLd() ignores malformed formerType values", async () => {
  const tombstone = await Tombstone.fromJsonLd({
    "@id": "https://example.com/users/alice",
    "@type": ["https://www.w3.org/ns/activitystreams#Tombstone"],
    "https://www.w3.org/ns/activitystreams#formerType": [{
      "@value": "Widget",
    }],
    "https://www.w3.org/ns/activitystreams#deleted": [{
      "@type": "http://www.w3.org/2001/XMLSchema#dateTime",
      "@value": "2024-01-15T00:00:00Z",
    }],
  });

  deepStrictEqual(tombstone.formerTypes, []);
  deepStrictEqual(
    tombstone.deleted,
    Temporal.Instant.from("2024-01-15T00:00:00Z"),
  );
});

test("Endpoints.toJsonLd() omits type", async () => {
  const ep = new Endpoints({
    sharedInbox: new URL("https://example.com/inbox"),
  });

  // Compact heuristic path (format == null)
  const compact = await ep.toJsonLd() as Record<string, unknown>;
  ok(!("type" in compact), "compact heuristic output should not have 'type'");
  deepStrictEqual(compact["sharedInbox"], "https://example.com/inbox");
  deepStrictEqual(compact["@context"], "https://www.w3.org/ns/activitystreams");

  // Expanded format
  const expanded = await ep.toJsonLd({
    format: "expand",
    contextLoader: mockDocumentLoader,
  }) as Record<string, unknown>[];
  ok(
    !("@type" in expanded[0]),
    "expanded output should not have '@type'",
  );

  // Compact via JSON-LD library
  const compactLib = await ep.toJsonLd({
    format: "compact",
    contextLoader: mockDocumentLoader,
  }) as Record<string, unknown>;
  ok(
    !("type" in compactLib),
    "compact (library) output should not have 'type'",
  );

  // Round-trip: compact heuristic → fromJsonLd → compare
  const restored = await Endpoints.fromJsonLd(compact, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  deepStrictEqual(restored, ep);
});

test("Endpoints.uploadMedia round-trips", async () => {
  const ep = new Endpoints({
    uploadMedia: new URL("https://example.com/users/alice/media"),
  });
  deepStrictEqual(
    ep.uploadMedia?.href,
    "https://example.com/users/alice/media",
  );

  const compact = await ep.toJsonLd() as Record<string, unknown>;
  deepStrictEqual(
    compact["uploadMedia"],
    "https://example.com/users/alice/media",
  );

  // Round-trip through every format under the standard AS term.
  for (const format of [undefined, "compact" as const, "expand" as const]) {
    const jsonLd = await ep.toJsonLd({
      format,
      contextLoader: mockDocumentLoader,
    });
    const restored = await Endpoints.fromJsonLd(jsonLd, {
      documentLoader: mockDocumentLoader,
      contextLoader: mockDocumentLoader,
    });
    deepStrictEqual(
      restored.uploadMedia?.href,
      "https://example.com/users/alice/media",
      `round-trip failed for format=${format ?? "heuristic"}`,
    );
  }
});

test("Source.toJsonLd() omits type", async () => {
  const src = new Source({
    content: "Hello, world!",
    mediaType: "text/plain",
  });

  // Compact heuristic path (format == null)
  const compact = await src.toJsonLd() as Record<string, unknown>;
  ok(!("type" in compact), "compact heuristic output should not have 'type'");
  deepStrictEqual(compact["mediaType"], "text/plain");

  // Expanded format
  const expanded = await src.toJsonLd({
    format: "expand",
    contextLoader: mockDocumentLoader,
  }) as Record<string, unknown>[];
  ok(
    !("@type" in expanded[0]),
    "expanded output should not have '@type'",
  );

  // Round-trip: compact heuristic → fromJsonLd → compare
  const restored = await Source.fromJsonLd(compact, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  deepStrictEqual(restored, src);
});

test("Endpoints.fromJsonLd() accepts input with @type (backward compat)", async () => {
  // Older Fedify instances may still send @type for Endpoints
  const ep = await Endpoints.fromJsonLd({
    "@context": "https://www.w3.org/ns/activitystreams",
    "type": "as:Endpoints",
    "sharedInbox": "https://example.com/inbox",
  }, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  assertInstanceOf(ep, Endpoints);
  deepStrictEqual(ep.sharedInbox?.href, "https://example.com/inbox");
});

test("Source.fromJsonLd() accepts input with @type (backward compat)", async () => {
  const src = await Source.fromJsonLd({
    "@context": "https://www.w3.org/ns/activitystreams",
    "type": "as:Source",
    "content": "Hello",
    "mediaType": "text/plain",
  }, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  assertInstanceOf(src, Source);
  deepStrictEqual(src.content, "Hello");
  deepStrictEqual(src.mediaType, "text/plain");
});

test("Endpoints with all properties set omits type", async () => {
  const ep = new Endpoints({
    proxyUrl: new URL("https://example.com/proxy"),
    oauthAuthorizationEndpoint: new URL("https://example.com/oauth/authorize"),
    oauthTokenEndpoint: new URL("https://example.com/oauth/token"),
    provideClientKey: new URL("https://example.com/provide-key"),
    signClientKey: new URL("https://example.com/sign-key"),
    sharedInbox: new URL("https://example.com/inbox"),
    uploadMedia: new URL("https://example.com/upload-media"),
  });

  // Compact heuristic path
  const compact = await ep.toJsonLd() as Record<string, unknown>;
  ok(!("type" in compact), "compact output should not have 'type'");
  deepStrictEqual(compact["proxyUrl"], "https://example.com/proxy");
  deepStrictEqual(
    compact["oauthAuthorizationEndpoint"],
    "https://example.com/oauth/authorize",
  );
  deepStrictEqual(
    compact["oauthTokenEndpoint"],
    "https://example.com/oauth/token",
  );
  deepStrictEqual(
    compact["provideClientKey"],
    "https://example.com/provide-key",
  );
  deepStrictEqual(compact["signClientKey"], "https://example.com/sign-key");
  deepStrictEqual(compact["sharedInbox"], "https://example.com/inbox");
  deepStrictEqual(compact["uploadMedia"], "https://example.com/upload-media");

  // Round-trip all three formats
  for (
    const format of [undefined, "compact" as const, "expand" as const]
  ) {
    const jsonLd = await ep.toJsonLd({
      format,
      contextLoader: mockDocumentLoader,
    });
    const restored = await Endpoints.fromJsonLd(jsonLd, {
      documentLoader: mockDocumentLoader,
      contextLoader: mockDocumentLoader,
    });
    deepStrictEqual(
      restored,
      ep,
      `round-trip failed for format=${format ?? "heuristic"}`,
    );
  }
});

test("Empty Endpoints omits type", async () => {
  const ep = new Endpoints({});

  const compact = await ep.toJsonLd() as Record<string, unknown>;
  ok(!("type" in compact), "empty compact output should not have 'type'");

  const expanded = await ep.toJsonLd({
    format: "expand",
    contextLoader: mockDocumentLoader,
  }) as Record<string, unknown>[];
  ok(
    !("@type" in (expanded[0] ?? {})),
    "empty expanded output should not have '@type'",
  );
});

test("Empty Source omits type", async () => {
  const src = new Source({});

  const compact = await src.toJsonLd() as Record<string, unknown>;
  ok(!("type" in compact), "empty compact output should not have 'type'");

  const expanded = await src.toJsonLd({
    format: "expand",
    contextLoader: mockDocumentLoader,
  }) as Record<string, unknown>[];
  ok(
    !("@type" in (expanded[0] ?? {})),
    "empty expanded output should not have '@type'",
  );
});

test("Person.toJsonLd() embeds Endpoints without type", async () => {
  const person = new Person({
    id: new URL("https://example.com/person/1"),
    endpoints: new Endpoints({
      sharedInbox: new URL("https://example.com/inbox"),
    }),
  });

  // Compact heuristic path (the real-world code path)
  const compact = await person.toJsonLd() as Record<string, unknown>;
  const endpoints = compact["endpoints"] as Record<string, unknown>;
  ok(endpoints != null, "endpoints should be present");
  ok(
    !("type" in endpoints),
    "embedded endpoints should not have 'type'",
  );
  deepStrictEqual(endpoints["sharedInbox"], "https://example.com/inbox");

  // Round-trip
  const restored = await Person.fromJsonLd(compact, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  deepStrictEqual(restored.id, person.id);
  deepStrictEqual(
    restored.endpoints?.sharedInbox,
    person.endpoints?.sharedInbox,
  );

  // Expanded format
  const expanded = await person.toJsonLd({
    format: "expand",
    contextLoader: mockDocumentLoader,
  }) as Record<string, unknown>[];
  const expandedEndpoints =
    (expanded[0]["https://www.w3.org/ns/activitystreams#endpoints"] as Record<
      string,
      unknown
    >[])?.[0];
  ok(expandedEndpoints != null, "expanded endpoints should be present");
  ok(
    !("@type" in expandedEndpoints),
    "expanded embedded endpoints should not have '@type'",
  );

  // Expanded round-trip
  const restored2 = await Person.fromJsonLd(expanded, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  deepStrictEqual(
    restored2.endpoints?.sharedInbox,
    person.endpoints?.sharedInbox,
  );

  // Compact via JSON-LD library
  const compactLib = await person.toJsonLd({
    format: "compact",
    contextLoader: mockDocumentLoader,
    context: "https://www.w3.org/ns/activitystreams",
  }) as Record<string, unknown>;
  const endpointsLib = compactLib["endpoints"] as Record<string, unknown>;
  ok(endpointsLib != null, "compact-lib endpoints should be present");
  ok(
    !("type" in endpointsLib),
    "compact-lib endpoints should not have 'type'",
  );

  // Compact library round-trip
  const restored3 = await Person.fromJsonLd(compactLib, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  deepStrictEqual(
    restored3.endpoints?.sharedInbox,
    person.endpoints?.sharedInbox,
  );
});

test("Object.toJsonLd() embeds Source without type", async () => {
  const obj = new Object({
    id: new URL("https://example.com/object/1"),
    source: new Source({
      content: "Hello, world!",
      mediaType: "text/plain",
    }),
  });

  // Compact heuristic path
  const compact = await obj.toJsonLd() as Record<string, unknown>;
  const source = compact["source"] as Record<string, unknown>;
  ok(source != null, "source should be present");
  ok(!("type" in source), "embedded source should not have 'type'");
  deepStrictEqual(source["mediaType"], "text/plain");

  // Round-trip
  const restored = await Object.fromJsonLd(compact, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  deepStrictEqual(restored.source?.content, "Hello, world!");
  deepStrictEqual(restored.source?.mediaType, "text/plain");
});

test("Person.fromJsonLd() with Mastodon-style endpoints (no type)", async () => {
  // Mastodon serializes endpoints without a type field
  const person = await Person.fromJsonLd({
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/v1",
    ],
    "id": "https://mastodon.social/users/testuser",
    "type": "Person",
    "preferredUsername": "testuser",
    "inbox": "https://mastodon.social/users/testuser/inbox",
    "outbox": "https://mastodon.social/users/testuser/outbox",
    "endpoints": {
      "sharedInbox": "https://mastodon.social/inbox",
    },
  }, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  assertInstanceOf(person, Person);
  deepStrictEqual(
    person.endpoints?.sharedInbox?.href,
    "https://mastodon.social/inbox",
  );
});

test("Person.fromJsonLd() with old Fedify-style endpoints (with type)", async () => {
  // Older Fedify versions serialized endpoints with type: "as:Endpoints"
  const person = await Person.fromJsonLd({
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/v1",
    ],
    "id": "https://example.com/users/testuser",
    "type": "Person",
    "endpoints": {
      "type": "as:Endpoints",
      "sharedInbox": "https://example.com/inbox",
    },
  }, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  assertInstanceOf(person, Person);
  deepStrictEqual(
    person.endpoints?.sharedInbox?.href,
    "https://example.com/inbox",
  );
});

test("Source with LanguageString content omits type", async () => {
  const src = new Source({
    contents: [
      new LanguageString("Hello", "en"),
      new LanguageString("Bonjour", "fr"),
    ],
    mediaType: "text/plain",
  });

  const compact = await src.toJsonLd() as Record<string, unknown>;
  ok(!("type" in compact), "source with LanguageString should not have 'type'");

  // Round-trip
  const restored = await Source.fromJsonLd(compact, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  deepStrictEqual(restored, src);
});

test("Cross-format round-trip for Endpoints", async () => {
  const ep = new Endpoints({
    sharedInbox: new URL("https://example.com/inbox"),
    proxyUrl: new URL("https://example.com/proxy"),
  });

  // compact heuristic → expanded → compact heuristic
  const compact1 = await ep.toJsonLd();
  const restored1 = await Endpoints.fromJsonLd(compact1, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  const expanded = await restored1.toJsonLd({
    format: "expand",
    contextLoader: mockDocumentLoader,
  });
  const restored2 = await Endpoints.fromJsonLd(expanded, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  const compact2 = await restored2.toJsonLd({
    contextLoader: mockDocumentLoader,
  });
  const restored3 = await Endpoints.fromJsonLd(compact2, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  deepStrictEqual(restored3, ep);
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
    "@context": NOTE_QUOTE_CONTEXT,
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

test("Note.quote", async () => {
  const note = new Note({
    quote: new URL("https://example.com/object"),
  });
  const expected = {
    "@context": NOTE_QUOTE_CONTEXT,
    quote: "https://example.com/object",
    type: "Note",
  };
  deepStrictEqual(await note.toJsonLd(), expected);
  deepStrictEqual(await note.toJsonLd({ format: "compact" }), expected);

  const loaded = await Note.fromJsonLd({
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      {
        quote: {
          "@id": "https://w3id.org/fep/044f#quote",
          "@type": "@id",
        },
      },
    ],
    type: "Note",
    quote: "https://example.com/object",
  });
  deepStrictEqual(loaded.quoteId, new URL("https://example.com/object"));
});

test("Note.quoteAuthorization", async () => {
  const note = new Note({
    quoteAuthorization: new URL("https://example.com/authorizations/1"),
  });
  const expected = {
    "@context": NOTE_QUOTE_CONTEXT,
    quoteAuthorization: "https://example.com/authorizations/1",
    type: "Note",
  };
  deepStrictEqual(await note.toJsonLd(), expected);
  deepStrictEqual(await note.toJsonLd({ format: "compact" }), expected);

  const loaded = await Note.fromJsonLd({
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      {
        QuoteAuthorization: "https://w3id.org/fep/044f#QuoteAuthorization",
        quoteAuthorization: {
          "@id": "https://w3id.org/fep/044f#quoteAuthorization",
          "@type": "@id",
        },
      },
    ],
    type: "Note",
    quoteAuthorization: "https://example.com/authorizations/1",
  });
  deepStrictEqual(
    loaded.quoteAuthorizationId,
    new URL("https://example.com/authorizations/1"),
  );

  const loadedFromGoToSocialContext = await Note.fromJsonLd({
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://gotosocial.org/ns",
    ],
    type: "Note",
    quoteAuthorization: "https://example.com/authorizations/2",
  }, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  deepStrictEqual(
    loadedFromGoToSocialContext.quoteAuthorizationId,
    new URL("https://example.com/authorizations/2"),
  );
});

test("InteractionPolicy.canQuote", async () => {
  const note = new Note({
    interactionPolicy: new InteractionPolicy({
      canQuote: new InteractionRule({
        automaticApproval: new URL(
          "https://www.w3.org/ns/activitystreams#Public",
        ),
      }),
    }),
  });
  const expected = {
    "@context": NOTE_QUOTE_CONTEXT,
    interactionPolicy: {
      canQuote: {
        automaticApproval: "as:Public",
      },
    },
    type: "Note",
  };
  deepStrictEqual(
    await note.toJsonLd({ contextLoader: mockDocumentLoader }),
    expected,
  );

  const loaded = await Note.fromJsonLd(expected, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  deepStrictEqual(
    await loaded.toJsonLd({ contextLoader: mockDocumentLoader }),
    expected,
  );
});

test("InteractionPolicy.canFeature", async () => {
  const person = new Person({
    id: new URL("https://example.com/users/alice"),
    featuredCollections: new URL(
      "https://example.com/users/alice/featured_collections",
    ),
    interactionPolicy: new InteractionPolicy({
      canFeature: new InteractionRule({
        automaticApproval: new URL(
          "https://www.w3.org/ns/activitystreams#Public",
        ),
      }),
    }),
  });
  const expected = {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/fep/ef61",
      "https://w3id.org/security/v1",
      "https://w3id.org/security/data-integrity/v1",
      "https://www.w3.org/ns/did/v1",
      "https://w3id.org/security/multikey/v1",
      "https://gotosocial.org/ns",
      "https://w3id.org/fep/7aa9",
      {
        Emoji: "toot:Emoji",
        PropertyValue: "schema:PropertyValue",
        _misskey_followedMessage: "misskey:_misskey_followedMessage",
        alsoKnownAs: {
          "@id": "as:alsoKnownAs",
          "@type": "@id",
        },
        discoverable: "toot:discoverable",
        featured: {
          "@id": "toot:featured",
          "@type": "@id",
        },
        featuredCollections: {
          "@id": "https://w3id.org/fep/7aa9#featuredCollections",
          "@type": "@id",
        },
        featuredTags: {
          "@id": "toot:featuredTags",
          "@type": "@id",
        },
        indexable: "toot:indexable",
        isCat: "misskey:isCat",
        manuallyApprovesFollowers: "as:manuallyApprovesFollowers",
        memorial: "toot:memorial",
        misskey: "https://misskey-hub.net/ns#",
        movedTo: {
          "@id": "as:movedTo",
          "@type": "@id",
        },
        schema: "http://schema.org#",
        suspended: "toot:suspended",
        toot: "http://joinmastodon.org/ns#",
        value: "schema:value",
      },
    ],
    type: "Person",
    id: "https://example.com/users/alice",
    featuredCollections: "https://example.com/users/alice/featured_collections",
    interactionPolicy: {
      canFeature: {
        automaticApproval: "as:Public",
      },
    },
  };
  deepStrictEqual(
    await person.toJsonLd({ contextLoader: mockDocumentLoader }),
    expected,
  );

  const loaded = await Person.fromJsonLd(expected, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  deepStrictEqual(
    loaded.featuredCollectionsId,
    new URL("https://example.com/users/alice/featured_collections"),
  );
  assertInstanceOf(loaded.interactionPolicy, InteractionPolicy);
  assertInstanceOf(loaded.interactionPolicy.canFeature, InteractionRule);
  deepStrictEqual(
    loaded.interactionPolicy.canFeature.automaticApproval,
    new URL("https://www.w3.org/ns/activitystreams#Public"),
  );
  deepStrictEqual(
    await loaded.toJsonLd({ contextLoader: mockDocumentLoader }),
    expected,
  );

  const loadedFromFepContext = await Person.fromJsonLd({
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://gotosocial.org/ns",
      "https://w3id.org/fep/7aa9",
      {
        featuredCollections: {
          "@id": "https://w3id.org/fep/7aa9#featuredCollections",
          "@type": "@id",
        },
      },
    ],
    type: "Person",
    id: "https://example.com/users/alice",
    featuredCollections: "https://example.com/users/alice/featured_collections",
  }, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  deepStrictEqual(
    loadedFromFepContext.featuredCollectionsId,
    new URL("https://example.com/users/alice/featured_collections"),
  );
});

test("FeaturedCollection.toJsonLd()", async () => {
  const collection = new FeaturedCollection({
    id: new URL("https://example.com/users/alice/featured/1"),
    name: "Cute cats",
    attribution: new URL("https://example.com/users/alice"),
    topic: new Hashtag({ name: "#cats" }),
    discoverable: false,
    totalItems: 1,
  });
  const expected = {
    "@context": FEATURED_COLLECTION_CONTEXT,
    type: "FeaturedCollection",
    id: "https://example.com/users/alice/featured/1",
    attributedTo: "https://example.com/users/alice",
    name: "Cute cats",
    totalItems: 1,
    topic: {
      type: "Hashtag",
      name: "#cats",
    },
    discoverable: false,
  };
  deepStrictEqual(
    await collection.toJsonLd({ contextLoader: mockDocumentLoader }),
    expected,
  );

  const loaded = await FeaturedCollection.fromJsonLd(expected, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  assertInstanceOf(loaded, FeaturedCollection);
  deepStrictEqual(loaded.name, "Cute cats");
  deepStrictEqual(
    loaded.attributionId,
    new URL("https://example.com/users/alice"),
  );
  assertInstanceOf(loaded.topic, Hashtag);
  deepStrictEqual(loaded.topic.name, "#cats");
  deepStrictEqual(loaded.discoverable, false);
  deepStrictEqual(loaded.totalItems, 1);
  deepStrictEqual(
    await loaded.toJsonLd({ contextLoader: mockDocumentLoader }),
    expected,
  );
});

test("FeaturedItem.toJsonLd()", async () => {
  const item = new FeaturedItem({
    id: new URL("https://example.com/users/alice/featured/1/items/1"),
    featuredObject: new URL("https://example.com/users/bob"),
    featureAuthorization: new URL("https://example.com/users/bob/stamps/1"),
  });
  const expected = {
    "@context": FEATURE_CONTEXT,
    type: "FeaturedItem",
    id: "https://example.com/users/alice/featured/1/items/1",
    featuredObject: "https://example.com/users/bob",
    featureAuthorization: "https://example.com/users/bob/stamps/1",
  };
  deepStrictEqual(
    await item.toJsonLd({ contextLoader: mockDocumentLoader }),
    expected,
  );

  const loaded = await FeaturedItem.fromJsonLd(expected, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  assertInstanceOf(loaded, FeaturedItem);
  deepStrictEqual(
    loaded.featuredObjectId,
    new URL("https://example.com/users/bob"),
  );
  deepStrictEqual(
    loaded.featureAuthorizationId,
    new URL("https://example.com/users/bob/stamps/1"),
  );
});

test("FeatureAuthorization.fromJsonLd()", async () => {
  const jsonLd = {
    "@context": FEATURE_CONTEXT,
    type: "FeatureAuthorization",
    id: "https://example.com/users/bob/stamps/1",
    interactingObject: "https://example.com/users/alice/featured/1",
    interactionTarget: "https://example.com/users/bob",
  };
  const authorization = await FeatureAuthorization.fromJsonLd(jsonLd, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  assertInstanceOf(authorization, FeatureAuthorization);
  deepStrictEqual(
    authorization.interactingObjectId,
    new URL("https://example.com/users/alice/featured/1"),
  );
  deepStrictEqual(
    authorization.interactionTargetId,
    new URL("https://example.com/users/bob"),
  );
  deepStrictEqual(
    await authorization.toJsonLd({ contextLoader: mockDocumentLoader }),
    jsonLd,
  );
});

test("FeatureRequest.toJsonLd()", async () => {
  const request = new FeatureRequest({
    id: new URL("https://example.com/users/alice/featured/1/requests/1"),
    object: new URL("https://example.com/users/bob"),
    instrument: new URL("https://example.com/users/alice/featured/1"),
  });
  const expected = {
    "@context": [
      "https://w3id.org/identity/v1",
      ...FEATURE_CONTEXT,
    ],
    type: "FeatureRequest",
    id: "https://example.com/users/alice/featured/1/requests/1",
    object: "https://example.com/users/bob",
    instrument: "https://example.com/users/alice/featured/1",
  };
  deepStrictEqual(
    await request.toJsonLd({ contextLoader: mockDocumentLoader }),
    expected,
  );

  const loaded = await FeatureRequest.fromJsonLd(expected, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  assertInstanceOf(loaded, FeatureRequest);
  deepStrictEqual(
    loaded.objectId,
    new URL("https://example.com/users/bob"),
  );
  deepStrictEqual(
    loaded.instrumentId,
    new URL("https://example.com/users/alice/featured/1"),
  );
});

test("QuoteAuthorization.fromJsonLd()", async () => {
  const jsonLd = {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/data-integrity/v1",
      "https://gotosocial.org/ns",
      {
        QuoteAuthorization: "https://w3id.org/fep/044f#QuoteAuthorization",
      },
    ],
    type: "QuoteAuthorization",
    id: "https://example.com/users/alice/stamps/1",
    attributedTo: "https://example.com/users/alice",
    interactingObject: "https://example.com/users/bob/statuses/1",
    interactionTarget: "https://example.com/users/alice/statuses/1",
  };
  const authorization = await QuoteAuthorization.fromJsonLd(jsonLd, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  assertInstanceOf(authorization, QuoteAuthorization);
  deepStrictEqual(
    await authorization.toJsonLd({ contextLoader: mockDocumentLoader }),
    jsonLd,
  );

  const loadedFromGoToSocialContext = await QuoteAuthorization.fromJsonLd({
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://gotosocial.org/ns",
    ],
    type: "QuoteAuthorization",
    id: "https://example.com/users/alice/stamps/2",
    attributedTo: "https://example.com/users/alice",
    interactingObject: "https://example.com/users/bob/statuses/2",
    interactionTarget: "https://example.com/users/alice/statuses/2",
  }, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  assertInstanceOf(loadedFromGoToSocialContext, QuoteAuthorization);
  deepStrictEqual(
    loadedFromGoToSocialContext.id,
    new URL("https://example.com/users/alice/stamps/2"),
  );
});

test("QuoteRequest.toJsonLd()", async () => {
  const request = new QuoteRequest({
    object: new URL("https://example.com/users/alice/statuses/1"),
    instrument: new Note({
      id: new URL("https://example.com/users/bob/statuses/1"),
      content: "I am quoting alice's post",
      quote: new URL("https://example.com/users/alice/statuses/1"),
    }),
  });
  const expected = {
    "@context": QUOTE_REQUEST_CONTEXT,
    type: "QuoteRequest",
    object: "https://example.com/users/alice/statuses/1",
    instrument: {
      type: "Note",
      id: "https://example.com/users/bob/statuses/1",
      content: "I am quoting alice's post",
      quote: "https://example.com/users/alice/statuses/1",
    },
  };
  deepStrictEqual(
    await request.toJsonLd({ contextLoader: mockDocumentLoader }),
    expected,
  );

  const loaded = await QuoteRequest.fromJsonLd(expected, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  assertInstanceOf(loaded, QuoteRequest);
  deepStrictEqual(
    await loaded.toJsonLd({ contextLoader: mockDocumentLoader }),
    expected,
  );

  const loadedFromGoToSocialContext = await QuoteRequest.fromJsonLd({
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://gotosocial.org/ns",
    ],
    type: "QuoteRequest",
    object: "https://example.com/users/alice/statuses/3",
  }, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  assertInstanceOf(loadedFromGoToSocialContext, QuoteRequest);
  deepStrictEqual(
    loadedFromGoToSocialContext.objectId,
    new URL("https://example.com/users/alice/statuses/3"),
  );
});

test("Collection.toJsonLd() compacts embedded QuoteRequest", async () => {
  const collection = new Collection({
    items: [
      new QuoteRequest({
        object: new URL("https://example.com/users/alice/statuses/1"),
      }),
    ],
  });
  deepStrictEqual(
    await collection.toJsonLd({ contextLoader: mockDocumentLoader }),
    {
      "@context": [
        "https://www.w3.org/ns/activitystreams",
        "https://w3id.org/security/data-integrity/v1",
        "https://gotosocial.org/ns",
        {
          ChatMessage: "http://litepub.social/ns#ChatMessage",
          Emoji: "toot:Emoji",
          Hashtag: "as:Hashtag",
          QuoteAuthorization: "https://w3id.org/fep/044f#QuoteAuthorization",
          QuoteRequest: "https://w3id.org/fep/044f#QuoteRequest",
          _misskey_quote: "misskey:_misskey_quote",
          fedibird: "http://fedibird.com/ns#",
          misskey: "https://misskey-hub.net/ns#",
          quote: {
            "@id": "https://w3id.org/fep/044f#quote",
            "@type": "@id",
          },
          quoteAuthorization: {
            "@id": "https://w3id.org/fep/044f#quoteAuthorization",
            "@type": "@id",
          },
          quoteUri: "fedibird:quoteUri",
          quoteUrl: "as:quoteUrl",
          sensitive: "as:sensitive",
          toot: "http://joinmastodon.org/ns#",
          votersCount: "toot:votersCount",
          emojiReactions: {
            "@id": "fedibird:emojiReactions",
            "@type": "@id",
          },
        },
      ],
      items: {
        "@context": QUOTE_REQUEST_CONTEXT,
        object: "https://example.com/users/alice/statuses/1",
        type: "QuoteRequest",
      },
      type: "Collection",
    },
  );
});

test("Delete.toJsonLd() compacts embedded QuoteRequest", async () => {
  const activity = new Delete({
    object: new QuoteRequest({
      object: new URL("https://example.com/users/alice/statuses/1"),
    }),
  });
  deepStrictEqual(
    await activity.toJsonLd({ contextLoader: mockDocumentLoader }),
    {
      "@context": DELETE_QUOTE_REQUEST_CONTEXT,
      object: {
        object: "https://example.com/users/alice/statuses/1",
        type: "QuoteRequest",
      },
      type: "Delete",
    },
  );
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
      "https://gotosocial.org/ns",
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

test("Object.fromJsonLd() normalizes Link icon to Image", async () => {
  const json = {
    "@context": "https://www.w3.org/ns/activitystreams",
    "type": "Note",
    "content": "Hello",
    "icon": {
      "type": "Link",
      "href": "https://example.com/icon.png",
      "mediaType": "image/png",
      "name": "Icon",
      "width": 64,
      "height": 64,
    },
  };
  const obj = await Object.fromJsonLd(json, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  const icon = await obj.getIcon();
  deepStrictEqual(
    icon?.url?.href,
    "https://example.com/icon.png",
  );
  deepStrictEqual(icon?.mediaType, "image/png");
  deepStrictEqual(icon?.names, ["Icon"]);
  deepStrictEqual(icon?.width, 64);
  deepStrictEqual(icon?.height, 64);
});

test("Object.fromJsonLd() normalizes Link image to Image", async () => {
  const json = {
    "@context": "https://www.w3.org/ns/activitystreams",
    "type": "Note",
    "content": "Hello",
    "image": {
      "type": "Link",
      "href": "https://example.com/banner.png",
      "mediaType": "image/png",
      "width": 800,
      "height": 200,
    },
  };
  const obj = await Object.fromJsonLd(json, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  const images = [];
  for await (const img of obj.getImages()) {
    images.push(img);
  }
  deepStrictEqual(images[0]?.url?.href, "https://example.com/banner.png");
  deepStrictEqual(images[0]?.mediaType, "image/png");
  deepStrictEqual(images[0]?.width, 800);
  deepStrictEqual(images[0]?.height, 200);
});

test("Object.fromJsonLd() normalizes Link icon with relative URL", async () => {
  const json = {
    "@context": "https://www.w3.org/ns/activitystreams",
    "type": "Note",
    "id": "https://example.com/notes/1",
    "content": "Hello",
    "icon": {
      "type": "Link",
      "href": "/icons/icon.png",
    },
  };
  const obj = await Object.fromJsonLd(json, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  const icon = await obj.getIcon();
  deepStrictEqual(
    icon?.url?.href,
    "https://example.com/icons/icon.png",
  );
});

test(
  "Object.fromJsonLd() normalizes Link icon with relative id and baseUrl",
  async () => {
    const json = {
      "@context": "https://www.w3.org/ns/activitystreams",
      "type": "Note",
      "id": "/notes/1",
      "content": "Hello",
      "icon": {
        "type": "Link",
        "href": "/icons/icon.png",
      },
    };
    const obj = await Object.fromJsonLd(json, {
      documentLoader: mockDocumentLoader,
      contextLoader: mockDocumentLoader,
      baseUrl: new URL("https://example.com/"),
    });
    const icon = await obj.getIcon();
    deepStrictEqual(obj.id?.href, "https://example.com/notes/1");
    deepStrictEqual(
      icon?.url?.href,
      "https://example.com/icons/icon.png",
    );
  },
);

test("Object.fromJsonLd() decodes Image icon with relative id and baseUrl", async () => {
  const json = {
    "@context": "https://www.w3.org/ns/activitystreams",
    "type": "Note",
    "id": "/notes/1",
    "content": "Hello",
    "icon": {
      "type": "Image",
      "url": "/icons/icon.png",
    },
  };
  const obj = await Object.fromJsonLd(json, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
    baseUrl: new URL("https://example.com/"),
  });
  const icon = await obj.getIcon();
  deepStrictEqual(obj.id?.href, "https://example.com/notes/1");
  deepStrictEqual(
    icon?.url?.href,
    "https://example.com/icons/icon.png",
  );
});

test("Object.fromJsonLd() decodes compact icon id with relative id and baseUrl", async () => {
  const json = {
    "@context": "https://www.w3.org/ns/activitystreams",
    "type": "Note",
    "id": "/notes/1",
    "content": "Hello",
    "icon": "/icons/icon.png",
  };
  const obj = await Object.fromJsonLd(json, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
    baseUrl: new URL("https://example.com/"),
  });
  deepStrictEqual(obj.id?.href, "https://example.com/notes/1");
  deepStrictEqual(
    obj.iconId?.href,
    "https://example.com/icons/icon.png",
  );
});

test("Object.fromJsonLd() resolves compact icon id against document base", async () => {
  const json = {
    "@context": "https://www.w3.org/ns/activitystreams",
    "type": "Note",
    "id": "../notes/1",
    "content": "Hello",
    "icon": "icon.png",
  };
  const obj = await Object.fromJsonLd(json, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
    baseUrl: new URL("https://example.com/outbox/page.json"),
  });
  deepStrictEqual(obj.id?.href, "https://example.com/outbox/notes/1");
  deepStrictEqual(
    obj.iconId?.href,
    "https://example.com/outbox/icon.png",
  );
});

test("Object.fromJsonLd() skips blank node compact icon id", async () => {
  const json = {
    "@context": "https://www.w3.org/ns/activitystreams",
    "type": "Note",
    "id": "/notes/1",
    "content": "Hello",
    "icon": { "@id": "_:b0" },
  };
  const obj = await Object.fromJsonLd(json, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
    baseUrl: new URL("https://example.com/"),
  });
  deepStrictEqual(obj.id?.href, "https://example.com/notes/1");
  deepStrictEqual(obj.iconId, null);
});

test("Object.fromJsonLd() resolves compact icon id against baseUrl for did id", async () => {
  const json = {
    "@context": "https://www.w3.org/ns/activitystreams",
    "type": "Note",
    "id": "did:plc:example",
    "content": "Hello",
    "icon": "/icons/icon.png",
  };
  const obj = await Object.fromJsonLd(json, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
    baseUrl: new URL("https://example.com/notes/1"),
  });
  deepStrictEqual(obj.id?.href, "did:plc:example");
  deepStrictEqual(
    obj.iconId?.href,
    "https://example.com/icons/icon.png",
  );
});

test(
  "Object.getIcon() resolves relative Link href without id via cached re-parse",
  async () => {
    const json = {
      "@context": "https://www.w3.org/ns/activitystreams",
      "type": "Note",
      "content": "Hello",
      "icon": {
        "@context": "https://www.w3.org/ns/activitystreams",
        "type": "Link",
        "href": "/icons/star.png",
        "mediaType": "image/png",
      },
    };
    const obj = await Object.fromJsonLd(json, {
      documentLoader: mockDocumentLoader,
      contextLoader: mockDocumentLoader,
      baseUrl: new URL("https://example.com/"),
    });
    // getIcon() is called WITHOUT explicit baseUrl — the accessor
    // should reuse the baseUrl that was set during fromJsonLd().
    const icon = await obj.getIcon();
    deepStrictEqual(
      icon?.url?.href,
      "https://example.com/icons/star.png",
    );
    deepStrictEqual(icon?.mediaType, "image/png");
  },
);

test(
  "Object.fromJsonLd() resolves Link href against document base, not object id",
  async () => {
    const json = {
      "@context": "https://www.w3.org/ns/activitystreams",
      "type": "Note",
      "id": "../notes/1",
      "content": "Hello",
      "icon": {
        "type": "Link",
        "href": "icon.png",
      },
    };
    const obj = await Object.fromJsonLd(json, {
      documentLoader: mockDocumentLoader,
      contextLoader: mockDocumentLoader,
      baseUrl: new URL("https://example.com/outbox/page.json"),
    });
    const icon = await obj.getIcon();
    deepStrictEqual(obj.id?.href, "https://example.com/outbox/notes/1");
    deepStrictEqual(
      icon?.url?.href,
      "https://example.com/outbox/icon.png",
    );
  },
);

test(
  "Object.getIcon() resolves cached relative Link href against baseUrl for did id",
  async () => {
    const json = {
      "@context": "https://www.w3.org/ns/activitystreams",
      "type": "Note",
      "id": "did:plc:example",
      "content": "Hello",
      "icon": {
        "@context": "https://www.w3.org/ns/activitystreams",
        "type": "Link",
        "href": "/icons/star.png",
        "mediaType": "image/png",
      },
    };
    const obj = await Object.fromJsonLd(json, {
      documentLoader: mockDocumentLoader,
      contextLoader: mockDocumentLoader,
      baseUrl: new URL("https://example.com/notes/1"),
    });
    const icon = await obj.getIcon();
    deepStrictEqual(obj.id?.href, "did:plc:example");
    deepStrictEqual(
      icon?.url?.href,
      "https://example.com/icons/star.png",
    );
    deepStrictEqual(icon?.mediaType, "image/png");
  },
);

test(
  "Object.getIcon() ignores mutation of caller's baseUrl after fromJsonLd()",
  async () => {
    const origBaseUrl = new URL("https://example.com/");
    const json = {
      "@context": "https://www.w3.org/ns/activitystreams",
      "type": "Note",
      "content": "Hello",
      "icon": {
        "@context": "https://www.w3.org/ns/activitystreams",
        "type": "Link",
        "href": "/icons/star.png",
        "mediaType": "image/png",
      },
    };
    const obj = await Object.fromJsonLd(json, {
      documentLoader: mockDocumentLoader,
      contextLoader: mockDocumentLoader,
      baseUrl: origBaseUrl,
    });
    // Mutate the caller's URL after construction.
    origBaseUrl.href = "https://attacker.example/";
    const icon = await obj.getIcon();
    deepStrictEqual(
      icon?.url?.href,
      "https://example.com/icons/star.png",
    );
    deepStrictEqual(icon?.mediaType, "image/png");
  },
);

test(
  "Object.fromJsonLd() does not resolve blank node @id against baseUrl",
  async () => {
    const json = {
      "@context": "https://www.w3.org/ns/activitystreams",
      "type": "Note",
      "id": "_:b0",
    };
    const obj = await Object.fromJsonLd(json, {
      documentLoader: mockDocumentLoader,
      contextLoader: mockDocumentLoader,
      baseUrl: new URL("https://example.com/"),
    });
    // Blank node identifiers must not be resolved against baseUrl.
    deepStrictEqual(obj.id, null);
  },
);

test(
  "Object.fromJsonLd() handles blank node @id without baseUrl",
  () => {
    const obj = Object.fromJsonLd({
      "@context": "https://www.w3.org/ns/activitystreams",
      "type": "Note",
      "id": "_:b0",
    }, {
      documentLoader: mockDocumentLoader,
      contextLoader: mockDocumentLoader,
    });
    // Blank node identifier without baseUrl must not throw.
    return obj.then((o) => deepStrictEqual(o.id, null));
  },
);

test(
  "Object.getAttachments() resolves relative url via stored _baseUrl",
  async () => {
    const json = {
      "@context": "https://www.w3.org/ns/activitystreams",
      "type": "Note",
      "content": "Hello",
      "attachment": {
        "@context": "https://www.w3.org/ns/activitystreams",
        "type": "Document",
        "url": "/files/report.pdf",
        "mediaType": "application/pdf",
      },
    };
    const obj = await Object.fromJsonLd(json, {
      documentLoader: mockDocumentLoader,
      contextLoader: mockDocumentLoader,
      baseUrl: new URL("https://example.com/"),
    });
    // getAttachments() without explicit baseUrl should use stored _baseUrl.
    const attachments = [];
    for await (const a of obj.getAttachments()) {
      attachments.push(a);
    }
    deepStrictEqual(attachments.length, 1);
    // deno-lint-ignore no-explicit-any
    const doc = attachments[0] as any;
    deepStrictEqual(
      doc?.url?.href,
      "https://example.com/files/report.pdf",
    );
    deepStrictEqual(doc?.mediaType, "application/pdf");
  },
);

test("Object.fromJsonLd() normalizes multiple Link icons", async () => {
  const json = {
    "@context": "https://www.w3.org/ns/activitystreams",
    "type": "Note",
    "content": "Hello",
    "icon": [
      { "type": "Link", "href": "https://example.com/a.png" },
      { "type": "Image", "url": "https://example.com/b.png" },
    ],
  };
  const obj = await Object.fromJsonLd(json, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  const icons = [];
  for await (const i of obj.getIcons()) {
    icons.push(i);
  }
  deepStrictEqual(icons.length, 2);
  deepStrictEqual(icons[0]?.url?.href, "https://example.com/a.png");
  deepStrictEqual(icons[1]?.url?.href, "https://example.com/b.png");
});

test("Object.getIcon() normalizes fetched Link document to Image", async () => {
  const linkDocUrl = "https://example.com/icons/avatar-link";
  const linkDoc = {
    "@context": "https://www.w3.org/ns/activitystreams",
    type: "Link",
    href: "https://example.com/avatars/user.png",
    mediaType: "image/png",
    width: 128,
    height: 128,
  };
  const docLoader = async (url: string) => {
    if (url === linkDocUrl) {
      return {
        document: linkDoc,
        documentUrl: url,
        contextUrl: null,
      };
    }
    return await mockDocumentLoader(url);
  };

  const person = new Person({
    id: new URL("https://example.com/ap/actors/test-user"),
    icon: new URL(linkDocUrl),
  });

  const icon = await person.getIcon({
    documentLoader: docLoader,
    contextLoader: mockDocumentLoader,
  });
  deepStrictEqual(
    icon?.url?.href,
    "https://example.com/avatars/user.png",
  );
  deepStrictEqual(icon?.mediaType, "image/png");
  deepStrictEqual(icon?.width, 128);
  deepStrictEqual(icon?.height, 128);
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

test("FEP-fe34: id-less owners honor crossOrigin trust", async () => {
  const create = await Create.fromJsonLd({
    "@context": "https://www.w3.org/ns/activitystreams",
    "@type": "Create",
    "actor": "https://example.com/actor",
    "object": {
      "@type": "Note",
      "@id": "https://different-origin.com/note",
      "content": "Embedded note",
    },
  });

  const result = await create.getObject({
    crossOrigin: "trust",
    // deno-lint-ignore require-await
    documentLoader: async (url) => {
      throw new Error(`Unexpected fetch: ${url}`);
    },
  });

  assertInstanceOf(result, Note);
  deepStrictEqual(result.id, new URL("https://different-origin.com/note"));
  deepStrictEqual(result.content, "Embedded note");
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

test("FEP-fe34: Same-authority non-FE34 embedded objects are trusted", async () => {
  const create = await Create.fromJsonLd({
    "@context": "https://www.w3.org/ns/activitystreams",
    "@type": "Create",
    "@id": "at://did:plc:example/collection/item",
    "actor": "at://did:plc:example/actor/self",
    "object": {
      "@type": "Note",
      "@id": "at://did:plc:example/collection/reply",
      "content": "Embedded AT Protocol note",
    },
  });

  const result = await create.getObject({
    // deno-lint-ignore require-await
    documentLoader: async (url) => {
      throw new Error(`Unexpected fetch: ${url}`);
    },
  });

  assertInstanceOf(result, Note);
  deepStrictEqual(result.content, "Embedded AT Protocol note");
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

test(
  "FEP-fe34: Portable DID authorities are cross-origin boundaries",
  async () => {
    const create = await Create.fromJsonLd({
      "@context": "https://www.w3.org/ns/activitystreams",
      "@type": "Create",
      "@id": "ap://did:key:z6MkOwner/create",
      "actor": "ap://did:key:z6MkOwner/actor",
      "object": {
        "@type": "Note",
        "@id": "ap://did:key:z6MkOther/note",
        "content": "Embedded portable note",
      },
    });

    // deno-lint-ignore require-await
    const documentLoader = async (url: string) => {
      if (url === "ap+ef61://did:key:z6MkOther/note") {
        return {
          documentUrl: url,
          contextUrl: null,
          document: {
            "@context": "https://www.w3.org/ns/activitystreams",
            "@type": "Note",
            "@id": "ap://did:key:z6MkOther/note",
            "content": "Fetched portable note",
          },
        };
      }
      throw new Error("Document not found");
    };

    const result = await create.getObject({ documentLoader });
    assertInstanceOf(result, Note);
    deepStrictEqual(result.content, "Fetched portable note");
  },
);

test(
  "FEP-fe34: DID verification methods share portable actor cryptographic origin",
  async () => {
    const person = await Person.fromJsonLd({
      "@id": "ap://did:key:z6MkOwner/actor",
      "@type": ["https://www.w3.org/ns/activitystreams#Person"],
      "https://w3id.org/security#assertionMethod": [{
        "@id": "did:key:z6MkOwner#z6MkOwner",
        "@type": ["https://w3id.org/security#Multikey"],
        "https://w3id.org/security#controller": [{
          "@id": "did:key:z6MkOwner",
        }],
      }],
    });

    // deno-lint-ignore require-await
    const documentLoader = async (url: string) => {
      throw new Error(`Unexpected fetch: ${url}`);
    };

    const methods = [];
    for await (const method of person.getAssertionMethods({ documentLoader })) {
      methods.push(method);
    }

    deepStrictEqual(methods.length, 1);
    assertInstanceOf(methods[0], Multikey);
    deepStrictEqual(
      methods[0].id,
      new URL("did:key:z6MkOwner#z6MkOwner"),
    );
  },
);

test(
  "FEP-fe34: DID verification methods from another cryptographic origin are untrusted",
  async () => {
    const person = await Person.fromJsonLd({
      "@id": "ap://did:key:z6MkOwner/actor",
      "@type": ["https://www.w3.org/ns/activitystreams#Person"],
      "https://w3id.org/security#assertionMethod": [{
        "@id": "did:key:z6MkOther#z6MkOther",
        "@type": ["https://w3id.org/security#Multikey"],
        "https://w3id.org/security#controller": [{
          "@id": "did:key:z6MkOther",
        }],
      }],
    });

    let fetches = 0;
    const methods = [];
    for await (
      const method of person.getAssertionMethods({
        suppressError: true,
        // deno-lint-ignore require-await
        documentLoader: async (url) => {
          fetches++;
          throw new Error(`Unexpected fetch: ${url}`);
        },
      })
    ) {
      methods.push(method);
    }
    deepStrictEqual(methods, []);
    deepStrictEqual(fetches, 1);
  },
);

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

test("FEP-fe34: id-less arrays honor crossOrigin trust", async () => {
  const collection = await Collection.fromJsonLd({
    "@context": "https://www.w3.org/ns/activitystreams",
    "@type": "Collection",
    "items": [
      {
        "@type": "Note",
        "@id": "https://different-origin.com/note1",
        "content": "Embedded note 1",
      },
      {
        "@type": "Note",
        "@id": "https://different-origin.com/note2",
        "content": "Embedded note 2",
      },
    ],
  });

  const items = [];
  for await (
    const item of collection.getItems({
      crossOrigin: "trust",
      // deno-lint-ignore require-await
      documentLoader: async (url) => {
        throw new Error(`Unexpected fetch: ${url}`);
      },
    })
  ) {
    items.push(item);
  }

  deepStrictEqual(items.length, 2);
  assertInstanceOf(items[0], Note);
  assertInstanceOf(items[1], Note);
  deepStrictEqual((items[0] as Note).content, "Embedded note 1");
  deepStrictEqual((items[1] as Note).content, "Embedded note 2");
});

test("FEP-fe34: Array properties track trust per item", async () => {
  const collection = new Collection({
    id: new URL("https://example.com/collection"),
    items: [
      new Note({
        id: new URL("https://malicious.com/fake-note1"),
        content: "Trusted constructor note 1",
      }),
      new URL("https://different-origin.com/note2"),
    ],
  });
  // deno-lint-ignore require-await
  const documentLoader = async (url: string) => {
    if (url === "https://different-origin.com/note2") {
      return {
        documentUrl: url,
        contextUrl: null,
        document: {
          "@context": "https://www.w3.org/ns/activitystreams",
          "@type": "Note",
          "@id": "https://malicious.com/fake-note2",
          "content": "Untrusted fetched note 2",
        },
      };
    }
    throw new Error("Document not found");
  };

  const items = [];
  for await (const item of collection.getItems({ documentLoader })) {
    items.push(item);
  }

  deepStrictEqual(items.length, 1);
  assertInstanceOf(items[0], Note);
  deepStrictEqual((items[0] as Note).content, "Trusted constructor note 1");
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

test("FEP-0837: Commitment roundtrip preserves satisfies and resourceQuantity", async () => {
  const commitment = new Commitment({
    id: new URL("https://market.example/agreements/abc#primary"),
    satisfies: new URL(
      "https://market.example/proposals/abc#primary",
    ),
    resourceQuantity: new Measure({
      unit: "one",
      numericalValue: parseDecimal("1"),
    }),
  });
  const jsonLd = await commitment.toJsonLd({
    contextLoader: mockDocumentLoader,
  });
  const restored = await Commitment.fromJsonLd(jsonLd, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  // A finalized Commitment carries a (fragment) id even though Commitment is
  // not an independently fetchable entity (`entity: false`).
  deepStrictEqual(restored.id?.href, commitment.id?.href);
  deepStrictEqual(restored.satisfies, commitment.satisfies);
  deepStrictEqual(restored.resourceQuantity?.unit, "one");
  deepStrictEqual(
    restored.resourceQuantity?.numericalValue,
    parseDecimal("1"),
  );
});

test("FEP-0837: Agreement roundtrip with both commitments", async () => {
  const agreement = new Agreement({
    id: new URL(
      "https://market.example/agreements/edc374aa-e580-4a58-9404-f3e8bf8556b2",
    ),
    attribution: new URL("https://market.example/users/alice"),
    stipulates: new Commitment({
      id: new URL(
        "https://market.example/agreements/edc374aa-e580-4a58-9404-f3e8bf8556b2#primary",
      ),
      satisfies: new URL(
        "https://market.example/proposals/ddde9d6f#primary",
      ),
      resourceQuantity: new Measure({
        unit: "one",
        numericalValue: parseDecimal("1"),
      }),
    }),
    stipulatesReciprocal: new Commitment({
      id: new URL(
        "https://market.example/agreements/edc374aa-e580-4a58-9404-f3e8bf8556b2#reciprocal",
      ),
      satisfies: new URL(
        "https://market.example/proposals/ddde9d6f#reciprocal",
      ),
      resourceQuantity: new Measure({
        unit: "currencyAmount",
        numericalValue: parseDecimal("30.00"),
      }),
    }),
  });
  const jsonLd = await agreement.toJsonLd({
    contextLoader: mockDocumentLoader,
  });
  const restored = await Agreement.fromJsonLd(jsonLd, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  deepStrictEqual(restored.id?.href, agreement.id?.href);
  deepStrictEqual(
    restored.stipulates?.id?.href,
    agreement.stipulates?.id?.href,
  );
  deepStrictEqual(
    restored.stipulates?.satisfies?.href,
    agreement.stipulates?.satisfies?.href,
  );
  deepStrictEqual(
    restored.stipulates?.resourceQuantity?.numericalValue,
    parseDecimal("1"),
  );
  deepStrictEqual(
    restored.stipulatesReciprocal?.id?.href,
    agreement.stipulatesReciprocal?.id?.href,
  );
  deepStrictEqual(
    restored.stipulatesReciprocal?.satisfies?.href,
    agreement.stipulatesReciprocal?.satisfies?.href,
  );
  deepStrictEqual(
    restored.stipulatesReciprocal?.resourceQuantity?.unit,
    "currencyAmount",
  );
  deepStrictEqual(
    restored.stipulatesReciprocal?.resourceQuantity?.numericalValue,
    parseDecimal("30.00"),
  );
});

test("FEP-0837: Agreement parses Accept-result example adapted from spec", async () => {
  // Adapted from FEP-0837's "Accepting an agreement" example, to Fedify customization
  const json = {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      {
        vf: "https://w3id.org/valueflows/ont/vf#",
        Agreement: "vf:Agreement",
        stipulates: "vf:stipulates",
        stipulatesReciprocal: "vf:stipulatesReciprocal",
        Commitment: "vf:Commitment",
        satisfies: { "@id": "vf:satisfies", "@type": "@id" },
        resourceQuantity: "vf:resourceQuantity",
        hasUnit: "om2:hasUnit",
        hasNumericalValue: "om2:hasNumericalValue",
        om2: "http://www.ontology-of-units-of-measure.org/resource/om-2/",
      },
    ],
    type: "Agreement",
    id:
      "https://market.example/agreements/edc374aa-e580-4a58-9404-f3e8bf8556b2",
    attributedTo: "https://market.example/users/alice",
    stipulates: {
      id:
        "https://market.example/agreements/edc374aa-e580-4a58-9404-f3e8bf8556b2#primary",
      type: "Commitment",
      satisfies:
        "https://market.example/proposals/ddde9d6f-6f3b-4770-a966-3a18ef006930#primary",
      resourceQuantity: {
        hasUnit: "one",
        hasNumericalValue: "1",
      },
    },
    stipulatesReciprocal: {
      id:
        "https://market.example/agreements/edc374aa-e580-4a58-9404-f3e8bf8556b2#reciprocal",
      type: "Commitment",
      satisfies:
        "https://market.example/proposals/ddde9d6f-6f3b-4770-a966-3a18ef006930#reciprocal",
      resourceQuantity: {
        hasUnit: "currencyAmount",
        hasNumericalValue: "30.00",
      },
    },
  };
  const agreement = await Agreement.fromJsonLd(json, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  deepStrictEqual(
    agreement.id?.href,
    "https://market.example/agreements/edc374aa-e580-4a58-9404-f3e8bf8556b2",
  );
  deepStrictEqual(
    agreement.attributionId?.href,
    "https://market.example/users/alice",
  );
  deepStrictEqual(
    agreement.stipulates?.id?.href,
    "https://market.example/agreements/edc374aa-e580-4a58-9404-f3e8bf8556b2#primary",
  );
  deepStrictEqual(
    agreement.stipulates?.satisfies?.href,
    "https://market.example/proposals/ddde9d6f-6f3b-4770-a966-3a18ef006930#primary",
  );
  deepStrictEqual(
    agreement.stipulates?.resourceQuantity?.numericalValue,
    parseDecimal("1"),
  );
  deepStrictEqual(
    agreement.stipulatesReciprocal?.id?.href,
    "https://market.example/agreements/edc374aa-e580-4a58-9404-f3e8bf8556b2#reciprocal",
  );
  deepStrictEqual(
    agreement.stipulatesReciprocal?.satisfies?.href,
    "https://market.example/proposals/ddde9d6f-6f3b-4770-a966-3a18ef006930#reciprocal",
  );
  deepStrictEqual(
    agreement.stipulatesReciprocal?.resourceQuantity?.numericalValue,
    parseDecimal("30.00"),
  );
});

test("FEP-0837: Full marketplace flow - Proposal => Offer => Accept => Confirmation", async () => {
  // Stage 1: Alice publishes a Proposal.  Its id anchors the intent fragment
  // URI (`#primary`) that the downstream commitments satisfy.
  const proposal = new Proposal({
    id: new URL(
      "https://market.example/proposals/ddde9d6f-6f3b-4770-a966-3a18ef006930",
    ),
    attribution: new URL("https://market.example/users/alice"),
    purpose: "offer",
    publishes: new Intent({
      action: "transfer",
      resourceConformsTo: new URL("https://www.wikidata.org/wiki/Q11442"),
      resourceQuantity: new Measure({
        unit: "one",
        numericalValue: parseDecimal("1"),
      }),
    }),
    to: new URL("https://www.w3.org/ns/activitystreams#Public"),
  });
  ok(proposal.purpose === "offer");
  const primaryIntent = new URL(`${proposal.id?.href}#primary`);

  // Stage 2a: Bob sends Offer(Agreement) whose commitment satisfies the
  // proposal's primary intent.
  const offerId = new URL(
    "https://social.example/objects/fc4af0d2-c3a1-409b-947c-3c5be29f49b0/offer",
  );
  const offer = new Offer({
    id: offerId,
    actor: new URL("https://social.example/users/bob"),
    object: new Agreement({
      stipulates: new Commitment({
        satisfies: primaryIntent,
        resourceQuantity: new Measure({
          unit: "one",
          numericalValue: parseDecimal("1"),
        }),
      }),
    }),
    to: new URL("https://market.example/users/alice"),
  });
  const offerJson = await offer.toJsonLd({
    contextLoader: mockDocumentLoader,
  });
  const offerRestored = await Offer.fromJsonLd(offerJson, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  const restoredAgreement = await offerRestored.getObject({
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  assertInstanceOf(restoredAgreement, Agreement);
  deepStrictEqual(
    restoredAgreement.stipulates?.satisfies?.href,
    primaryIntent.href,
  );
  deepStrictEqual(
    restoredAgreement.stipulates?.resourceQuantity?.numericalValue,
    parseDecimal("1"),
  );

  // Stage 2b: Alice sends Accept(Offer) with finalized Agreement in `result`.
  const agreementId = new URL(
    "https://market.example/agreements/edc374aa-e580-4a58-9404-f3e8bf8556b2",
  );
  const accept = new Accept({
    id: new URL(
      "https://market.example/activities/059f08fa-31b1-4136-8d76-5987d705a0ab",
    ),
    actor: new URL("https://market.example/users/alice"),
    object: offerId,
    result: new Agreement({
      id: agreementId,
      attribution: new URL("https://market.example/users/alice"),
      stipulates: new Commitment({
        satisfies: primaryIntent,
        resourceQuantity: new Measure({
          unit: "one",
          numericalValue: parseDecimal("1"),
        }),
      }),
    }),
    to: new URL("https://social.example/users/bob"),
  });
  const acceptJson = await accept.toJsonLd({
    contextLoader: mockDocumentLoader,
  });
  const acceptRestored = await Accept.fromJsonLd(acceptJson, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  deepStrictEqual(acceptRestored.objectId?.href, offerId.href);
  const acceptResult = await acceptRestored.getResult({
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  assertInstanceOf(acceptResult, Agreement);
  deepStrictEqual(acceptResult.id?.href, agreementId.href);

  // Stage 2 alt: Reject(Offer) with a reason.
  const reject = new Reject({
    actor: new URL("https://market.example/users/alice"),
    object: offerId,
    content: "Not available",
    to: new URL("https://social.example/users/bob"),
  });
  const rejectJson = await reject.toJsonLd({
    contextLoader: mockDocumentLoader,
  });
  const rejectRestored = await Reject.fromJsonLd(rejectJson, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  deepStrictEqual(rejectRestored.objectId?.href, offerId.href);
  deepStrictEqual(rejectRestored.content?.toString(), "Not available");

  // Stage 3: Confirmation as Create(Document) with `context` linking to the
  // finalized Agreement.  The Create activity needs an @id at the same origin
  // as its embedded Document so cross-origin trust preserves the embedded
  // form (rather than unwinding to a URL reference that would require a fetch).
  const receipt = new Create({
    id: new URL(
      "https://market.example/receipts/ad2f7ee1-6567-413e-a10b-72650cbdc743/create",
    ),
    actor: new URL("https://market.example/users/alice"),
    object: new Document({
      id: new URL(
        "https://market.example/receipts/ad2f7ee1-6567-413e-a10b-72650cbdc743",
      ),
      name: "Receipt",
      contexts: [agreementId],
      published: Temporal.Instant.from("2023-07-03T14:13:41.843794Z"),
    }),
    to: new URL("https://social.example/users/bob"),
  });
  const receiptJson = await receipt.toJsonLd({
    contextLoader: mockDocumentLoader,
  });
  const receiptRestored = await Create.fromJsonLd(receiptJson, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  const receiptObject = await receiptRestored.getObject({
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  assertInstanceOf(receiptObject, Document);
  deepStrictEqual(receiptObject.contextIds[0]?.href, agreementId.href);
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
  "http://www.w3.org/2001/XMLSchema#decimal": parseDecimal("12.34"),
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
  "fedify:gatewayUrl": new URL("https://gateway.example/"),
  "fedify:publicKey": rsaPublicKey.publicKey,
  "fedify:multibaseKey": ed25519PublicKey.publicKey,
  "fedify:proofPurpose": "assertionMethod",
  "fedify:units": "m",
  "fedify:vocabEntityType": Person,
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
    if (type.typeless) {
      const compactJsonLd = await instance.toJsonLd({
        format: "compact",
        contextLoader: mockDocumentLoader,
      }) as Record<string, unknown>;
      ok(
        !("type" in compactJsonLd),
        `${type.name} is typeless; compact output should not have 'type'`,
      );
    } else {
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
    }

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
    if (type.entity) deepStrictEqual(jsonLd.id, "https://example.com/");
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
