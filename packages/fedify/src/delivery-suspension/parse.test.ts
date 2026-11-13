// oxlint-disable no-await-in-loop -- Keep malformed-input cases sequential so context-cache and loader state cannot interfere across cases.
import { deepStrictEqual, ok, strictEqual, throws } from "node:assert/strict";
import { test } from "@fedify/fixture";
import {
  Create,
  Emoji,
  Image,
  Note,
  OrderedCollection,
  Person,
} from "@fedify/vocab";
import type { DocumentLoader } from "@fedify/vocab-runtime";
import jsonld from "@fedify/vocab-runtime/jsonld";
import {
  getDeliverySuspensionContextLoader,
  parseActorControlMetadata,
  parseDeliverySuspensionActivityDocument,
  parseDeliverySuspensionDocument,
  parseInboxControlMetadata,
} from "./parse.ts";
import type { DeliverySuspensionTarget, ParseResult } from "./types.ts";

const AS = "https://www.w3.org/ns/activitystreams#";
const F799 = "https://w3id.org/fep/f799#";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const contexts = [
  "https://www.w3.org/ns/activitystreams",
  "https://w3id.org/fep/f799",
];
function notice(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "@context": contexts,
    id: "https://social.example/maintenance/1",
    type: "DeliverySuspension",
    attributedTo: "https://social.example/actor",
    published: "2026-10-31T12:00:00Z",
    status: "active",
    targetOrigin: "https://SOCIAL.example:443/",
    revision: 1,
    endTime: "2026-11-01T05:00:00Z",
    ...extra,
  };
}
function actor(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "@context": contexts,
    id: "https://social.example/actor",
    type: "Application",
    ...extra,
  };
}
function activity(
  type: string,
  object: unknown,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    "@context": contexts,
    id: "https://social.example/activities/1",
    type,
    actor: "https://social.example/actor",
    published: "2026-10-31T12:00:00Z",
    object,
    ...extra,
  };
}
function success<T>(result: ParseResult<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}
function unsuccessful<T>(result: ParseResult<T>, code?: string): void {
  strictEqual(result.ok, false, JSON.stringify(result));
  if (!result.ok && code !== undefined)
    ok(
      result.issues.some((issue) => issue.code === code),
      JSON.stringify(result.issues),
    );
}

test("delivery suspension notice preserves detached immutable original claims", async () => {
  const raw = notice({
    type: ["DeliverySuspension", "https://example.net/Extra"],
    ["https://schema.org/status"]: "unrelated",
    startTime: "2026-11-01T01:00:00.00000000000000001Z",
  });
  const result = await parseDeliverySuspensionDocument(raw);
  const value = success(result);
  strictEqual(value.id, raw.id);
  strictEqual(value.controller, raw.attributedTo);
  strictEqual(value.suspensionStatus, "active");
  strictEqual(value.published, raw.published);
  strictEqual(value.startTime, raw.startTime);
  strictEqual(value.target.kind, "origin");
  const target: DeliverySuspensionTarget = {
    kind: "origin",
    origin: "https://SOCIAL.example:443/",
  };
  deepStrictEqual(value.target, target);
  strictEqual(
    value.normalizedTargetOrigin?.normalized,
    "https://social.example",
  );
  ok(Object.isFrozen(value.normalizedTargetOrigin));
  deepStrictEqual(value.types, [
    F799 + "DeliverySuspension",
    "https://example.net/Extra",
  ]);
  const expanded = value.expanded as readonly Record<string, unknown>[];
  deepStrictEqual(expanded[0]["https://schema.org/status"], [
    { "@value": "unrelated" },
  ]);
  deepStrictEqual(value.raw, raw);
  raw.id = "https://changed.example";
  strictEqual((value.raw as Record<string, unknown>).id, value.id);
  ok(Object.isFrozen(value));
  ok(Object.isFrozen(value.raw));
  ok(Object.isFrozen(expanded[0]));
  throws(() => {
    (value.raw as Record<string, unknown>).id = "mutated";
  }, TypeError);
});

test("delivery suspension aliases scoped contexts and expanded IRIs retain exact spelling", async () => {
  const raw = notice();
  delete raw.targetOrigin;
  raw["@context"] = [
    ...contexts,
    {
      actorAlias: { "@id": AS + "attributedTo", "@type": "@vocab" },
      sameActor: "https://social.example/actor",
      endpointAlias: { "@id": F799 + "targetInbox", "@type": "@id" },
      https: { "@id": "https://mapped.example/", "@prefix": true },
    },
  ];
  delete raw.attributedTo;
  raw.actorAlias = "sameActor";
  raw.endpointAlias = "https:InBox%2fPath?x=1#Fragment";
  const value = success(await parseDeliverySuspensionDocument(raw));
  strictEqual(value.controller, "https://social.example/actor");
  deepStrictEqual(value.target, {
    kind: "inbox",
    inbox: "https://mapped.example/InBox%2fPath?x=1#Fragment",
  });
  strictEqual(
    (value.raw as Record<string, unknown>).endpointAlias,
    "https:InBox%2fPath?x=1#Fragment",
  );
  const scoped = activity("Update", {
    type: "DeliverySuspension",
    ...notice({
      "@context": {
        custom: { "@id": F799 + "status", "@type": XSD + "string" },
      },
      status: undefined,
    }),
  });
  const scopedObject = scoped.object as Record<string, unknown>;
  delete scopedObject.status;
  scopedObject.custom = "cancelled";
  strictEqual(
    success(await parseDeliverySuspensionActivityDocument(scoped)).kind,
    "update",
  );
});

