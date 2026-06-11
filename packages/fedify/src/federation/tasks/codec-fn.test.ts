import { mockDocumentLoader, test } from "@fedify/fixture";
import { Create, Link, Note, Person } from "@fedify/vocab";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { deepStrictEqual, ok, rejects, strictEqual } from "node:assert/strict";
import {
  deserializeTaskData,
  serializeTaskData,
  validateTaskData,
} from "./codec-fn.ts";

const loaders = {
  contextLoader: mockDocumentLoader,
  documentLoader: mockDocumentLoader,
};

function makeSchema<T>(
  check: (data: unknown) => data is T,
): StandardSchemaV1<unknown, T> {
  return {
    "~standard": {
      version: 1,
      vendor: "fedify-test",
      validate(value: unknown) {
        return check(value)
          ? { value }
          : { issues: [{ message: "Invalid task data." }] };
      },
    },
  };
}

test("serializeTaskData() / deserializeTaskData()", async (t) => {
  const note = new Note({
    id: new URL("https://example.com/notes/1"),
    content: "Hello, world!",
  });
  const person = new Person({
    id: new URL("https://example.com/users/alice"),
    name: "Alice",
  });
  const link = new Link({
    href: new URL("https://example.com/"),
    mediaType: "text/html",
  });
  const create = new Create({
    id: new URL("https://example.com/activities/1"),
    actor: new URL("https://example.com/users/alice"),
    object: note,
  });

  await t.step("round-trips a mixed payload", async () => {
    const payload = {
      note,
      when: new Date("2026-01-02T03:04:05Z"),
      big: 1234567890123456789n,
      url: new URL("https://example.com/some/path"),
      list: [person, link],
      map: new Map<string, unknown>([["create", create], ["n", 42]]),
      set: new Set([1, 2, 3]),
      nested: { create },
    };
    const encoded = await serializeTaskData(payload, mockDocumentLoader);
    strictEqual(typeof encoded, "string");
    const decoded = await deserializeTaskData(encoded, loaders) as Record<
      string,
      unknown
    >;
    ok(decoded.note instanceof Note);
    strictEqual(decoded.note.content?.toString(), "Hello, world!");
    strictEqual(decoded.note.id?.href, "https://example.com/notes/1");
    ok(decoded.when instanceof Date);
    strictEqual(decoded.when.toISOString(), "2026-01-02T03:04:05.000Z");
    strictEqual(decoded.big, 1234567890123456789n);
    ok(decoded.url instanceof URL);
    strictEqual(decoded.url.href, "https://example.com/some/path");
    const list = decoded.list as unknown[];
    ok(list[0] instanceof Person);
    strictEqual(list[0].name?.toString(), "Alice");
    ok(list[1] instanceof Link);
    strictEqual(list[1].href?.href, "https://example.com/");
    const map = decoded.map as Map<string, unknown>;
    ok(map.get("create") instanceof Create);
    strictEqual(map.get("n"), 42);
    deepStrictEqual(decoded.set, new Set([1, 2, 3]));
    const nested = decoded.nested as Record<string, unknown>;
    ok(nested.create instanceof Create);
    const nestedObject = await nested.create.getObject({
      documentLoader: mockDocumentLoader,
      contextLoader: mockDocumentLoader,
    });
    ok(nestedObject instanceof Note);
    strictEqual(nestedObject.content?.toString(), "Hello, world!");
  });

  await t.step(
    "encodes vocab objects in expand form (no @context)",
    async () => {
      const encoded = await serializeTaskData({ note }, mockDocumentLoader);
      ok(!encoded.includes("@context"));
    },
  );

  await t.step("leaves a non-vocab payload untouched", async () => {
    const payload = {
      text: "plain",
      n: 1,
      flag: true,
      nothing: null,
      when: new Date("2026-06-10T00:00:00Z"),
      list: [1, "two", 3n],
    };
    const encoded = await serializeTaskData(payload, mockDocumentLoader);
    const decoded = await deserializeTaskData(encoded, loaders);
    deepStrictEqual(decoded, payload);
  });

  await t.step("throws on a malformed wire string", async () => {
    // deserializeTaskData() throws synchronously on a malformed wire string
    // (devalue's parse() runs before the first await); the async wrapper
    // funnels both sync throws and rejections into one assertion.
    await rejects(async () => await deserializeTaskData("garbage", loaders));
  });

  await t.step("preserves circular and repeated references", async () => {
    const shared = new Note({ content: "shared" });
    interface Cyclic {
      name: string;
      self?: Cyclic;
      notes: Note[];
    }
    const payload: Cyclic = { name: "root", notes: [shared, shared] };
    payload.self = payload;
    const encoded = await serializeTaskData(payload, mockDocumentLoader);
    const decoded = await deserializeTaskData(encoded, loaders) as Cyclic;
    strictEqual(decoded.self, decoded);
    ok(decoded.notes[0] instanceof Note);
    strictEqual(decoded.notes[0], decoded.notes[1]);
    strictEqual(decoded.notes[0].content?.toString(), "shared");
  });

  await t.step("preserves a cycle through an array", async () => {
    const list: unknown[] = ["head"];
    list.push(list);
    const encoded = await serializeTaskData({ list }, mockDocumentLoader);
    const decoded = await deserializeTaskData(encoded, loaders) as {
      list: unknown[];
    };
    strictEqual(decoded.list[0], "head");
    strictEqual(decoded.list[1], decoded.list);
  });

  await t.step("preserves cycles re-entering at a Map and a Set", async () => {
    // The cycle must re-enter at the Map/Set *itself* (not at a plain
    // object) to exercise their pre-registration in the reviver.
    const set = new Set<unknown>();
    set.add({ set });
    const map = new Map<string, unknown>();
    map.set("entry", { map });
    const encoded = await serializeTaskData({ set, map }, mockDocumentLoader);
    const decoded = await deserializeTaskData(encoded, loaders) as {
      set: Set<{ set: Set<unknown> }>;
      map: Map<string, { map: Map<string, unknown> }>;
    };
    const [member] = decoded.set;
    strictEqual(member.set, decoded.set);
    strictEqual(decoded.map.get("entry")?.map, decoded.map);
  });
});

