import { test } from "@fedify/fixture";
import {
  type DocumentLoader,
  getDocumentLoader,
  preloadedContexts,
} from "@fedify/vocab-runtime";
import { deepStrictEqual, ok, rejects } from "node:assert/strict";
import {
  Application,
  Article,
  Collection,
  Create,
  Group,
  LanguageString,
  Link,
  Note,
  Object as ASObject,
  Organization,
  Person,
  PropertyValue,
  Service,
  Translation,
  Update,
} from "./mod.ts";

// FEP-22cd draft and examples, pinned to:
// https://codeberg.org/fediverse/fep/src/commit/6d0d6559054baeb7b71a5f2bdc14fc4c09b66f39/fep/22cd/fep-22cd.md
const AS = "https://www.w3.org/ns/activitystreams";
const FEP = "https://w3id.org/fep/22cd";
const SCHEMA = "https://schema.org/";
const articleId = new URL("https://example.com/articles/1");
const alice = new URL("https://example.com/users/alice");
const context = [AS, FEP];
const sourceUpdated = Temporal.Instant.from("2026-09-01T00:00:00Z");
const entry = {
  type: "Translation",
  inLanguage: "ko",
  url: "https://example.com/articles/1/ko",
  translator: [alice.href],
  translationOfWork: articleId.href,
  sourceUpdated: sourceUpdated.toString(),
};
const example = {
  "@context": context,
  id: articleId.href,
  type: "Article",
  attributedTo: alice.href,
  updated: sourceUpdated.toString(),
  contentMap: { en: "<p>Original text...</p>", ko: "<p>번역 텍스트...</p>" },
  translations: [entry],
};

function translation(): Translation {
  return new Translation({
    language: new Intl.Locale("ko"),
    translator: alice,
    original: articleId,
    sourceUpdated,
    url: new URL(entry.url),
  });
}

function article(): Article {
  return new Article({
    id: articleId,
    attribution: alice,
    updated: sourceUpdated,
    contents: [
      new LanguageString(example.contentMap.en, "en"),
      new LanguageString(example.contentMap.ko, "ko"),
    ],
    translations: [translation()],
  });
}

