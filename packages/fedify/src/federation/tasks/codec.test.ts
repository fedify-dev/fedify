import { mockDocumentLoader, test } from "@fedify/fixture";
import { Create, Link, Note, Person } from "@fedify/vocab";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { deepStrictEqual, ok, rejects, strictEqual } from "node:assert/strict";
import TaskCodec from "./codec.ts";

const loaders = {
  contextLoader: mockDocumentLoader,
  documentLoader: mockDocumentLoader,
};

const codec = new TaskCodec(loaders);

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

test("TaskCodec.serialize() / deserialize()", async (t) => {
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
    const encoded = await codec.serialize(payload);
    strictEqual(typeof encoded, "string");
    const decoded = await codec.deserialize(encoded) as Record<
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
      const encoded = await codec.serialize({ note });
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
    const encoded = await codec.serialize(payload);
    const decoded = await codec.deserialize(encoded);
    deepStrictEqual(decoded, payload);
  });

  await t.step("throws on a malformed wire string", async () => {
    await rejects(async () => await codec.deserialize("garbage"));
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
    const encoded = await codec.serialize(payload);
    const decoded = await codec.deserialize(encoded) as Cyclic;
    strictEqual(decoded.self, decoded);
    ok(decoded.notes[0] instanceof Note);
    strictEqual(decoded.notes[0], decoded.notes[1]);
    strictEqual(decoded.notes[0].content?.toString(), "shared");
  });

  await t.step("preserves a cycle through an array", async () => {
    const list: unknown[] = ["head"];
    list.push(list);
    const encoded = await codec.serialize({ list });
    const decoded = await codec.deserialize(encoded) as {
      list: unknown[];
    };
    strictEqual(decoded.list[0], "head");
    strictEqual(decoded.list[1], decoded.list);
  });

  await t.step("preserves cycles re-entering at a Map and a Set", async () => {
    const set = new Set<unknown>();
    set.add({ set });
    const map = new Map<string, unknown>();
    map.set("entry", { map });
    const encoded = await codec.serialize({ set, map });
    const decoded = await codec.deserialize(encoded) as {
      set: Set<{ set: Set<unknown> }>;
      map: Map<string, { map: Map<string, unknown> }>;
    };
    const [member] = decoded.set;
    strictEqual(member.set, decoded.set);
    strictEqual(decoded.map.get("entry")?.map, decoded.map);
  });

  await t.step(
    "revives a vocab object nested in a null-prototype object",
    async () => {
      const nullProto = Object.create(null) as Record<string, unknown>;
      nullProto.note = note;
      const encoded = await codec.serialize({ wrap: nullProto });
      const decoded = await codec.deserialize(encoded) as {
        wrap: Record<string, unknown>;
      };
      ok(decoded.wrap.note instanceof Note);
      strictEqual(decoded.wrap.note.content?.toString(), "Hello, world!");
    },
  );

  await t.step(
    "revives a payload nested far deeper than any fixed depth cap",
    async () => {
      // `#revive` suspends at an `await` on every level, so nesting depth
      // consumes heap (promise chains) rather than native stack—deep
      // payloads cannot overflow it, and a fixed depth cap would only
      // reject legitimate data.  Pins a depth an order of magnitude above
      // any such cap.
      const depth = 1000;
      let payload: unknown = new Note({ content: "deep" });
      for (let i = 0; i < depth; i++) {
        payload = i % 2 === 0 ? { inner: payload } : [payload];
      }
      const encoded = await codec.serialize(payload);
      let decoded = await codec.deserialize(encoded);
      for (let i = depth - 1; i >= 0; i--) {
        decoded = i % 2 === 0
          ? (decoded as { inner: unknown }).inner
          : (decoded as unknown[])[0];
      }
      ok(decoded instanceof Note);
      strictEqual(decoded.content?.toString(), "deep");
    },
  );
});

test("TaskCodec (one instance reused across decodes)", async (t) => {
  // Each deserialize() call builds its own per-decode `seen` map, so no
  // cycle-tracking state crosses calls and a reused instance decodes every
  // payload independently.
  await t.step("two sequential decodes stay independent", async () => {
    const codec = new TaskCodec(loaders);
    const first = await codec.serialize({
      note: new Note({ content: "A" }),
    });
    const second = await codec.serialize({
      note: new Note({ content: "B" }),
    });
    const a = await codec.deserialize(first) as { note: Note };
    const b = await codec.deserialize(second) as { note: Note };
    ok(a.note instanceof Note);
    ok(b.note instanceof Note);
    strictEqual(a.note.content?.toString(), "A");
    strictEqual(b.note.content?.toString(), "B");
  });
});

test("TaskCodec.validate()", async (t) => {
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
    const payload = { note: new Note({ content: "Hi" }), title: "greeting" };
    const validated = await TaskCodec.validate(schema, payload);
    deepStrictEqual(validated, payload);
  });

  await t.step("rejects a wrong-shaped payload", async () => {
    await rejects(
      () => TaskCodec.validate(schema, { note: "not a Note", title: 42 }),
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
    strictEqual(await TaskCodec.validate(asyncSchema, 42), 42);
    await rejects(() => TaskCodec.validate(asyncSchema, "nope"));
  });

  await t.step(
    "round-trip then validate (same schema on both sides)",
    async () => {
      const payload = { note: new Note({ content: "Hi" }), title: "greeting" };
      const encoded = await codec.serialize(payload);
      const decoded = await codec.deserialize(encoded);
      const validated = await TaskCodec.validate(schema, decoded);
      ok(validated.note instanceof Note);
      strictEqual(validated.title, "greeting");
      strictEqual(validated.note.content?.toString(), "Hi");
    },
  );
});

test("TaskCodec.encode() / decode()", async (t) => {
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

  await t.step(
    "encode() validates then serializes; decode() round-trips",
    async () => {
      const payload = { note: new Note({ content: "Hi" }), title: "greeting" };
      const wire = await codec.encode(schema, payload);
      strictEqual(typeof wire, "string");
      const back = await codec.decode(schema, wire);
      ok(back.note instanceof Note);
      strictEqual(back.note.content?.toString(), "Hi");
      strictEqual(back.title, "greeting");
    },
  );

  await t.step("encode() rejects a wrong-shaped payload", async () => {
    await rejects(
      () => codec.encode(schema, { note: "nope", title: 42 }),
      { name: "TypeError", message: /Task data failed schema validation/ },
    );
  });

  await t.step(
    "decode() re-validates and rejects a drifted payload",
    async () => {
      // Encode under a permissive schema, decode under the strict one.
      const loose = makeSchema((_data): _data is unknown => true);
      const wire = await codec.encode(loose, { note: "not a note" });
      await rejects(
        () => codec.decode(schema, wire),
        { name: "TypeError", message: /Task data failed schema validation/ },
      );
    },
  );

  await t.step(
    "a non-idempotent (transforming) schema fails to round-trip",
    async () => {
      // Validation must be idempotent: the wire carries the validated
      // output, which the same schema re-validates as input at dequeue.
      const transforming: StandardSchemaV1<string, number> = {
        "~standard": {
          version: 1,
          vendor: "fedify-test",
          validate: (value: unknown) =>
            typeof value === "string"
              ? { value: value.length }
              : { issues: [{ message: "Expected a string." }] },
        },
      };
      const wire = await codec.encode(transforming, "hello");
      await rejects(
        () => codec.decode(transforming, wire),
        { name: "TypeError", message: /Task data failed schema validation/ },
      );
    },
  );
});