test("validateTaskData()", async (t) => {
  interface Envelope {
    note: Note;
    title: string;
  }
  const schema = makeSchema(
    (data): data is Envelope =>
      typeof data === "object" && data != null &&
      (data as Envelope).note instanceof Note &&
      typeof (data as Envelope).title === "string",
  );

  await t.step("accepts a payload with a vocab instanceof leaf", async () => {
    const payload = {
      note: new Note({ content: "Hi" }),
      title: "greeting",
    };
    const validated = await validateTaskData(schema, payload);
    deepStrictEqual(validated, payload);
  });

  await t.step("rejects a wrong-shaped payload", async () => {
    await rejects(
      () => validateTaskData(schema, { note: "not a Note", title: 42 }),
      { name: "TypeError", message: /Task data failed schema validation/ },
    );
  });

  await t.step("supports async validation", async () => {
    const asyncSchema: StandardSchemaV1<unknown, number> = {
      "~standard": {
        version: 1,
        vendor: "fedify-test",
        validate: (value: unknown) =>
          Promise.resolve(
            typeof value === "number"
              ? { value }
              : { issues: [{ message: "not a number" }] },
          ),
      },
    };
    strictEqual(await validateTaskData(asyncSchema, 42), 42);
    await rejects(() => validateTaskData(asyncSchema, "nope"));
  });

  await t.step(
    "round-trip then validate (same schema on both sides)",
    async () => {
      const payload = {
        note: new Note({ content: "Hi" }),
        title: "greeting",
      };
      const encoded = await serializeTaskData(payload, mockDocumentLoader);
      const decoded = await deserializeTaskData(encoded, loaders);
      const validated = await validateTaskData(schema, decoded);
      ok(validated.note instanceof Note);
      strictEqual(validated.title, "greeting");
      strictEqual(validated.note.content?.toString(), "Hi");
    },
  );
});
