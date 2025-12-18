import { test } from "@fedify/fixture";
import {
  assert,
  assertEquals,
  assertFalse,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "@std/assert";
import * as fc from "fast-check";
import fetchMock from "fetch-mock";
import {
  type Actor,
  getActorClassByTypeName,
  getActorHandle,
  getActorTypeName,
  isActor,
  normalizeActorHandle,
} from "./actor.ts";
import { Application, Group, Organization, Person, Service } from "./vocab.ts";

function actorClass(): fc.Arbitrary<
  | typeof Application
  | typeof Group
  | typeof Organization
  | typeof Person
  | typeof Service
> {
  return fc.constantFrom(Application, Group, Organization, Person, Service);
}

function actorClassAndInstance(): fc.Arbitrary<
  | [typeof Application, Application]
  | [typeof Group, Group]
  | [typeof Organization, Organization]
  | [typeof Person, Person]
  | [typeof Service, Service]
> {
  return actorClass().map((cls) =>
    [cls, new cls({})] as (
      | [typeof Application, Application]
      | [typeof Group, Group]
      | [typeof Organization, Organization]
      | [typeof Person, Person]
      | [typeof Service, Service]
    )
  );
}

function actor(): fc.Arbitrary<Actor> {
  return actorClassAndInstance().map(([, instance]) => instance);
}

test("isActor()", () => {
  fc.assert(fc.property(actor(), (actor) => assert(isActor(actor))));
  fc.assert(
    fc.property(
      fc.anything({
        withBigInt: true,
        withBoxedValues: true,
        withDate: true,
        withMap: true,
        withNullPrototype: true,
        withObjectString: true,
        withSet: true,
        withTypedArray: true,
        withSparseArray: true,
      }),
      (nonActor) => assertFalse(isActor(nonActor)),
    ),
  );
});

test("getActorTypeName()", () => {
  fc.assert(
    fc.property(
      actorClassAndInstance(),
      ([cls, instance]) => assertEquals(getActorTypeName(instance), cls.name),
    ),
  );
});

test("getActorClassByTypeName()", () => {
  fc.assert(
    fc.property(
      actorClassAndInstance(),
      ([cls, instance]) =>
        assertStrictEquals(
          getActorClassByTypeName(getActorTypeName(instance)),
          cls,
        ),
    ),
  );
});

test({
  name: "getActorHandle()",
  permissions: { env: true, read: true },
  async fn(t) {
    fetchMock.spyGlobal();

    fetchMock.get(
      "begin:https://foo.example.com/.well-known/webfinger?",
      {
        body: { subject: "acct:johndoe@foo.example.com" },
        headers: { "Content-Type": "application/jrd+json" },
      },
    );

    const actorId = new URL("https://foo.example.com/@john");
    const actor = new Person({
      id: actorId,
      preferredUsername: "john",
    });

    await t.step("WebFinger subject", async () => {
      assertEquals(await getActorHandle(actor), "@johndoe@foo.example.com");
      assertEquals(
        await getActorHandle(actor, { trimLeadingAt: true }),
        "johndoe@foo.example.com",
      );
      assertEquals(await getActorHandle(actorId), "@johndoe@foo.example.com");
      assertEquals(
        await getActorHandle(actorId, { trimLeadingAt: true }),
        "johndoe@foo.example.com",
      );
    });

    fetchMock.removeRoutes();
    fetchMock.get(
      "begin:https://foo.example.com/.well-known/webfinger?",
      {
        body: {
          subject: "https://foo.example.com/@john",
          aliases: [
            "acct:john@bar.example.com",
            "acct:johndoe@foo.example.com",
          ],
        },
        headers: { "Content-Type": "application/jrd+json" },
      },
    );

    await t.step("WebFinger aliases", async () => {
      assertEquals(await getActorHandle(actor), "@johndoe@foo.example.com");
      assertEquals(
        await getActorHandle(actor, { trimLeadingAt: true }),
        "johndoe@foo.example.com",
      );
      assertEquals(await getActorHandle(actorId), "@johndoe@foo.example.com");
      assertEquals(
        await getActorHandle(actorId, { trimLeadingAt: true }),
        "johndoe@foo.example.com",
      );
    });

    fetchMock.get(
      "begin:https://bar.example.com/.well-known/webfinger?",
      {
        body: {
          subject: "acct:john@bar.example.com",
          aliases: [
            "https://foo.example.com/@john",
          ],
        },
        headers: { "Content-Type": "application/jrd+json" },
      },
    );

    await t.step("cross-origin WebFinger resources", async () => {
      assertEquals(await getActorHandle(actor), "@john@bar.example.com");
    });

    fetchMock.removeRoutes();
    fetchMock.get(
      "begin:https://foo.example.com/.well-known/webfinger?",
      { status: 404 },
    );

    await t.step("no WebFinger", async () => {
      assertEquals(await getActorHandle(actor), "@john@foo.example.com");
      assertRejects(() => getActorHandle(actorId), TypeError);
    });

    fetchMock.hardReset();
  },
});

test("normalizeActorHandle()", () => {
  assertEquals(normalizeActorHandle("@foo@BAR.COM"), "@foo@bar.com");
  assertEquals(normalizeActorHandle("@BAZ@☃-⌘.com"), "@BAZ@☃-⌘.com");
  assertEquals(
    normalizeActorHandle("@qux@xn--maana-pta.com"),
    "@qux@mañana.com",
  );
  assertEquals(
    normalizeActorHandle("@quux@XN--MAANA-PTA.COM"),
    "@quux@mañana.com",
  );
  assertEquals(
    normalizeActorHandle("@quux@MAÑANA.COM"),
    "@quux@mañana.com",
  );

  assertEquals(
    normalizeActorHandle("@foo@BAR.COM", { trimLeadingAt: true }),
    "foo@bar.com",
  );
  assertEquals(
    normalizeActorHandle("@BAZ@☃-⌘.com", { trimLeadingAt: true }),
    "BAZ@☃-⌘.com",
  );
  assertEquals(
    normalizeActorHandle("@qux@xn--maana-pta.com", { trimLeadingAt: true }),
    "qux@mañana.com",
  );
  assertEquals(
    normalizeActorHandle("@quux@XN--MAANA-PTA.COM", { trimLeadingAt: true }),
    "quux@mañana.com",
  );
  assertEquals(
    normalizeActorHandle("@quux@MAÑANA.COM", { trimLeadingAt: true }),
    "quux@mañana.com",
  );

  assertEquals(
    normalizeActorHandle("@foo@BAR.COM", { punycode: true }),
    "@foo@bar.com",
  );
  assertEquals(
    normalizeActorHandle("@BAZ@☃-⌘.com", { punycode: true }),
    "@BAZ@xn----dqo34k.com",
  );
  assertEquals(
    normalizeActorHandle("@qux@xn--maana-pta.com", { punycode: true }),
    "@qux@xn--maana-pta.com",
  );
  assertEquals(
    normalizeActorHandle("@quux@XN--MAANA-PTA.COM", { punycode: true }),
    "@quux@xn--maana-pta.com",
  );
  assertEquals(
    normalizeActorHandle("@quux@MAÑANA.COM", { punycode: true }),
    "@quux@xn--maana-pta.com",
  );

  assertThrows(() => normalizeActorHandle(""));
  assertThrows(() => normalizeActorHandle("@"));
  assertThrows(() => normalizeActorHandle("foo"));
  assertThrows(() => normalizeActorHandle("@foo"));
  assertThrows(() => normalizeActorHandle("@@foo.com"));
  assertThrows(() => normalizeActorHandle("@foo@"));
  assertThrows(() => normalizeActorHandle("foo@bar.com@baz.com"));
  assertThrows(() => normalizeActorHandle("@foo@bar.com@baz.com"));
});

// cSpell: ignore maana
