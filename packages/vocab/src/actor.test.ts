import { createTestMeterProvider, test } from "@fedify/fixture";
import { configure, type LogRecord, reset } from "@logtape/logtape";
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
  getActorHandleInternal,
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

test("getActorHandle() records activitypub.actor.discovery counter", {
  permissions: { env: true, read: true },
}, async (t) => {
  fetchMock.spyGlobal();
  try {
    const actorId = new URL("https://1.1.1.1/@john");
    const actor = new Person({
      id: actorId,
      preferredUsername: "john",
    });

    await t.step("records result=resolved on a successful lookup", async () => {
      fetchMock.removeRoutes();
      fetchMock.get(
        "begin:https://1.1.1.1/.well-known/webfinger?",
        {
          body: { subject: "acct:johndoe@1.1.1.1" },
          headers: { "Content-Type": "application/jrd+json" },
        },
      );
      const [meterProvider, recorder] = createTestMeterProvider();
      const handle = await getActorHandle(actor, { meterProvider });
      deepStrictEqual(handle, "@johndoe@1.1.1.1");

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
        "1.1.1.1",
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
          "begin:https://1.1.1.1/.well-known/webfinger?",
          { status: 404 },
        );
        const [meterProvider, recorder] = createTestMeterProvider();
        const handle = await getActorHandle(actor, { meterProvider });
        deepStrictEqual(handle, "@john@1.1.1.1");
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
          "begin:https://1.1.1.1/.well-known/webfinger?",
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
          "1.1.1.1",
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
      "records non-default ports for actor IDs",
      async () => {
        fetchMock.removeRoutes();
        fetchMock.get(
          "begin:https://1.1.1.1:8443/.well-known/webfinger?",
          { status: 404 },
        );
        const [meterProvider, recorder] = createTestMeterProvider();
        await rejects(
          () =>
            getActorHandle(new URL("https://1.1.1.1:8443/@john"), {
              meterProvider,
            }),
          TypeError,
        );
        const counter = recorder.getMeasurement("activitypub.actor.discovery");
        ok(counter != null);
        deepStrictEqual(
          counter.attributes["activitypub.remote.host"],
          "1.1.1.1:8443",
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
          "begin:https://1.1.1.1/.well-known/webfinger?",
          {
            body: {
              subject: "https://1.1.1.1/@john",
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
          "begin:https://1.1.1.1/.well-known/webfinger?",
          {
            body: { subject: "acct:johndoe@1.1.1.1" },
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
          "begin:https://1.1.1.1/.well-known/webfinger?",
          {
            body: { subject: "acct:johndoe@1.1.1.1" },
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

test("getActorHandle() shares its deadline with the initial lookup", async () => {
  const actorId = new URL("https://1.1.1.1/@john");
  const actor = new Person({ id: actorId, preferredUsername: "john" });
  let signal: AbortSignal | undefined;
  const result = await getActorHandleInternal(actor, {}, {
    timeoutMs: 50,
    lookupWebFinger: (_resource, options) => {
      signal = options?.signal;
      return new Promise((resolve) => {
        const fallback = setTimeout(() => resolve(null), 200);
        signal?.addEventListener("abort", () => {
          clearTimeout(fallback);
          resolve(null);
        }, { once: true });
      });
    },
  });
  deepStrictEqual(result, "@john@1.1.1.1");
  ok(signal?.aborted);
  ok(signal.reason instanceof DOMException);
  deepStrictEqual(signal.reason.name, "TimeoutError");
});

test("getActorHandle() deduplicates and caps alias checks", async () => {
  const actorId = new URL("https://1.1.1.1/@john");
  const actor = new Person({ id: actorId, preferredUsername: "john" });
  let checks = 0;
  const duplicate = "acct:john@8.8.8.8";
  const lookupWebFinger = (resource: URL | string) => {
    if (resource instanceof URL) {
      return Promise.resolve({
        subject: actorId.href,
        aliases: [duplicate, duplicate, "acct:jane@1.1.1.1"],
      });
    }
    checks++;
    return Promise.resolve(null);
  };
  deepStrictEqual(
    await getActorHandleInternal(actor, {}, { lookupWebFinger }),
    "@jane@1.1.1.1",
  );
  deepStrictEqual(checks, 1);

  checks = 0;
  deepStrictEqual(
    await getActorHandleInternal(actor, {}, {
      lookupWebFinger: (resource) => {
        if (resource instanceof URL) {
          return Promise.resolve({
            subject: actorId.href,
            aliases: [
              ...Array.from({ length: 100 }, (_, i) => `acct:${i}@8.8.8.8`),
              "acct:jane@1.1.1.1",
            ],
          });
        }
        checks++;
        return Promise.resolve(null);
      },
    }),
    "@john@1.1.1.1",
  );
  deepStrictEqual(checks, 99);
});

test("getActorHandle() enforces its deadline between alias checks", async () => {
  const actorId = new URL("https://1.1.1.1/@john");
  const actor = new Person({ id: actorId, preferredUsername: "john" });
  const records: LogRecord[] = [];
  await configure({
    sinks: { buffer: (record) => records.push(record) },
    loggers: [
      { category: "fedify", sinks: ["buffer"], lowestLevel: "warning" },
      { category: ["logtape", "meta"], sinks: [] },
    ],
    reset: true,
  });
  let now = 0;
  let checks = 0;
  let signal: AbortSignal | undefined;
  try {
    deepStrictEqual(
      await getActorHandleInternal(actor, {}, {
        timeoutMs: 50,
        now: () => now,
        lookupWebFinger: (resource, options) => {
          signal = options?.signal;
          if (resource instanceof URL) {
            return Promise.resolve({
              subject: actorId.href,
              aliases: ["acct:one@8.8.8.8", "acct:two@8.8.8.8"],
            });
          }
          checks++;
          now = 51;
          return Promise.resolve(null);
        },
      }),
      "@john@1.1.1.1",
    );
    deepStrictEqual(checks, 1);
    ok(signal?.aborted);
    deepStrictEqual((signal.reason as DOMException).name, "TimeoutError");
    deepStrictEqual(
      records.map((record) => [
        record.level,
        record.rawMessage,
        record.properties.actorId,
      ]),
      [[
        "warning",
        "Actor handle lookup timed out for {actorId} after {timeoutMs} ms.",
        actorId.href,
      ]],
    );
  } finally {
    await reset();
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