test("delivery suspension cardinality rejects null empty and aliased extra targets", async () => {
  for (const field of [
    "status",
    "revision",
    "published",
    "endTime",
    "startTime",
    "announcement",
    "targetOrigin",
  ]) {
    for (const invalid of [null, [], [null], ["active", null]]) {
      unsuccessful(
        await parseDeliverySuspensionDocument(notice({ [field]: invalid })),
      );
    }
  }
  for (const target of [
    null,
    [],
    [null],
    { "@language": "en" },
    { "@graph": [] },
  ])
    unsuccessful(
      await parseDeliverySuspensionDocument(notice({ targetInbox: target })),
    );
  const aliased = notice({
    "@context": [
      ...contexts,
      { more: { "@id": F799 + "targetOrigin", "@type": XSD + "string" } },
    ],
    more: null,
  });
  unsuccessful(
    await parseDeliverySuspensionDocument(aliased),
    "invalid-target",
  );
  const mixed = notice({ targetOrigin: ["https://social.example", null] });
  unsuccessful(await parseDeliverySuspensionDocument(mixed), "invalid-target");
  const typedNull = await parseDeliverySuspensionDocument(
    notice({ status: { "@value": null, "@type": XSD + "string" } }),
  );
  unsuccessful(typedNull);
  if (!typedNull.ok) strictEqual(typedNull.issues[0].rawPath, "/status/@value");
  const hostile = notice({
    "@context": [
      ...contexts,
      {
        urn: { "@id": "https://attacker.example/", "@prefix": true },
        https: { "@id": "https://attacker.example/", "@prefix": true },
      },
    ],
    targetInbox: null,
  });
  unsuccessful(await parseDeliverySuspensionDocument(hostile));
});

test("delivery suspension conservative expansion rejects global structural loss", async () => {
  for (const extra of [
    { "@context": [...contexts, { "@vocab": null }], unmapped: null },
    { "@context": [...contexts, { "@vocab": null }], unmapped: [] },
    { "https://example.net/other": { "@language": "en" } },
    { "https://example.net/other": { "@graph": [] } },
    { "@included": {} },
    {
      "@context": [
        ...contexts,
        {
          graph: { "@id": "https://example.net/graph", "@container": "@graph" },
        },
      ],
      graph: null,
    },
    {
      "@context": [
        ...contexts,
        {
          graph: { "@id": "https://example.net/graph", "@container": "@graph" },
        },
      ],
      graph: [],
    },
    {
      "@context": [...contexts, { "@reserved": "https://example.net/ignored" }],
    },
  ])
    unsuccessful(
      await parseDeliverySuspensionDocument(notice(extra)),
      "unsupported-lossy-shape",
    );
  const warnings = await parseDeliverySuspensionDocument(
    notice({
      "@context": [...contexts, { "@vocab": null }],
      unmapped: "a non-null unknown scalar",
    }),
  );
  success(warnings);
  if (warnings.ok)
    ok(warnings.warnings.some((issue) => issue.code === "jsonld-warning"));
  const jsonNull = notice({
    "https://example.net/json": {
      "@type": "@json",
      "@value": { null: null, empty: [] },
    },
  });
  const value = success(await parseDeliverySuspensionDocument(jsonNull));
  ok(!JSON.stringify(value).includes("fedify-f799-occurrence"));
});

test("delivery suspension strict literal shapes times revisions and target URI syntax", async () => {
  for (const invalid of [
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    "1",
    { "@value": 1, "@type": XSD + "double" },
  ])
    unsuccessful(
      await parseDeliverySuspensionDocument(notice({ revision: invalid })),
    );
  for (const invalid of [
    "ACTIVE",
    { "@value": "active", "@language": "en" },
    { "@value": "active", "@index": "x" },
    { "@list": ["active"] },
    { "@value": "active", "@type": "@json" },
  ])
    unsuccessful(
      await parseDeliverySuspensionDocument(notice({ status: invalid })),
    );
  for (const invalid of [
    "2026-11-01T05:00:00",
    "2026-11-01T05:00:60Z",
    { "@value": "2026-11-01T05:00:00Z" },
    { "@value": "2026-11-01T05:00:00Z", "@type": XSD + "string" },
  ])
    unsuccessful(
      await parseDeliverySuspensionDocument(notice({ endTime: invalid })),
    );
  success(
    await parseDeliverySuspensionDocument(
      notice({
        startTime: "0000-01-01T00:00:00.0000000000000000001Z",
        endTime: "-0000-01-01T00:00:00.0000000000000000002Z",
        revision: Number.MAX_SAFE_INTEGER,
      }),
    ),
  );
  unsuccessful(
    await parseDeliverySuspensionDocument(
      notice({
        startTime: "2000-01-01T00:00:00.10Z",
        endTime: "2000-01-01T00:00:00.100Z",
      }),
    ),
    "invalid-interval",
  );
  for (const targetInbox of [
    "http://social.example/inbox",
    "https://user@social.example/inbox",
    "https://social.example/a%2",
    "https://social.example/a b",
    "https://social.example/\\inbox",
    { id: "https://social.example/inbox", type: "Collection" },
  ]) {
    const raw = notice({ targetInbox });
    delete raw.targetOrigin;
    unsuccessful(await parseDeliverySuspensionDocument(raw));
  }
  for (const inbox of [
    "https://0x7f000001/inbox",
    "https://%65xample.com/inbox",
    "https://%E4%BE%8B.example/inbox",
  ]) {
    const unusual = notice({ targetInbox: inbox });
    delete unusual.targetOrigin;
    const result = await parseDeliverySuspensionDocument(unusual);
    deepStrictEqual(success(result).target, { kind: "inbox", inbox });
    strictEqual(success(result).normalizedTargetOrigin, undefined);
    if (result.ok)
      ok(result.warnings.some((issue) => issue.code === "unavailable-origin"));
    const metadata = await parseActorControlMetadata(actor({ inbox }));
    strictEqual(success(metadata).inbox.state, "single");
    if (metadata.ok)
      ok(
        metadata.warnings.some((issue) => issue.code === "unavailable-origin"),
      );
  }
});

