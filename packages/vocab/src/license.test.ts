import { test } from "@fedify/fixture";
import {
  type DocumentLoader,
  getDocumentLoader,
  preloadedContexts,
} from "@fedify/vocab-runtime";
import jsonld from "@fedify/vocab-runtime/jsonld";
import { deepStrictEqual, ok } from "node:assert/strict";
import {
  Application,
  Collection,
  Create,
  Group,
  Image,
  Link,
  Note,
  Organization,
  Person,
  Question,
  Service,
  Video,
} from "./mod.ts";

// FEP-6757 draft and examples, pinned to:
// https://codeberg.org/fediverse/fep/src/commit/e735111d2d28a3d7b9798b7d5d436ec2d1f3bd04/fep/6757/fep-6757.md
const AS = "https://www.w3.org/ns/activitystreams";
const FEP = "https://w3id.org/fep/6757";
const DC_LICENSE = "http://purl.org/dc/terms/license";
const PREFERRED_LICENSE = `${FEP}#preferredLicense`;
const SCHEMA_LICENSE = "https://schema.org/license";
const HTTP_SCHEMA_LICENSE = "http://schema.org/license";
const CC_LICENSE = "http://creativecommons.org/ns#license";
const BY = "https://creativecommons.org/licenses/by/4.0/";
const BY_NC = "https://creativecommons.org/licenses/by-nc/4.0/";
const BY_NC_ND = "https://creativecommons.org/licenses/by-nc-nd/4.0/";
const CC0 = "https://creativecommons.org/publicdomain/zero/1.0/";
const PD_MARK = "https://creativecommons.org/publicdomain/mark/1.0/";

const noteExample = {
  "@context": [AS, FEP, { schema: "https://schema.org/" }],
  id: "https://social.example/note/857",
  type: "Note",
  content: "Hello, world!",
  license: BY,
  "schema:license": BY,
  attachment: {
    type: "Link",
    href: "https://media.social.example/uploads/file339.jpg",
    mediaType: "image/jpeg",
    license: PD_MARK,
  },
};

const personExample = {
  "@context": [AS, FEP],
  id: "https://social.example/user/1753",
  type: "Person",
  name: "Example User",
  inbox: "https://social.example/collection/9257",
  outbox: "https://social.example/collection/10772",
  summary: "An example user who is very illustrative of important features",
  license: BY_NC_ND,
  icon: {
    type: "Image",
    license: BY_NC,
    url: {
      type: "Link",
      mediaType: "image/jpeg",
      href: "https://media.social.example/upload/7272.jpg",
    },
  },
  preferredLicense: BY_NC,
};

