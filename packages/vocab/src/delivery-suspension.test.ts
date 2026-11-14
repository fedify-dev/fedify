import { test } from "@fedify/fixture";
import { getDocumentLoader, type DocumentLoader } from "@fedify/vocab-runtime";
import jsonld from "@fedify/vocab-runtime/jsonld";
import { deepStrictEqual, ok, rejects, throws } from "node:assert/strict";
import {
  Application,
  Collection,
  Create,
  DeliverySuspension,
  getRawPropertyValues,
  Group,
  Object as ActivityObject,
  OrderedCollection,
  Organization,
  Person,
  Service,
  Update,
  withRawProperties,
  withRawProperty,
} from "./mod.ts";

const { Temporal: TemporalPolyfill } = await import("temporal-polyfill");
// Source-based Workers tests do not receive tsdown's Temporal banner.
const TemporalForTest = (globalThis.Temporal ??= TemporalPolyfill);

const AS = "https://www.w3.org/ns/activitystreams";
const FEP = "https://w3id.org/fep/f799";
const NS = `${FEP}#`;
const XSD = "http://www.w3.org/2001/XMLSchema#";
const actorId = "https://social.example/actor";
const inbox = "https://social.example/inbox";
const noticeId = "https://social.example/maintenance/1";
const announcement = "https://social.example/activities/1";
const noFetch: DocumentLoader = (url) => {
  throw new Error(`Unexpected fetch: ${url}`);
};
const options = { documentLoader: noFetch, contextLoader: getDocumentLoader() };
function record(value: unknown): Record<string, unknown> {
  ok(value != null && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}
async function expand(value: unknown): Promise<Record<string, unknown>> {
  return record(
    (await jsonld.expand(value, { documentLoader: getDocumentLoader() }))[0],
  );
}
function contexts(value: unknown): unknown[] {
  const context = record(value)["@context"];
  return Array.isArray(context) ? context : [context];
}
function notice() {
  return new DeliverySuspension({
    id: new URL(noticeId),
    attribution: new URL(actorId),
    published: TemporalForTest.Instant.from("2026-11-13T08:00:00Z"),
    startTime: TemporalForTest.Instant.from("2026-11-14T08:00:00Z"),
    endTime: TemporalForTest.Instant.from("2026-11-14T09:00:00Z"),
    summary: "Scheduled maintenance",
    url: new URL("https://status.example/maintenance/1"),
    suspensionStatus: "active",
    targetOrigin: "https://SOCIAL.example:443/",
    announcement: new URL(announcement),
    revision: 1,
  });
}

test("FEP-f799 DeliverySuspension compacts and round-trips directly and nested", async () => {
  for (const format of [undefined, "compact"] as const) {
    const source = notice();
    const json = record(await source.toJsonLd({ format }));
    const baseContext = contexts(await new ActivityObject({}).toJsonLd());
    deepStrictEqual(contexts(json), [...baseContext, FEP]);
    deepStrictEqual(json.type, "DeliverySuspension");
    deepStrictEqual(json.status, "active");
    deepStrictEqual(json.targetOrigin, "https://SOCIAL.example:443/");
    deepStrictEqual(json.announcement, announcement);
    deepStrictEqual(json.revision, 1);
    deepStrictEqual(json.attributedTo, actorId);
    deepStrictEqual(json.summary, "Scheduled maintenance");
    const expanded = await expand(json);
    deepStrictEqual(expanded[`${NS}status`], [
      { "@type": `${XSD}string`, "@value": "active" },
    ]);
    deepStrictEqual(expanded[`${NS}targetOrigin`], [
      { "@type": `${XSD}string`, "@value": "https://SOCIAL.example:443/" },
    ]);
    deepStrictEqual(expanded[`${NS}revision`], [
      { "@type": `${XSD}integer`, "@value": 1 },
    ]);
    deepStrictEqual(expanded[`${NS}announcement`], [{ "@id": announcement }]);
    const parsed = await DeliverySuspension.fromJsonLd(json, options);
    deepStrictEqual(parsed.suspensionStatus, "active");
    deepStrictEqual(parsed.targetOrigin, source.targetOrigin);
    deepStrictEqual(parsed.announcement, new URL(announcement));
    deepStrictEqual(parsed.revision, 1);
    deepStrictEqual(parsed.endTime?.toString(), source.endTime?.toString());
    for (const Activity of [Create, Update]) {
      const wrapper = new Activity({
        id: new URL(announcement),
        actor: new URL(actorId),
        object: source,
      });
      const serialized = record(await wrapper.toJsonLd({ format }));
      ok(contexts(serialized).includes(FEP));
      const embedded = record(serialized.object);
      deepStrictEqual(embedded.type, "DeliverySuspension");
      deepStrictEqual(embedded.status, "active");
      deepStrictEqual(embedded.revision, 1);
      const activity = await Activity.fromJsonLd(serialized, options);
      const child = await activity.getObject(options);
      ok(child instanceof DeliverySuspension);
      deepStrictEqual(child.targetOrigin, source.targetOrigin);
      deepStrictEqual(child.revision, 1);
    }
  }
  const source = new DeliverySuspension({ targetInbox: new URL(inbox) });
  const json = record(await source.toJsonLd({ format: "compact" }));
  deepStrictEqual(json.targetInbox, inbox);
  ok(!("targetOrigin" in json));
  const parsed = await DeliverySuspension.fromJsonLd(json, options);
  deepStrictEqual(parsed.targetInbox, new URL(inbox));
});

test("FEP-f799 controlledOrigins on all actor classes preserves spelling and context", async () => {
  for (const Actor of [Application, Group, Organization, Person, Service]) {
    const empty = new Actor({});
    ok(!contexts(await empty.toJsonLd()).includes(FEP));
    const actor = new Actor({
      controlledOrigins: [
        "https://SOCIAL.example:443/",
        "https://other.example",
      ],
    });
    for (const format of [undefined, "compact"] as const) {
      const json = record(await actor.toJsonLd({ format }));
      deepStrictEqual(contexts(json).at(-1), FEP);
      deepStrictEqual(json.controlledOrigin, actor.controlledOrigins);
      const parsed = await Actor.fromJsonLd(json, options);
      deepStrictEqual(parsed.controlledOrigins, actor.controlledOrigins);
      deepStrictEqual(
        await getRawPropertyValues(parsed, `${NS}controlledOrigin`),
        actor.controlledOrigins.map((value) => ({
          "@type": `${XSD}string`,
          "@value": value,
        })),
      );
    }
  }
});

test("FEP-f799 deliveryController is an inherited URL scalar without dereference", async () => {
  for (const Type of [Collection, OrderedCollection]) {
    ok(!contexts(await new Type({}).toJsonLd()).includes(FEP));
    const source = new Type({ deliveryController: new URL(actorId) });
    deepStrictEqual("getDeliveryController" in source, false);
    for (const format of [undefined, "compact"] as const) {
      const json = record(await source.toJsonLd({ format }));
      deepStrictEqual(json.deliveryController, actorId);
      deepStrictEqual(contexts(json).at(-1), FEP);
      const parsed = await Type.fromJsonLd(json, options);
      deepStrictEqual(parsed.deliveryController, new URL(actorId));
    }
  }
});

test("FEP-f799 malformed extensions do not break ordinary actors collections or Create", async () => {
  const badValues = [
    { "@id": "https://[" },
    { "@value": 42 },
    { "@value": "not a URL" },
    { "@value": "wrong", "@type": `${XSD}integer` },
    { "@type": ["https://example.com/Other"] },
  ];
  for (const bad of badValues) {
    for (const Type of [Collection, OrderedCollection]) {
      const raw = {
        "@type": [`${AS}#${Type.name}`],
        [`${NS}deliveryController`]: [bad, { "@id": actorId }],
      };
      const parsed = await Type.fromJsonLd(raw, options);
      deepStrictEqual(parsed.deliveryController, new URL(actorId));
      const wrapper = await Create.fromJsonLd(
        { "@type": [`${AS}#Create`], [`${AS}#object`]: [raw] },
        options,
      );
      const object = await wrapper.getObject(options);
      ok(object instanceof Type);
      deepStrictEqual(object.deliveryController, new URL(actorId));
    }
    for (const Actor of [Application, Group, Organization, Person, Service]) {
      const parsed = await Actor.fromJsonLd(
        {
          "@type": [`${AS}#${Actor.name}`],
          [`${NS}controlledOrigin`]: [
            bad,
            { "@value": "https://social.example", "@type": `${XSD}string` },
          ],
        },
        options,
      );
      deepStrictEqual(
        parsed.controlledOrigins,
        "@value" in bad &&
          typeof bad["@value"] === "string" &&
          !("@type" in bad)
          ? [bad["@value"], "https://social.example"]
          : ["https://social.example"],
      );
    }
    const wrapper = await Create.fromJsonLd(
      {
        "@type": [`${AS}#Create`],
        [`${AS}#object`]: [
          {
            "@type": [`${NS}DeliverySuspension`],
            [`${NS}targetInbox`]: [bad],
            [`${NS}announcement`]: [bad],
            [`${NS}revision`]: [bad],
          },
        ],
      },
      options,
    );
    const object = await wrapper.getObject(options);
    ok(object instanceof DeliverySuspension);
    deepStrictEqual(object.targetInbox, null);
    deepStrictEqual(object.announcement, null);
    deepStrictEqual(
      object.revision,
      "@value" in bad && bad["@value"] === 42 ? 42 : null,
    );
  }
});

test("FEP-f799 status is independent of schema.org status in either context order", async () => {
  const schemaStatus = "http://schema.org/status";
  const alias = {
    suspension: { "@id": `${NS}status`, "@type": `${XSD}string` },
    profileStatus: schemaStatus,
  };
  for (const fepLast of [false, true]) {
    const context = fepLast
      ? [AS, "http://schema.org/", FEP, alias]
      : [AS, FEP, "http://schema.org/", alias];
    const parsed = await DeliverySuspension.fromJsonLd(
      {
        "@context": context,
        type: ["DeliverySuspension", "https://example.com/Extra"],
        ...(fepLast
          ? { status: "active", profileStatus: "profile status" }
          : { suspension: "active", status: "profile status" }),
      },
      options,
    );
    deepStrictEqual(parsed.suspensionStatus, "active");
    deepStrictEqual(await getRawPropertyValues(parsed, schemaStatus), [
      { "@value": "profile status" },
    ]);
    const retained = await withRawProperty(parsed, schemaStatus, [
      { "@value": "profile status" },
    ]);
    const expanded = await expand(
      await retained.toJsonLd({ format: "compact" }),
    );
    deepStrictEqual(expanded[`${NS}status`], [
      { "@type": `${XSD}string`, "@value": "active" },
    ]);
    deepStrictEqual(expanded[schemaStatus], [{ "@value": "profile status" }]);
  }
});

test("FEP-f799 modeled raw writes replace remove and validate extension values", async () => {
  const source = await DeliverySuspension.fromJsonLd(
    {
      "@type": [`${NS}DeliverySuspension`],
      [`${NS}status`]: [{ "@value": "active" }],
      [`${NS}revision`]: [{ "@value": 1 }],
    },
    options,
  );
  deepStrictEqual(await getRawPropertyValues(source, `${NS}status`), [
    { "@type": `${XSD}string`, "@value": "active" },
  ]);
  const changed = await withRawProperties(source, [
    [`${NS}status`, [{ "@value": "cancelled" }]],
    [`${NS}revision`, [{ "@value": 2 }]],
    [`${NS}targetInbox`, [{ "@id": inbox }]],
    [`${NS}announcement`, [{ "@id": announcement }]],
  ]);
  deepStrictEqual(changed.suspensionStatus, "cancelled");
  deepStrictEqual(changed.revision, 2);
  deepStrictEqual(changed.targetInbox, new URL(inbox));
  deepStrictEqual(changed.announcement, new URL(announcement));
  deepStrictEqual(source.suspensionStatus, "active");
  const removed = await withRawProperty(changed, `${NS}targetInbox`, []);
  deepStrictEqual(removed.targetInbox, null);
  const actor = await withRawProperty(
    new Person({ controlledOrigins: ["old"] }),
    `${NS}controlledOrigin`,
    [{ "@value": "https://social.example" }],
  );
  deepStrictEqual(actor.controlledOrigins, ["https://social.example"]);
  const collection = await withRawProperty(
    new Collection({}),
    `${NS}deliveryController`,
    [{ "@id": actorId }],
  );
  deepStrictEqual(collection.deliveryController, new URL(actorId));
  for (const [property, value] of [
    ["targetOrigin", { "@value": 42 }],
    ["status", { "@value": 42 }],
    ["status", { "@value": "active", "@type": `${XSD}integer` }],
    ["revision", { "@value": "2", "@type": `${XSD}integer` }],
    ["revision", { "@value": 0 }],
    ["revision", { "@value": 1.5 }],
    ["revision", { "@value": Number.MAX_SAFE_INTEGER + 1 }],
    ["targetInbox", { "@id": "https://[" }],
    ["announcement", { "@value": 42 }],
  ] as const) {
    await rejects(
      withRawProperty(source, `${NS}${property}`, [value]),
      TypeError,
    );
  }
  await rejects(
    withRawProperty(actor, `${NS}controlledOrigin`, [{ "@value": 42 }]),
    TypeError,
  );
  await rejects(
    withRawProperty(collection, `${NS}deliveryController`, [
      { "@id": "https://[" },
    ]),
    TypeError,
  );
  for (const revision of [
    0,
    -1,
    1.1,
    Number.MAX_SAFE_INTEGER + 1,
    NaN,
    Infinity,
  ]) {
    throws(() => new DeliverySuspension({ revision }), TypeError);
  }
});