test("delivery suspension Create Update and unverified Undo activity claims", async () => {
  const createObject = notice({
    announcement: "https://social.example/activities/1",
  });
  const create = success(
    await parseDeliverySuspensionActivityDocument(
      activity("Create", createObject),
    ),
  );
  strictEqual(create.kind, "create");
  strictEqual(create.suspension.revision, 1);
  deepStrictEqual(create.suspension.raw, create.raw);
  ok(
    !JSON.stringify(create.suspension.expanded).includes(
      "fedify-f799-occurrence",
    ),
  );
  const update = success(
    await parseDeliverySuspensionActivityDocument(
      activity("Update", notice({ revision: 2, status: "cancelled" })),
    ),
  );
  strictEqual(update.kind, "update");
  for (const type of ["Create", "Update"]) {
    unsuccessful(
      await parseDeliverySuspensionActivityDocument(
        activity(type, {
          ...createObject,
          id: "https://social.example/activities/1",
        }),
      ),
      "invalid-activity-id",
    );
  }
  unsuccessful(
    await parseDeliverySuspensionActivityDocument(
      activity("Update", { ...createObject, revision: 2 }),
    ),
    "invalid-activity-id",
  );
  for (const object of [
    "https://social.example/activities/1",
    {
      id: "https://social.example/activities/1",
      type: "Create",
      actor: "https://social.example/actor",
    },
  ]) {
    unsuccessful(
      await parseDeliverySuspensionActivityDocument(activity("Undo", object)),
      "invalid-activity-id",
    );
  }
  unsuccessful(
    await parseDeliverySuspensionActivityDocument(activity("Create", notice())),
    "inconsistent-announcement",
  );
  unsuccessful(
    await parseDeliverySuspensionActivityDocument(
      activity(
        "Create",
        notice({
          announcement: "https://social.example/activities/1",
          revision: 2,
        }),
      ),
    ),
    "invalid-create-revision",
  );
  unsuccessful(
    await parseDeliverySuspensionActivityDocument(
      activity(
        "Update",
        notice({ attributedTo: "https://social.example/other" }),
      ),
    ),
    "inconsistent-actor",
  );
  unsuccessful(
    await parseDeliverySuspensionActivityDocument(
      activity("Update", notice({ id: "https://other.example/notice" })),
    ),
    "inconsistent-origin",
  );
  unsuccessful(
    await parseDeliverySuspensionActivityDocument(
      activity("Create", { type: "Note", content: "not a notice" }),
    ),
    "not-applicable",
  );
  for (const type of ["Create", "Update"]) {
    for (const omitted of [["published"], ["id", "actor", "published"]]) {
      const unrelated = activity(type, { type: "Note", content: "unrelated" });
      for (const key of omitted) delete unrelated[key];
      unsuccessful(
        await parseDeliverySuspensionActivityDocument(unrelated),
        "not-applicable",
      );
    }
    const applicable = activity(type, createObject);
    delete applicable.published;
    unsuccessful(
      await parseDeliverySuspensionActivityDocument(applicable),
      "invalid-cardinality",
    );
  }
  const undo = success(
    await parseDeliverySuspensionActivityDocument(
      activity("Undo", "https://social.example/original-create"),
    ),
  );
  strictEqual(undo.kind, "undo");
  if (undo.kind === "undo") {
    strictEqual(undo.undoneActivity, "https://social.example/original-create");
    strictEqual(undo.embeddedCreate, undefined);
  }
  const embeddedUndo = success(
    await parseDeliverySuspensionActivityDocument(
      activity("Undo", {
        id: "https://social.example/original-create",
        type: ["Create", "https://other.example/Extra"],
        actor: "https://social.example/actor",
      }),
    ),
  );
  if (embeddedUndo.kind === "undo")
    strictEqual(
      embeddedUndo.embeddedCreate?.actor,
      "https://social.example/actor",
    );
  unsuccessful(
    await parseDeliverySuspensionActivityDocument(
      activity("Undo", {
        id: "https://social.example/original-create",
        type: "Create",
        actor: "https://social.example/other",
      }),
    ),
    "inconsistent-actor",
  );
  unsuccessful(
    await parseDeliverySuspensionActivityDocument(
      activity("Undo", {
        id: "https://social.example/update",
        type: "Update",
        actor: "https://social.example/actor",
      }),
    ),
    "invalid-object",
  );
  unsuccessful(
    await parseDeliverySuspensionActivityDocument(
      activity("Undo", "https://other.example/create"),
    ),
    "inconsistent-origin",
  );
  unsuccessful(
    await parseDeliverySuspensionActivityDocument(
      activity("Create", createObject, { type: ["Create", "Update"] }),
    ),
    "invalid-type",
  );
});

