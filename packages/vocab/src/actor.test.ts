import { test } from "@fedify/fixture";
import * as fc from "fast-check";
import fetchMock from "fetch-mock";
import {
  deepStrictEqual,
  ok,
  rejects,
  strictEqual,
  throws,
} from "node:assert/strict";
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
  fc.assert(fc.property(actor(), (actor) => ok(isActor(actor))));
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
      (nonActor) => ok(!isActor(nonActor)),
    ),
  );
});

test("getActorTypeName()", () => {
  fc.assert(
    fc.property(
      actorClassAndInstance(),
      ([cls, instance]) =>
        deepStrictEqual(getActorTypeName(instance), cls.name),
    ),
  );
});

test("getActorClassByTypeName()", () => {
  fc.assert(
    fc.property(
      actorClassAndInstance(),
      ([cls, instance]) =>
        strictEqual(
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

    // Node validates addresses before fetch; public IP literals avoid DNS.
    fetchMock.get(
      "begin:https://1.1.1.1/.well-known/webfinger?",
      {
        body: { subject: "acct:johndoe@1.1.1.1" },
        headers: { "Content-Type": "application/jrd+json" },
      },
    );

    const actorId = new URL("https://1.1.1.1/@john");
    const actor = new Person({
      id: actorId,
      preferredUsername: "john",
    });

    await t.step("WebFinger subject", async () => {
      deepStrictEqual(await getActorHandle(actor), "@johndoe@1.1.1.1");
      deepStrictEqual(
        await getActorHandle(actor, { trimLeadingAt: true }),
        "johndoe@1.1.1.1",
      );
      deepStrictEqual(
        await getActorHandle(actorId),
        "@johndoe@1.1.1.1",
      );
      deepStrictEqual(
        await getActorHandle(actorId, { trimLeadingAt: true }),
        "johndoe@1.1.1.1",
      );
    });

    fetchMock.removeRoutes();
    fetchMock.get(
      "begin:https://1.1.1.1/.well-known/webfinger?",
      {
        body: {
          subject: "https://1.1.1.1/@john",
          aliases: [
            "acct:john@8.8.8.8",
            "acct:johndoe@1.1.1.1",
          ],
        },
        headers: { "Content-Type": "application/jrd+json" },
      },
    );

    await t.step("WebFinger aliases", async () => {
      deepStrictEqual(await getActorHandle(actor), "@johndoe@1.1.1.1");
      deepStrictEqual(
        await getActorHandle(actor, { trimLeadingAt: true }),
        "johndoe@1.1.1.1",
      );
      deepStrictEqual(
        await getActorHandle(actorId),
        "@johndoe@1.1.1.1",
      );
      deepStrictEqual(
        await getActorHandle(actorId, { trimLeadingAt: true }),
        "johndoe@1.1.1.1",
      );
    });

    fetchMock.get(
      "begin:https://8.8.8.8/.well-known/webfinger?",
      {
        body: {
          subject: "acct:john@8.8.8.8",
          aliases: [
            "https://1.1.1.1/@john",
          ],
        },
        headers: { "Content-Type": "application/jrd+json" },
      },
    );

    await t.step("cross-origin WebFinger resources", async () => {
      deepStrictEqual(await getActorHandle(actor), "@john@8.8.8.8");
    });

    fetchMock.removeRoutes();
    fetchMock.get(
      "begin:https://1.1.1.1/.well-known/webfinger?",
      { status: 404 },
    );

    await t.step("no WebFinger", async () => {
      deepStrictEqual(await getActorHandle(actor), "@john@1.1.1.1");
      await rejects(() => getActorHandle(actorId), TypeError);
    });

    fetchMock.hardReset();
  },
});

test("normalizeActorHandle()", () => {
  deepStrictEqual(normalizeActorHandle("@foo@BAR.COM"), "@foo@bar.com");
  deepStrictEqual(normalizeActorHandle("@BAZ@☃-⌘.com"), "@BAZ@☃-⌘.com");
  deepStrictEqual(
    normalizeActorHandle("@qux@xn--maana-pta.com"),
    "@qux@mañana.com",
  );
  deepStrictEqual(
    normalizeActorHandle("@quux@XN--MAANA-PTA.COM"),
    "@quux@mañana.com",
  );
  deepStrictEqual(
    normalizeActorHandle("@quux@MAÑANA.COM"),
    "@quux@mañana.com",
  );

  deepStrictEqual(
    normalizeActorHandle("@foo@BAR.COM", { trimLeadingAt: true }),
    "foo@bar.com",
  );
  deepStrictEqual(
    normalizeActorHandle("@BAZ@☃-⌘.com", { trimLeadingAt: true }),
    "BAZ@☃-⌘.com",
  );
  deepStrictEqual(
    normalizeActorHandle("@qux@xn--maana-pta.com", { trimLeadingAt: true }),
    "qux@mañana.com",
  );
  deepStrictEqual(
    normalizeActorHandle("@quux@XN--MAANA-PTA.COM", { trimLeadingAt: true }),
    "quux@mañana.com",
  );
  deepStrictEqual(
    normalizeActorHandle("@quux@MAÑANA.COM", { trimLeadingAt: true }),
    "quux@mañana.com",
  );

  deepStrictEqual(
    normalizeActorHandle("@foo@BAR.COM", { punycode: true }),
    "@foo@bar.com",
  );
  deepStrictEqual(
    normalizeActorHandle("@BAZ@☃-⌘.com", { punycode: true }),
    "@BAZ@xn----dqo34k.com",
  );
  deepStrictEqual(
    normalizeActorHandle("@qux@xn--maana-pta.com", { punycode: true }),
    "@qux@xn--maana-pta.com",
  );
  deepStrictEqual(
    normalizeActorHandle("@quux@XN--MAANA-PTA.COM", { punycode: true }),
    "@quux@xn--maana-pta.com",
  );
  deepStrictEqual(
    normalizeActorHandle("@quux@MAÑANA.COM", { punycode: true }),
    "@quux@xn--maana-pta.com",
  );

  throws(() => normalizeActorHandle(""));
  throws(() => normalizeActorHandle("@"));
  throws(() => normalizeActorHandle("foo"));
  throws(() => normalizeActorHandle("@foo"));
  throws(() => normalizeActorHandle("@@foo.com"));
  throws(() => normalizeActorHandle("@foo@"));
  throws(() => normalizeActorHandle("foo@bar.com@baz.com"));
  throws(() => normalizeActorHandle("@foo@bar.com@baz.com"));
});

// cSpell: ignore maana
