import { createTestMeterProvider, test } from "@fedify/fixture";
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
      deepStrictEqual(await getActorHandle(actor), "@johndoe@foo.example.com");
      deepStrictEqual(
        await getActorHandle(actor, { trimLeadingAt: true }),
        "johndoe@foo.example.com",
      );
      deepStrictEqual(
        await getActorHandle(actorId),
        "@johndoe@foo.example.com",
      );
      deepStrictEqual(
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
      deepStrictEqual(await getActorHandle(actor), "@johndoe@foo.example.com");
      deepStrictEqual(
        await getActorHandle(actor, { trimLeadingAt: true }),
        "johndoe@foo.example.com",
      );
      deepStrictEqual(
        await getActorHandle(actorId),
        "@johndoe@foo.example.com",
      );
      deepStrictEqual(
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
      deepStrictEqual(await getActorHandle(actor), "@john@bar.example.com");
    });

    fetchMock.removeRoutes();
    fetchMock.get(
      "begin:https://foo.example.com/.well-known/webfinger?",
      { status: 404 },
    );

    await t.step("no WebFinger", async () => {
      deepStrictEqual(await getActorHandle(actor), "@john@foo.example.com");
      rejects(() => getActorHandle(actorId), TypeError);
    });

    fetchMock.hardReset();
  },
});

test("getActorHandle() records activitypub.actor.discovery counter", {
  permissions: { env: true, read: true },
}, async (t) => {
  fetchMock.spyGlobal();
  try {
    const actorId = new URL("https://foo.example.com/@john");
    const actor = new Person({
      id: actorId,
      preferredUsername: "john",
    });

    await t.step("records result=resolved on a successful lookup", async () => {
      fetchMock.removeRoutes();
      fetchMock.get(
        "begin:https://foo.example.com/.well-known/webfinger?",
        {
          body: { subject: "acct:johndoe@foo.example.com" },
          headers: { "Content-Type": "application/jrd+json" },
        },
      );
      const [meterProvider, recorder] = createTestMeterProvider();
      const handle = await getActorHandle(actor, { meterProvider });
      deepStrictEqual(handle, "@johndoe@foo.example.com");

      const counters = recorder.getMeasurements(
        "activitypub.actor.discovery",
      );
      deepStrictEqual(counters.length, 1);
      deepStrictEqual(counters[0].type, "counter");
      deepStrictEqual(counters[0].value, 1);
      deepStrictEqual(
        counters[0].attributes["activitypub.actor.discovery.result"],
        "resolved",
      );
      deepStrictEqual(
        counters[0].attributes["activitypub.remote.host"],
        "foo.example.com",
      );

      const durations = recorder.getMeasurements(
        "activitypub.actor.discovery.duration",
      );
      deepStrictEqual(durations.length, 1);
      deepStrictEqual(durations[0].type, "histogram");
      deepStrictEqual(
        durations[0].attributes["activitypub.actor.discovery.result"],
        "resolved",
      );
      ok(typeof durations[0].value === "number" && durations[0].value >= 0);
    });

    await t.step(
      "records result=resolved when WebFinger is missing but preferredUsername fallback succeeds",
      async () => {
        fetchMock.removeRoutes();
        fetchMock.get(
          "begin:https://foo.example.com/.well-known/webfinger?",
          { status: 404 },
        );
        const [meterProvider, recorder] = createTestMeterProvider();
        const handle = await getActorHandle(actor, { meterProvider });
        deepStrictEqual(handle, "@john@foo.example.com");
        const counter = recorder.getMeasurement("activitypub.actor.discovery");
        ok(counter != null);
        deepStrictEqual(
          counter.attributes["activitypub.actor.discovery.result"],
          "resolved",
        );
      },
    );

    await t.step(
      "records result=not_found when neither WebFinger nor preferredUsername yields a handle",
      async () => {
        fetchMock.removeRoutes();
        fetchMock.get(
          "begin:https://foo.example.com/.well-known/webfinger?",
          { status: 404 },
        );
        const [meterProvider, recorder] = createTestMeterProvider();
        await rejects(
          () => getActorHandle(actorId, { meterProvider }),
          TypeError,
        );
        const counter = recorder.getMeasurement("activitypub.actor.discovery");
        ok(counter != null);
        deepStrictEqual(
          counter.attributes["activitypub.actor.discovery.result"],
          "not_found",
        );
        deepStrictEqual(
          counter.attributes["activitypub.remote.host"],
          "foo.example.com",
        );
        const duration = recorder.getMeasurement(
          "activitypub.actor.discovery.duration",
        );
        ok(duration != null);
        deepStrictEqual(
          duration.attributes["activitypub.actor.discovery.result"],
          "not_found",
        );
      },
    );

    await t.step(
      "records result=error when a malformed WebFinger alias throws TypeError",
      async () => {
        // The "[" byte makes `new URL("https://[/")` throw `TypeError`
        // when getActorHandleInternal attempts to parse the alias host.
        // This TypeError is a malformed-remote-data failure, not the
        // "actor lacks information" sentinel, so the metric must record
        // `error` rather than `not_found`.
        fetchMock.removeRoutes();
        fetchMock.get(
          "begin:https://foo.example.com/.well-known/webfinger?",
          {
            body: {
              subject: "https://foo.example.com/@john",
              aliases: ["acct:john@["],
            },
            headers: { "Content-Type": "application/jrd+json" },
          },
        );
        const [meterProvider, recorder] = createTestMeterProvider();
        await rejects(
          () => getActorHandle(actorId, { meterProvider }),
          TypeError,
        );
        const counter = recorder.getMeasurement(
          "activitypub.actor.discovery",
        );
        ok(counter != null);
        deepStrictEqual(
          counter.attributes["activitypub.actor.discovery.result"],
          "error",
        );
      },
    );

    await t.step(
      "propagates meterProvider into the nested webfinger.lookup",
      async () => {
        fetchMock.removeRoutes();
        fetchMock.get(
          "begin:https://foo.example.com/.well-known/webfinger?",
          {
            body: { subject: "acct:johndoe@foo.example.com" },
            headers: { "Content-Type": "application/jrd+json" },
          },
        );
        const [meterProvider, recorder] = createTestMeterProvider();
        await getActorHandle(actor, { meterProvider });
        const webFingerCounter = recorder.getMeasurement("webfinger.lookup");
        ok(webFingerCounter != null);
        deepStrictEqual(
          webFingerCounter.attributes["webfinger.lookup.result"],
          "found",
        );
      },
    );

    await t.step(
      "omits measurements when no meterProvider is provided",
      async () => {
        fetchMock.removeRoutes();
        fetchMock.get(
          "begin:https://foo.example.com/.well-known/webfinger?",
          {
            body: { subject: "acct:johndoe@foo.example.com" },
            headers: { "Content-Type": "application/jrd+json" },
          },
        );
        const [_unused, recorder] = createTestMeterProvider();
        await getActorHandle(actor);
        deepStrictEqual(
          recorder.getMeasurements("activitypub.actor.discovery").length,
          0,
        );
        deepStrictEqual(
          recorder.getMeasurements("activitypub.actor.discovery.duration")
            .length,
          0,
        );
        deepStrictEqual(
          recorder.getMeasurements("webfinger.lookup").length,
          0,
        );
      },
    );
  } finally {
    fetchMock.removeRoutes();
    fetchMock.hardReset();
  }
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