function record(value: unknown): Record<string, unknown> {
  ok(value != null && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

const noFetch: DocumentLoader = (url) => {
  throw new Error(`Unexpected fetch: ${url}`);
};

/**
 * A context loader that serves only preloaded contexts and records them.
 */
function offlineContextLoader(): DocumentLoader & { loaded: string[] } {
  const loaded: string[] = [];
  const loader = getDocumentLoader();
  const contextLoader: DocumentLoader = (url, options) => {
    if (!(url in preloadedContexts)) {
      throw new Error(`Unexpected context fetch: ${url}`);
    }
    loaded.push(url);
    return loader(url, options);
  };
  return Object.assign(contextLoader, { loaded });
}

async function expand(json: unknown): Promise<Record<string, unknown>> {
  const expanded = await jsonld.expand(json, {
    documentLoader: getDocumentLoader(),
  });
  return record(expanded[0]);
}

function contexts(json: unknown): unknown[] {
  const context = record(json)["@context"];
  return Array.isArray(context) ? context : [context];
}

function note(licenses: URL[] = [new URL(BY)]): Note {
  return new Note({
    id: new URL("https://social.example/note/857"),
    content: "Hello, world!",
    licenses,
  });
}

test("FEP-6757 context is preloaded", async () => {
  ok(FEP in preloadedContexts);
  const loaded = await getDocumentLoader()(FEP);
  deepStrictEqual(record(loaded.document)["@context"], {
    license: { "@id": DC_LICENSE, "@type": "@id" },
    preferredLicense: { "@id": PREFERRED_LICENSE, "@type": "@id" },
  });
});

test("FEP-6757 note example is parsed offline", async () => {
  const contextLoader = offlineContextLoader();
  const parsed = await Note.fromJsonLd(noteExample, {
    documentLoader: noFetch,
    contextLoader,
  });
  deepStrictEqual(parsed.licenses, [new URL(BY)]);
  const attachments = await Array.fromAsync(
    parsed.getAttachments({ documentLoader: noFetch, contextLoader }),
  );
  deepStrictEqual(attachments.length, 1);
  ok(attachments[0] instanceof Link);
  deepStrictEqual(attachments[0].licenses, [new URL(PD_MARK)]);
  ok(contextLoader.loaded.includes(FEP));
  // An unchanged parsed object keeps its input, including the synonym:
  deepStrictEqual(await parsed.toJsonLd(), noteExample);
});

test("FEP-6757 person example is parsed offline", async () => {
  const contextLoader = offlineContextLoader();
  const person = await Person.fromJsonLd(personExample, {
    documentLoader: noFetch,
    contextLoader,
  });
  deepStrictEqual(person.licenses, [new URL(BY_NC_ND)]);
  deepStrictEqual(person.preferredLicense, new URL(BY_NC));
  const icon = await person.getIcon({ documentLoader: noFetch, contextLoader });
  ok(icon instanceof Image);
  deepStrictEqual(icon.licenses, [new URL(BY_NC)]);
  const url = icon.url;
  ok(url instanceof Link);
  deepStrictEqual(url.licenses, []);
  deepStrictEqual(await person.toJsonLd(), personExample);
});

test("FEP-6757 license is written only as the canonical IRI", async () => {
  for (const format of [undefined, "compact"] as const) {
    const json = record(await note().toJsonLd({ format }));
    deepStrictEqual(contexts(json).at(-1), FEP);
    deepStrictEqual(json.license, BY);
    const expanded = await expand(json);
    deepStrictEqual(expanded[DC_LICENSE], [{ "@id": BY }]);
    for (const synonym of [SCHEMA_LICENSE, HTTP_SCHEMA_LICENSE, CC_LICENSE]) {
      ok(!(synonym in expanded));
    }
  }
  const expanded = await note().toJsonLd({ format: "expand" });
  deepStrictEqual(
    record((expanded as unknown[])[0])[DC_LICENSE],
    [{ "@id": BY }],
  );
});

test("FEP-6757 multiple licenses are alternatives in observed order", async () => {
  const licenses = [new URL(BY), new URL(CC0)];
  const json = record(await note(licenses).toJsonLd());
  deepStrictEqual(json.license, [BY, CC0]);
  const parsed = await Note.fromJsonLd(json, { documentLoader: noFetch });
  deepStrictEqual(parsed.licenses, licenses);
});

test("FEP-6757 objects without license metadata serialize as before", async () => {
  const fields = {
    id: new URL("https://social.example/note/1"),
    content: "No license",
  };
  for (const format of [undefined, "compact"] as const) {
    const json = record(await new Note(fields).toJsonLd({ format }));
    ok(!JSON.stringify(json["@context"]).includes(FEP));
    ok(!("license" in json));
    const person = record(
      await new Person({ id: new URL("https://social.example/user/1") })
        .toJsonLd({ format }),
    );
    ok(!JSON.stringify(person["@context"]).includes(FEP));
    ok(!("preferredLicense" in person));
  }
  deepStrictEqual(await new Note(fields).toJsonLd(), {
    "@context": [
      AS,
      "https://w3id.org/security/data-integrity/v1",
      "https://gotosocial.org/ns",
      {
        toot: "http://joinmastodon.org/ns#",
        misskey: "https://misskey-hub.net/ns#",
        fedibird: "http://fedibird.com/ns#",
        sensitive: "as:sensitive",
        Emoji: "toot:Emoji",
        Hashtag: "as:Hashtag",
        quote: { "@id": "https://w3id.org/fep/044f#quote", "@type": "@id" },
        quoteUrl: "as:quoteUrl",
        _misskey_quote: "misskey:_misskey_quote",
        quoteUri: "fedibird:quoteUri",
        QuoteAuthorization: "https://w3id.org/fep/044f#QuoteAuthorization",
        quoteAuthorization: {
          "@id": "https://w3id.org/fep/044f#quoteAuthorization",
          "@type": "@id",
        },
        emojiReactions: { "@id": "fedibird:emojiReactions", "@type": "@id" },
      },
    ],
    id: "https://social.example/note/1",
    type: "Note",
    content: "No license",
  });
});

test("FEP-6757 preferredLicense on every actor type", async () => {
  for (const Actor of [Application, Group, Organization, Person, Service]) {
    const actor = new Actor({
      id: new URL("https://social.example/actor"),
      preferredLicense: new URL(BY_NC),
    });
    for (const format of [undefined, "compact"] as const) {
      const json = record(await actor.toJsonLd({ format }));
      deepStrictEqual(contexts(json).at(-1), FEP);
      deepStrictEqual(json.preferredLicense, BY_NC);
      ok(!("license" in json));
      const expanded = await expand(json);
      deepStrictEqual(expanded[PREFERRED_LICENSE], [{ "@id": BY_NC }]);
      const parsed = await Actor.fromJsonLd(json, { documentLoader: noFetch });
      deepStrictEqual(parsed.preferredLicense, new URL(BY_NC));
      // A preferred license is not a license of the actor itself:
      deepStrictEqual(parsed.licenses, []);
    }
  }
});

test("FEP-6757 licenses in activities compact to the license term", async () => {
  // Activity contexts define a dc: prefix, which must not hide the license
  // term behind a compact IRI such as dc:license:
  const create = new Create({
    id: new URL("https://social.example/create/1"),
    actor: new URL("https://social.example/user/1753"),
    object: note(),
  });
  for (const format of [undefined, "compact"] as const) {
    const json = record(await create.toJsonLd({ format }));
    deepStrictEqual(contexts(json).at(-1), FEP);
    deepStrictEqual(record(json.object).license, BY);
    ok(!("license" in json));
    ok(!JSON.stringify(json).includes("dc:license"));
  }
  const parsedNote = await Note.fromJsonLd(noteExample, {
    documentLoader: noFetch,
  });
  const forwarded = record(
    await new Create({
      actor: new URL("https://social.example/user/1753"),
      object: parsedNote,
    }).toJsonLd(),
  );
  deepStrictEqual(contexts(forwarded).at(-1), FEP);
  deepStrictEqual(record(forwarded.object).license, BY);
  const question = record(
    await new Question({
      id: new URL("https://social.example/question/1"),
      licenses: [new URL(BY)],
    }).toJsonLd(),
  );
  deepStrictEqual(question.license, BY);
  ok(!JSON.stringify(question).includes("dc:license"));
  // A cached child may define the license term inline:
  const inline = await Note.fromJsonLd({
    "@context": [AS, {
      license: { "@id": DC_LICENSE, "@type": "@id" },
    }],
    id: "https://social.example/note/inline",
    type: "Note",
    license: BY,
  }, { documentLoader: noFetch });
  const collection = record(
    await new Collection({
      id: new URL("https://social.example/collection/1"),
      items: [inline],
      summary: "Licensed items",
    }).toJsonLd(),
  );
  deepStrictEqual(contexts(collection).at(-1), FEP);
  const items = collection.items as Record<string, unknown>;
  deepStrictEqual(items.license, BY);
});

test("FEP-6757 licenses of nested objects only", async () => {
  // Neither the note nor the actor has a license of its own:
  const unlicensed = new Note({
    id: new URL("https://social.example/note/2"),
    attachments: [
      new Link({ href: new URL(noteExample.attachment.href), licenses: [] }),
      new Link({
        href: new URL(noteExample.attachment.href),
        licenses: [new URL(PD_MARK)],
      }),
    ],
  });
  const json = record(await unlicensed.toJsonLd());
  ok(!("license" in json));
  const attachments = json.attachment as Record<string, unknown>[];
  ok(!("license" in attachments[0]));
  deepStrictEqual(attachments[1].license, PD_MARK);
  const expanded = await expand(json);
  const links =
    expanded["https://www.w3.org/ns/activitystreams#attachment"] as Record<
      string,
      unknown
    >[];
  deepStrictEqual(links[1][DC_LICENSE], [{ "@id": PD_MARK }]);
  const person = record(
    await new Person({
      id: new URL("https://social.example/user/1"),
      icon: new Image({ licenses: [new URL(BY_NC)] }),
    }).toJsonLd(),
  );
  ok(!("license" in person));
  deepStrictEqual(record(person.icon).license, BY_NC);
  // A collection's license does not apply to its items:
  const collection = await Collection.fromJsonLd({
    "@context": [AS, FEP],
    type: "Collection",
    license: CC0,
    items: [{ type: "Note", content: "Unlicensed item" }],
  }, { documentLoader: noFetch });
  deepStrictEqual(collection.licenses, [new URL(CC0)]);
  const items = await Array.fromAsync(
    collection.getItems({ documentLoader: noFetch }),
  );
  ok(items[0] instanceof Note);
  deepStrictEqual(items[0].licenses, []);
});

test("FEP-6757 modified clones write the canonical property", async () => {
  const parsed = await Note.fromJsonLd({
    "@context": [AS, { schema: "https://schema.org/" }],
    id: "https://social.example/note/3",
    type: "Note",
    "schema:license": BY,
  }, { documentLoader: noFetch });
  deepStrictEqual(parsed.licenses, [new URL(BY)]);
  for (
    const clone of [
      parsed.clone({ content: "Edited" }),
      parsed.clone({ licenses: [new URL(CC0)] }),
    ]
  ) {
    const json = record(await clone.toJsonLd());
    ok(!("schema:license" in json));
    const expanded = await expand(json);
    ok(!(SCHEMA_LICENSE in expanded));
    deepStrictEqual(expanded[DC_LICENSE], [{ "@id": clone.licenses[0].href }]);
  }
  // Explicit compaction bypasses the cached input:
  const compact = await expand(await parsed.toJsonLd({ format: "compact" }));
  deepStrictEqual(compact[DC_LICENSE], [{ "@id": BY }]);
  ok(!(SCHEMA_LICENSE in compact));
});

test("FEP-6757 caller-provided contexts", async () => {
  for (
    const context of [
      AS,
      [AS, FEP],
      [AS, "http://schema.org/"],
      [AS, FEP, "http://schema.org/"],
      [AS, "http://schema.org/", FEP],
    ]
  ) {
    const json = await note().toJsonLd({ format: "compact", context });
    // The context is used as is; no extension context is appended:
    deepStrictEqual(record(json)["@context"], context);
    const expanded = await expand(json);
    deepStrictEqual(expanded[DC_LICENSE], [{ "@id": BY }]);
    const parsed = await Note.fromJsonLd(json, { documentLoader: noFetch });
    deepStrictEqual(parsed.licenses, [new URL(BY)]);
  }
});

test("FEP-6757 synonym precedence", async () => {
  const id = "https://social.example/note/4";
  const cases: [Record<string, unknown>, string[]][] = [
    [{ [DC_LICENSE]: [{ "@id": BY }], [SCHEMA_LICENSE]: [{ "@id": CC0 }] }, [
      BY,
    ]],
    [{ [SCHEMA_LICENSE]: [{ "@id": CC0 }], [CC_LICENSE]: [{ "@id": BY }] }, [
      CC0,
    ]],
    // http://schema.org/license is not a synonym; see the PeerTube test:
    [{ [HTTP_SCHEMA_LICENSE]: [{ "@id": BY }] }, []],
    [{ [CC_LICENSE]: [{ "@id": CC0 }, { "@value": BY }] }, [CC0, BY]],
    // An explicitly empty canonical set falls through to the synonyms:
    [{ [DC_LICENSE]: [], [SCHEMA_LICENSE]: [{ "@value": BY }] }, [BY]],
    // An invalid canonical set is not replaced by a synonym:
    [{
      [DC_LICENSE]: [{ "@id": "CC-BY-4.0" }],
      [SCHEMA_LICENSE]: [{
        "@id": BY,
      }],
    }, []],
    [{}, []],
  ];
  for (const [properties, expected] of cases) {
    const parsed = await Note.fromJsonLd({
      "@id": id,
      "@type": [`${AS}#Note`],
      ...properties,
    }, { documentLoader: noFetch });
    deepStrictEqual(parsed.licenses, expected.map((l) => new URL(l)));
  }
});

test("FEP-6757 schema.org context order", async () => {
  // The bundled Schema.org context also defines a license term, which expands
  // to http://schema.org/license instead.  The later context wins:
  for (
    const [context, predicate, expected] of [
      [[AS, FEP, "http://schema.org/"], HTTP_SCHEMA_LICENSE, []],
      [[AS, "http://schema.org/", FEP], DC_LICENSE, [new URL(BY)]],
    ] as const
  ) {
    const json = {
      "@context": context,
      id: "https://social.example/note/5",
      type: "Note",
      license: BY,
    };
    deepStrictEqual(Object.keys(await expand(json)).includes(predicate), true);
    const parsed = await Note.fromJsonLd(json, {
      documentLoader: noFetch,
      contextLoader: offlineContextLoader(),
    });
    deepStrictEqual(parsed.licenses, expected);
  }
  // The FEP example's own schema prefix yields a string literal, and
  // a context's default language tags it:
  for (const extra of [{}, { "@language": "und" }]) {
    const literal = await Note.fromJsonLd({
      "@context": [AS, { schema: "https://schema.org/", ...extra }],
      type: "Note",
      "schema:license": BY,
    }, { documentLoader: noFetch });
    deepStrictEqual(literal.licenses, [new URL(BY)]);
  }
});

test("FEP-6757 PeerTube licences round-trip unchanged", async () => {
  // PeerTube maps its licence to http://schema.org/license with a value
  // that is not a URI, which must not cost the object its cached input:
  const video = {
    "@context": [AS, {
      sc: "http://schema.org/",
      licence: "sc:license",
      uuid: "sc:identifier",
    }],
    type: "Video",
    id: "https://peertube.example/videos/watch/1",
    name: "A video",
    uuid: "e5a2d4b0-0000-4000-8000-000000000000",
    licence: { identifier: "1", name: "Attribution" },
  };
  const parsed = await Video.fromJsonLd(video, { documentLoader: noFetch });
  deepStrictEqual(parsed.licenses, []);
  deepStrictEqual(await parsed.toJsonLd(), video);
  const create = {
    "@context": video["@context"],
    type: "Create",
    id: "https://peertube.example/videos/watch/1/activity",
    actor: "https://peertube.example/accounts/alice",
    object: { ...video, "@context": undefined },
  };
  delete create.object["@context"];
  const parsedCreate = await Create.fromJsonLd(create, {
    documentLoader: noFetch,
  });
  deepStrictEqual(await parsedCreate.toJsonLd(), create);
});

test("FEP-6757 rejects license names and relative identifiers", async () => {
  const base = {
    "@context": [AS, FEP],
    id: "https://social.example/note/6",
    type: "Note",
  };
  for (
    const license of [
      "CC-BY-4.0",
      "Creative Commons Attribution 4.0 International",
      "licenses/by/4.0/",
      "_:license",
    ]
  ) {
    const parsed = await Note.fromJsonLd({ ...base, license }, {
      documentLoader: noFetch,
    });
    deepStrictEqual(parsed.licenses, []);
    ok(!("license" in record(await parsed.toJsonLd())));
  }
  const mixed = await Note.fromJsonLd({
    ...base,
    license: ["CC-BY-4.0", BY, "urn:example:license"],
  }, { documentLoader: noFetch });
  deepStrictEqual(mixed.licenses, [
    new URL(BY),
    new URL("urn:example:license"),
  ]);
  // The input is no longer cached because a value was dropped:
  deepStrictEqual(
    record(await mixed.toJsonLd()).license,
    [BY, "urn:example:license"],
  );
  // A relative identifier made absolute by JSON-LD @base is accepted:
  const withBase = await Note.fromJsonLd({
    ...base,
    "@context": [AS, FEP, { "@base": "https://licenses.example/" }],
    license: "by/4.0/",
  }, { documentLoader: noFetch });
  deepStrictEqual(withBase.licenses, [
    new URL("https://licenses.example/by/4.0/"),
  ]);
  for (
    const value of [
      { "@value": BY, "@type": "http://www.w3.org/2001/XMLSchema#date" },
      { "@value": "CC-BY-4.0", "@language": "en" },
    ]
  ) {
    const parsed = await Note.fromJsonLd({
      "@type": [`${AS}#Note`],
      [DC_LICENSE]: [value],
    }, { documentLoader: noFetch });
    deepStrictEqual(parsed.licenses, []);
  }
  const typed = await Note.fromJsonLd({
    "@type": [`${AS}#Note`],
    [DC_LICENSE]: [{
      "@value": BY,
      "@type": "http://www.w3.org/2001/XMLSchema#anyURI",
    }],
  }, { documentLoader: noFetch });
  deepStrictEqual(typed.licenses, [new URL(BY)]);
});

test("FEP-6757 license IRIs are never dereferenced", async () => {
  const requested: string[] = [];
  const documentLoader: DocumentLoader = (url) => {
    requested.push(url);
    throw new Error(`Unexpected fetch: ${url}`);
  };
  const contextLoader = offlineContextLoader();
  const parsed = await Note.fromJsonLd(noteExample, {
    documentLoader,
    contextLoader,
  });
  deepStrictEqual(parsed.licenses, [new URL(BY)]);
  await parsed.clone({ content: "Edited" }).toJsonLd({ contextLoader });
  const person = await Person.fromJsonLd(personExample, {
    documentLoader,
    contextLoader,
  });
  deepStrictEqual(person.preferredLicense, new URL(BY_NC));
  deepStrictEqual(requested, []);
  for (const url of contextLoader.loaded) ok(url in preloadedContexts);
});