function record(value: unknown): Record<string, unknown> {
  ok(value != null && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

const noFetch: DocumentLoader = (url) => {
  throw new Error(`Unexpected fetch: ${url}`);
};

function actorLoader(type: string, id?: string): DocumentLoader {
  return (url) =>
    Promise.resolve({
      contextUrl: null,
      documentUrl: url,
      document: { "@context": AS, type, id: id ?? url },
    });
}

test("FEP-22cd canonical context is preloaded", async () => {
  ok(FEP in preloadedContexts);
  const loaded = await getDocumentLoader()(FEP);
  deepStrictEqual(record(loaded.document)["@context"], {
    "fep-22cd": `${FEP}#`,
    schema: SCHEMA,
    xsd: "http://www.w3.org/2001/XMLSchema#",
    translations: { "@id": "fep-22cd:translations", "@container": "@set" },
    Translation: "fep-22cd:Translation",
    sourceUpdated: { "@id": "fep-22cd:sourceUpdated", "@type": "xsd:dateTime" },
    translator: {
      "@id": "schema:translator",
      "@type": "@id",
      "@container": "@set",
    },
    inLanguage: "schema:inLanguage",
    translationOfWork: { "@id": "schema:translationOfWork", "@type": "@id" },
    isBasedOn: { "@id": "schema:isBasedOn", "@type": "@id" },
  });
});

test("FEP-22cd personal translation compact and expanded round trips", async () => {
  for (const format of [undefined, "compact", "expand"] as const) {
    const encoded = await article().toJsonLd({ format });
    if (format !== "expand") {
      deepStrictEqual(record(encoded).translations, [entry]);
      ok((record(encoded)["@context"] as unknown[]).includes(FEP));
    }
    const restored = await Article.fromJsonLd(encoded, {
      documentLoader: noFetch,
    });
    deepStrictEqual(restored.attributionId, alice);
    deepStrictEqual(restored.contents, article().contents);
    deepStrictEqual(restored.translations.length, 1);
    const t = restored.translations[0];
    deepStrictEqual(t.language?.baseName, "ko");
    deepStrictEqual(t.original, articleId);
    deepStrictEqual(t.translatorIds, [alice]);
    deepStrictEqual(t.sourceUpdated?.toString(), sourceUpdated.toString());
    deepStrictEqual(t.url, new URL(entry.url));
    // Explicit compact bypasses the input cache.
    deepStrictEqual(
      record(await restored.toJsonLd({ format: "compact" })).translations,
      [entry],
    );
  }
  const restored = await Article.fromJsonLd(example, {
    documentLoader: noFetch,
  });
  deepStrictEqual(
    record(await restored.toJsonLd({ format: "compact", context }))
      .translations,
    [entry],
  );
  deepStrictEqual(
    await article().toJsonLd({ format: "compact", context }),
    example,
  );
});

test("FEP-22cd full IRIs, optional revision, script language and AS links", async () => {
  const expanded = {
    "@type": `${FEP}#Translation`,
    [`${SCHEMA}inLanguage`]: "zh-Hant",
    [`${SCHEMA}translator`]: [{ "@id": alice.href }],
    [`${SCHEMA}translationOfWork`]: { "@id": articleId.href },
    [`${SCHEMA}isBasedOn`]: { "@id": `${articleId.href}/revisions/2` },
    [`${AS}#url`]: [
      { "@id": `${articleId.href}/zh-Hant` },
      {
        "@type": `${AS}#Link`,
        [`${AS}#href`]: { "@id": `${articleId.href}/zh-Hant.html` },
      },
    ],
  };
  const t = await Translation.fromJsonLd(expanded, { documentLoader: noFetch });
  deepStrictEqual(t.language?.baseName, "zh-Hant");
  deepStrictEqual(t.original, articleId);
  deepStrictEqual(t.basis?.href, `${articleId.href}/revisions/2`);
  deepStrictEqual(t.sourceUpdated, null);
  ok(t.urls[1] instanceof Link);
  const compact = record(await t.toJsonLd({ format: "compact" }));
  deepStrictEqual(compact.translator, [alice.href]);
  deepStrictEqual(compact.inLanguage, "zh-Hant");
  deepStrictEqual(compact.isBasedOn, `${articleId.href}/revisions/2`);
  ok(!("sourceUpdated" in compact));
  ok(Object.keys(compact).every((key) => !key.startsWith("https:")));
});

test("FEP-22cd organization languages, multiple translators and review-only Update", async () => {
  const initial = article().clone({
    attribution: new URL("https://example.com/orgs/acme"),
    names: [
      new LanguageString("Title", "en"),
      new LanguageString("제목", "ko"),
    ],
    summaries: [
      new LanguageString("Summary", "en"),
      new LanguageString("요약", "ko"),
    ],
    contents: [
      ...article().contents,
      new LanguageString("日本語版", "ja"),
      "Fallback",
    ],
    translations: [
      translation(),
      new Translation({
        language: new Intl.Locale("ja"),
        translators: [
          new URL("https://example.com/users/bob"),
          new URL("https://example.com/actors/translator"),
        ],
        original: articleId,
      }),
    ],
  });
  const editedAt = Temporal.Instant.from("2026-09-15T00:00:00Z");
  const edited = initial.clone({ updated: editedAt });
  ok(
    Temporal.Instant.compare(
      edited.translations[0].sourceUpdated!,
      edited.updated!,
    ) < 0,
  );
  const reviewed = edited.clone({
    translations: [
      edited.translations[0].clone({ sourceUpdated: edited.updated }),
      edited.translations[1],
    ],
  });
  const update = new Update({
    id: new URL(`${articleId.href}/review`),
    actor: alice,
    object: reviewed,
  });
  const restored = await Update.fromJsonLd(
    await update.toJsonLd({ format: "compact" }),
    { documentLoader: noFetch },
  );
  const object = await restored.getObject();
  ok(object instanceof Article);
  deepStrictEqual(object.id, articleId);
  const byLanguage = (values: readonly (string | LanguageString)[]) =>
    Object.fromEntries(values.map((value) => [
      value instanceof LanguageString ? value.locale.baseName : "@none",
      value.toString(),
    ]));
  deepStrictEqual(byLanguage(object.contents), byLanguage(initial.contents));
  deepStrictEqual(object.names, initial.names);
  deepStrictEqual(object.summaries, initial.summaries);
  deepStrictEqual(object.attributionId, initial.attributionId);
  deepStrictEqual(object.translations.map((t) => t.language?.baseName), [
    "ko",
    "ja",
  ]);
  deepStrictEqual(
    object.translations[0].sourceUpdated?.toString(),
    editedAt.toString(),
  );
  deepStrictEqual(object.translations[1].sourceUpdated, null);
  deepStrictEqual(
    object.translations[1].translatorIds,
    initial.translations[1].translatorIds,
  );
  const withdrawn = reviewed.clone({
    translations: [],
    contents: [new LanguageString("Original", "en")],
  });
  const replaced = await Article.fromJsonLd(await withdrawn.toJsonLd());
  deepStrictEqual(replaced.translations, []);
  deepStrictEqual(replaced.id, articleId);
});

test("FEP-22cd nested fresh and cached objects compact without full-IRI terms", async () => {
  for (const child of [article(), await Article.fromJsonLd(example)]) {
    for (
      const wrapper of [
        new Create({ object: child }),
        new Collection({ items: [child] }),
      ]
    ) {
      for (const format of [undefined, "compact"] as const) {
        const json = record(await wrapper.toJsonLd({ format }));
        const nested = record(json.object ?? json.items);
        deepStrictEqual(nested.translations, [entry]);
        const roundTrip = await ASObject.fromJsonLd(json);
        ok(roundTrip instanceof Create || roundTrip instanceof Collection);
      }
    }
  }
  const custom = record(
    await article().toJsonLd({ format: "compact", context: AS }),
  );
  deepStrictEqual(custom["@context"], AS);
  ok(`${FEP}#translations` in custom);
});

test("FEP-22cd all actor types use the existing linked-object getters", async () => {
  for (const Type of [Person, Organization, Group, Application, Service]) {
    const t = new Translation({ translator: new Type({ id: alice }) });
    ok(await t.getTranslator({ documentLoader: noFetch }) instanceof Type);
    const parsed = await Translation.fromJsonLd(await t.toJsonLd());
    ok(
      await parsed.getTranslator({
        documentLoader: actorLoader(Type.name),
      }) instanceof Type,
    );
    deepStrictEqual((await Array.fromAsync(parsed.getTranslators())).length, 1);
  }
});

test("FEP-22cd metadata ids are not fetched or trusted as actor origins", async () => {
  for (const id of [undefined, "https://victim.example/metadata"]) {
    for (const plural of [false, true]) {
      const t = await Translation.fromJsonLd({
        "@context": context,
        type: "Translation",
        ...(id == null ? {} : { id }),
        translator: [{
          id: "https://victim.example/actor",
          type: "Application",
        }],
      });
      const fetched: string[] = [];
      const documentLoader: DocumentLoader = (url) => {
        fetched.push(url);
        return actorLoader("Person")(url);
      };
      const actors = plural
        ? await Array.fromAsync(t.getTranslators({ documentLoader }))
        : [await t.getTranslator({ documentLoader })];
      deepStrictEqual(fetched, ["https://victim.example/actor"]);
      ok(actors[0] instanceof Person);
      deepStrictEqual(t.id?.href, id);
    }
  }
  const parsed = await Article.fromJsonLd({
    ...example,
    translations: [{ ...entry, id: "urn:translation:ko" }],
  }, { documentLoader: noFetch });
  deepStrictEqual(parsed.translations[0].id?.href, "urn:translation:ko");
  await parsed.toJsonLd({ format: "compact" });
});

// Mirrors the documentation's completeness check before classifying credit.
async function hasCompleteCredit(
  t: Translation,
  documentLoader: DocumentLoader,
): Promise<boolean> {
  const ids = t.translatorIds;
  const actors = await Array.fromAsync(
    t.getTranslators({ documentLoader, suppressError: true }),
  );
  return actors.length > 0 && actors.length >= ids.length &&
    actors.every((actor) => actor.id != null);
}

test("FEP-22cd unavailable, deleted, mismatched and id-less actors leave status unknown", async () => {
  for (
    const failedLoader of [
      noFetch,
      actorLoader("Tombstone"),
      actorLoader("Person", "https://spoof.example/actor"),
    ]
  ) {
    const t = new Translation({
      translators: [
        alice,
        new Application({ id: new URL("https://example.com/machine") }),
      ],
    });
    deepStrictEqual(await hasCompleteCredit(t, failedLoader), false);
    deepStrictEqual(t.translatorIds, [
      alice,
      new URL("https://example.com/machine"),
    ]);
    deepStrictEqual(
      record(await t.toJsonLd({ format: "compact" })).translator instanceof
        Array,
      true,
    );
  }
  const idless = await Translation.fromJsonLd({
    "@context": context,
    type: "Translation",
    translator: [alice.href, { type: "Application" }],
  });
  deepStrictEqual(
    await hasCompleteCredit(idless, actorLoader("Person")),
    false,
  );
  await rejects(
    () =>
      new Translation({ translator: alice }).getTranslator({
        documentLoader: noFetch,
      }),
    /Unexpected fetch/,
  );
  const t = new Translation({ translator: alice });
  await rejects(() =>
    t.getTranslator({
      documentLoader: actorLoader("Person", "https://spoof.example/actor"),
      crossOrigin: "throw",
    })
  );
});

test("FEP-22cd malformed metadata follows vocabulary parsing behavior", async () => {
  await rejects(
    () =>
      Article.fromJsonLd({
        ...example,
        translations: [{ ...entry, inLanguage: "not_a_language" }],
      }),
    RangeError,
  );
  await rejects(
    () =>
      Article.fromJsonLd({
        ...example,
        translations: [{ ...entry, sourceUpdated: "2026-09-01" }],
      }),
    RangeError,
  );
  await rejects(
    () =>
      Article.fromJsonLd({
        ...example,
        translations: [{ ...entry, type: "Note" }],
      }),
    TypeError,
  );
  // As with other value types, required FEP fields are not enforced by the parser.
  const idOnly = await Article.fromJsonLd({
    ...example,
    translations: [{ id: "urn:translation:ko" }],
  }, { documentLoader: noFetch });
  deepStrictEqual(idOnly.translations[0].id?.href, "urn:translation:ko");
  deepStrictEqual(idOnly.translations[0].language, null);
  deepStrictEqual(idOnly.translations[0].translatorIds, []);
  const missing = await Article.fromJsonLd({
    ...example,
    translations: undefined,
  });
  deepStrictEqual(missing.translations, []);
});

test("FEP-22cd ordinary multilingual serialization remains unchanged", async () => {
  const fields = {
    id: articleId,
    attribution: alice,
    contents: [
      "Fallback",
      new LanguageString("Original", "en"),
      new LanguageString("번역", "ko"),
    ],
    names: [
      new LanguageString("Title", "en"),
      new LanguageString("제목", "ko"),
    ],
  };
  for (const Type of [Article, Note, ASObject]) {
    for (const format of [undefined, "compact"] as const) {
      const json = record(await new Type(fields).toJsonLd({ format }));
      ok(!JSON.stringify(json["@context"]).includes(FEP));
      deepStrictEqual(json.contentMap, { en: "Original", ko: "번역" });
      deepStrictEqual(json.content, "Fallback");
      deepStrictEqual(json.nameMap, { en: "Title", ko: "제목" });
      deepStrictEqual(json.attributedTo, alice.href);
      ok(!("translations" in json));
    }
  }
});

test("FEP-22cd keeps Mastodon PropertyValue and Schema.org translation namespaces distinct", async () => {
  const person = new Person({
    id: alice,
    attachments: [
      new PropertyValue({ name: "Website", value: "https://example.com/" }),
    ],
    translations: [translation()],
  });
  const json = record(await person.toJsonLd());
  deepStrictEqual(json.attachment, {
    type: "PropertyValue",
    name: "Website",
    value: "https://example.com/",
  });
  deepStrictEqual(json.translations, [entry]);
  const restored = await Person.fromJsonLd(json);
  const attachments = await Array.fromAsync(restored.getAttachments());
  ok(attachments[0] instanceof PropertyValue);
  deepStrictEqual(attachments[0].value, "https://example.com/");
  deepStrictEqual(restored.translations[0].original, articleId);
});

test("FEP-22cd explicit actor trust remains opt-in and clones retain untrusted state", async () => {
  const parsed = await Translation.fromJsonLd({
    "@context": context,
    type: "Translation",
    id: "https://victim.example/metadata",
    translator: [{ id: "https://victim.example/actor", type: "Application" }],
  });
  ok(
    await parsed.getTranslator({
      documentLoader: noFetch,
      crossOrigin: "trust",
    }) instanceof Application,
  );
  const clone = parsed.clone({ sourceUpdated });
  ok(
    await clone.getTranslator({
      documentLoader: actorLoader("Person"),
    }) instanceof Person,
  );
  const local = parsed.clone({ translator: new Application({ id: alice }) });
  ok(
    await local.getTranslator({ documentLoader: noFetch }) instanceof
      Application,
  );
});