test("delivery suspension metadata preserves absent single invalid and multiple links", async () => {
  strictEqual(
    success(await parseActorControlMetadata(actor())).inbox.state,
    "absent",
  );
  strictEqual(
    success(
      await parseActorControlMetadata(
        actor({ inbox: "https://social.example/inbox" }),
      ),
    ).inbox.state,
    "single",
  );
  for (const inbox of [
    null,
    [],
    "http://social.example/inbox",
    { id: "https://social.example/inbox", type: "Collection" },
  ]) {
    const value = success(await parseActorControlMetadata(actor({ inbox })));
    strictEqual(value.inbox.state, "invalid");
    strictEqual(value.inbox.values.length, 1);
  }
  const result = success(
    await parseActorControlMetadata(
      actor({ inbox: ["https://social.example/inbox", null] }),
    ),
  );
  strictEqual(result.inbox.state, "multiple");
  deepStrictEqual(
    result.inbox.values.map((value) => value.valid),
    [true, false],
  );
  strictEqual(result.inbox.values[1].rawPath, "/inbox/1");
  strictEqual(result.inbox.values[1].raw, null);
  const propertyPointer = (name: string) =>
    name.replace(/~/g, "~0").replace(/\//g, "~1");
  const evidenceAt = (evidence: unknown, path: string): unknown => {
    let value = evidence;
    for (const token of path.split("/").slice(1)) {
      const key = token.replace(/~1/g, "/").replace(/~0/g, "~");
      ok(
        value !== null &&
          typeof value === "object" &&
          Object.hasOwn(value, key),
        path,
      );
      value = (value as Record<string, unknown>)[key];
    }
    return value;
  };
  for (const inbox of [
    [null, "http://social.example/inbox"],
    [[], null, "https://social.example/a", null, "http://social.example/b"],
    [{ "@value": null }, "http://social.example/inbox"],
    [
      [null, "http://social.example/a"],
      [[], "https://social.example/b"],
    ],
    ["http://social.example/a", null, "http://social.example/a"],
    [{ "@value": null, "@type": "@json" }, "http://social.example/a"],
    [{ "@value": { nested: [] }, "@type": "@json" }, "http://social.example/a"],
  ]) {
    const result = await parseActorControlMetadata(actor({ inbox }));
    const value = success(result);
    for (const member of value.inbox.values) {
      const evidence = evidenceAt(value.expanded, member.path);
      if (member.rawPath === undefined) deepStrictEqual(evidence, member.raw);
      else evidenceAt(value.raw, member.rawPath);
      for (const issue of member.issues) {
        strictEqual(issue.path, member.path);
        evidenceAt(value.expanded, issue.path);
      }
    }
    const http = value.inbox.values.filter(
      (v) =>
        v.raw !== null &&
        typeof v.raw === "object" &&
        !Array.isArray(v.raw) &&
        "@id" in v.raw &&
        typeof v.raw["@id"] === "string" &&
        v.raw["@id"].startsWith("http:"),
    );
    for (const member of http)
      strictEqual(member.issues[0].code, "invalid-https-uri");
  }
  const shifted = success(
    await parseActorControlMetadata(
      actor({
        inbox: [null, "http://social.example/inbox"],
      }),
    ),
  );
  strictEqual(
    shifted.inbox.values[1].path,
    `/0/${propertyPointer("http://www.w3.org/ns/ldp#inbox")}/0`,
  );
  strictEqual(shifted.inbox.values[0].rawPath, "/inbox/0");
  const opaque = success(
    await parseActorControlMetadata(
      actor({
        inbox: { "@value": { nested: [] }, "@type": "@json" },
      }),
    ),
  );
  deepStrictEqual(opaque.inbox.values[0].raw, {
    "@value": { nested: [] },
    "@type": "@json",
  });
  const nested = success(
    await parseActorControlMetadata(
      actor({
        endpoints: [
          null,
          { sharedInbox: [null, "http://social.example/shared"] },
          { sharedInbox: [] },
          "http://social.example/endpoints",
        ],
      }),
    ),
  );
  for (const parent of nested.endpoints) {
    evidenceAt(nested.expanded, parent.path);
    for (const member of parent.sharedInbox.values) {
      evidenceAt(nested.expanded, member.path);
      if (member.rawPath === undefined)
        deepStrictEqual(evidenceAt(nested.expanded, member.path), member.raw);
    }
  }
  strictEqual(
    nested.sharedInbox.values[1].path,
    `/0/${propertyPointer(AS + "endpoints")}/0/${propertyPointer(AS + "sharedInbox")}/0`,
  );
  const aliases = success(
    await parseActorControlMetadata(
      actor({
        "@context": [
          ...contexts,
          {
            zInbox: { "@id": "http://www.w3.org/ns/ldp#inbox", "@type": "@id" },
            aInbox: { "@id": "http://www.w3.org/ns/ldp#inbox", "@type": "@id" },
          },
        ],
        zInbox: [null, "http://social.example/z"],
        aInbox: [null, "http://social.example/a"],
      }),
    ),
  );
  for (const member of aliases.inbox.values)
    if (member.rawPath === undefined)
      deepStrictEqual(evidenceAt(aliases.expanded, member.path), member.raw);
  const originResult = await parseActorControlMetadata(
    actor({
      controlledOrigin: [
        null,
        "https://social.example/path",
        { "@value": null, "@type": XSD + "string" },
        "https://social.example/",
      ],
    }),
  );
  const originValues = success(originResult);
  for (const member of originValues.controlledOrigins)
    evidenceAt(originValues.expanded, member.path);
  if (originResult.ok)
    for (const warning of originResult.warnings)
      evidenceAt(originValues.expanded, warning.path);
  const reverse = success(
    await parseInboxControlMetadata({
      "@context": [...contexts, "https://w3id.org/fep/5711"],
      id: "https://social.example/inbox",
      deliveryController: [null, "http://social.example/actor"],
      inboxOf: [null, "http://social.example/owner"],
    }),
  );
  for (const state of [reverse.deliveryController, reverse.inboxOf])
    for (const member of state.values) {
      evidenceAt(reverse.expanded, member.path);
      if (member.rawPath === undefined)
        deepStrictEqual(evidenceAt(reverse.expanded, member.path), member.raw);
    }
  const inbox = {
    "@context": [...contexts, "https://w3id.org/fep/5711"],
    id: "https://social.example/inbox",
    type: "Collection",
    inboxOf: "https://social.example/actor",
    deliveryController: ["https://social.example/actor", null],
  };
  const parsedInbox = success(
    await parseInboxControlMetadata(inbox, { expectedId: inbox.id }),
  );
  strictEqual(parsedInbox.inboxOf.state, "single");
  strictEqual(parsedInbox.deliveryController.state, "multiple");
  unsuccessful(
    await parseInboxControlMetadata(inbox, {
      expectedId: "https://SOCIAL.example/inbox",
    }),
    "unexpected-id",
  );
  unsuccessful(
    await parseActorControlMetadata(
      actor({ id: "http://social.example/actor" }),
    ),
    "invalid-https-uri",
  );
  strictEqual(
    success(
      await parseActorControlMetadata(
        actor({ type: "https://other.example/UnfamiliarActor" }),
      ),
    ).id,
    "https://social.example/actor",
  );
});

test("delivery suspension actor metadata retains unresolved endpoints and parent ambiguity", async () => {
  const unresolved = success(
    await parseActorControlMetadata(
      actor({ endpoints: "https://social.example/endpoints" }),
    ),
  );
  strictEqual(unresolved.endpoints[0].kind, "unresolved");
  strictEqual(
    unresolved.endpoints[0].reference,
    "https://social.example/endpoints",
  );
  strictEqual(unresolved.sharedInbox.state, "absent");
  const multiple = success(
    await parseActorControlMetadata(
      actor({
        endpoints: [
          { sharedInbox: "https://social.example/inbox" },
          { sharedInbox: ["https://social.example/other", null] },
          "https://social.example/unresolved",
        ],
      }),
    ),
  );
  strictEqual(multiple.endpointsAmbiguous, true);
  strictEqual(multiple.endpoints.length, 3);
  strictEqual(multiple.sharedInbox.state, "multiple");
  deepStrictEqual(
    multiple.sharedInbox.values.map((value) => value.valid),
    [true, true, false],
  );
  const nullEndpoints = success(
    await parseActorControlMetadata(actor({ endpoints: null })),
  );
  strictEqual(nullEndpoints.endpoints[0].kind, "invalid");
  const origins = success(
    await parseActorControlMetadata(
      actor({
        controlledOrigin: [
          "https://SOCIAL.example:443/",
          "https://social.example/path",
          null,
        ],
      }),
    ),
  );
  strictEqual(origins.controlledOrigins.length, 3);
  deepStrictEqual(
    origins.controlledOrigins.map((value) => value.normalization.ok),
    [true, false, false],
  );
  strictEqual(
    origins.controlledOrigins[0].value,
    "https://SOCIAL.example:443/",
  );
  strictEqual(origins.controlledOrigins[2].raw, null);
});

test("delivery suspension rejects unsafe JSON without invoking accessors", async () => {
  let invoked = false;
  const getter = notice();
  Object.defineProperty(getter, "status", {
    enumerable: true,
    get() {
      invoked = true;
      return "active";
    },
  });
  unsuccessful(await parseDeliverySuspensionDocument(getter), "invalid-json");
  strictEqual(invoked, false);
  const cycle = notice();
  cycle.cycle = cycle;
  for (const bad of [
    cycle,
    notice({ bad: new Date() }),
    notice({ bad: Infinity }),
    notice({ bad: undefined }),
    notice({ bad: [1, , 3] }),
    "https://social.example/notice",
    null,
  ])
    unsuccessful(await parseDeliverySuspensionDocument(bad));
  const sparseWithNamedIndex: unknown[] = [1];
  sparseWithNamedIndex.length = 2;
  Object.defineProperty(sparseWithNamedIndex, "4294967295", {
    enumerable: true,
    value: 2,
  });
  unsuccessful(
    await parseDeliverySuspensionDocument(
      notice({ bad: sparseWithNamedIndex }),
    ),
    "invalid-json",
  );
  const pollution = JSON.parse('{"__proto__":{"polluted":true}}');
  unsuccessful(
    await parseDeliverySuspensionDocument(notice(pollution)),
    "unsafe-json-key",
  );
  strictEqual(({} as Record<string, unknown>).polluted, undefined);
  let nested: unknown = "value";
  for (let i = 0; i < 66; i++) nested = { nested };
  unsuccessful(
    await parseDeliverySuspensionDocument(notice({ nested })),
    "resource-limit",
  );
  unsuccessful(
    await parseDeliverySuspensionDocument(
      notice({ huge: "x".repeat(1024 * 1024) }),
    ),
    "resource-limit",
  );
});

test("delivery suspension default loader is offline cloned and unknown contexts never fetch", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (() => {
    calls++;
    throw new Error("no network");
  }) as typeof fetch;
  try {
    const loader = getDeliverySuspensionContextLoader();
    const loaded = await loader("https://w3id.org/fep/f799");
    (loaded.document as Record<string, unknown>)["@context"] = {};
    const fresh = await loader("https://w3id.org/fep/f799");
    ok(
      Object.keys(
        (fresh.document as Record<string, Record<string, unknown>>)["@context"],
      ).length > 0,
    );
    success(await parseDeliverySuspensionDocument(notice()));
    unsuccessful(
      await parseDeliverySuspensionDocument(
        notice({ "@context": ["https://unknown.example/context"] }),
      ),
    );
    strictEqual(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("delivery suspension custom contexts are memoized validated and detached before awaits", async () => {
  const offline = getDeliverySuspensionContextLoader();
  let calls = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const loader: DocumentLoader = async (url) => {
    calls++;
    if (url === "https://example.net/custom") {
      await gate;
      return {
        documentUrl: url,
        contextUrl: null,
        document: { "@context": contexts },
      };
    }
    return offline(url);
  };
  const raw = notice({ "@context": "https://example.net/custom" });
  const parsing = parseDeliverySuspensionDocument(raw, {
    contextLoader: loader,
  });
  raw.status = "cancelled";
  raw.id = "https://evil.example/id";
  release!();
  const value = success(await parsing);
  strictEqual(value.suspensionStatus, "active");
  strictEqual(value.id, "https://social.example/maintenance/1");
  strictEqual(calls, 3);
  for (const parser of [parseActorControlMetadata, parseInboxControlMetadata]) {
    for (const initiallyMatches of [true, false]) {
      let releaseOptionsRace!: () => void;
      const optionsGate = new Promise<void>((resolve) => {
        releaseOptionsRace = resolve;
      });
      let startedOptionsRace!: () => void;
      const optionsLoading = new Promise<void>((resolve) => {
        startedOptionsRace = resolve;
      });
      const goodId = "https://good.example/resource";
      const otherId = "https://evil.example/resource";
      const optionsLoader: DocumentLoader = async (url) => {
        if (url === "https://example.net/options-race") {
          startedOptionsRace();
          await optionsGate;
          return {
            document: { "@context": contexts },
            documentUrl: url,
            contextUrl: null,
          };
        }
        return offline(url);
      };
      const mutableOptions = {
        expectedId: goodId,
        contextLoader: optionsLoader,
      };
      const metadataRaw = actor({
        "@context": "https://example.net/options-race",
        id: initiallyMatches ? goodId : otherId,
      });
      const pendingMetadata = parser(metadataRaw, mutableOptions);
      await optionsLoading;
      mutableOptions.expectedId = otherId;
      mutableOptions.contextLoader = () =>
        Promise.reject(new Error("mutated loader must not be used"));
      metadataRaw.id = "https://changed.example/resource";
      releaseOptionsRace();
      const metadataResult = await pendingMetadata;
      strictEqual(
        metadataResult.ok,
        initiallyMatches,
        `${parser.name}: expectedId is captured before awaiting`,
      );
      if (metadataResult.ok) strictEqual(metadataResult.value.id, goodId);
      else
        ok(
          metadataResult.issues.some(
            (problem) => problem.code === "unexpected-id",
          ),
        );
    }
  }

  for (const document of [
    { "@context": { "@base": "https://evil.example/" } },
    {
      "@context": {
        local: {
          "@id": "https://example.net/local",
          "@context": { "@base": "https://evil.example/" },
        },
      },
    },
    JSON.parse('{"@context":{"__proto__":{"polluted":true}}}'),
    { "@context": { bad: new Date() } },
    '{"@context":{"__proto__":{"polluted":true}}}',
  ]) {
    const unsafe: DocumentLoader = (url) =>
      Promise.resolve({
        document,
        documentUrl: url,
        contextUrl: null,
      });
    unsuccessful(
      await parseDeliverySuspensionDocument(
        notice({ "@context": "https://example.net/context" }),
        { contextLoader: unsafe },
      ),
    );
  }
  let invokedContextGetter = false;
  const accessorContext = { "@context": {} };
  Object.defineProperty(accessorContext, "unsafe", {
    enumerable: true,
    get() {
      invokedContextGetter = true;
      return "not invoked";
    },
  });
  const accessorLoader: DocumentLoader = (url) =>
    Promise.resolve({
      document: accessorContext,
      contextUrl: null,
      documentUrl: url,
    });
  unsuccessful(
    await parseDeliverySuspensionDocument(
      notice({ "@context": "https://example.net/context" }),
      { contextLoader: accessorLoader },
    ),
    "invalid-json",
  );
  strictEqual(invokedContextGetter, false);
  const mutableContext = {
    "@context": [
      ...contexts,
      { condition: { "@id": F799 + "status", "@type": XSD + "string" } },
    ],
  };
  const mutableLoader: DocumentLoader = (url) => {
    if (url === "https://example.net/mutable")
      return Promise.resolve({
        document: mutableContext,
        contextUrl: null,
        documentUrl: url,
      });
    (
      mutableContext["@context"][2] as { condition: { "@id": string } }
    ).condition["@id"] = "https://evil.example/condition";
    return offline(url);
  };
  const mutableRaw = notice({
    "@context": "https://example.net/mutable",
    condition: "active",
  });
  delete mutableRaw.status;
  strictEqual(
    success(
      await parseDeliverySuspensionDocument(mutableRaw, {
        contextLoader: mutableLoader,
      }),
    ).suspensionStatus,
    "active",
  );
  const throwing: DocumentLoader = () =>
    Promise.reject(new Error("caller failure"));
  unsuccessful(
    await parseDeliverySuspensionDocument(
      notice({ "@context": "https://example.net/context" }),
      { contextLoader: throwing },
    ),
  );
});

test("delivery suspension rejects base in inline scoped imported and loaded context closure", async () => {
  for (const context of [
    [...contexts, { "@base": "https://evil.example/" }],
    [
      ...contexts,
      {
        local: {
          "@id": "https://example.net/local",
          "@context": { "@base": "https://evil.example/" },
        },
      },
    ],
  ])
    unsuccessful(
      await parseDeliverySuspensionDocument(notice({ "@context": context })),
      "unsupported-base",
    );
  const offline = getDeliverySuspensionContextLoader();
  const loader: DocumentLoader = (url) => {
    if (url === "https://example.net/a")
      return Promise.resolve({
        document: { "@context": { "@import": "https://example.net/b" } },
        contextUrl: null,
        documentUrl: url,
      });
    if (url === "https://example.net/b")
      return Promise.resolve({
        document: { "@context": { "@base": "https://evil.example/" } },
        contextUrl: null,
        documentUrl: url,
      });
    return offline(url);
  };
  unsuccessful(
    await parseDeliverySuspensionDocument(
      notice({ "@context": [...contexts, "https://example.net/a"] }),
      { contextLoader: loader },
    ),
    "unsupported-base",
  );
  success(
    await parseDeliverySuspensionDocument(
      notice({ "@context": [...contexts, { "@base": null }] }),
    ),
  );
  unsuccessful(
    await parseDeliverySuspensionDocument(notice({ id: "/relative" })),
    "invalid-https-uri",
  );
});

test("delivery suspension loader cannot be bypassed by ambient JSON-LD context cache", async () => {
  const offline = getDeliverySuspensionContextLoader();
  const url = "https://unpreloaded.example/cached-context";
  const raw = notice({ "@context": url });
  await jsonld.expand(raw as Parameters<typeof jsonld.expand>[0], {
    documentLoader: async (requested: string) =>
      requested === url
        ? {
            document: { "@context": contexts },
            contextUrl: null,
            documentUrl: url,
            tag: "static",
          }
        : await offline(requested),
  });
  // Prime only this test's URL; caching shared preloads would interfere with
  // context-recording tests in runtimes that run files in the same process.
  let ambientLoaderCalled = false;
  await jsonld.expand(raw as Parameters<typeof jsonld.expand>[0], {
    documentLoader: () => {
      ambientLoaderCalled = true;
      return Promise.reject(
        new Error(
          "The statically cached test context should bypass this loader.",
        ),
      );
    },
  });
  strictEqual(ambientLoaderCalled, false);
  unsuccessful(await parseDeliverySuspensionDocument(raw), "unknown-context");
});

test("delivery suspension diagnostic markers avoid input and loaded-context collisions", async () => {
  const collision = "\u0000fedify-f799-occurrence-0:0";
  const offline = getDeliverySuspensionContextLoader();
  const loader: DocumentLoader = (url) =>
    url === "https://example.net/collision"
      ? Promise.resolve({
          documentUrl: url,
          contextUrl: null,
          document: {
            "@context": [
              ...contexts,
              {
                collision: {
                  "@id": "https://example.net/collision-property",
                  "@context": { unused: collision },
                },
              },
            ],
          },
        })
      : offline(url);
  const raw = actor({
    "@context": "https://example.net/collision",
    inbox: null,
    "https://example.net/input": collision,
  });
  const result = success(
    await parseActorControlMetadata(raw, { contextLoader: loader }),
  );
  strictEqual(result.inbox.state, "invalid");
  strictEqual(result.inbox.values[0].raw, null);
  deepStrictEqual(result.raw, raw);
  strictEqual(
    JSON.stringify(result.raw).includes("fedify-f799-occurrence-0:0"),
    true,
  );
  strictEqual(
    JSON.stringify(result).includes("fedify-f799-occurrence-1:"),
    false,
  );
});

test("delivery suspension context URL limit retains resource diagnostics", async () => {
  for (const count of [30, 31]) {
    const definitions: Record<string, { "@id": string; "@context": string[] }> =
      {};
    const extra: Record<string, unknown> = {};
    for (let start = 0; start < count; start += 8) {
      const term = `p${start}`;
      definitions[term] = {
        "@id": `https://example.net/${term}`,
        "@context": Array.from(
          { length: Math.min(8, count - start) },
          (_, index) => `https://contexts.example/${start + index}`,
        ),
      };
      extra[term] = { "https://example.net/value": "value" };
    }
    const offline = getDeliverySuspensionContextLoader();
    const loaded = new Set<string>();
    const result = await parseDeliverySuspensionDocument(
      notice({ "@context": [...contexts, definitions], ...extra }),
      {
        contextLoader: async (url) => {
          loaded.add(url);
          return url.startsWith("https://contexts.example/")
            ? {
                document: { "@context": {} },
                documentUrl: url,
                contextUrl: null,
              }
            : await offline(url);
        },
      },
    );
    strictEqual(loaded.size, 32);
    if (count === 30) success(result);
    else unsuccessful(result, "resource-limit");
  }
});

test("delivery suspension bounds context expansion before materializing IRIs", async () => {
  const ordinaryActor = await new Person({
    id: new URL("https://social.example/actor"),
    inbox: new URL("https://social.example/inbox"),
    tags: Array.from(
      { length: 100 },
      (_, i) =>
        new Emoji({
          id: new URL(`https://social.example/emojis/${i}`),
          name: `:emoji${i}:`,
          icon: new Image({
            url: new URL(`https://social.example/emojis/${i}.png`),
          }),
        }),
    ),
  }).toJsonLd();
  const ordinaryActorResult = success(
    await parseActorControlMetadata(ordinaryActor),
  );
  strictEqual(ordinaryActorResult.inbox.state, "single");
  const ordinaryInbox = await new OrderedCollection({
    id: new URL("https://social.example/inbox"),
    items: Array.from(
      { length: 100 },
      (_, i) =>
        new Create({
          id: new URL(`https://social.example/activities/${i}`),
          object: new Note({
            id: new URL(`https://social.example/notes/${i}`),
            content: "Hello",
          }),
        }),
    ),
  }).toJsonLd();
  success(await parseInboxControlMetadata(ordinaryInbox));

  const oversized = "https://example.net/" + "a".repeat(2049);
  const term = { p: { "@id": oversized, "@prefix": true } };
  const remote = "https://contexts.example/oversized";
  const header = "https://contexts.example/header";
  const offline = getDeliverySuspensionContextLoader();
  const loaded = new Map<string, number>();
  const loader: DocumentLoader = (url) => {
    loaded.set(url, (loaded.get(url) ?? 0) + 1);
    if (url === remote || url === header)
      return Promise.resolve({
        documentUrl: url,
        contextUrl: url === header ? remote : null,
        document: { "@context": url === header ? {} : term },
      });
    return offline(url);
  };
  for (const local of [
    term,
    { scoped: { "@id": "https://example.net/scoped", "@context": term } },
    { Scoped: { "@id": "https://example.net/Scoped", "@context": term } },
    remote,
    { "@import": remote },
    header,
  ]) {
    loaded.clear();
    unsuccessful(
      await parseActorControlMetadata(
        actor({
          "@context": [...contexts, local],
          "p:key": "value",
        }),
        { contextLoader: loader },
      ),
      "resource-limit",
    );
    ok([...loaded.values()].every((count) => count === 1));
  }
  for (const local of [
    { p: "https://example.net/", q: "p:more/" },
    { p: "https://example.net/", q: { "@id": "p:more/", "@prefix": true } },
    { p: "https://example.net/", "@vocab": "p:more" },
    { "https://example.net/term": "https://example.net/mapped" },
    { "@context": { p: "https://example.net/", q: "p:more/" } },
    { "@context": null },
  ])
    unsuccessful(
      await parseActorControlMetadata(
        actor({
          "@context": [...contexts, local],
        }),
      ),
      "unsupported-lossy-shape",
    );
  const urls = Array.from(
    { length: 8 },
    (_, i) => `https://contexts.example/repeat/${i}`,
  );
  loaded.clear();
  unsuccessful(
    await parseActorControlMetadata(
      actor({
        "@context": [...contexts, urls[7]],
      }),
      {
        contextLoader: (url) => {
          loaded.set(url, (loaded.get(url) ?? 0) + 1);
          const index = urls.indexOf(url);
          return index < 0
            ? offline(url)
            : Promise.resolve({
                documentUrl: url,
                contextUrl: null,
                document: {
                  "@context":
                    index === 0
                      ? {}
                      : Array.from({ length: 4 }, () => urls[index - 1]),
                },
              });
        },
      },
    ),
    "resource-limit",
  );
  ok([...loaded.values()].every((count) => count === 1));
  for (const payload of [
    { "@context": "https://payload.example/never-fetch" },
    { child: [{ "@context": "https://payload.example/never-fetch" }] },
  ]) {
    let payloadCalls = 0;
    unsuccessful(
      await parseActorControlMetadata(
        actor({
          "https://example.net/payload": {
            "@value": payload,
            "@type": "@json",
          },
        }),
        {
          contextLoader: (url) => {
            if (url.startsWith("https://payload.example/")) payloadCalls++;
            return offline(url);
          },
        },
      ),
      "unsupported-lossy-shape",
    );
    strictEqual(payloadCalls, 0);
  }
  unsuccessful(
    await parseActorControlMetadata(
      actor({
        "@context": [
          ...contexts,
          {
            unused: {
              "@id": "https://example.net/unused",
              "@context": {
                payload: {
                  "@id": "https://example.net/payload",
                  "@type": "@json",
                },
              },
            },
            payload: "https://example.net/payload",
          },
        ],
        payload: {
          "@context": { p: "https://example.net/", q: "p:more/" },
          "q:key": "value",
        },
      }),
    ),
    "unsupported-lossy-shape",
  );
  const definitions = Object.fromEntries(
    Array.from({ length: 100 }, (_, i) => [
      `term${i}`,
      `https://example.net/term${i}`,
    ]),
  );
  const children = Array.from({ length: 500 }, (_, i) => ({
    id: `https://social.example/n/${i}`,
  }));
  for (const extra of [
    {
      "@context": [
        ...contexts,
        definitions,
        {
          Scoped: {
            "@id": "https://example.net/Scoped",
            "@context": { extra: "https://example.net/extra" },
          },
        },
      ],
      type: "Scoped",
      "https://example.net/children": children,
    },
    {
      "@context": [...contexts, definitions],
      "https://example.net/parent": {
        "@context": { "@propagate": false, extra: "https://example.net/extra" },
        "https://example.net/children": children,
      },
    },
  ])
    unsuccessful(
      await parseActorControlMetadata(actor({ ...extra, id: 7 })),
      "resource-limit",
    );
  const cachedUrl = "https://unpreloaded.example/resource-preflight-cache";
  const cachedRaw = actor({
    "@context": cachedUrl,
    claimedInbox: "https://social.example/inbox",
  });
  await jsonld.expand(cachedRaw as Parameters<typeof jsonld.expand>[0], {
    documentLoader: async (requested: string) =>
      requested === cachedUrl
        ? {
            document: {
              "@context": [
                ...contexts,
                {
                  p: oversized,
                  claimedInbox: { "@id": "p:inbox", "@type": "@id" },
                },
              ],
            },
            contextUrl: null,
            documentUrl: cachedUrl,
            tag: "static",
          }
        : await offline(requested),
  });
  let ambientCalled = false;
  await jsonld.expand(cachedRaw as Parameters<typeof jsonld.expand>[0], {
    documentLoader: () => {
      ambientCalled = true;
      return Promise.reject(
        new Error("Cached context should bypass this loader."),
      );
    },
  });
  strictEqual(ambientCalled, false);
  let freshCalls = 0;
  const fresh = success(
    await parseActorControlMetadata(cachedRaw, {
      contextLoader: (requested) => {
        if (requested !== cachedUrl) return offline(requested);
        freshCalls++;
        return Promise.resolve({
          document: {
            "@context": [
              ...contexts,
              {
                claimedInbox: {
                  "@id": "http://www.w3.org/ns/ldp#inbox",
                  "@type": "@id",
                },
              },
            ],
          },
          contextUrl: null,
          documentUrl: cachedUrl,
        });
      },
    }),
  );
  strictEqual(freshCalls, 1);
  strictEqual(fresh.inbox.state, "single");
  strictEqual(fresh.inbox.values[0].value, "https://social.example/inbox");
  // Each pass fits separately; the joint reserve fails before an invalid @id
  // could produce a JSON-LD error in the first expansion.
  const bothPasses = actor({
    "@context": [...contexts, { "@propagate": false }],
    id: 7,
    "https://example.net/nodes": Array.from({ length: 200 }, (_, i) => ({
      id: `https://social.example/n/${i}`,
    })),
  });
  for (const parser of [
    parseDeliverySuspensionDocument,
    parseDeliverySuspensionActivityDocument,
    parseActorControlMetadata,
    parseInboxControlMetadata,
  ])
    unsuccessful<unknown>(await parser(bothPasses), "resource-limit");
  const largeKey = "k".repeat(16000);
  unsuccessful(
    await parseActorControlMetadata(
      actor({
        id: 7,
        "@context": [
          ...contexts,
          { map: { "@id": "https://example.net/map", "@container": "@index" } },
        ],
        map: {
          [largeKey]: Array.from({ length: 100 }, (_, i) => ({
            id: `https://social.example/n/${i}`,
          })),
        },
      }),
    ),
    "resource-limit",
  );
  const collisions = Array.from(
    { length: 8 },
    (_, i) => `\u0000fedify-f799-occurrence-${i}:`,
  ).join("");
  for (const parser of [
    parseDeliverySuspensionDocument,
    parseDeliverySuspensionActivityDocument,
    parseActorControlMetadata,
    parseInboxControlMetadata,
  ])
    unsuccessful<unknown>(
      await parser(
        actor({ "https://example.net/collisions": collisions, inbox: null }),
      ),
      "resource-limit",
    );
});
