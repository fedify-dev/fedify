import {
  createTestMeterProvider,
  createTestTracerProvider,
  mockDocumentLoader,
  test,
} from "@fedify/fixture";
import { Create, Person } from "@fedify/vocab";
import { FetchError, UrlError } from "@fedify/vocab-runtime";
import { configure, reset } from "@logtape/logtape";
import {
  isSpanContextValid,
  SpanKind,
  SpanStatusCode,
  trace,
  TraceFlags,
} from "@opentelemetry/api";
import fetchMock from "fetch-mock";
import {
  deepStrictEqual,
  notStrictEqual,
  ok,
  rejects,
  strictEqual,
  throws,
} from "node:assert/strict";
import { createFederationBuilder, FederationBuilderImpl } from "./builder.ts";
import { MemoryKvStore } from "./kv.ts";
import {
  ContextImpl,
  createFederation,
  FederationImpl,
  OutboxContextImpl,
} from "./middleware.ts";
import type {
  Federation,
  Message,
  MessageQueue,
  OutboundAttemptReport,
  OutboundBroadcastEvent,
  OutboundDeliveryEvent,
  OutboundHttpExchangeReport,
  OutboundObservers,
  OutboundWorkerReport,
} from "./mod.ts";
import type { FanoutMessage, OutboxMessage } from "./queue.ts";
import {
  sendActivity as sendConcreteActivity,
  SendActivityError,
} from "./send.ts";
import { OutboundBroadcastObservation } from "./outbound-observation.ts";
import { snapshotHeaderPolicy, snapshotHeaders } from "./outbound-headers.ts";
import { rsaPrivateKey2, rsaPublicKey2 } from "../testing/keys.ts";

const activity = new Create({
  id: new URL("https://example.com/create"),
  actor: new URL("https://example.com/alice"),
});
const sender = { keyId: rsaPublicKey2.id!, privateKey: rsaPrivateKey2 };
const options = {
  kv: new MemoryKvStore(),
  documentLoaderFactory: () => mockDocumentLoader,
  contextLoaderFactory: () => mockDocumentLoader,
};

test("outbound observation timestamps snapshot each boundary and refresh on fanout replay", async () => {
  const federation = createFederation<void>(options);
  const ctx = federation.createContext(
    new URL("https://example.com"),
    undefined,
  );
  const events: (OutboundBroadcastEvent | OutboundDeliveryEvent)[] = [];
  const timestamps: number[] = [];
  let now = 1_800_000_000_000;
  const originalNow = Temporal.Now.instant;
  const observe = async (
    _context: unknown,
    event: OutboundBroadcastEvent | OutboundDeliveryEvent,
  ) => {
    const observedAt = now;
    strictEqual(event.observedAt, observedAt);
    ok(Object.isFrozen(event));
    ok(Object.isFrozen(event.provenance));
    ok(Object.isFrozen(event.local));
    events.push(event);
    timestamps.push(observedAt);
    // Time spent awaiting a recorder must not change this event's snapshot.
    now += 1_000;
    await Promise.resolve();
    strictEqual(event.observedAt, observedAt);
  };
  const observers = { onBroadcast: observe, onDelivery: observe };
  const inbox = "https://receiver.example/inbox";
  const otherInbox = "https://receiver.example/other";
  try {
    Temporal.Now.instant = () => Temporal.Instant.fromEpochMilliseconds(now);
    const observation = new OutboundBroadcastObservation(
      ctx,
      observers,
      "send",
    );
    await observation.run(async () => {
      await observation.planDestinations({
        [inbox]: { actorIds: [], sharedInbox: false },
        [otherInbox]: { actorIds: [], sharedInbox: false },
      });
      await observation.delivery(inbox)!.handoff({ type: "direct" });
      await observation.delivery(otherInbox)!.failed(new Error("local setup"));
      await observation.prepared("delivery");
    });
    deepStrictEqual(events.map((event) => event.stage), [
      "started",
      "planned",
      "planned",
      "handoff",
      "preparation-failed",
      "preparation-finished",
    ]);
    deepStrictEqual(timestamps, [
      1_800_000_000_000,
      1_800_000_001_000,
      1_800_000_002_000,
      1_800_000_003_000,
      1_800_000_004_000,
      1_800_000_005_000,
    ]);
    const identity = observation.continuation(inbox)!.outbound;
    strictEqual("observedAt" in identity, false);
    const message: FanoutMessage = JSON.parse(JSON.stringify({
      type: "fanout",
      id: crypto.randomUUID(),
      baseUrl: "https://example.com/",
      keys: [],
      inboxes: {
        [inbox]: { actorIds: [], sharedInbox: false, outbound: identity },
      },
      activity: {},
      activityType: Create.typeId.href,
      traceContext: {},
    }));
    // Replaying the same task preserves grouping, but observes a new instant.
    for (let replay = 0; replay < 2; replay++) {
      now += 60_000;
      const resumed = await OutboundBroadcastObservation.resumeFanout(
        ctx,
        observers,
        message,
      );
      ok(resumed);
      await resumed.delivery(inbox)!.handoff({
        type: "enqueued",
        queue: "outbox",
        queueMessageId: crypto.randomUUID(),
      });
      const event = events.at(-1)!;
      ok("deliveryId" in event);
      strictEqual(event.deliveryId, identity.deliveryId);
      strictEqual(event.provenance, events[0].provenance);
      deepStrictEqual(event.local, events[0].local);
    }
    deepStrictEqual(timestamps.slice(6), [
      1_800_000_066_000,
      1_800_000_127_000,
    ]);
    deepStrictEqual(events.map((event) => event.observedAt), timestamps);
    strictEqual("observedAt" in message.inboxes[inbox].outbound!, false);
  } finally {
    Temporal.Now.instant = originalNow;
  }
});

test("outbound exchange-only observers await snapshots across unsigned worker redirects", async () => {
  const builder = createFederationBuilder<{ label: string }>();
  const exchanges: OutboundHttpExchangeReport[] = [];
  const contexts: unknown[] = [];
  let entered!: () => void;
  const observing = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let replacements = 0;
  builder.setOutboundObservers({
    async onHttpExchange(ctx, report) {
      exchanges.push(report);
      contexts.push(ctx.data);
      entered();
      await gate;
      throw new Error("exchange callback rejection must be isolated");
    },
  });
  const federation = await builder.build({
    kv: new MemoryKvStore(),
    allowPrivateAddress: true,
  });
  builder.setOutboundObservers({
    onHttpExchange() {
      replacements++;
    },
  });
  const message = continuationMessage(recipient.inboxId!.href, true);
  const data = { label: "worker" };
  const next = new URL("/next", message.inbox).href;
  const bodies: unknown[] = [];
  fetchMock.mockGlobal()
    .post(message.inbox, (call) => {
      bodies.push(JSON.parse(String(call.options.body)));
      return { status: 303, headers: { Location: next } };
    })
    .get(next, 202);
  let settled = false;
  const processing = federation.processQueuedTask(data, message)
    .finally(() => {
      settled = true;
    });
  try {
    await observing;
    strictEqual(settled, false);
    strictEqual(fetchMock.callHistory.calls().length, 1);
    strictEqual(exchanges.length, 1);
    strictEqual(
      Reflect.set(exchanges[0].request, "url", "https://changed.example"),
      false,
    );
    federation.setOutboundObservers({
      onHttpExchange() {
        replacements++;
      },
    });
    release();
    await processing;
    strictEqual(replacements, 0);
    strictEqual(exchanges.length, 2);
    deepStrictEqual(contexts, [data, data]);
    deepStrictEqual(bodies, [message.activity]);
    deepStrictEqual(exchanges.map((report) => report.exchangeIndex), [0, 1]);
    deepStrictEqual(exchanges.map((report) => report.request), [
      { url: message.inbox, method: "POST" },
      { url: next, method: "GET" },
    ]);
    strictEqual(exchanges[0].attemptId, exchanges[1].attemptId);
    for (const [index, report] of exchanges.entries()) {
      strictEqual(report.deliveryId, message.outbound!.deliveryId);
      deepStrictEqual(report.broadcast, message.outbound!.broadcast);
      deepStrictEqual(report.provenance, message.provenance);
      deepStrictEqual(report.queue, {
        queueMessageId: message.id,
        queueAttempt: message.attempt,
      });
      strictEqual(report.outcome.type, "response");
      ok(report.outcome.type === "response");
      strictEqual(report.outcome.response.status, index === 0 ? 303 : 202);
      ok(Object.isFrozen(report));
      ok(Object.isFrozen(report.request));
      ok(Object.isFrozen(report.outcome));
      ok(Object.isFrozen(report.outcome.response));
      strictEqual("trace" in report, false);
    }
    strictEqual(fetchMock.callHistory.calls().length, 2);
  } finally {
    release();
    await processing;
    fetchMock.hardReset();
  }
});

test("outbound unsigned exchanges report only actual submissions and retain received responses", async (t) => {
  for (
    const phase of [
      "http",
      "request",
      "policy",
      "serialization",
      "redirect-policy",
      "redirect-cleanup",
      "final-cleanup",
    ] as const
  ) {
    await t.step(phase, async () => {
      const federation = createFederation<void>(options);
      const ctx = federation.createContext(
        new URL("https://example.com"),
        undefined,
      );
      const exchanges: OutboundHttpExchangeReport[] = [];
      const attempts: OutboundAttemptReport[] = [];
      const observation = new OutboundBroadcastObservation(ctx, {
        onAttempt(_ctx, report) {
          attempts.push(report);
        },
        onHttpExchange(_ctx, report) {
          exchanges.push(report);
          throw new Error("recorder must not change the exchange result");
        },
      }, "send");
      const inbox = recipient.inboxId!.href;
      await observation.planDestinations({
        [inbox]: { actorIds: [], sharedInbox: false },
      });
      const failure = phase.includes("policy")
        ? new UrlError("destination denied")
        : undefined;
      let submissions = 0;
      let closed = 0;
      let outward: unknown;
      await rejects(
        sendConcreteActivity({
          observation: observation.delivery(inbox),
          activity: phase === "serialization"
            ? {
              toJSON() {
                throw failure;
              },
            }
            : {},
          keys: [],
          inbox: new URL(inbox),
        }, {
          openHop(url) {
            if (
              phase === "policy" || phase === "redirect-policy" && url !== inbox
            ) {
              return Promise.reject(failure);
            }
            return Promise.resolve({
              url: new URL(url),
              fetch() {
                submissions++;
                if (phase === "request") return Promise.reject(failure);
                const redirect = phase.startsWith("redirect-");
                return Promise.resolve(
                  new Response(null, {
                    status: redirect ? 307 : phase === "http" ? 503 : 202,
                    statusText: "Observed response",
                    headers: redirect ? { Location: "/next" } : {},
                  }),
                );
              },
              close() {
                closed++;
                return phase.endsWith("cleanup")
                  ? Promise.reject(failure)
                  : Promise.resolve();
              },
            });
          },
        }),
        (error: unknown) => {
          outward = error;
          return true;
        },
      );
      strictEqual(attempts.length, 1);
      ok(attempts[0].outcome.type === "failed");
      strictEqual(attempts[0].outcome.error, outward);
      const count = phase === "policy" || phase === "serialization" ? 0 : 1;
      strictEqual(submissions, count);
      strictEqual(exchanges.length, count);
      strictEqual(attempts[0].httpExchangeCount, count);
      const evidence = attempts[0].outcome.response;
      if (count === 0 || phase === "request") {
        deepStrictEqual(evidence, { type: "not-observed" });
      } else if (phase.startsWith("redirect-")) {
        deepStrictEqual(evidence, {
          type: "intermediate-only",
          lastObserved: {
            exchangeIndex: 0,
            metadata: { status: 307, statusText: "Observed response" },
          },
        });
      } else {
        ok(evidence.type === "final");
        strictEqual(evidence.exchangeIndex, 0);
        strictEqual(evidence.metadata.status, phase === "http" ? 503 : 202);
      }
      if (count === 0) return;
      const report = exchanges[0];
      strictEqual(report.attemptId, attempts[0].attemptId);
      strictEqual(report.exchangeIndex, 0);
      deepStrictEqual(report.request, { url: inbox, method: "POST" });
      if (phase === "request") {
        strictEqual(report.outcome.type, "failed");
        ok(report.outcome.type === "failed");
        strictEqual(report.outcome.error, failure);
      } else {
        ok(report.outcome.type === "response");
        deepStrictEqual(report.outcome.response, {
          status: phase.startsWith("redirect-")
            ? 307
            : phase === "http"
            ? 503
            : 202,
          statusText: "Observed response",
        });
      }
      ok(closed > 0);
    });
  }
});

test("outbound signed exchanges follow actual challenge, fallback, and redirect submissions", async (t) => {
  const challenge =
    'sig1=("@method" "@target-uri");created;nonce="observer-nonce"';
  for (
    const mode of [
      "success",
      "fallback",
      "challenge",
      "challenge-fallback",
      "challenge-redirect",
      "unfulfillable",
    ] as const
  ) {
    await t.step(mode, async () => {
      const inbox = recipient.inboxId!.href;
      const next = new URL("/next", inbox).href;
      const responses: ResponseInit[] = mode === "success"
        ? [{ status: 202 }]
        : mode === "fallback"
        ? [{ status: 401 }, { status: 202 }]
        : mode === "unfulfillable"
        ? [
          {
            status: 401,
            headers: {
              "Accept-Signature": 'sig1=("@method" "x-absent");created',
            },
          },
          { status: 202 },
        ]
        : [
          { status: 401, headers: { "Accept-Signature": challenge } },
          ...(mode === "challenge"
            ? [{ status: 202 }]
            : mode === "challenge-fallback"
            ? [{ status: 401 }, { status: 202 }]
            : [{ status: 307, headers: { Location: next } }, { status: 202 }]),
        ];
      const ctx = createFederation<void>(options).createContext(
        new URL("https://example.com"),
        undefined,
      );
      const exchanges: OutboundHttpExchangeReport[] = [];
      const attempts: OutboundAttemptReport[] = [];
      const observation = new OutboundBroadcastObservation(ctx, {
        onAttempt(_ctx, report) {
          attempts.push(report);
        },
        onHttpExchange(_ctx, report) {
          exchanges.push(report);
          throw new Error("observer must not alter signature negotiation");
        },
      }, "send");
      await observation.planDestinations({
        [inbox]: { actorIds: [], sharedInbox: false },
      });
      const requests: Request[] = [];
      const origins: string[] = [];
      const payload = { id: "https://example.com/activity", extra: "original" };
      await sendConcreteActivity({
        observation: observation.delivery(inbox),
        activity: payload,
        keys: [sender],
        inbox: new URL(inbox),
        specDeterminer: {
          determineSpec(origin) {
            origins.push(origin);
            return "rfc9421";
          },
          rememberSpec() {},
        },
      }, {
        openHop: (url) =>
          Promise.resolve({
            url: new URL(url),
            fetch(input) {
              ok(input instanceof Request);
              const response = responses[requests.length];
              requests.push(input);
              ok(
                response,
                "observation must not create extra HTTP submissions",
              );
              return Promise.resolve(new Response(null, response));
            },
            close: () => Promise.resolve(),
          }),
      });
      strictEqual(attempts.length, 1);
      strictEqual(attempts[0].outcome.type, "succeeded");
      strictEqual(exchanges.length, responses.length);
      strictEqual(requests.length, responses.length);
      strictEqual(attempts[0].httpExchangeCount, requests.length);
      const final = attempts[0].outcome.response;
      ok(final.type === "final");
      strictEqual(final.exchangeIndex, requests.length - 1);
      ok(Object.isFrozen(final));
      ok(Object.isFrozen(final.metadata));
      strictEqual(final.metadata.status, 202);
      strictEqual(origins.length, mode === "challenge-redirect" ? 2 : 1);
      for (const [index, report] of exchanges.entries()) {
        strictEqual(report.exchangeIndex, index);
        strictEqual(report.attemptId, attempts[0].attemptId);
        deepStrictEqual(report.request, {
          url: requests[index].url,
          method: requests[index].method,
        });
        ok(report.outcome.type === "response");
        strictEqual(report.outcome.response.status, responses[index].status);
        deepStrictEqual(
          JSON.parse(await requests[index].clone().text()),
          payload,
        );
        ok(requests[index].headers.has("Signature"));
      }
      ok(requests[0].headers.has("Signature-Input"));
      if (mode.startsWith("challenge")) {
        ok(
          requests[1].headers.get("Signature-Input")?.includes(
            'nonce="observer-nonce"',
          ),
        );
      }
      if (
        mode === "fallback" || mode === "challenge-fallback" ||
        mode === "unfulfillable"
      ) {
        strictEqual(requests.at(-1)!.headers.has("Signature-Input"), false);
      }
      if (mode === "challenge-redirect") strictEqual(requests[2].url, next);
    });
  }
});

test("outbound signed exchanges preserve earlier responses when subsequent operations fail", async (t) => {
  for (
    const phase of [
      "spec-lookup",
      "signing",
      "later-spec-lookup",
      "later-signing",
      "post-response",
      "request",
      "handled-signing",
    ] as const
  ) {
    await t.step(phase, async () => {
      const inbox = recipient.inboxId!.href;
      const exchanges: OutboundHttpExchangeReport[] = [];
      const attempts: OutboundAttemptReport[] = [];
      const ctx = createFederation<void>(options).createContext(
        new URL("https://example.com"),
        undefined,
      );
      const observation = new OutboundBroadcastObservation(ctx, {
        onAttempt(_ctx, report) {
          attempts.push(report);
        },
        onHttpExchange(_ctx, report) {
          exchanges.push(report);
        },
      }, "send");
      await observation.planDestinations({
        [inbox]: { actorIds: [], sharedInbox: false },
      });
      const failure = Symbol(phase);
      const keyId = new URL(sender.keyId);
      const href = keyId.href;
      let submissions = 0;
      let lookups = 0;
      Object.defineProperty(keyId, "href", {
        get() {
          if (
            phase === "signing" || phase === "later-signing" && submissions > 0
          ) throw failure;
          return href;
        },
      });
      let outward: unknown;
      await rejects(
        sendConcreteActivity({
          observation: observation.delivery(inbox),
          activity: {},
          keys: [{ ...sender, keyId }],
          inbox: new URL(inbox),
          specDeterminer: {
            determineSpec() {
              lookups++;
              if (
                phase === "spec-lookup" ||
                phase === "later-spec-lookup" && lookups > 1
              ) throw failure;
              return "rfc9421";
            },
            rememberSpec() {
              if (phase === "post-response") return Promise.reject(failure);
            },
          },
        }, {
          openHop: (url) =>
            Promise.resolve({
              url: new URL(url),
              fetch() {
                submissions++;
                if (
                  phase === "request" ||
                  phase === "handled-signing" && submissions > 1
                ) return Promise.reject(failure);
                return Promise.resolve(
                  new Response(null, {
                    status: phase === "later-spec-lookup"
                      ? 307
                      : phase === "post-response"
                      ? 202
                      : 401,
                    headers: phase === "later-spec-lookup"
                      ? { Location: "/next" }
                      : phase === "handled-signing"
                      ? {
                        "Accept-Signature":
                          'sig1=("@method" "x-absent");created',
                      }
                      : {},
                  }),
                );
              },
              close: () => Promise.resolve(),
            }),
        }),
        (error: unknown) => {
          outward = error;
          return error instanceof FetchError;
        },
      );
      strictEqual(exchanges.length, submissions);
      strictEqual(attempts.length, 1);
      const outcome = attempts[0].outcome;
      ok(outcome.type === "failed");
      strictEqual(outcome.error, outward);
      strictEqual(outcome.failure.error, failure);
      const transport = phase === "request" || phase === "handled-signing";
      strictEqual(outcome.failure.kind, transport ? "transport" : "local");
      strictEqual(
        outcome.failure.phase,
        transport ? "request" : phase.replace("later-", ""),
      );
      const count = phase === "spec-lookup" || phase === "signing"
        ? 0
        : phase === "handled-signing"
        ? 2
        : 1;
      strictEqual(submissions, count);
      strictEqual(attempts[0].httpExchangeCount, count);
      if (phase === "post-response") {
        ok(outcome.response.type === "final");
        strictEqual(outcome.response.exchangeIndex, 0);
        strictEqual(outcome.response.metadata.status, 202);
      } else if (phase.startsWith("later-") || phase === "handled-signing") {
        ok(outcome.response.type === "intermediate-only");
        strictEqual(outcome.response.lastObserved.exchangeIndex, 0);
        strictEqual(
          outcome.response.lastObserved.metadata.status,
          phase === "later-spec-lookup" ? 307 : 401,
        );
      } else deepStrictEqual(outcome.response, { type: "not-observed" });
      for (const [index, report] of exchanges.entries()) {
        strictEqual(report.attemptId, attempts[0].attemptId);
        strictEqual(report.exchangeIndex, index);
        if (transport && index === count - 1) {
          ok(report.outcome.type === "failed");
          strictEqual(report.outcome.error, failure);
        } else {
          ok(report.outcome.type === "response");
          strictEqual(
            report.outcome.response.status,
            phase === "later-spec-lookup"
              ? 307
              : phase === "post-response"
              ? 202
              : 401,
          );
        }
      }
    });
  }
});

test("outbound attempt finality preserves HTTP, cache, and cleanup failures together", async (t) => {
  for (const status of [202, 503]) {
    for (const phase of ["cache", "cleanup", "both"] as const) {
      await t.step(`${status}: ${phase}`, async () => {
        const inbox = recipient.inboxId!.href;
        const reports: OutboundAttemptReport[] = [];
        const exchanges: OutboundHttpExchangeReport[] = [];
        const ctx = createFederation<void>(options).createContext(
          new URL("https://example.com"),
          undefined,
        );
        const observation = new OutboundBroadcastObservation(ctx, {
          onAttempt(_ctx, report) {
            reports.push(report);
          },
          onHttpExchange(_ctx, report) {
            exchanges.push(report);
          },
        }, "send");
        await observation.planDestinations({
          [inbox]: { actorIds: [], sharedInbox: false },
        });
        const cacheError = Symbol("cache failure");
        const cleanupError = Symbol("cleanup failure");
        let submissions = 0;
        let outward: unknown;
        await rejects(
          sendConcreteActivity({
            observation: observation.delivery(inbox),
            activity: {},
            keys: [sender],
            inbox: new URL(inbox),
            specDeterminer: {
              determineSpec: () => "rfc9421",
              rememberSpec() {
                if (phase !== "cleanup") throw cacheError;
              },
            },
          }, {
            openHop: (url) =>
              Promise.resolve({
                url: new URL(url),
                fetch() {
                  return Promise.resolve(
                    new Response(null, {
                      status: ++submissions === 1 ? 401 : status,
                      statusText: "Observed response",
                    }),
                  );
                },
                close() {
                  return phase === "cache"
                    ? Promise.resolve()
                    : Promise.reject(cleanupError);
                },
              }),
          }),
          (error: unknown) => {
            outward = error;
            return error instanceof FetchError;
          },
        );
        strictEqual(reports.length, 1);
        strictEqual(submissions, 2);
        const report = reports[0];
        strictEqual(report.httpExchangeCount, 2);
        const outcome = report.outcome;
        ok(outcome.type === "failed");
        strictEqual(outcome.error, outward);
        strictEqual(
          (outward as FetchError).cause,
          phase === "cleanup" ? cleanupError : cacheError,
        );
        deepStrictEqual(outcome.response, {
          type: "final",
          exchangeIndex: 1,
          metadata: { status, statusText: "Observed response" },
        });
        const diagnostics = [];
        if (phase !== "cleanup") {
          diagnostics.push({
            kind: "local",
            phase: "post-response",
            error: cacheError,
          });
        }
        if (phase !== "cache") {
          diagnostics.push({
            kind: "local",
            phase: "cleanup",
            error: cleanupError,
          });
        }
        if (status === 503) {
          deepStrictEqual(outcome.failure, { kind: "http", phase: "response" });
          deepStrictEqual(outcome.diagnostics, diagnostics);
        } else {
          deepStrictEqual(outcome.failure, diagnostics[0]);
          deepStrictEqual(
            outcome.diagnostics,
            diagnostics.length > 1 ? diagnostics.slice(1) : undefined,
          );
        }
        ok(Object.isFrozen(outcome.response));
        ok(Object.isFrozen(outcome.response.metadata));
        if (outcome.diagnostics != null) {
          ok(Object.isFrozen(outcome.diagnostics));
        }
        strictEqual(exchanges.length, 2);
        ok(exchanges[1].outcome.type === "response");
        deepStrictEqual(
          exchanges[1].outcome.response,
          outcome.response.metadata,
        );
      });
    }
  }
});

test("outbound attempt finality follows branch decisions rather than status or last index", async (t) => {
  for (
    const mode of [
      "challenge-cache",
      "final-401",
      "unsigned-300",
      "signed-300",
      "undetermined",
    ] as const
  ) {
    await t.step(mode, async () => {
      const inbox = recipient.inboxId!.href;
      const reports: OutboundAttemptReport[] = [];
      const exchanges: OutboundHttpExchangeReport[] = [];
      const ctx = createFederation<void>(options).createContext(
        new URL("https://example.com"),
        undefined,
      );
      const observation = new OutboundBroadcastObservation(ctx, {
        onAttempt(_ctx, report) {
          reports.push(report);
        },
        onHttpExchange(_ctx, report) {
          exchanges.push(report);
        },
      }, "send");
      await observation.planDestinations({
        [inbox]: { actorIds: [], sharedInbox: false },
      });
      const failure = Symbol(mode);
      const denied = new UrlError("redirect denied");
      const keyId = new URL(sender.keyId);
      const href = keyId.href;
      let submissions = 0;
      let cacheWrites = 0;
      Object.defineProperty(keyId, "href", {
        get() {
          if (mode === "undetermined" && submissions > 0) throw failure;
          return href;
        },
      });
      let outward: unknown;
      await rejects(
        sendConcreteActivity({
          observation: observation.delivery(inbox),
          activity: {},
          keys: mode === "unsigned-300" ? [] : [{ ...sender, keyId }],
          inbox: new URL(inbox),
          specDeterminer: {
            determineSpec: () => "rfc9421",
            rememberSpec() {
              cacheWrites++;
              if (mode === "challenge-cache") throw failure;
            },
          },
        }, {
          openHop(url) {
            if (url !== inbox) return Promise.reject(denied);
            return Promise.resolve({
              url: new URL(url),
              fetch() {
                submissions++;
                return Promise.resolve(
                  new Response(null, {
                    status: mode.endsWith("300")
                      ? 300
                      : mode === "challenge-cache" && submissions > 1
                      ? 202
                      : 401,
                    statusText: "Observed response",
                    headers: mode.endsWith("300")
                      ? { Location: "/next" }
                      : mode === "challenge-cache" || mode === "undetermined"
                      ? {
                        "Accept-Signature":
                          'sig1=("@method" "@target-uri");created',
                      }
                      : {},
                  }),
                );
              },
              close: () => Promise.resolve(),
            });
          },
        }),
        (error: unknown) => {
          outward = error;
          return true;
        },
      );
      strictEqual(reports.length, 1);
      const report = reports[0];
      strictEqual(report.httpExchangeCount, submissions);
      strictEqual(
        submissions,
        mode === "challenge-cache" || mode === "final-401" ? 2 : 1,
      );
      strictEqual(exchanges.length, submissions);
      const outcome = report.outcome;
      ok(outcome.type === "failed");
      strictEqual(outcome.error, outward);
      const evidence = outcome.response;
      if (mode === "signed-300" || mode === "undetermined") {
        ok(
          evidence.type ===
            (mode === "signed-300" ? "intermediate-only" : "undetermined"),
        );
        strictEqual(evidence.lastObserved.exchangeIndex, 0);
        strictEqual(
          evidence.lastObserved.metadata.status,
          mode === "signed-300" ? 300 : 401,
        );
        strictEqual(
          outcome.failure.kind,
          mode === "signed-300" ? "policy" : "unknown",
        );
      } else {
        ok(evidence.type === "final");
        strictEqual(evidence.exchangeIndex, submissions - 1);
        strictEqual(
          evidence.metadata.status,
          mode === "challenge-cache" ? 202 : mode === "final-401" ? 401 : 300,
        );
        strictEqual(
          outcome.failure.kind,
          mode === "challenge-cache" ? "local" : "http",
        );
      }
      if (mode === "final-401") strictEqual(cacheWrites, 0);
      if (mode === "challenge-cache" || mode === "undetermined") {
        strictEqual(outcome.failure.error, failure);
      }
    });
  }
});

test("outbound attempts report ordinary and outbox sends with attempt-only builder registration", async (t) => {
  for (const kind of ["ordinary", "outbox"] as const) {
    for (const status of [202, 503, "policy"] as const) {
      await t.step(`${kind}: ${status}`, async () => {
        const [tracerProvider, exporter] = createTestTracerProvider();
        try {
          const builder = createFederationBuilder<void>();
          const reports: OutboundAttemptReport[] = [];
          const contexts: unknown[] = [];
          let recorded = false;
          let replacementCalls = 0;
          builder.setOutboundObservers({
            async onAttempt(context, report) {
              contexts.push(context);
              reports.push(report);
              await Promise.resolve();
              recorded = true;
              throw new Error("observer rejection must be isolated");
            },
          });
          const federation = await builder.build({
            kv: new MemoryKvStore(),
            tracerProvider,
            allowPrivateAddress: status !== "policy",
          });
          builder.setOutboundObservers({
            onAttempt() {
              replacementCalls++;
            },
          });
          const base = federation.createContext(
            new URL("https://example.com"),
            undefined,
          );
          ok(base instanceof ContextImpl);
          const ctx = kind === "ordinary"
            ? base
            : base.toOutboxContext("alice", {}, undefined, Create.typeId.href);
          const target = status === "policy"
            ? recipient.clone({
              inbox: new URL("http://127.0.0.1/inbox"),
            })
            : recipient;
          if (status !== "policy") {
            fetchMock.mockGlobal().post(target.inboxId!.href, status);
          }
          const sending = ctx.sendActivity(sender, target, activity, {
            immediate: true,
            dispatchId: "application-dispatch",
          });
          let outward: unknown;
          if (status === 202) await sending;
          else {
            await rejects(sending, (error: unknown) => {
              outward = error;
              return status === "policy"
                ? error instanceof UrlError
                : error instanceof SendActivityError &&
                  error.statusCode === status;
            });
          }
          strictEqual(recorded, true);
          strictEqual(replacementCalls, 0);
          strictEqual(reports.length, 1);
          strictEqual(contexts[0], ctx);
          const report = reports[0];
          ok(report.attemptId.length > 0);
          ok(report.deliveryId.length > 0);
          ok(report.broadcast.type === "known");
          strictEqual(report.destinationInbox, target.inboxId!.href);
          strictEqual(report.inboxUrl, target.inboxId!.href);
          strictEqual(report.provenance.dispatchId, "application-dispatch");
          ok(Object.isFrozen(report));
          ok(Object.isFrozen(report.outcome));
          ok(Object.isFrozen(report.local));
          ok(Object.isFrozen(report.provenance));
          const span = exporter.getSpan("activitypub.send_activity");
          ok(span);
          deepStrictEqual(report.trace, {
            traceId: span.spanContext().traceId,
            spanId: span.spanContext().spanId,
          });
          strictEqual(
            report.httpExchangeCount,
            status === "policy" ? 0 : status === 202 ? 1 : 2,
          );
          if (status === 202) {
            strictEqual(report.outcome.type, "succeeded");
            ok(report.outcome.response.type === "final");
            strictEqual(report.outcome.response.metadata.status, status);
            strictEqual(report.outcome.response.exchangeIndex, 0);
          } else {
            ok(report.outcome.type === "failed");
            strictEqual(report.outcome.error, outward);
            strictEqual(report.outcome.failure.error, outward);
            strictEqual(
              report.outcome.failure.kind,
              status === "policy" ? "policy" : "http",
            );
            if (status === "policy") {
              deepStrictEqual(report.outcome.response, {
                type: "not-observed",
              });
            } else {
              ok(report.outcome.response.type === "final");
              strictEqual(report.outcome.response.metadata.status, status);
              strictEqual(report.outcome.response.exchangeIndex, 1);
            }
          }
        } finally {
          fetchMock.hardReset();
          await tracerProvider.shutdown();
        }
      });
    }
  }
});

test("outbound attempts await the selected observer without inventing pre-entry attempts", async () => {
  fetchMock.mockGlobal().post(recipient.inboxId!.href, 202);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const observing = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const reports: OutboundAttemptReport[] = [];
  let replacements = 0;
  let settled = false;
  try {
    const federation = createFederation<void>({
      kv: new MemoryKvStore(),
      allowPrivateAddress: true,
    });
    federation.setOutboundObservers({
      onBroadcast(_ctx, event) {
        if (event.stage === "started") {
          federation.setOutboundObservers({
            onAttempt() {
              replacements++;
            },
          });
        }
      },
      async onAttempt(_ctx, report) {
        reports.push(report);
        entered();
        await gate;
      },
    });
    const ctx = federation.createContext(
      new URL("https://example.com"),
      undefined,
    );
    const sending = ctx.sendActivity(sender, recipient, activity, {
      immediate: true,
    })
      .finally(() => {
        settled = true;
      });
    await observing;
    strictEqual(settled, false);
    strictEqual(replacements, 0);
    release();
    await sending;
    strictEqual(reports.length, 1);
    await ctx.sendActivity(sender, [], activity);
    await rejects(
      ctx.sendActivity(sender, recipient, new Create({})),
      TypeError,
    );
    strictEqual(replacements, 0);
    strictEqual(reports.length, 1);
  } finally {
    release();
    fetchMock.hardReset();
  }
});

test("outbound attempts preserve boundary failures and allocate fresh IDs per concrete entry", async (t) => {
  for (
    const phase of [
      "success",
      "serialization",
      "dns",
      "request",
      "cleanup",
      "http-cleanup",
      "spec-lookup",
    ] as const
  ) {
    await t.step(phase, async () => {
      const federation = createFederation<void>(options);
      const ctx = federation.createContext(
        new URL("https://example.com"),
        undefined,
      );
      const reports: OutboundAttemptReport[] = [];
      const deliveries: OutboundDeliveryEvent[] = [];
      const observation = new OutboundBroadcastObservation(ctx, {
        onAttempt(_ctx, report) {
          reports.push(report);
        },
        onDelivery(_ctx, event) {
          deliveries.push(event);
        },
      }, "send");
      const inbox = "https://receiver.example/inbox";
      await observation.planDestinations({
        [inbox]: { actorIds: [], sharedInbox: false },
      });
      const failure = phase === "dns"
        ? new UrlError(inbox, { reason: "dns" })
        : Symbol(phase);
      const delivery = observation.delivery(inbox)!;
      let submissions = 0;
      const send = () =>
        sendConcreteActivity({
          observation: delivery,
          activity: phase === "serialization"
            ? {
              toJSON() {
                throw failure;
              },
            }
            : {},
          keys: phase === "spec-lookup" ? [sender] : [],
          inbox: new URL(inbox),
          specDeterminer: {
            determineSpec() {
              throw failure;
            },
            rememberSpec() {
              return Promise.resolve();
            },
          },
        }, {
          openHop(url) {
            if (phase === "dns") return Promise.reject(failure);
            return Promise.resolve({
              url: new URL(url),
              fetch() {
                submissions++;
                return phase === "request"
                  ? Promise.reject(failure)
                  : Promise.resolve(
                    new Response(null, {
                      status: phase === "http-cleanup" ? 503 : 202,
                    }),
                  );
              },
              close() {
                return phase === "cleanup" || phase === "http-cleanup"
                  ? Promise.reject(failure)
                  : Promise.resolve();
              },
            });
          },
        });
      let outward: unknown;
      if (phase === "success") {
        await send();
        await send();
        strictEqual(reports.length, 2);
        notStrictEqual(reports[0].attemptId, reports[1].attemptId);
        strictEqual(reports[0].deliveryId, reports[1].deliveryId);
        strictEqual(submissions, 2);
        return;
      }
      await rejects(send(), (error: unknown) => {
        outward = error;
        return phase === "serialization"
          ? error === failure
          : error instanceof FetchError;
      });
      strictEqual(reports.length, 1);
      const report = reports[0];
      strictEqual(report.deliveryId, deliveries[0].deliveryId);
      strictEqual(report.outcome.type, "failed");
      ok(report.outcome.type === "failed");
      strictEqual(report.outcome.error, outward);
      if (phase === "http-cleanup") {
        deepStrictEqual(report.outcome.failure, {
          kind: "http",
          phase: "response",
        });
        deepStrictEqual(report.outcome.diagnostics, [{
          kind: "local",
          phase: "cleanup",
          error: failure,
        }]);
        deepStrictEqual(report.outcome.response, {
          type: "final",
          exchangeIndex: 0,
          metadata: { status: 503, statusText: "" },
        });
      } else {
        deepStrictEqual(report.outcome.failure, {
          kind: phase === "dns" || phase === "request" ? "transport" : "local",
          phase: phase === "dns" ? "validation" : phase,
          error: failure,
        });
      }
      strictEqual(
        submissions,
        ["request", "cleanup", "http-cleanup"].includes(phase) ? 1 : 0,
      );
      strictEqual("trace" in report, false);
    });
  }
});

test("outbound observers report fresh immutable starts without tracing or extra loading", async (t) => {
  const { AlwaysOffSampler, BasicTracerProvider } = await import(
    "@opentelemetry/sdk-trace-base"
  );
  const provider = new BasicTracerProvider({ sampler: new AlwaysOffSampler() });
  try {
    for (const tracerProvider of [undefined, provider]) {
      await t.step(
        tracerProvider == null ? "no provider" : "sampling disabled",
        async () => {
          let loads = 0;
          const federation = createFederation<{ label: string }>({
            kv: new MemoryKvStore(),
            tracerProvider,
            documentLoaderFactory: () => () => {
              loads++;
              throw new Error("unexpected observation lookup");
            },
            contextLoaderFactory: () => () => {
              loads++;
              throw new Error("unexpected observation lookup");
            },
          });
          const ctx = federation.createContext(new URL("https://example.com"), {
            label: "app",
          });
          const events: OutboundBroadcastEvent[] = [];
          federation.setOutboundObservers({
            onBroadcast(context, event) {
              strictEqual(context, ctx);
              strictEqual(context.data.label, "app");
              strictEqual(event.operation, "send");
              ok(Object.isFrozen(event));
              events.push(event);
            },
          });
          await ctx.sendActivity(sender, [], activity);
          await ctx.sendActivity(sender, [], activity);
          deepStrictEqual(preparation(events.slice(0, 2)), {
            type: "skipped",
            reason: "no-destinations",
          });
          deepStrictEqual(preparation(events.slice(2)), {
            type: "skipped",
            reason: "no-destinations",
          });
          for (const event of events) {
            if (event.stage === "started" || tracerProvider == null) {
              strictEqual("trace" in event, false);
            } else {
              ok(event.trace);
              ok(
                isSpanContextValid({
                  ...event.trace,
                  traceFlags: TraceFlags.NONE,
                }),
              );
            }
          }
          ok(events[0].broadcastId.length > 0);
          notStrictEqual(events[0].broadcastId, events[2].broadcastId);
          strictEqual(loads, 0);
        },
      );
    }
  } finally {
    await provider.shutdown();
  }
});

test("outbound trace snapshots identify producer and fanout spans without changing callbacks", async (t) => {
  for (
    const mode of [
      "send",
      "outbox-send",
      "inbox-forward",
      "outbox-forward",
    ] as const
  ) {
    await t.step(mode, async () => {
      const [tracerProvider, exporter] = createTestTracerProvider();
      try {
        const queued: Message[] = [];
        const queue: MessageQueue = {
          enqueue(message) {
            queued.push(message);
            return Promise.resolve();
          },
          listen: () => Promise.resolve(),
        };
        const federation = createFederation<void>({
          ...options,
          kv: new MemoryKvStore(),
          tracerProvider,
          manuallyStartQueue: true,
          queue: { fanout: queue, outbox: queue },
        });
        const events: (OutboundBroadcastEvent | OutboundDeliveryEvent)[] = [];
        let replacements = 0;
        const replacement = () => {
          replacements++;
        };
        const record = async (
          _ctx: unknown,
          event: OutboundBroadcastEvent | OutboundDeliveryEvent,
        ) => {
          events.push(event);
          if (event.stage === "started") {
            federation.setOutboundObservers({
              onBroadcast: replacement,
              onDelivery: replacement,
            });
          }
          await Promise.resolve();
        };
        const observers = { onBroadcast: record, onDelivery: record };
        federation.setOutboundObservers(observers);
        const ctx = federation.createContext(
          new URL("https://example.com"),
          undefined,
        );
        ok(ctx instanceof ContextImpl);
        if (mode.endsWith("forward")) {
          await forwardingContext(
            federation,
            mode === "inbox-forward" ? "inbox" : "outbox",
            forwardingPayload,
            undefined,
          ).forwardActivity(sender, recipient, { skipIfUnsigned: true });
        } else {
          const producer = mode === "outbox-send"
            ? ctx.toOutboxContext("alice", {}, undefined, Create.typeId.href)
            : ctx;
          await producer.sendActivity(sender, recipient, activity, {
            fanout: mode === "send" ? "force" : "skip",
          });
        }
        strictEqual(replacements, 0);
        strictEqual(events[0].stage, "started");
        strictEqual("trace" in events[0], false);
        ok(events.length > 2);
        const producerEvents = events.length;
        if (mode === "send") {
          federation.setOutboundObservers(observers);
          const task = queued.find((message) => message.type === "fanout");
          ok(task);
          await federation.processQueuedTask(undefined, structuredClone(task));
          ok(events.length > producerEvents);
        }
        for (const [index, event] of events.entries()) {
          if (index === 0) continue;
          ok(event.trace);
          ok(Object.isFrozen(event.trace));
          const span = exporter.spans.find((span) =>
            span.spanContext().spanId === event.trace!.spanId
          );
          ok(span);
          deepStrictEqual(event.trace, {
            traceId: span.spanContext().traceId,
            spanId: span.spanContext().spanId,
          });
          strictEqual(
            span.kind,
            index < producerEvents ? SpanKind.PRODUCER : SpanKind.CONSUMER,
          );
        }
      } finally {
        await tracerProvider.shutdown();
      }
    });
  }
});

test("outbound trace snapshots omit invalid and inherited span identities", async () => {
  const federation = createFederation<void>(options);
  const ctx = federation.createContext(
    new URL("https://example.com"),
    undefined,
  );
  const parent = {
    traceId: "11111111111111111111111111111111",
    spanId: "2222222222222222",
    traceFlags: TraceFlags.NONE,
  };
  for (
    const spanContext of [
      { ...parent, traceId: "00000000000000000000000000000000" },
      parent,
      { ...parent, isRemote: true },
    ]
  ) {
    const events: OutboundBroadcastEvent[] = [];
    const observation = new OutboundBroadcastObservation(ctx, {
      onBroadcast(_ctx, event) {
        events.push(event);
      },
    }, "send");
    observation.setSpan(trace.wrapSpanContext(spanContext), parent);
    await observation.skipped();
    strictEqual(events.length, 1);
    strictEqual("trace" in events[0], false);
  }
});

test("outbound observers await entry before preparation and retain the selected callback", async () => {
  const federation = createFederation<void>(options);
  let preparations = 0;
  const failure = Symbol("original preparation failure");
  federation.setActorDispatcher("/users/{identifier}", () => new Person({}))
    .mapHandle(() => {
      preparations++;
      throw failure;
    });
  const ctx = federation.createContext(
    new URL("https://example.com"),
    undefined,
  );
  let entered!: () => void;
  const entry = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const calls: string[] = [];
  federation.setOutboundObservers({
    async onBroadcast(_ctx, event) {
      calls.push(`original:${event.stage}`);
      entered();
      await gate;
      throw new Error("asynchronous observer failure");
    },
  });
  const pending = rejects(
    ctx.sendActivity({ username: "alice" }, [], activity),
    (error: unknown) => error === failure,
  );
  await entry;
  strictEqual(preparations, 0);
  federation.setOutboundObservers({
    onBroadcast(_ctx, event) {
      calls.push(`replacement:${event.stage}`);
    },
  });
  release();
  await pending;
  await rejects(
    ctx.sendActivity({ username: "alice" }, [], activity),
    (error: unknown) => error === failure,
  );
  deepStrictEqual(calls, [
    "original:started",
    "original:preparation-finished",
    "replacement:started",
    "replacement:preparation-finished",
  ]);
  strictEqual(preparations, 2);
});

test("outbound observers isolate callback and logging errors from success and original failures", async () => {
  let logCalls = 0;
  await configure({
    reset: true,
    sinks: {
      broken() {
        logCalls++;
        throw new Error("sink failed");
      },
    },
    loggers: [
      {
        category: ["fedify", "federation", "outbox"],
        sinks: ["broken"],
        lowestLevel: "error",
      },
      { category: ["logtape", "meta"], sinks: [] },
    ],
  });
  try {
    const federation = createFederation<void>(options);
    const failure = { original: true };
    let calls = 0;
    federation.setActorDispatcher("/users/{identifier}", () => new Person({}))
      .mapHandle(() => {
        throw failure;
      });
    federation.setOutboundObservers({
      onBroadcast() {
        calls++;
        throw "observer failed";
      },
    });
    const ctx = federation.createContext(
      new URL("https://example.com"),
      undefined,
    );
    await ctx.sendActivity(sender, [], activity);
    await rejects(
      ctx.sendActivity({ username: "alice" }, [], activity),
      (error: unknown) => error === failure,
    );
    strictEqual(calls, 4);
    strictEqual(logCalls, 4);
  } finally {
    await reset();
  }
});

test("outbound observers copy registration and isolate builder instances", async () => {
  const builder = createFederationBuilder<void>();
  const calls: string[] = [];
  const registration = {
    onBroadcast() {
      calls.push("original");
    },
  } satisfies OutboundObservers<void>;
  builder.setOutboundObservers(registration);
  registration.onBroadcast = () => {
    calls.push("mutated");
  };
  const first = await builder.build(options);
  const second = await builder.build(options);
  builder.setOutboundObservers({
    onBroadcast() {
      calls.push("new builder");
    },
  });
  const third = await builder.build(options);
  first.setOutboundObservers({
    onBroadcast() {
      calls.push("first only");
    },
  });
  for (const federation of [first, second, third]) {
    await federation.createContext(new URL("https://example.com"), undefined)
      .sendActivity(sender, [], activity);
  }
  deepStrictEqual(calls, [
    "first only",
    "first only",
    "original",
    "original",
    "new builder",
    "new builder",
  ]);
  second.setOutboundObservers({});
  await second.createContext(new URL("https://example.com"), undefined)
    .sendActivity(sender, [], activity);
  strictEqual(calls.length, 6);
});

test("outbound observers do not veto an actual immediate delivery", async () => {
  const order: string[] = [];
  fetchMock.mockGlobal().post("https://receiver.example/inbox", (call) => {
    order.push("fetch");
    strictEqual(JSON.parse(String(call.options.body)).id, activity.id!.href);
    return 202;
  });
  try {
    const federation = createFederation<void>({
      kv: new MemoryKvStore(),
      allowPrivateAddress: true,
    });
    federation.setOutboundObservers({
      onBroadcast(_ctx, event) {
        order.push(event.stage);
        throw new Error("recording failed");
      },
    });
    await federation.createContext(new URL("https://example.com"), undefined)
      .sendActivity(
        sender,
        new Person({
          id: new URL("https://receiver.example/actor"),
          inbox: new URL("https://receiver.example/inbox"),
        }),
        activity,
        { immediate: true },
      );
    strictEqual(order[0], "started");
    strictEqual(order.filter((entry) => entry === "fetch").length, 1);
    strictEqual(
      order.filter((entry) => entry === "preparation-finished").length,
      1,
    );
  } finally {
    fetchMock.hardReset();
  }
});

function preparation(events: OutboundBroadcastEvent[]) {
  deepStrictEqual(events.map((event) => event.stage), [
    "started",
    "preparation-finished",
  ]);
  strictEqual(events[0].broadcastId, events[1].broadcastId);
  ok(events.every((event) => Object.isFrozen(event)));
  const event = events[1];
  ok(event.stage === "preparation-finished");
  ok(Object.isFrozen(event.result));
  return event.result;
}

const recipient = new Person({
  id: new URL("https://receiver.example/actor"),
  inbox: new URL("https://receiver.example/inbox"),
});

test("outbound preparation preserves failure provenance and plan completeness", async (t) => {
  for (
    const phase of [
      "sender-resolution",
      "key-resolution",
      "recipient-resolution",
      "transformation",
      "signing",
      "destination-planning",
      "serialization",
    ] as const
  ) {
    await t.step(phase, async () => {
      const failure = Symbol(phase);
      const events: OutboundBroadcastEvent[] = [];
      const federation = createFederation<void>({
        ...options,
        kv: new MemoryKvStore(),
        ...(phase === "transformation"
          ? {
            activityTransformers: [() => {
              throw failure;
            }],
          }
          : { activityTransformers: [] }),
      });
      federation.setOutboundObservers({
        onBroadcast(_ctx, event) {
          events.push(event);
        },
      });
      let sentActivity = activity;
      let target = recipient;
      if (phase === "serialization") {
        sentActivity = activity.clone({});
        Object.defineProperty(sentActivity, "toJsonLd", {
          value: () => Promise.reject(failure),
        });
      }
      if (phase === "signing") {
        sentActivity = activity.clone({});
        Object.defineProperty(sentActivity, "getProofs", {
          value() {
            throw failure;
          },
        });
      }
      if (phase === "destination-planning") {
        target = recipient.clone({});
        Object.defineProperty(target, "inboxId", {
          get() {
            throw failure;
          },
        });
      }
      if (phase === "sender-resolution") {
        federation.setActorDispatcher(
          "/users/{identifier}",
          () => new Person({}),
        )
          .mapHandle(() => {
            throw failure;
          });
      }
      let keyDispatches = 0;
      if (phase === "key-resolution" || phase === "recipient-resolution") {
        federation.setActorDispatcher(
          "/users/{identifier}",
          () => new Person({}),
        )
          .setKeyPairsDispatcher(() => {
            keyDispatches++;
            if (phase === "key-resolution") throw failure;
            return [{
              privateKey: rsaPrivateKey2,
              publicKey: rsaPublicKey2.publicKey!,
            }];
          });
      }
      if (phase === "recipient-resolution") {
        federation.setFollowersDispatcher(
          "/users/{identifier}/followers",
          () => {
            throw failure;
          },
        );
      }
      const ctx = federation.createContext(
        new URL("https://example.com"),
        undefined,
      );
      const sending = phase === "recipient-resolution"
        ? ctx.sendActivity({ identifier: "alice" }, "followers", sentActivity)
        : ctx.sendActivity(
          phase === "sender-resolution"
            ? { username: "alice" }
            : phase === "key-resolution"
            ? { identifier: "alice" }
            : sender,
          target,
          sentActivity,
        );
      let originalError: unknown;
      await rejects(sending, (error: unknown) => {
        originalError = error;
        if (phase === "key-resolution") {
          // Key-dispatcher errors are already handled by getActorKeyPairs().
          // Preserve the public send error from the resulting empty key set.
          return error instanceof Error &&
            error.message === 'No key pair found for actor "alice".';
        }
        return error === failure;
      });
      if (phase === "key-resolution" || phase === "recipient-resolution") {
        strictEqual(keyDispatches, 1);
      }
      const result = preparation(events);
      ok(result.type === "failed");
      strictEqual(result.failure.error, originalError);
      deepStrictEqual(result, {
        type: "failed",
        failure: { kind: "local", phase, error: originalError },
        planning: phase === "serialization"
          ? "complete"
          : phase === "destination-planning"
          ? "incomplete"
          : "not-started",
        plannedDestinationCount: phase === "serialization" ? 1 : 0,
      });
    });
  }
});

test("outbound preparation precedes queue acceptance and is not rewritten by enqueue failure", async (t) => {
  for (const role of ["outbox", "fanout"] as const) {
    for (const rejected of [false, true]) {
      await t.step(
        `${role}: ${rejected ? "enqueue rejects" : "enqueue accepts"}`,
        async () => {
          const failure = Symbol("enqueue failure");
          const events: OutboundBroadcastEvent[] = [];
          const messages: Message[] = [];
          const queue: MessageQueue = {
            enqueue(message) {
              messages.push(message);
              if (rejected) return Promise.reject(failure);
              return Promise.resolve();
            },
            listen: () => Promise.resolve(),
          };
          const federation = createFederation<void>({
            ...options,
            kv: new MemoryKvStore(),
            manuallyStartQueue: true,
            queue: { [role]: queue },
          });
          let ready!: () => void;
          const prepared = new Promise<void>((resolve) => {
            ready = resolve;
          });
          let release!: () => void;
          const gate = new Promise<void>((resolve) => {
            release = resolve;
          });
          federation.setOutboundObservers({
            async onBroadcast(_ctx, event) {
              events.push(event);
              if (event.stage === "preparation-finished") {
                ready();
                await gate;
              }
            },
          });
          const sending = federation.createContext(
            new URL("https://example.com"),
            undefined,
          )
            .sendActivity(sender, [recipient, recipient], activity, {
              fanout: role === "fanout" ? "force" : "skip",
            });
          const settled = rejected
            ? rejects(sending, (error: unknown) => error === failure)
            : sending;
          await prepared;
          strictEqual(messages.length, 0);
          deepStrictEqual(preparation(events), {
            type: "prepared",
            preparedFor: role === "fanout" ? "fanout" : "delivery",
            destinationCount: 1,
          });
          release();
          await settled;
          strictEqual(messages.length, 1);
          strictEqual(messages[0].type, role);
          const message = messages[0];
          const identity = message.type === "fanout"
            ? message.inboxes[recipient.inboxId!.href].outbound
            : message.type === "outbox"
            ? message.outbound
            : undefined;
          ok(identity);
          deepStrictEqual(identity.broadcast, {
            type: "known",
            id: events[0].broadcastId,
          });
          strictEqual(identity.destinationInbox, recipient.inboxId!.href);
          deepStrictEqual(structuredClone(identity), identity);
          strictEqual(events.length, 2);
          ok(!("observation" in messages[0]));
        },
      );
    }
  }
});

test("outbound preparation finishes before immediate sends settle without reporting later failures twice", async (t) => {
  for (const status of [202, 503]) {
    await t.step(`HTTP ${status}`, async () => {
      let fetched!: () => void;
      const fetching = new Promise<void>((resolve) => {
        fetched = resolve;
      });
      let releaseResponse!: () => void;
      const responseGate = new Promise<void>((resolve) => {
        releaseResponse = resolve;
      });
      let ready!: () => void;
      const prepared = new Promise<void>((resolve) => {
        ready = resolve;
      });
      let releaseObserver!: () => void;
      const observerGate = new Promise<void>((resolve) => {
        releaseObserver = resolve;
      });
      const events: OutboundBroadcastEvent[] = [];
      const deliveries: OutboundDeliveryEvent[] = [];
      const [tracerProvider, spanExporter] = createTestTracerProvider();
      let sendEnded!: () => void;
      const concreteSendEnded = new Promise<void>((resolve) => {
        sendEnded = resolve;
      });
      const exportSpans = spanExporter.export.bind(spanExporter);
      spanExporter.export = (spans, callback) => {
        exportSpans(spans, callback);
        if (spans.some((span) => span.name === "activitypub.send_activity")) {
          sendEnded();
        }
      };
      fetchMock.mockGlobal().post(
        "https://receiver.example/inbox",
        async () => {
          fetched();
          await responseGate;
          return { status, body: "receiver response" };
        },
      );
      try {
        const federation = createFederation<void>({
          kv: new MemoryKvStore(),
          allowPrivateAddress: true,
          tracerProvider,
        });
        federation.setOutboundObservers({
          onDelivery(_ctx, event) {
            deliveries.push(event);
          },
          async onBroadcast(_ctx, event) {
            events.push(event);
            if (event.stage === "preparation-finished") {
              ready();
              await observerGate;
            }
          },
        });
        let settled = false;
        const sending = federation.createContext(
          new URL("https://example.com"),
          undefined,
        )
          .sendActivity(sender, recipient, activity, { immediate: true })
          .finally(() => {
            settled = true;
          });
        const result = status === 202
          ? sending
          : rejects(sending, (error: unknown) => {
            return error instanceof Error && "statusCode" in error &&
              error.statusCode === status;
          });
        await Promise.all([prepared, fetching]);
        strictEqual(settled, false);
        deepStrictEqual(preparation(events), {
          type: "prepared",
          preparedFor: "delivery",
          destinationCount: 1,
        });
        releaseResponse();
        // Wait for the actual concrete send to finish while the preparation
        // observer remains blocked, rather than assuming a timer is long enough.
        await concreteSendEnded;
        const span = spanExporter.getSpan("activitypub.send_activity");
        ok(span);
        if (status === 503) strictEqual(span.status.code, SpanStatusCode.ERROR);
        // Only now yield a turn so an unhandled rejection would be detected
        // before releasing the observer and joining the send promises.
        await new Promise((resolve) => setTimeout(resolve, 0));
        strictEqual(settled, false);
        releaseObserver();
        await result;
        deepStrictEqual(deliveries.map((event) => event.stage), [
          "planned",
          "handoff",
        ]);
        const handoff = deliveries[1];
        ok(handoff.stage === "handoff");
        deepStrictEqual(handoff.result, { type: "direct" });
        strictEqual(events.length, 2);
      } finally {
        releaseResponse();
        releaseObserver();
        fetchMock.hardReset();
        await tracerProvider.shutdown();
      }
    });
  }
});

test("outbound preparation preserves earlier handoffs when later destination setup fails", async (t) => {
  for (const immediate of [true, false]) {
    await t.step(
      immediate
        ? "immediate handoff survives"
        : "queued messages are not handed off yet",
      async () => {
        const events: OutboundBroadcastEvent[] = [];
        const deliveries: OutboundDeliveryEvent[] = [];
        const messages: Message[] = [];
        const firstInbox = "https://receiver.example/first-inbox";
        const broken = recipient.clone({
          inbox: new URL("https://receiver.example/second-inbox"),
        });
        // Fault injection: planning can retain this value, but collection-sync
        // header construction cannot interpret it as a URL.
        Object.defineProperty(broken, "id", {
          value: { href: "invalid actor URL" },
        });
        let firstFetched!: () => void;
        const fetching = new Promise<void>((resolve) => {
          firstFetched = resolve;
        });
        fetchMock.mockGlobal().post(firstInbox, () => {
          firstFetched();
          return new Response(null, { status: 202 });
        });
        try {
          const queue: MessageQueue = {
            enqueue(message) {
              messages.push(message);
              return Promise.resolve();
            },
            listen: () => Promise.resolve(),
          };
          const federation = createFederation<void>({
            kv: new MemoryKvStore(),
            allowPrivateAddress: true,
            manuallyStartQueue: true,
            ...(immediate ? {} : { queue: { outbox: queue } }),
          });
          federation.setActorDispatcher(
            "/users/{identifier}",
            () => new Person({}),
          )
            .setKeyPairsDispatcher(
              () => [{
                privateKey: rsaPrivateKey2,
                publicKey: rsaPublicKey2.publicKey!,
              }],
            );
          federation.setFollowersDispatcher(
            "/users/{identifier}/followers",
            () => ({
              items: [recipient.clone({ inbox: new URL(firstInbox) }), broken],
            }),
          );
          federation.setOutboundObservers({
            onDelivery(_ctx, event) {
              deliveries.push(event);
            },
            onBroadcast(_ctx, event) {
              events.push(event);
            },
          });
          let originalError: unknown;
          await rejects(
            federation.createContext(new URL("https://example.com"), undefined)
              .sendActivity({ identifier: "alice" }, "followers", activity, {
                immediate,
                syncCollection: true,
              }),
            (error: unknown) => {
              originalError = error;
              return error instanceof TypeError;
            },
          );
          deepStrictEqual(preparation(events), {
            type: "failed",
            failure: {
              kind: "local",
              phase: "request-preparation",
              error: originalError,
            },
            planning: "complete",
            plannedDestinationCount: 2,
          });
          strictEqual(messages.length, 0);
          if (immediate) {
            // Prove the earlier send still reaches fetch after producer failure.
            await fetching;
          }
          const planned = deliveries.filter((event) =>
            event.stage === "planned"
          );
          strictEqual(planned.length, 2);
          const first = deliveries.filter((event) =>
            event.destinationInbox === firstInbox
          );
          deepStrictEqual(
            first.map((event) => event.stage),
            immediate ? ["planned", "handoff"] : ["planned"],
          );
          if (immediate) {
            const handoff = first[1];
            ok(handoff.stage === "handoff");
            deepStrictEqual(handoff.result, { type: "direct" });
          }
          const failed = deliveries.find((event) =>
            event.stage === "preparation-failed"
          );
          ok(failed?.stage === "preparation-failed");
          strictEqual(
            failed.destinationInbox,
            "https://receiver.example/second-inbox",
          );
          strictEqual(failed.failure.error, originalError);
          strictEqual(
            deliveries.filter((event) => event.stage === "handoff").length,
            immediate ? 1 : 0,
          );
          strictEqual(events.length, 2);
        } finally {
          fetchMock.hardReset();
        }
      },
    );
  }
});

test("outbox-context observers await starts and preserve context, registration, and failures", async () => {
  const federation = createFederation<{ label: string }>(options);
  const failure = Symbol("sender resolution failed");
  let resolutions = 0;
  federation.setActorDispatcher("/users/{identifier}", () => new Person({}))
    .mapHandle(() => {
      resolutions++;
      throw failure;
    });
  const base = federation.createContext(new URL("https://example.com"), {
    label: "app",
  });
  ok(base instanceof ContextImpl);
  const ctx = base.toOutboxContext(
    "alice",
    {},
    activity.id!.href,
    Create.typeId.href,
  );
  let entered!: () => void;
  const entry = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const events: OutboundBroadcastEvent[] = [];
  const contexts: unknown[] = [];
  let replacementCalls = 0;
  federation.setOutboundObservers({
    async onBroadcast(context, event) {
      contexts.push(context);
      events.push(event);
      if (event.stage === "started") {
        entered();
        await gate;
      }
      throw new Error("recorder failed");
    },
  });
  const sending = rejects(
    ctx.sendActivity({ username: "alice" }, [], activity),
    (error: unknown) => error === failure,
  );
  await entry;
  strictEqual(resolutions, 0);
  strictEqual(ctx.hasDeliveredActivity(), false);
  federation.setOutboundObservers({
    onBroadcast() {
      replacementCalls++;
    },
  });
  release();
  await sending;
  strictEqual(resolutions, 1);
  strictEqual(replacementCalls, 0);
  strictEqual(contexts.length, 2);
  for (const context of contexts) strictEqual(context, ctx);
  strictEqual(ctx.data.label, "app");
  deepStrictEqual(preparation(events), {
    type: "failed",
    failure: { kind: "local", phase: "sender-resolution", error: failure },
    planning: "not-started",
    plannedDestinationCount: 0,
  });
  strictEqual(ctx.hasDeliveredActivity(), false);
  federation.setOutboundObservers({});
  await rejects(
    ctx.sendActivity({ username: "alice" }, [], activity),
    (error: unknown) => error === failure,
  );
  strictEqual(resolutions, 2);
  strictEqual(events.length, 2);
  strictEqual(ctx.hasDeliveredActivity(), false);
});

test("outbox-context observers preserve empty sends without extra loading", async () => {
  let loads = 0;
  const federation = createFederation<void>({
    kv: new MemoryKvStore(),
    documentLoaderFactory: () => () => {
      loads++;
      throw new Error("unexpected lookup");
    },
    contextLoaderFactory: () => () => {
      loads++;
      throw new Error("unexpected lookup");
    },
  });
  const base = federation.createContext(
    new URL("https://example.com"),
    undefined,
  );
  ok(base instanceof ContextImpl);
  const ctx = base.toOutboxContext(
    "alice",
    {},
    activity.id!.href,
    Create.typeId.href,
  );
  const events: OutboundBroadcastEvent[] = [];
  federation.setOutboundObservers({
    onBroadcast(_ctx, event) {
      events.push(event);
    },
  });
  await ctx.sendActivity(sender, [], activity);
  deepStrictEqual(preparation(events), {
    type: "skipped",
    reason: "no-destinations",
  });
  strictEqual(ctx.hasDeliveredActivity(), false);
  federation.setOutboundObservers({});
  await ctx.sendActivity(sender, [], activity);
  strictEqual(ctx.hasDeliveredActivity(), false);
  strictEqual(events.length, 2);
  strictEqual(loads, 0);
});

test("outbox-context observers report queue readiness before acceptance and preserve delivery state", async (t) => {
  for (const role of ["outbox", "fanout"] as const) {
    for (const rejected of [false, true]) {
      await t.step(
        `${role}: ${rejected ? "rejected" : "accepted"}`,
        async () => {
          const failure = Symbol("enqueue failed");
          const events: OutboundBroadcastEvent[] = [];
          const messages: Message[] = [];
          const checkpoints: {
            context: unknown;
            delivered: boolean;
            enqueued: number;
          }[] = [];
          const queue: MessageQueue = {
            enqueue(message) {
              messages.push(message);
              return rejected ? Promise.reject(failure) : Promise.resolve();
            },
            listen: () => Promise.resolve(),
          };
          const federation = createFederation<void>({
            ...options,
            kv: new MemoryKvStore(),
            manuallyStartQueue: true,
            queue: { [role]: queue },
          });
          const base = federation.createContext(
            new URL("https://example.com"),
            undefined,
          );
          ok(base instanceof ContextImpl);
          const ctx = base.toOutboxContext(
            "alice",
            {},
            activity.id!.href,
            Create.typeId.href,
          );
          const clone = ctx.clone(undefined);
          federation.setOutboundObservers({
            onBroadcast(context, event) {
              events.push(event);
              checkpoints.push({
                context,
                delivered: ctx.hasDeliveredActivity(),
                enqueued: messages.length,
              });
              // Callback failure must not change acceptance or delivery state.
              throw new Error("recorder failed");
            },
          });
          const sending = ctx.sendActivity(
            sender,
            [recipient, recipient],
            activity,
            {
              fanout: role === "fanout" ? "force" : "skip",
            },
          );
          if (rejected) {
            await rejects(sending, (error: unknown) => error === failure);
          } else await sending;
          deepStrictEqual(preparation(events), {
            type: "prepared",
            preparedFor: role === "fanout" ? "fanout" : "delivery",
            destinationCount: 1,
          });
          strictEqual(checkpoints.length, 2);
          for (const checkpoint of checkpoints) {
            strictEqual(checkpoint.context, ctx);
            strictEqual(checkpoint.delivered, false);
            strictEqual(checkpoint.enqueued, 0);
          }
          strictEqual(messages.length, 1);
          strictEqual(messages[0].type, role);
          strictEqual(ctx.hasDeliveredActivity(), !rejected);
          strictEqual(clone.hasDeliveredActivity(), !rejected);
          // Clearing observers keeps successful sends and the shared state working.
          if (!rejected) {
            federation.setOutboundObservers({});
            await ctx.sendActivity(sender, recipient, activity, {
              fanout: role === "fanout" ? "force" : "skip",
            });
            await ctx.sendActivity(sender, [], activity);
            strictEqual(messages.length, 2);
            strictEqual(events.length, 2);
            strictEqual(ctx.hasDeliveredActivity(), true);
            strictEqual(clone.hasDeliveredActivity(), true);
          }
        },
      );
    }
  }
});

test("outbox-context observers report immediate readiness before transport settles", async (t) => {
  for (const status of [202, 503]) {
    await t.step(`HTTP ${status}`, async () => {
      let fetched!: () => void;
      const fetching = new Promise<void>((resolve) => {
        fetched = resolve;
      });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let ready!: () => void;
      const prepared = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const events: OutboundBroadcastEvent[] = [];
      const contexts: unknown[] = [];
      const [tracerProvider, spanExporter] = createTestTracerProvider();
      fetchMock.mockGlobal().post(
        "https://receiver.example/inbox",
        async () => {
          fetched();
          await gate;
          return new Response(null, { status });
        },
      );
      try {
        const federation = createFederation<void>({
          kv: new MemoryKvStore(),
          allowPrivateAddress: true,
          tracerProvider,
        });
        const base = federation.createContext(
          new URL("https://example.com"),
          undefined,
        );
        ok(base instanceof ContextImpl);
        const ctx = base.toOutboxContext(
          "alice",
          {},
          activity.id!.href,
          Create.typeId.href,
        );
        const clone = ctx.clone(undefined);
        federation.setOutboundObservers({
          onBroadcast(context, event) {
            contexts.push(context);
            events.push(event);
            if (event.stage === "preparation-finished") ready();
          },
        });
        let settled = false;
        const sending = ctx.sendActivity(sender, recipient, activity, {
          immediate: true,
        })
          .finally(() => {
            settled = true;
          });
        const result = status === 202
          ? sending
          : rejects(sending, (error: unknown) => {
            return error instanceof Error && "statusCode" in error &&
              error.statusCode === status;
          });
        await Promise.all([fetching, prepared]);
        strictEqual(settled, false);
        strictEqual(ctx.hasDeliveredActivity(), false);
        deepStrictEqual(preparation(events), {
          type: "prepared",
          preparedFor: "delivery",
          destinationCount: 1,
        });
        release();
        await result;
        strictEqual(events.length, 2);
        for (const context of contexts) strictEqual(context, ctx);
        strictEqual(ctx.hasDeliveredActivity(), status === 202);
        strictEqual(clone.hasDeliveredActivity(), status === 202);
        const spans = spanExporter.getSpans("activitypub.outbox");
        strictEqual(spans.length, 1);
        strictEqual(
          spans[0].attributes["activitypub.activity.id"],
          activity.id!.href,
        );
        if (status === 503) {
          strictEqual(spans[0].status.code, SpanStatusCode.ERROR);
        }
      } finally {
        release();
        fetchMock.hardReset();
        await tracerProvider.shutdown();
      }
    });
  }
});

// Keep extension fields and signature-shaped data opaque; forwarding observes
// their existing shape checks, not authentication or a vocabulary round trip.
const forwardingPayload = {
  "@context": ["https://www.w3.org/ns/activitystreams", {
    extension: "https://example.com/extension",
  }],
  type: "Create",
  id: "https://sender.example/create",
  actor: "https://sender.example/actor",
  extension: { values: ["original", "payload"] },
  signature: {
    type: "RsaSignature2017",
    creator: "https://sender.example/key",
    signatureValue: "opaque signature",
  },
};

function forwardingContext<TContextData>(
  federation: Federation<TContextData>,
  kind: "inbox" | "outbox",
  payload: unknown,
  data: TContextData,
) {
  const base = federation.createContext(new URL("https://example.com"), data);
  ok(base instanceof ContextImpl);
  return kind === "inbox"
    ? base.toInboxContext(
      null,
      payload,
      forwardingPayload.id,
      Create.typeId.href,
    )
    : base.toOutboxContext(
      "alice",
      payload,
      forwardingPayload.id,
      Create.typeId.href,
    );
}

test("forwarding observers distinguish skips from preparation failures without extra loading", async (t) => {
  for (const kind of ["inbox", "outbox"] as const) {
    for (const scenario of ["unsigned", "empty", "failed"] as const) {
      await t.step(`${kind}: ${scenario}`, async () => {
        let loads = 0;
        const failure = Symbol("resolution failed");
        const federation = createFederation<{ label: string }>({
          kv: new MemoryKvStore(),
          documentLoaderFactory: () => () => {
            loads++;
            throw new Error("extra lookup");
          },
          contextLoaderFactory: () => () => {
            loads++;
            throw new Error("extra lookup");
          },
        });
        federation.setActorDispatcher(
          "/users/{identifier}",
          () => new Person({}),
        )
          .mapHandle(() => {
            throw failure;
          });
        const { signature: _signature, ...unsigned } = forwardingPayload;
        const ctx = forwardingContext(
          federation,
          kind,
          scenario === "unsigned" ? unsigned : forwardingPayload,
          { label: "app" },
        );
        const events: OutboundBroadcastEvent[] = [];
        const contexts: unknown[] = [];
        federation.setOutboundObservers({
          onBroadcast(context, event) {
            contexts.push(context);
            events.push(event);
            throw new Error("recorder failed");
          },
        });
        const forward = () =>
          ctx.forwardActivity(
            scenario === "failed" ? { username: "alice" } : sender,
            scenario === "empty" ? [] : recipient,
            { skipIfUnsigned: true },
          );
        if (scenario === "failed") {
          await rejects(forward(), (error: unknown) => error === failure);
        } else await forward();
        deepStrictEqual(
          preparation(events),
          scenario === "failed"
            ? {
              type: "failed",
              failure: {
                kind: "local",
                phase: "sender-resolution",
                error: failure,
              },
              planning: "not-started",
              plannedDestinationCount: 0,
            }
            : {
              type: "skipped",
              reason: scenario === "unsigned" ? "unsigned" : "no-destinations",
            },
        );
        for (const event of events) strictEqual(event.operation, "forward");
        for (const context of contexts) strictEqual(context, ctx);
        strictEqual(ctx.data.label, "app");
        strictEqual(loads, 0);
        if (ctx instanceof OutboxContextImpl) {
          strictEqual(ctx.hasDeliveredActivity(), false);
        }
        federation.setOutboundObservers({});
        if (scenario === "failed") {
          await rejects(forward(), (error: unknown) => error === failure);
        } else await forward();
        strictEqual(events.length, 2);
        strictEqual(loads, 0);
      });
    }
  }
});

test("forwarding observers await readiness before enqueue while preserving raw payloads and errors", async (t) => {
  for (const batch of [false, true]) {
    for (const rejected of [false, true]) {
      await t.step(
        `${batch ? "batch" : "single"}: ${rejected ? "rejected" : "accepted"}`,
        async () => {
          const failure = Symbol("enqueue failure");
          const messages: Message[] = [];
          const queue: MessageQueue = {
            enqueue(message) {
              messages.push(message);
              return rejected ? Promise.reject(failure) : Promise.resolve();
            },
            ...(batch
              ? {
                enqueueMany(batch: readonly Message[]) {
                  messages.push(...batch);
                  return rejected ? Promise.reject(failure) : Promise.resolve();
                },
              }
              : {}),
            listen: () => Promise.resolve(),
          };
          const federation = createFederation<void>({
            ...options,
            kv: new MemoryKvStore(),
            queue: { outbox: queue },
            manuallyStartQueue: true,
            activityTransformers: [() => {
              throw new Error("forwarding must not transform");
            }],
          });
          const ctx = forwardingContext(
            federation,
            batch ? "outbox" : "inbox",
            forwardingPayload,
            undefined,
          );
          let ready!: () => void;
          const prepared = new Promise<void>((resolve) => {
            ready = resolve;
          });
          let release!: () => void;
          const gate = new Promise<void>((resolve) => {
            release = resolve;
          });
          const events: OutboundBroadcastEvent[] = [];
          federation.setOutboundObservers({
            async onBroadcast(_ctx, event) {
              events.push(event);
              if (event.stage === "preparation-finished") {
                ready();
                await gate;
              }
              throw new Error("recorder failed");
            },
          });
          const sending = ctx.forwardActivity(sender, [recipient, recipient], {
            skipIfUnsigned: true,
          });
          const result = rejected
            ? rejects(sending, (error: unknown) => error === failure)
            : sending;
          await prepared;
          strictEqual(messages.length, 0);
          if (ctx instanceof OutboxContextImpl) {
            strictEqual(ctx.hasDeliveredActivity(), false);
          }
          deepStrictEqual(preparation(events), {
            type: "prepared",
            preparedFor: "delivery",
            destinationCount: 1,
          });
          release();
          await result;
          strictEqual(events.length, 2);
          strictEqual(messages.length, 1);
          ok(messages[0].type === "outbox");
          strictEqual(messages[0].activity, forwardingPayload);
          ok(!("broadcastId" in messages[0]));
          for (const event of events) strictEqual(event.operation, "forward");
          if (ctx instanceof OutboxContextImpl) {
            strictEqual(ctx.hasDeliveredActivity(), !rejected);
          }
          federation.setOutboundObservers({});
          const unobserved = ctx.forwardActivity(sender, recipient, {
            skipIfUnsigned: true,
          });
          if (rejected) {
            await rejects(unobserved, (error: unknown) => error === failure);
          } else await unobserved;
          strictEqual(messages.length, 2);
          ok(messages[1].type === "outbox");
          strictEqual(messages[1].activity, forwardingPayload);
          strictEqual(events.length, 2);
        },
      );
    }
  }
});

test("forwarding observers retain readiness and registration through late immediate results", async (t) => {
  for (const status of [202, 503]) {
    await t.step(`HTTP ${status}`, async () => {
      let fetched!: () => void;
      const fetching = new Promise<void>((resolve) => {
        fetched = resolve;
      });
      let respond!: () => void;
      const responseGate = new Promise<void>((resolve) => {
        respond = resolve;
      });
      let ready!: () => void;
      const prepared = new Promise<void>((resolve) => {
        ready = resolve;
      });
      let release!: () => void;
      const observerGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const [tracerProvider, exporter] = createTestTracerProvider();
      let ended!: () => void;
      const concreteSendEnded = new Promise<void>((resolve) => {
        ended = resolve;
      });
      const exportSpans = exporter.export.bind(exporter);
      exporter.export = (spans, callback) => {
        exportSpans(spans, callback);
        if (spans.some((span) => span.name === "activitypub.send_activity")) {
          ended();
        }
      };
      let submitted: unknown;
      fetchMock.mockGlobal().post(
        "https://receiver.example/inbox",
        async (call) => {
          submitted = JSON.parse(String(call.options.body));
          fetched();
          await responseGate;
          return new Response(null, { status });
        },
      );
      try {
        const federation = createFederation<void>({
          kv: new MemoryKvStore(),
          allowPrivateAddress: true,
          tracerProvider,
        });
        const ctx = forwardingContext(
          federation,
          status === 202 ? "inbox" : "outbox",
          forwardingPayload,
          undefined,
        );
        const events: OutboundBroadcastEvent[] = [];
        const deliveries: OutboundDeliveryEvent[] = [];
        const attempts: OutboundAttemptReport[] = [];
        let replacements = 0;
        federation.setOutboundObservers({
          onAttempt(_ctx, report) {
            attempts.push(report);
          },
          onDelivery(_ctx, event) {
            deliveries.push(event);
          },
          async onBroadcast(_ctx, event) {
            events.push(event);
            if (event.stage === "preparation-finished") {
              ready();
              await observerGate;
            }
          },
        });
        let settled = false;
        const sending = ctx.forwardActivity(sender, recipient, {
          immediate: true,
          skipIfUnsigned: true,
        })
          .finally(() => {
            settled = true;
          });
        const result = status === 202
          ? sending
          : rejects(sending, (error: unknown) => {
            return error instanceof Error && "statusCode" in error &&
              error.statusCode === status;
          });
        await Promise.all([prepared, fetching]);
        deepStrictEqual(submitted, forwardingPayload);
        strictEqual(settled, false);
        deepStrictEqual(preparation(events), {
          type: "prepared",
          preparedFor: "delivery",
          destinationCount: 1,
        });
        federation.setOutboundObservers({
          onAttempt() {
            replacements++;
          },
          onBroadcast() {
            replacements++;
          },
        });
        respond();
        await concreteSendEnded;
        await new Promise((resolve) => setTimeout(resolve, 0));
        strictEqual(settled, false);
        release();
        await result;
        deepStrictEqual(deliveries.map((event) => event.stage), [
          "planned",
          "handoff",
        ]);
        const handoff = deliveries[1];
        ok(handoff.stage === "handoff");
        deepStrictEqual(handoff.result, { type: "direct" });
        strictEqual(attempts.length, 1);
        const attempt = attempts[0];
        strictEqual(attempt.deliveryId, handoff.deliveryId);
        deepStrictEqual(attempt.broadcast, handoff.broadcast);
        strictEqual(attempt.inboxUrl, recipient.inboxId!.href);
        strictEqual(
          attempt.outcome.type,
          status === 202 ? "succeeded" : "failed",
        );
        ok(attempt.outcome.response.type === "final");
        strictEqual(attempt.outcome.response.metadata.status, status);
        strictEqual(attempt.httpExchangeCount, status === 202 ? 1 : 2);
        if (attempt.outcome.type === "failed") {
          strictEqual(attempt.outcome.failure.kind, "http");
          strictEqual(attempt.outcome.failure.error, attempt.outcome.error);
        }
        strictEqual(events.length, 2);
        strictEqual(replacements, 0);
        for (const event of events) strictEqual(event.operation, "forward");
        if (ctx instanceof OutboxContextImpl) {
          strictEqual(ctx.hasDeliveredActivity(), false);
        }
        const spans = exporter.getSpans(
          status === 202 ? "activitypub.inbox" : "activitypub.outbox",
        );
        strictEqual(spans.length, 1);
        if (status === 503) {
          strictEqual(spans[0].status.code, SpanStatusCode.ERROR);
        }
      } finally {
        respond();
        release();
        fetchMock.hardReset();
        await tracerProvider.shutdown();
      }
    });
  }
});

test("outbound delivery observers snapshot registration and deduplicated destination facts", async () => {
  const events: OutboundDeliveryEvent[] = [];
  const contexts: unknown[] = [];
  const messages: Message[] = [];
  let replacements = 0;
  let mutationApplied: boolean | undefined;
  const registration: {
    onDelivery: NonNullable<OutboundObservers<void>["onDelivery"]>;
  } = {
    onDelivery(context, event) {
      contexts.push(context);
      events.push(event);
      if (event.stage === "planned") {
        mutationApplied = Reflect.set(event.actorIds, 0, "changed");
        federation.setOutboundObservers({
          onDelivery() {
            replacements++;
          },
        });
      }
    },
  };
  const builder = createFederationBuilder<void>();
  builder.setOutboundObservers(registration);
  // The caller's object and later builder changes cannot replace the snapshot.
  registration.onDelivery = () => {
    replacements++;
  };
  const federation = await builder.build({
    ...options,
    kv: new MemoryKvStore(),
    manuallyStartQueue: true,
    queue: {
      outbox: {
        enqueue(message) {
          messages.push(message);
          return Promise.resolve();
        },
        listen: () => Promise.resolve(),
      },
    },
  });
  builder.setOutboundObservers({});
  const ctx = federation.createContext(
    new URL("https://example.com"),
    undefined,
  );
  const shared = new URL("https://receiver.example/shared");
  const recipients = ["alice", "bob"].map((name) => ({
    id: new URL(`https://receiver.example/${name}`),
    inboxId: new URL(`https://receiver.example/${name}/inbox`),
    endpoints: { sharedInbox: shared },
  }));
  await ctx.sendActivity(sender, [...recipients, recipient], activity, {
    preferSharedInbox: true,
  });
  strictEqual(mutationApplied, false);
  strictEqual(replacements, 0);
  strictEqual(events.length, 4);
  for (const context of contexts) strictEqual(context, ctx);
  const planned = events.filter((event) => event.stage === "planned");
  strictEqual(planned.length, 2);
  const sharedPlan = planned.find((event) =>
    event.destinationInbox === shared.href
  );
  ok(sharedPlan?.stage === "planned");
  deepStrictEqual(
    sharedPlan.actorIds,
    recipients.map((recipient) => recipient.id.href),
  );
  strictEqual(sharedPlan.sharedInbox, true);
  strictEqual(sharedPlan.mode, "ordinary");
  notStrictEqual(planned[0].deliveryId, planned[1].deliveryId);
  ok(planned[0].broadcast.type === "known");
  ok(planned[1].broadcast.type === "known");
  strictEqual(planned[0].broadcast.id, planned[1].broadcast.id);
  for (const event of events) {
    ok(Object.isFrozen(event));
    ok(Object.isFrozen(event.broadcast));
    const plan = planned.find((plan) => plan.deliveryId === event.deliveryId);
    ok(plan);
    strictEqual(event.destinationInbox, plan.destinationInbox);
    if (event.stage === "handoff") {
      ok(Object.isFrozen(event.result));
      const result = event.result;
      ok(result.type === "enqueued");
      strictEqual(result.queue, "outbox");
      const message = messages.find((message) =>
        message.id === result.queueMessageId
      );
      ok(message?.type === "outbox");
      strictEqual(message.inbox, event.destinationInbox);
      ok(!message.actorIds?.includes("changed"));
    }
  }
});

test("outbound delivery observers report queue acceptance separately from producer readiness", async (t) => {
  for (const mode of ["single", "batch", "fanout", "forward"] as const) {
    for (const rejected of [false, true]) {
      await t.step(
        `${mode}: ${rejected ? "rejected" : "accepted"}`,
        async () => {
          const failure = Symbol("enqueue failed");
          const messages: Message[] = [];
          const queue: MessageQueue = {
            enqueue(message) {
              messages.push(message);
              const fails = rejected &&
                (mode !== "single" || messages.length === 1);
              return fails ? Promise.reject(failure) : Promise.resolve();
            },
            ...(mode === "batch" || mode === "forward"
              ? {
                enqueueMany(batch: readonly Message[]) {
                  messages.push(...batch);
                  return rejected ? Promise.reject(failure) : Promise.resolve();
                },
              }
              : {}),
            listen: () => Promise.resolve(),
          };
          const federation = createFederation<void>({
            ...options,
            kv: new MemoryKvStore(),
            manuallyStartQueue: true,
            queue: mode === "fanout" ? { fanout: queue } : { outbox: queue },
          });
          const deliveries: OutboundDeliveryEvent[] = [];
          const broadcasts: OutboundBroadcastEvent[] = [];
          federation.setOutboundObservers({
            onBroadcast(_ctx, event) {
              broadcasts.push(event);
            },
            onDelivery(_ctx, event) {
              deliveries.push(event);
              throw new Error("recorder failed");
            },
          });
          const targets = [
            recipient,
            recipient.clone({
              inbox: new URL("https://receiver.example/second"),
            }),
          ];
          const ctx = federation.createContext(
            new URL("https://example.com"),
            undefined,
          );
          ok(ctx instanceof ContextImpl);
          const sending = mode === "forward"
            ? ctx.toInboxContext(
              null,
              forwardingPayload,
              forwardingPayload.id,
              Create.typeId.href,
            )
              .forwardActivity(sender, targets, { skipIfUnsigned: true })
            : ctx.sendActivity(sender, targets, activity, {
              fanout: mode === "fanout" ? "force" : "skip",
            });
          if (rejected) {
            await rejects(sending, (error: unknown) => error === failure);
          } else await sending;
          deepStrictEqual(preparation(broadcasts), {
            type: "prepared",
            preparedFor: mode === "fanout" ? "fanout" : "delivery",
            destinationCount: 2,
          });
          const planned = deliveries.filter((event) =>
            event.stage === "planned"
          );
          const handoffs = deliveries.filter((event) =>
            event.stage === "handoff"
          );
          strictEqual(planned.length, 2);
          strictEqual(handoffs.length, 2);
          for (const event of handoffs) {
            ok(event.stage === "handoff");
            const fails = rejected &&
              (mode !== "single" ||
                event.destinationInbox === recipient.inboxId!.href);
            if (fails) {
              ok(event.result.type === "enqueue-failed");
              strictEqual(event.result.acceptance, "unknown");
              strictEqual(event.result.error, failure);
            } else {
              const result = event.result;
              ok(result.type === "enqueued");
              strictEqual(
                result.queue,
                mode === "fanout" ? "fanout" : "outbox",
              );
              ok(
                messages.some((message) =>
                  message.id === result.queueMessageId
                ),
              );
            }
            ok(event.broadcast.type === "known");
            strictEqual(event.broadcast.id, broadcasts[0].broadcastId);
            const message = messages.find((message) =>
              message.type === "fanout"
                ? event.destinationInbox in message.inboxes
                : message.type === "outbox" &&
                  message.inbox === event.destinationInbox
            );
            ok(message);
            const identity = message.type === "fanout"
              ? message.inboxes[event.destinationInbox].outbound
              : message.type === "outbox"
              ? message.outbound
              : undefined;
            deepStrictEqual(identity, {
              broadcast: event.broadcast,
              deliveryId: event.deliveryId,
              destinationInbox: event.destinationInbox,
            });
            deepStrictEqual(JSON.parse(JSON.stringify(identity)), identity);
            deepStrictEqual(structuredClone(identity), identity);
            strictEqual(
              event.deliveryId,
              planned.find((plan) =>
                plan.destinationInbox === event.destinationInbox
              )!.deliveryId,
            );
          }
        },
      );
    }
  }
});

test("outbound delivery observers retain accepted handoffs after bookkeeping failure", async () => {
  const failure = Symbol("metrics failed after acceptance");
  const events: OutboundDeliveryEvent[] = [];
  const federation = createFederation<void>({
    ...options,
    kv: new MemoryKvStore(),
    manuallyStartQueue: true,
    queue: {
      outbox: {
        enqueue() {
          Object.defineProperty(federation, "meterProvider", {
            get() {
              throw failure;
            },
          });
          return Promise.resolve();
        },
        listen: () => Promise.resolve(),
      },
    },
  });
  federation.setOutboundObservers({
    onDelivery(_ctx, event) {
      events.push(event);
    },
  });
  await rejects(
    federation.createContext(new URL("https://example.com"), undefined)
      .sendActivity(sender, recipient, activity),
    (error: unknown) => error === failure,
  );
  deepStrictEqual(events.map((event) => event.stage), ["planned", "handoff"]);
  const event = events[1];
  ok(event.stage === "handoff");
  ok(event.result.type === "enqueued");
});

test("outbound queue identities survive fanout replay and legacy messages", async (t) => {
  for (const legacy of [false, true]) {
    await t.step(
      legacy ? "legacy fanout" : "serialized producer identities",
      async () => {
        const fanouts: Message[] = [];
        const outboxes: Message[] = [];
        const recordingQueue = (messages: Message[]): MessageQueue => ({
          enqueue(message) {
            messages.push(message);
            return Promise.resolve();
          },
          listen: () => Promise.resolve(),
        });
        const federation = createFederation<void>({
          ...options,
          kv: new MemoryKvStore(),
          manuallyStartQueue: true,
          queue: {
            fanout: recordingQueue(fanouts),
            outbox: recordingQueue(outboxes),
          },
        });
        const broadcasts: OutboundBroadcastEvent[] = [];
        // Identity propagation also works when only the broadcast callback exists.
        federation.setOutboundObservers({
          onBroadcast(_ctx, event) {
            broadcasts.push(event);
          },
        });
        const ctx = federation.createContext(
          new URL("https://example.com"),
          undefined,
        );
        const targets = [
          recipient,
          recipient.clone({
            inbox: new URL("https://receiver.example/second"),
          }),
        ];
        await ctx.sendActivity(sender, targets, activity, { fanout: "force" });
        const message = fanouts[0];
        ok(message?.type === "fanout");
        const original = structuredClone(message);
        if (legacy) {
          for (
            const entry of Object.values(message.inboxes)
          ) delete (entry as { outbound?: unknown }).outbound;
        }
        const events: OutboundDeliveryEvent[] = [];
        let newBroadcasts = 0;
        federation.setOutboundObservers({
          onBroadcast() {
            newBroadcasts++;
          },
          onDelivery(_ctx, event) {
            events.push(event);
          },
        });
        await federation.processQueuedTask(
          undefined,
          JSON.parse(JSON.stringify(message)),
        );
        // Preserve metadata even when the consumer's callbacks are disabled.
        if (!legacy) federation.setOutboundObservers({});
        await federation.processQueuedTask(undefined, structuredClone(message));
        strictEqual(newBroadcasts, 0);
        strictEqual(outboxes.length, 4);
        strictEqual(new Set(outboxes.map((message) => message.id)).size, 4);
        const identities = new Set<string>();
        for (const inbox of Object.keys(message.inboxes)) {
          const children = outboxes.filter((message) =>
            message.type === "outbox" && message.inbox === inbox
          );
          strictEqual(children.length, 2);
          ok(children[0].type === "outbox" && children[1].type === "outbox");
          const identity = children[0].outbound;
          ok(identity);
          identities.add(identity.deliveryId);
          deepStrictEqual(children[1].outbound, identity);
          strictEqual(identity.destinationInbox, inbox);
          deepStrictEqual(
            identity.broadcast,
            legacy
              ? { type: "unknown" }
              : { type: "known", id: broadcasts[0].broadcastId },
          );
          if (!legacy) {
            deepStrictEqual(identity, original.inboxes[inbox].outbound);
          }
          for (
            const event of events.filter((event) =>
              event.destinationInbox === inbox
            )
          ) {
            strictEqual(event.stage, "handoff");
            strictEqual(event.deliveryId, identity.deliveryId);
            deepStrictEqual(event.broadcast, identity.broadcast);
            ok(event.stage === "handoff" && event.result.type === "enqueued");
            const queueMessageId = event.result.queueMessageId;
            ok(children.some((child) => child.id === queueMessageId));
          }
        }
        strictEqual(identities.size, 2);
        strictEqual(events.length, legacy ? 4 : 2);
        if (!legacy) {
          const invalid = structuredClone(original);
          const first = Object.values(invalid.inboxes)[0];
          ok(first.outbound);
          Object.assign(first.outbound, { deliveryId: "" });
          await rejects(
            federation.processQueuedTask(undefined, invalid),
            TypeError,
          );
          strictEqual(outboxes.length, 4);
        }
      },
    );
  }
});

test("outbound observers preserve processing of legacy outbox messages", async () => {
  const messages: Message[] = [];
  const federation = createFederation<void>({
    kv: new MemoryKvStore(),
    allowPrivateAddress: true,
    manuallyStartQueue: true,
    queue: {
      outbox: {
        enqueue(message) {
          messages.push(message);
          return Promise.resolve();
        },
        listen: () => Promise.resolve(),
      },
    },
  });
  const ctx = federation.createContext(
    new URL("https://example.com"),
    undefined,
  );
  await ctx.sendActivity(sender, recipient, activity, { fanout: "skip" });
  const message = messages[0];
  ok(message?.type === "outbox");
  strictEqual(message.outbound, undefined);
  const attempts: OutboundAttemptReport[] = [];
  federation.setOutboundObservers({
    onAttempt(_ctx, report) {
      attempts.push(report);
    },
    onDelivery() {
      throw new Error("unused worker observer");
    },
  });
  fetchMock.mockGlobal().post(recipient.inboxId!.href, 202);
  try {
    await federation.processQueuedTask(
      undefined,
      JSON.parse(JSON.stringify(message)),
    );
    strictEqual(fetchMock.callHistory.calls().length, 1);
    strictEqual(messages.length, 1);
    strictEqual(attempts.length, 1);
    strictEqual(attempts[0].deliveryId, message.id);
    deepStrictEqual(attempts[0].broadcast, { type: "unknown" });
    strictEqual("destinationInbox" in attempts[0], false);
    deepStrictEqual(attempts[0].provenance, {});
  } finally {
    fetchMock.hardReset();
  }
});

function continuationMessage(
  inbox: string,
  observed: boolean,
  portableInbox?: string,
): OutboxMessage {
  return {
    type: "outbox",
    id: crypto.randomUUID(),
    baseUrl: "https://example.com",
    keys: [],
    activity: {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: activity.id!.href,
      type: "Create",
      actor: activity.actorId!.href,
    },
    activityId: activity.id!.href,
    activityType: Create.typeId.href,
    inbox,
    sharedInbox: false,
    started: new Date().toISOString(),
    attempt: 0,
    headers: {},
    orderingKey: "original-order",
    traceContext: {},
    ...(portableInbox == null ? {} : { portableInbox }),
    ...(observed
      ? {
        provenance: {
          dispatchId: "application-dispatch",
          inboxRequest: {
            inboxRequestId: crypto.randomUUID(),
            requestId: "original-request-label",
            context: {
              origin: "https://source.example:8443",
              host: "source.example:8443",
              hostname: "source.example",
              canonicalOrigin: "https://canonical.example",
            },
          },
        },
        outbound: {
          broadcast: { type: "known" as const, id: crypto.randomUUID() },
          deliveryId: crypto.randomUUID(),
          destinationInbox: inbox,
          ...(portableInbox == null ? {} : { portableInbox }),
        },
      }
      : {}),
  };
}

test("gateway worker actions retain route abandonment without claiming an unqueued deferral", async () => {
  const gateways = [
    "https://gw1.example/inbox",
    "https://gw2.example/inbox",
    "https://gw3.example/inbox",
  ];
  const queued: Message[] = [];
  const workers: OutboundWorkerReport[] = [];
  const attempts: OutboundAttemptReport[] = [];
  const federation = createFederation<void>({
    kv: new MemoryKvStore(),
    allowPrivateAddress: true,
    manuallyStartQueue: true,
    circuitBreaker: false,
    queue: {
      outbox: {
        enqueue(message) {
          queued.push(message);
          return Promise.resolve();
        },
        listen: () => Promise.resolve(),
      },
    },
  });
  federation.setOutboundObservers({
    onWorker(_ctx, report) {
      workers.push(report);
    },
    onAttempt(_ctx, report) {
      attempts.push(report);
    },
  });
  const message = {
    ...continuationMessage(gateways[0], true),
    gatewayInboxes: gateways,
  };
  fetchMock.mockGlobal().post(gateways[0], 404)
    .post(gateways[1], { status: 429, headers: { "Retry-After": "3600" } })
    .post(gateways[2], 202);
  try {
    await federation.processQueuedTask(undefined, message);
    strictEqual(workers.length, 1);
    strictEqual(workers[0].attemptsStarted, 3);
    deepStrictEqual(workers[0].result, { type: "completed" });
    deepStrictEqual(workers[0].actions, [{
      type: "abandoned",
      reason: "permanent-failure",
      inboxUrls: [gateways[0]],
    }]);
    strictEqual(queued.length, 0);
    deepStrictEqual(attempts.map((report) => report.outcome.type), [
      "failed",
      "failed",
      "succeeded",
    ]);
    for (const report of attempts) {
      strictEqual(report.deliveryId, message.outbound!.deliveryId);
    }
  } finally {
    fetchMock.hardReset();
  }
});

test("gateway worker actions preserve abandonment and available drop errors", async (t) => {
  const gateways = ["https://gw1.example/inbox", "https://gw2.example/inbox"];
  for (
    const mode of [
      "permanent",
      "permanent-handler",
      "declined",
      "queue-unavailable",
      "ttl",
      "ttl-parse",
    ] as const
  ) {
    await t.step(mode, async () => {
      const ttl = mode.startsWith("ttl");
      const failure = Symbol(mode);
      const reports: OutboundWorkerReport[] = [];
      const queued: Message[] = [];
      const federation = createFederation<void>({
        kv: new MemoryKvStore(),
        allowPrivateAddress: true,
        manuallyStartQueue: true,
        circuitBreaker: ttl ? { heldActivityTtl: { seconds: 1 } } : false,
        outboxRetryPolicy: () =>
          mode === "declined" ? null : Temporal.Duration.from({ seconds: 1 }),
        ...(mode === "queue-unavailable" ? {} : {
          queue: {
            outbox: {
              enqueue(message: Message) {
                queued.push(message);
                return Promise.resolve();
              },
              listen: () => Promise.resolve(),
            },
          },
        }),
      });
      federation.setOutboundObservers({
        onWorker(_ctx, report) {
          reports.push(report);
        },
      });
      if (mode === "permanent-handler") {
        federation.setOutboxPermanentFailureHandler(() => {
          throw failure;
        });
      }
      if (mode === "ttl-parse") {
        Object.defineProperty(federation, "documentLoaderFactory", {
          value: () => {
            throw failure;
          },
        });
      }
      const message = {
        ...continuationMessage(gateways[0], true),
        gatewayInboxes: gateways,
        ...(ttl
          ? {
            circuitHeld: true as const,
            circuitHeldSince: "2000-01-01T00:00:00Z",
          }
          : {}),
      };
      fetchMock.mockGlobal();
      for (const inbox of gateways) {
        fetchMock.post(inbox, mode.startsWith("permanent") ? 404 : 503);
      }
      try {
        const processing = federation.processQueuedTask(undefined, message);
        if (mode === "ttl-parse") {
          await rejects(processing, (error: unknown) => error === failure);
        } else await processing;
        strictEqual(reports.length, 1);
        strictEqual(queued.length, 0);
        const report = reports[0];
        strictEqual(report.attemptsStarted, ttl ? 0 : 2);
        deepStrictEqual(
          report.result,
          mode === "ttl-parse"
            ? { type: "failed", error: failure }
            : { type: "completed" },
        );
        const actions = report.actions;
        ok(actions);
        const abandonments = actions.filter((action) =>
          action.type === "abandoned"
        );
        if (mode.startsWith("permanent")) {
          deepStrictEqual(
            abandonments,
            gateways.map((inbox) => ({
              type: "abandoned",
              reason: "permanent-failure",
              inboxUrls: [inbox],
            })),
          );
        } else {deepStrictEqual(abandonments, [{
            type: "abandoned",
            reason: ttl
              ? "held-ttl-expired"
              : mode === "declined"
              ? "retry-policy-declined"
              : "queue-unavailable",
            inboxUrls: gateways,
          }]);}
        const failed = actions.filter((action) =>
          action.type === "action-failed"
        );
        if (mode === "permanent-handler" || mode === "ttl-parse") {
          strictEqual(failed.length, 1);
          strictEqual(failed[0].action, "drop");
          strictEqual(failed[0].error, failure);
          deepStrictEqual(failed[0].inboxUrls, gateways);
          strictEqual("acceptance" in failed[0], false);
        } else strictEqual(failed.length, 0);
        if (ttl) strictEqual(fetchMock.callHistory.calls().length, 0);
      } finally {
        fetchMock.hardReset();
      }
    });
  }
});

test("gateway continuation failures preserve partial actions and settled attempts", async (t) => {
  const gateways = [
    "https://gw1.example/inbox",
    "https://gw2.example/inbox",
    "https://gw3.example/inbox",
  ];
  for (
    const mode of ["retry-reject", "defer-reject", "retry-bookkeeping"] as const
  ) {
    await t.step(mode, async () => {
      const [meterProvider] = createTestMeterProvider();
      const failure = Symbol(mode);
      const queued: Message[] = [];
      const workers: OutboundWorkerReport[] = [];
      const attempts: OutboundAttemptReport[] = [];
      const federation = createFederation<void>({
        kv: new MemoryKvStore(),
        allowPrivateAddress: true,
        manuallyStartQueue: true,
        meterProvider,
        circuitBreaker: mode === "defer-reject"
          ? { failureThreshold: 1, recoveryDelay: { hours: 1 } }
          : false,
        outboxRetryPolicy: () => Temporal.Duration.from({ seconds: 1 }),
        queue: {
          outbox: {
            enqueue(message) {
              queued.push(message);
              return mode === "retry-bookkeeping"
                ? Promise.resolve()
                : Promise.reject(failure);
            },
            listen: () => Promise.resolve(),
          },
        },
      });
      ok(federation instanceof FederationImpl);
      const metrics = federation.metrics;
      const original = metrics.recordQueueTaskEnqueued;
      if (mode === "retry-bookkeeping") {
        Object.defineProperty(metrics, "recordQueueTaskEnqueued", {
          configurable: true,
          value: (...args: Parameters<typeof original>) => {
            original.call(metrics, ...args);
            throw failure;
          },
        });
      }
      federation.setOutboundObservers({
        onWorker(_ctx, report) {
          workers.push(report);
        },
        onAttempt(_ctx, report) {
          attempts.push(report);
        },
      });
      const message = {
        ...continuationMessage(gateways[0], true),
        gatewayInboxes: gateways,
      };
      fetchMock.mockGlobal().post(gateways[0], 404).post(gateways[1], 503).post(
        gateways[2],
        503,
      );
      try {
        await rejects(
          federation.processQueuedTask(undefined, message),
          (error: unknown) => error === failure,
        );
        strictEqual(queued.length, 1);
        strictEqual(workers.length, 1);
        strictEqual(workers[0].attemptsStarted, 3);
        deepStrictEqual(workers[0].result, { type: "failed", error: failure });
        const actions = workers[0].actions;
        ok(actions);
        strictEqual(actions.length, 2);
        deepStrictEqual(actions[0], {
          type: "abandoned",
          reason: "permanent-failure",
          inboxUrls: [gateways[0]],
        });
        const action = actions[1];
        ok(
          action.type === "scheduled" ||
            action.type === "action-failed" && action.action !== "drop",
        );
        strictEqual(action.action, mode === "defer-reject" ? "defer" : "retry");
        deepStrictEqual(action.inboxUrls, gateways.slice(1));
        const task = queued[0];
        ok(task.type === "outbox");
        deepStrictEqual(action.queue, {
          queueMessageId: task.id,
          queueAttempt: task.attempt,
        });
        if (mode === "retry-bookkeeping") strictEqual(action.type, "scheduled");
        else {
          ok(action.type === "action-failed");
          strictEqual(action.acceptance, "unknown");
          strictEqual(action.error, failure);
        }
        strictEqual(attempts.length, 3);
        for (const report of attempts) {
          ok(report.outcome.type === "failed");
          strictEqual(report.outcome.failure.kind, "http");
        }
      } finally {
        if (mode === "retry-bookkeeping") {
          Object.defineProperty(metrics, "recordQueueTaskEnqueued", {
            value: original,
          });
        }
        fetchMock.hardReset();
      }
    });
  }
});

test("ordinary outbox worker actions record actual retry and hold enqueues", async (t) => {
  for (const mode of ["retry", "retry-after", "hold"] as const) {
    await t.step(mode, async () => {
      const queued: {
        message: Message;
        options: Parameters<MessageQueue["enqueue"]>[1];
      }[] = [];
      const reports: OutboundWorkerReport[] = [];
      const federation = createFederation<void>({
        kv: new MemoryKvStore(),
        allowPrivateAddress: true,
        manuallyStartQueue: true,
        outboxRetryPolicy: () => Temporal.Duration.from({ milliseconds: 250 }),
        circuitBreaker: mode === "hold"
          ? { failureThreshold: 1, recoveryDelay: { hours: 1 } }
          : false,
        queue: {
          outbox: {
            enqueue(message, options) {
              queued.push({ message, options });
              return Promise.resolve();
            },
            listen: () => Promise.resolve(),
          },
        },
      });
      federation.setOutboundObservers({
        onWorker(_ctx, report) {
          reports.push(report);
        },
      });
      const message = continuationMessage(recipient.inboxId!.href, true);
      Object.assign(message, {
        outbound: {
          ...message.outbound!,
          destinationInbox: "https://original.example/inbox",
        },
      });
      fetchMock.mockGlobal().post(
        message.inbox,
        mode === "retry-after"
          ? {
            status: 429,
            headers: { "Retry-After": "1" },
          }
          : 503,
      );
      try {
        await federation.processQueuedTask(undefined, message);
        strictEqual(reports.length, 1);
        strictEqual(reports[0].attemptsStarted, 1);
        deepStrictEqual(reports[0].result, { type: "completed" });
        strictEqual(queued.length, 1);
        const task = queued[0].message;
        ok(task.type === "outbox");
        const action = reports[0].actions?.[0];
        ok(action?.type === "scheduled");
        strictEqual(action.action, mode === "hold" ? "defer" : "retry");
        deepStrictEqual(action.queue, {
          queueMessageId: task.id,
          queueAttempt: mode === "hold" ? 0 : 1,
        });
        strictEqual(reports[0].queue.queueAttempt, 0);
        ok(action.action === "retry" || action.action === "defer");
        strictEqual(action.delay, queued[0].options?.delay?.toString());
        deepStrictEqual(action.inboxUrls, [message.inbox]);
        strictEqual(
          reports[0].delivery?.destinationInbox,
          "https://original.example/inbox",
        );
        strictEqual(reports[0].actions?.length, 1);
        ok(Object.isFrozen(reports[0].actions));
        ok(Object.isFrozen(action));
        ok(Object.isFrozen(action.queue));
        ok(Object.isFrozen(action.inboxUrls));
        if (mode === "retry-after") {
          strictEqual(
            Temporal.Duration.from(action.delay).total("milliseconds"),
            1_000,
          );
        }
        if (mode === "hold") {
          const requests = fetchMock.callHistory.calls().length;
          await federation.processQueuedTask(undefined, structuredClone(task));
          strictEqual(reports.length, 2);
          strictEqual(reports[1].attemptsStarted, 0);
          strictEqual(fetchMock.callHistory.calls().length, requests);
          const held = reports[1].actions?.[0];
          ok(held?.type === "scheduled");
          strictEqual(held.action, "defer");
          strictEqual(held.queue.queueAttempt, 0);
        }
      } finally {
        fetchMock.hardReset();
      }
    });
  }
});

test("ordinary outbox worker actions preserve enqueue uncertainty and accepted bookkeeping failures", async (t) => {
  for (const mode of ["rejected", "accepted"] as const) {
    await t.step(mode, async () => {
      const [meterProvider] = createTestMeterProvider();
      const failure = Symbol(mode);
      const queued: Message[] = [];
      const reports: OutboundWorkerReport[] = [];
      const federation = createFederation<void>({
        kv: new MemoryKvStore(),
        allowPrivateAddress: true,
        manuallyStartQueue: true,
        meterProvider,
        circuitBreaker: false,
        outboxRetryPolicy: () => Temporal.Duration.from({ seconds: 1 }),
        queue: {
          outbox: {
            enqueue(message) {
              queued.push(message);
              return mode === "rejected"
                ? Promise.reject(failure)
                : Promise.resolve();
            },
            listen: () => Promise.resolve(),
          },
        },
      });
      ok(federation instanceof FederationImpl);
      const metrics = federation.metrics;
      const original = metrics.recordQueueTaskEnqueued;
      if (mode === "accepted") {
        Object.defineProperty(metrics, "recordQueueTaskEnqueued", {
          configurable: true,
          value: (...args: Parameters<typeof original>) => {
            original.call(metrics, ...args);
            throw failure;
          },
        });
      }
      federation.setOutboundObservers({
        onWorker(_ctx, report) {
          reports.push(report);
        },
      });
      const message = continuationMessage(recipient.inboxId!.href, true);
      fetchMock.mockGlobal().post(message.inbox, 503);
      try {
        await rejects(
          federation.processQueuedTask(undefined, message),
          (error: unknown) => error === failure,
        );
        strictEqual(queued.length, 1);
        strictEqual(reports.length, 1);
        strictEqual(reports[0].attemptsStarted, 1);
        deepStrictEqual(reports[0].result, { type: "failed", error: failure });
        const action = reports[0].actions?.[0];
        ok(action);
        strictEqual(reports[0].actions?.length, 1);
        strictEqual(
          action.type,
          mode === "rejected" ? "action-failed" : "scheduled",
        );
        ok(
          action.type === "scheduled" ||
            action.type === "action-failed" && action.action === "retry",
        );
        strictEqual(action.action, "retry");
        deepStrictEqual(action.queue, {
          queueMessageId: queued[0].id,
          queueAttempt: 1,
        });
        if (action.type === "action-failed") {
          ok("acceptance" in action);
          strictEqual(action.acceptance, "unknown");
          strictEqual(action.error, failure);
        } else strictEqual("acceptance" in action, false);
      } finally {
        if (mode === "accepted") {
          Object.defineProperty(metrics, "recordQueueTaskEnqueued", {
            value: original,
          });
        }
        fetchMock.hardReset();
      }
    });
  }
});

test("ordinary outbox worker actions retain local abandonment and failed drop steps", async (t) => {
  for (
    const mode of [
      "permanent",
      "declined",
      "ttl",
      "ttl-parse",
      "ttl-handler",
      "permanent-handler",
    ] as const
  ) {
    await t.step(mode, async () => {
      const reports: OutboundWorkerReport[] = [];
      const queued: Message[] = [];
      const ttl = mode.startsWith("ttl");
      const failure = Symbol(mode);
      const federation = createFederation<void>({
        kv: new MemoryKvStore(),
        allowPrivateAddress: true,
        manuallyStartQueue: true,
        outboxRetryPolicy: () => null,
        circuitBreaker: ttl ? { heldActivityTtl: { seconds: 1 } } : false,
        queue: {
          outbox: {
            enqueue(message) {
              queued.push(message);
              return Promise.resolve();
            },
            listen: () => Promise.resolve(),
          },
        },
      });
      federation.setOutboundObservers({
        onWorker(_ctx, report) {
          reports.push(report);
        },
      });
      if (mode.endsWith("handler")) {
        federation.setOutboxPermanentFailureHandler(() => {
          throw failure;
        });
      }
      if (mode === "ttl-parse") {
        Object.defineProperty(federation, "documentLoaderFactory", {
          value: () => {
            throw failure;
          },
        });
      }
      const original = continuationMessage(recipient.inboxId!.href, true);
      const message = ttl
        ? {
          ...original,
          circuitHeld: true as const,
          circuitHeldSince: "2000-01-01T00:00:00Z",
        }
        : original;
      fetchMock.mockGlobal().post(
        message.inbox,
        mode.startsWith("permanent") ? 404 : 503,
      );
      try {
        const processing = federation.processQueuedTask(undefined, message);
        if (mode === "ttl-parse") {
          await rejects(processing, (error: unknown) => error === failure);
        } else await processing;
        strictEqual(reports.length, 1);
        strictEqual(queued.length, 0);
        const report = reports[0];
        strictEqual(report.attemptsStarted, ttl ? 0 : 1);
        deepStrictEqual(
          report.result,
          mode === "ttl-parse"
            ? { type: "failed", error: failure }
            : { type: "completed" },
        );
        const actions = report.actions;
        ok(actions);
        const abandoned = actions[0];
        ok(abandoned.type === "abandoned");
        strictEqual(
          abandoned.reason,
          ttl
            ? "held-ttl-expired"
            : mode === "declined"
            ? "retry-policy-declined"
            : "permanent-failure",
        );
        deepStrictEqual(abandoned.inboxUrls, [message.inbox]);
        if (mode.endsWith("handler") || mode === "ttl-parse") {
          strictEqual(actions.length, 2);
          const failed = actions[1];
          ok(failed.type === "action-failed" && failed.action === "drop");
          strictEqual(failed.error, failure);
          strictEqual("acceptance" in failed, false);
        } else strictEqual(actions.length, 1);
        if (ttl) strictEqual(fetchMock.callHistory.calls().length, 0);
      } finally {
        fetchMock.hardReset();
      }
    });
  }
});

test("outbound worker-only observers count real sends and report local settlement", async (t) => {
  for (
    const mode of [
      "success",
      "handled",
      "native",
      "gateway",
      "recovered-preparation",
    ] as const
  ) {
    await t.step(mode, async () => {
      const [tracerProvider, exporter] = createTestTracerProvider();
      const builder = createFederationBuilder<{ label: string }>();
      const reports: OutboundWorkerReport[] = [];
      const contexts: unknown[] = [];
      const queued: Message[] = [];
      let replacements = 0;
      builder.setOutboundObservers({
        async onWorker(ctx, report) {
          reports.push(report);
          contexts.push(ctx.data);
          await Promise.resolve();
          throw new Error("worker observer error must not replace settlement");
        },
      });
      const federation = await builder.build({
        kv: new MemoryKvStore(),
        allowPrivateAddress: true,
        manuallyStartQueue: true,
        tracerProvider,
        queue: {
          outbox: {
            nativeRetrial: mode === "native" ||
              mode === "recovered-preparation",
            enqueue(message) {
              queued.push(message);
              return Promise.resolve();
            },
            listen: () => Promise.resolve(),
          },
        },
      });
      builder.setOutboundObservers({
        onWorker() {
          replacements++;
        },
      });
      const message = continuationMessage(recipient.inboxId!.href, true);
      if (mode === "gateway" || mode === "recovered-preparation") {
        Object.assign(message, {
          gatewayInboxes: [message.inbox, "https://gateway.example/inbox"],
        });
      }
      if (mode === "recovered-preparation") {
        let reads = 0;
        Object.assign(message, {
          headers: new Proxy({}, {
            get(target, property, receiver) {
              if (property === Symbol.iterator && ++reads === 1) {
                throw new Error("first gateway header preparation");
              }
              return Reflect.get(target, property, receiver);
            },
          }),
        });
      }
      const data = { label: "worker data" };
      fetchMock.mockGlobal().post(
        message.inbox,
        mode === "success" ? 202 : 503,
      );
      if (mode === "gateway" || mode === "recovered-preparation") {
        fetchMock.post(
          "https://gateway.example/inbox",
          mode === "gateway" ? 202 : 503,
        );
      }
      let outward: unknown;
      try {
        const processing = federation.processQueuedTask(data, message);
        if (mode === "native" || mode === "recovered-preparation") {
          await rejects(processing, (error: unknown) => {
            outward = error;
            return error instanceof SendActivityError;
          });
        } else await processing;
        strictEqual(replacements, 0);
        strictEqual(reports.length, 1);
        deepStrictEqual(contexts, [data]);
        const report = reports[0];
        strictEqual(report.role, "outbox");
        if (mode === "gateway" || mode === "recovered-preparation") {
          deepStrictEqual(report.actions, []);
        } else if (mode === "handled") {
          ok(report.actions?.[0].type === "scheduled");
        } else deepStrictEqual(report.actions, []);
        strictEqual(report.attemptsStarted, mode === "gateway" ? 2 : 1);
        deepStrictEqual(report.queue, {
          queueMessageId: message.id,
          queueAttempt: 0,
        });
        deepStrictEqual(report.delivery, message.outbound);
        deepStrictEqual(report.provenance, message.provenance);
        strictEqual(report.local.origin, new URL(message.baseUrl).origin);
        if (mode === "native" || mode === "recovered-preparation") {
          deepStrictEqual(report.result, { type: "failed", error: outward });
        } else deepStrictEqual(report.result, { type: "completed" });
        strictEqual(queued.length, mode === "handled" ? 1 : 0);
        const workerSpan = exporter.getSpan("activitypub.outbox");
        ok(workerSpan);
        deepStrictEqual(report.trace, {
          traceId: workerSpan.spanContext().traceId,
          spanId: workerSpan.spanContext().spanId,
        });
        ok(Object.isFrozen(report));
        ok(Object.isFrozen(report.queue));
        ok(Object.isFrozen(report.result));
      } finally {
        fetchMock.hardReset();
        await tracerProvider.shutdown();
      }
    });
  }
});

test("outbound worker observers report explicit key and fanout parse failures with zero sends", async (t) => {
  for (const mode of ["key-import", "activity-parsing", "non-error"] as const) {
    const phase = mode === "non-error" ? "activity-parsing" : mode;
    await t.step(mode, async () => {
      const federation = createFederation<void>({
        kv: new MemoryKvStore(),
        allowPrivateAddress: true,
      });
      const reports: OutboundWorkerReport[] = [];
      federation.setOutboundObservers({
        onWorker(_ctx, report) {
          reports.push(report);
        },
      });
      const original = continuationMessage(recipient.inboxId!.href, true);
      let loaderCalls = 0;
      Object.defineProperties(federation, {
        documentLoaderFactory: {
          value: () => {
            loaderCalls++;
            return mockDocumentLoader;
          },
        },
        contextLoaderFactory: {
          value: () => {
            loaderCalls++;
            if (mode === "non-error") throw NaN;
            return mockDocumentLoader;
          },
        },
      });
      const message: Message = phase === "key-import"
        ? {
          ...original,
          keys: [{ keyId: sender.keyId.href, privateKey: { kty: "invalid" } }],
        }
        : {
          type: "fanout",
          id: original.id,
          baseUrl: original.baseUrl,
          keys: [],
          inboxes: {},
          activity: {
            "@context": "https://www.w3.org/ns/activitystreams",
            type: "Person",
          },
          activityType: Create.typeId.href,
          traceContext: {},
          provenance: original.provenance,
        };
      let outward: unknown;
      await rejects(
        federation.processQueuedTask(undefined, message),
        (error: unknown) => {
          outward = error;
          return true;
        },
      );
      strictEqual(reports.length, 1);
      const report = reports[0];
      strictEqual(report.attemptsStarted, 0);
      deepStrictEqual(report.result, {
        type: "preparation-failed",
        failure: { kind: "local", phase, error: outward },
        error: outward,
      });
      deepStrictEqual(report.provenance, original.provenance);
      strictEqual(
        loaderCalls,
        mode === "non-error" ? 1 : phase === "key-import" ? 0 : 2,
      );
      if (phase === "activity-parsing") {
        strictEqual(report.role, "fanout");
        strictEqual(report.delivery, undefined);
      }
    });
  }
});

test("outbound worker reports distinguish fanout child tasks from concrete sends", async (t) => {
  for (const queued of [false, true]) {
    await t.step(queued ? "child outbox tasks" : "direct sends", async () => {
      const fanouts: Message[] = [];
      const children: Message[] = [];
      const queue = (messages: Message[]): MessageQueue => ({
        enqueue(message) {
          messages.push(message);
          return Promise.resolve();
        },
        listen: () => Promise.resolve(),
      });
      const federation = createFederation<{ label: string }>({
        kv: new MemoryKvStore(),
        allowPrivateAddress: true,
        manuallyStartQueue: true,
        queue: {
          fanout: queue(fanouts),
          ...(queued ? { outbox: queue(children) } : {}),
        },
      });
      const reports: OutboundWorkerReport[] = [];
      const contexts: unknown[] = [];
      federation.setOutboundObservers({
        onWorker(ctx, report) {
          reports.push(report);
          contexts.push(ctx.data);
        },
      });
      const ctx = federation.createContext(new URL("https://example.com"), {
        label: "producer",
      });
      const targets = [
        recipient,
        recipient.clone({ inbox: new URL("https://receiver.example/second") }),
      ];
      await ctx.sendActivity(sender, targets, activity, {
        fanout: "force",
        dispatchId: "original invocation",
      });
      strictEqual(reports.length, 0);
      const task = fanouts[0];
      ok(task?.type === "fanout");
      const data = { label: "fanout worker" };
      fetchMock.mockGlobal().post(recipient.inboxId!.href, 202).post(
        "https://receiver.example/second",
        202,
      );
      try {
        await federation.processQueuedTask(data, task);
        strictEqual(reports.length, 1);
        strictEqual(reports[0].role, "fanout");
        strictEqual(reports[0].delivery, undefined);
        strictEqual(reports[0].attemptsStarted, queued ? 0 : 2);
        strictEqual(children.length, queued ? 2 : 0);
        strictEqual(reports[0].actions.length, 2);
        for (const action of reports[0].actions) {
          strictEqual(action.type, queued ? "scheduled" : "handoff");
          ok(action.type === "scheduled" || action.type === "handoff");
          strictEqual(action.action, queued ? "enqueue" : "direct");
          const inbox = action.inboxUrls[0];
          strictEqual(action.delivery?.destinationInbox, inbox);
          deepStrictEqual(action.delivery?.broadcast, { type: "unknown" });
          ok(action.delivery?.deliveryId);
          if (action.type === "scheduled") {
            const child = children.find((child) =>
              child.id === action.queue.queueMessageId
            );
            ok(child?.type === "outbox");
            deepStrictEqual(action.delivery, child.outbound);
          }
          ok(Object.isFrozen(action));
          ok(Object.isFrozen(action.inboxUrls));
          ok(Object.isFrozen(action.delivery));
        }
        deepStrictEqual(reports[0].queue, { queueMessageId: task.id });
        deepStrictEqual(reports[0].result, { type: "completed" });
        strictEqual(reports[0].provenance.dispatchId, "original invocation");
        deepStrictEqual(contexts, [data]);
      } finally {
        fetchMock.hardReset();
      }
    });
  }
});

test("outbound worker callbacks retain selection, await settlement, and isolate logging failures", async () => {
  let logs = 0;
  await configure({
    reset: true,
    sinks: {
      broken() {
        logs++;
        throw new Error("logging failure");
      },
    },
    loggers: [{
      category: ["fedify", "federation", "outbox"],
      sinks: ["broken"],
      lowestLevel: "error",
    }, { category: ["logtape", "meta"], sinks: [] }],
  });
  let respond!: () => void;
  const responseGate = new Promise<void>((resolve) => {
    respond = resolve;
  });
  let fetched!: () => void;
  const fetching = new Promise<void>((resolve) => {
    fetched = resolve;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const observing = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let replacements = 0;
  let settled = false;
  const reports: OutboundWorkerReport[] = [];
  const federation = createFederation<void>({
    kv: new MemoryKvStore(),
    allowPrivateAddress: true,
  });
  federation.setOutboundObservers({
    async onWorker(_ctx, report) {
      reports.push(report);
      entered();
      await gate;
      throw new Error("observer failure");
    },
  });
  const message = continuationMessage(recipient.inboxId!.href, false);
  fetchMock.mockGlobal().post(message.inbox, async () => {
    fetched();
    await responseGate;
    return 202;
  });
  const processing = federation.processQueuedTask(undefined, message).finally(
    () => {
      settled = true;
    },
  );
  try {
    await fetching;
    federation.setOutboundObservers({
      onWorker() {
        replacements++;
      },
    });
    respond();
    await observing;
    strictEqual(settled, false);
    release();
    await processing;
    strictEqual(reports.length, 1);
    strictEqual(replacements, 0);
    strictEqual(logs, 1);
    deepStrictEqual(reports[0].delivery, {
      broadcast: { type: "unknown" },
      deliveryId: message.id,
    });
  } finally {
    respond();
    release();
    await processing;
    fetchMock.hardReset();
    await reset();
  }
});

test("outbound worker failure after a completed sender does not rewrite its attempt", async () => {
  const [meterProvider] = createTestMeterProvider();
  const federation = createFederation<void>({
    kv: new MemoryKvStore(),
    allowPrivateAddress: true,
    meterProvider,
  });
  ok(federation instanceof FederationImpl);
  const metrics = federation.metrics;
  const original = metrics.recordQueueTaskOutcome;
  const failure = Symbol("worker bookkeeping after sender settlement");
  Object.defineProperty(metrics, "recordQueueTaskOutcome", {
    configurable: true,
    value: (...args: Parameters<typeof original>) => {
      original.call(metrics, ...args);
      throw failure;
    },
  });
  const attempts: OutboundAttemptReport[] = [];
  const workers: OutboundWorkerReport[] = [];
  const contexts: unknown[] = [];
  federation.setOutboundObservers({
    onAttempt(ctx, report) {
      attempts.push(report);
      contexts.push(ctx);
    },
    onWorker(ctx, report) {
      workers.push(report);
      contexts.push(ctx);
    },
  });
  const message = continuationMessage(recipient.inboxId!.href, true);
  fetchMock.mockGlobal().post(message.inbox, 202);
  try {
    await rejects(
      federation.processQueuedTask(undefined, message),
      (error: unknown) => error === failure,
    );
    strictEqual(attempts.length, 1);
    strictEqual(attempts[0].outcome.type, "succeeded");
    strictEqual(workers.length, 1);
    strictEqual(workers[0].attemptsStarted, 1);
    deepStrictEqual(workers[0].result, { type: "failed", error: failure });
    strictEqual(contexts[0], contexts[1]);
  } finally {
    Object.defineProperty(metrics, "recordQueueTaskOutcome", {
      value: original,
    });
    fetchMock.hardReset();
  }
});

test("outbound worker attempts restore current context without creating loaders", async () => {
  const federation = createFederation<{ label: string }>({
    kv: new MemoryKvStore(),
    allowPrivateAddress: true,
  });
  let loads = 0;
  const unexpectedLoader = () => {
    loads++;
    throw new Error("observation must not create loaders");
  };
  Object.defineProperties(federation, {
    documentLoaderFactory: { value: unexpectedLoader },
    contextLoaderFactory: { value: unexpectedLoader },
  });
  const message = continuationMessage(recipient.inboxId!.href, true);
  const data = { label: "current worker" };
  const reports: OutboundAttemptReport[] = [];
  const contexts: unknown[] = [];
  federation.setOutboundObservers({
    onAttempt(ctx, report) {
      reports.push(report);
      contexts.push(ctx.data, ctx.clone(data).data);
      throw new Error("worker observer failure must be isolated");
    },
  });
  fetchMock.mockGlobal().post(message.inbox, 202);
  try {
    await federation.processQueuedTask(data, structuredClone(message));
    strictEqual(loads, 0);
    deepStrictEqual(contexts, [data, data]);
    strictEqual(reports.length, 1);
    deepStrictEqual(reports[0].provenance, message.provenance);
    strictEqual(reports[0].local.origin, new URL(message.baseUrl).origin);
    deepStrictEqual(reports[0].queue, {
      queueMessageId: message.id,
      queueAttempt: 0,
    });
    strictEqual(reports[0].outcome.type, "succeeded");
  } finally {
    fetchMock.hardReset();
  }
});

test("outbound fanout workers report fresh attempts with restored grouping and current data", async (t) => {
  for (const legacy of [false, true]) {
    await t.step(legacy ? "legacy fanout" : "populated identity", async () => {
      const messages: Message[] = [];
      const [tracerProvider, exporter] = createTestTracerProvider();
      const federation = createFederation<{ label: string }>({
        kv: new MemoryKvStore(),
        allowPrivateAddress: true,
        tracerProvider,
        manuallyStartQueue: true,
        queue: {
          fanout: {
            enqueue(message) {
              messages.push(message);
              return Promise.resolve();
            },
            listen: () => Promise.resolve(),
          },
        },
      });
      if (!legacy) federation.setOutboundObservers({ onBroadcast() {} });
      const ctx = federation.createContext(new URL("https://example.com"), {
        label: "producer",
      });
      await ctx.sendActivity(sender, recipient, activity, {
        fanout: "force",
        dispatchId: "original-dispatch",
      });
      const message = messages[0];
      ok(message?.type === "fanout");
      const identity = message.inboxes[recipient.inboxId!.href].outbound;
      strictEqual(identity == null, legacy);
      const reports: OutboundAttemptReport[] = [];
      const contexts: unknown[] = [];
      const data = { label: "worker" };
      federation.setOutboundObservers({
        onAttempt(context, report) {
          reports.push(report);
          contexts.push(context.data);
        },
      });
      fetchMock.mockGlobal().post(recipient.inboxId!.href, 202);
      try {
        await federation.processQueuedTask(data, structuredClone(message));
        await federation.processQueuedTask(data, structuredClone(message));
        strictEqual(reports.length, 2);
        deepStrictEqual(contexts, [data, data]);
        notStrictEqual(reports[0].attemptId, reports[1].attemptId);
        strictEqual(reports[0].deliveryId, reports[1].deliveryId);
        if (identity != null) {
          strictEqual(reports[0].deliveryId, identity.deliveryId);
        }
        for (const report of reports) {
          strictEqual(report.destinationInbox, recipient.inboxId!.href);
          deepStrictEqual(
            report.broadcast,
            identity?.broadcast ?? { type: "unknown" },
          );
          strictEqual(report.provenance.dispatchId, "original-dispatch");
          deepStrictEqual(report.queue, { queueMessageId: message.id });
          const span = exporter.spans.find((span) =>
            span.spanContext().spanId === report.trace?.spanId
          );
          ok(span);
          strictEqual(span.name, "activitypub.send_activity");
        }
      } finally {
        fetchMock.hardReset();
        await tracerProvider.shutdown();
      }
    });
  }
});

test("outbound workers omit attempts for key import, fanout parsing, and held-task drops", async (t) => {
  for (
    const phase of [
      "key-import",
      "fanout-parsing",
      "drop",
      "gateway-drop",
    ] as const
  ) {
    await t.step(phase, async () => {
      const messages: Message[] = [];
      const federation = createFederation<void>({
        kv: new MemoryKvStore(),
        allowPrivateAddress: true,
        manuallyStartQueue: true,
        circuitBreaker: { heldActivityTtl: { seconds: 1 } },
        queue: {
          outbox: {
            enqueue(message) {
              messages.push(message);
              return Promise.resolve();
            },
            listen: () => Promise.resolve(),
          },
        },
      });
      const attempts: OutboundAttemptReport[] = [];
      federation.setOutboundObservers({
        onAttempt(_ctx, report) {
          attempts.push(report);
        },
      });
      const original = continuationMessage(recipient.inboxId!.href, true);
      const message: Message = phase === "fanout-parsing"
        ? {
          type: "fanout",
          id: original.id,
          baseUrl: original.baseUrl,
          keys: [],
          inboxes: { [original.inbox]: { actorIds: [], sharedInbox: false } },
          activity: {
            "@context": "https://www.w3.org/ns/activitystreams",
            type: "Person",
          },
          activityType: Create.typeId.href,
          traceContext: {},
        }
        : phase === "key-import"
        ? {
          ...original,
          keys: [{ keyId: sender.keyId.href, privateKey: { kty: "invalid" } }],
        }
        : {
          ...original,
          circuitHeld: true,
          circuitHeldSince: "2000-01-01T00:00:00Z",
          ...(phase === "gateway-drop"
            ? {
              gatewayInboxes: [original.inbox, "https://gateway.example/inbox"],
            }
            : {}),
        };
      fetchMock.mockGlobal();
      try {
        const processing = federation.processQueuedTask(undefined, message);
        if (phase === "key-import" || phase === "fanout-parsing") {
          await rejects(processing);
        } else await processing;
        strictEqual(attempts.length, 0);
        strictEqual(fetchMock.callHistory.calls().length, 0);
        strictEqual(messages.length, 0);
      } finally {
        fetchMock.hardReset();
      }
    });
  }
});

test("outbound queue identities survive ordinary retries, holds, and native redelivery", async (t) => {
  for (const observed of [false, true]) {
    for (const mode of ["retry", "hold", "retry-after", "native"] as const) {
      await t.step(`${mode}: ${observed ? "identity" : "legacy"}`, async () => {
        const queued: {
          message: Message;
          options: Parameters<MessageQueue["enqueue"]>[1];
        }[] = [];
        const federation = createFederation<void>({
          kv: new MemoryKvStore(),
          manuallyStartQueue: true,
          allowPrivateAddress: true,
          circuitBreaker: mode === "hold"
            ? { failureThreshold: 1, recoveryDelay: { hours: 1 } }
            : false,
          queue: {
            outbox: {
              nativeRetrial: mode === "native",
              enqueue(message, options) {
                queued.push({ message, options });
                return Promise.resolve();
              },
              listen: () => Promise.resolve(),
            },
          },
        });
        const message = continuationMessage(recipient.inboxId!.href, observed);
        const attempts: OutboundAttemptReport[] = [];
        federation.setOutboundObservers({
          onAttempt(_ctx, report) {
            attempts.push(report);
          },
        });
        const original = structuredClone(message);
        const task: OutboxMessage = JSON.parse(JSON.stringify(message));
        fetchMock.mockGlobal().post(
          message.inbox,
          mode === "retry-after"
            ? { status: 429, headers: { "Retry-After": "3600" } }
            : 500,
        );
        try {
          if (mode === "native") {
            await rejects(
              federation.processQueuedTask(
                undefined,
                task,
              ),
            );
            strictEqual(queued.length, 0);
            fetchMock.hardReset();
            fetchMock.mockGlobal().post(message.inbox, 202);
            deepStrictEqual(task, original);
            const redelivery = {
              ...structuredClone(task),
              id: crypto.randomUUID(),
            };
            await federation.processQueuedTask(undefined, redelivery);
            deepStrictEqual(redelivery.outbound, original.outbound);
            strictEqual("outbound" in redelivery, observed);
            ok(fetchMock.callHistory.calls().length > 0);
            strictEqual(queued.length, 0);
          } else {
            await federation.processQueuedTask(
              undefined,
              task,
            );
            strictEqual(queued.length, 1);
            const next = queued[0].message;
            ok(next.type === "outbox");
            deepStrictEqual(next.outbound, original.outbound);
            deepStrictEqual(next.provenance, original.provenance);
            strictEqual("provenance" in next, observed);
            strictEqual("outbound" in next, observed);
            strictEqual(next.attempt, mode === "hold" ? 0 : 1);
            strictEqual(next.circuitHeld, mode === "hold" ? true : undefined);
            strictEqual(queued[0].options?.orderingKey, message.orderingKey);
            ok(queued[0].options?.delay);
            const requests = fetchMock.callHistory.calls().length;
            await federation.processQueuedTask(undefined, {
              ...structuredClone(next),
              id: crypto.randomUUID(),
            });
            strictEqual(queued.length, 2);
            const replay = queued[1].message;
            ok(replay.type === "outbox");
            deepStrictEqual(replay.outbound, original.outbound);
            deepStrictEqual(replay.provenance, original.provenance);
            strictEqual("provenance" in replay, observed);
            strictEqual("outbound" in replay, observed);
            strictEqual(replay.attempt, mode === "hold" ? 0 : 2);
            if (mode === "hold") {
              strictEqual(fetchMock.callHistory.calls().length, requests);
            }
          }
          strictEqual(attempts.length, mode === "hold" ? 1 : 2);
          strictEqual(
            new Set(attempts.map((report) => report.attemptId)).size,
            attempts.length,
          );
          for (const report of attempts) {
            strictEqual(
              report.destinationInbox,
              original.outbound?.destinationInbox,
            );
            deepStrictEqual(
              report.broadcast,
              original.outbound?.broadcast ?? { type: "unknown" },
            );
            strictEqual(
              report.provenance.dispatchId,
              original.provenance?.dispatchId,
            );
            deepStrictEqual(
              report.provenance.inboxRequest,
              original.provenance?.inboxRequest,
            );
            strictEqual(report.local.origin, new URL(message.baseUrl).origin);
            ok(report.queue);
            strictEqual(
              report.deliveryId,
              observed
                ? original.outbound!.deliveryId
                : report.queue.queueMessageId,
            );
            ok(Object.isFrozen(report.queue));
          }
          strictEqual(attempts[0].queue?.queueAttempt, 0);
          if (mode !== "hold") {
            strictEqual(
              attempts[1].queue?.queueAttempt,
              mode === "native" ? 0 : 1,
            );
          }
          deepStrictEqual(task, original);
          deepStrictEqual(message, original);
        } finally {
          fetchMock.hardReset();
        }
      });
    }
  }
});

test("outbound queue identities retain planned destinations through gateway continuations", async (t) => {
  const gateways = [
    "https://gw1.example/inbox",
    "https://gw2.example/inbox",
    "https://gw3.example/inbox",
  ];
  const portableInbox = "ap+ef61://z6Mktest/inbox";
  for (const observed of [false, true]) {
    for (const mode of ["retry", "hold", "defer", "native"] as const) {
      await t.step(`${mode}: ${observed ? "identity" : "legacy"}`, async () => {
        const queued: Message[] = [];
        const enqueueOptions: Parameters<MessageQueue["enqueue"]>[1][] = [];
        const workers: OutboundWorkerReport[] = [];
        const federation = createFederation<void>({
          kv: new MemoryKvStore(),
          manuallyStartQueue: true,
          allowPrivateAddress: true,
          circuitBreaker: mode === "hold"
            ? { failureThreshold: 1, recoveryDelay: { hours: 1 } }
            : false,
          queue: {
            outbox: {
              nativeRetrial: mode === "native",
              enqueue(message, options) {
                queued.push(message);
                enqueueOptions.push(options);
                return Promise.resolve();
              },
              listen: () => Promise.resolve(),
            },
          },
        });
        const message = {
          ...continuationMessage(gateways[0], observed, portableInbox),
          gatewayInboxes: gateways,
        };
        const attempts: OutboundAttemptReport[] = [];
        federation.setOutboundObservers({
          onWorker(_ctx, report) {
            workers.push(report);
          },
          onAttempt(_ctx, report) {
            attempts.push(report);
          },
        });
        const original = structuredClone(message);
        const task: OutboxMessage = JSON.parse(JSON.stringify(message));
        fetchMock.mockGlobal();
        for (const [index, inbox] of gateways.entries()) {
          fetchMock.post(
            inbox,
            mode !== "native" && index === 0
              ? 404
              : mode === "defer"
              ? { status: 429, headers: { "Retry-After": "3600" } }
              : 500,
          );
        }
        try {
          if (mode === "native") {
            await rejects(
              federation.processQueuedTask(
                undefined,
                task,
              ),
            );
            strictEqual(queued.length, 0);
            fetchMock.hardReset();
            fetchMock.mockGlobal().post(gateways[0], 202);
            deepStrictEqual(task, original);
            const redelivery = {
              ...structuredClone(task),
              id: crypto.randomUUID(),
            };
            await federation.processQueuedTask(undefined, redelivery);
            deepStrictEqual(redelivery.outbound, original.outbound);
            strictEqual("outbound" in redelivery, observed);
            ok(fetchMock.callHistory.calls().length > 0);
            strictEqual(queued.length, 0);
          } else {
            await federation.processQueuedTask(
              undefined,
              task,
            );
            strictEqual(queued.length, 1);
            const next = queued[0];
            ok(next.type === "outbox");
            strictEqual(next.inbox, gateways[1]);
            deepStrictEqual(next.gatewayInboxes, gateways.slice(1));
            deepStrictEqual(next.outbound, original.outbound);
            deepStrictEqual(next.provenance, original.provenance);
            strictEqual("provenance" in next, observed);
            strictEqual("outbound" in next, observed);
            strictEqual(next.portableInbox, portableInbox);
            if (observed) {
              strictEqual(next.outbound?.destinationInbox, gateways[0]);
            }
            strictEqual(next.attempt, mode === "hold" ? 0 : 1);
            strictEqual(next.circuitHeld, mode === "hold" ? true : undefined);
            if (mode === "defer") {
              deepStrictEqual(
                Object.keys(next.gatewayNotBefore ?? {}),
                gateways.slice(1),
              );
            }
            const requests = fetchMock.callHistory.calls().length;
            await federation.processQueuedTask(undefined, {
              ...structuredClone(next),
              id: crypto.randomUUID(),
            });
            strictEqual(queued.length, 2);
            const replay = queued[1];
            ok(replay.type === "outbox");
            deepStrictEqual(replay.outbound, original.outbound);
            deepStrictEqual(replay.provenance, original.provenance);
            strictEqual("provenance" in replay, observed);
            strictEqual("outbound" in replay, observed);
            strictEqual(replay.inbox, gateways[1]);
            strictEqual(replay.attempt, mode === "retry" ? 2 : next.attempt);
            if (mode !== "retry") {
              strictEqual(fetchMock.callHistory.calls().length, requests);
            }
          }
          strictEqual(
            attempts.length,
            mode === "native" ? 4 : mode === "retry" ? 5 : 3,
          );
          strictEqual(
            new Set(attempts.map((report) => report.attemptId)).size,
            attempts.length,
          );
          for (const report of attempts) {
            strictEqual(
              report.destinationInbox,
              original.outbound?.destinationInbox,
            );
            deepStrictEqual(
              report.broadcast,
              original.outbound?.broadcast ?? { type: "unknown" },
            );
            strictEqual(
              report.provenance.dispatchId,
              original.provenance?.dispatchId,
            );
            deepStrictEqual(
              report.provenance.inboxRequest,
              original.provenance?.inboxRequest,
            );
            strictEqual(report.local.origin, new URL(message.baseUrl).origin);
            ok(report.queue);
            strictEqual(
              report.deliveryId,
              observed
                ? original.outbound!.deliveryId
                : report.queue.queueMessageId,
            );
            ok(Object.isFrozen(report.queue));
          }
          strictEqual(attempts[0].queue?.queueAttempt, 0);
          deepStrictEqual(
            attempts.slice(0, 3).map((report) => report.inboxUrl),
            gateways,
          );
          for (const report of attempts) {
            strictEqual(report.portableInbox, portableInbox);
          }
          if (mode === "retry") {
            deepStrictEqual(
              attempts.slice(3).map((report) => report.inboxUrl),
              gateways.slice(1),
            );
            strictEqual(attempts[3].queue?.queueAttempt, 1);
          }
          strictEqual(workers.length, 2);
          for (const [index, report] of workers.entries()) {
            if (mode === "native") {
              deepStrictEqual(report.actions, []);
              strictEqual(
                report.result.type,
                index === 0 ? "failed" : "completed",
              );
              strictEqual(report.attemptsStarted, index === 0 ? 3 : 1);
              continue;
            }
            const actions = report.actions;
            ok(actions);
            if (index === 0) {
              deepStrictEqual(actions[0], {
                type: "abandoned",
                reason: "permanent-failure",
                inboxUrls: [gateways[0]],
              });
            }
            strictEqual(actions.length, index === 0 ? 2 : 1);
            const action = actions.at(-1)!;
            ok(action.type === "scheduled");
            const task = queued[index];
            ok(task.type === "outbox");
            strictEqual(
              action.action,
              mode === "hold" || index === 1 && mode === "defer"
                ? "defer"
                : "retry",
            );
            deepStrictEqual(action.inboxUrls, gateways.slice(1));
            deepStrictEqual(action.queue, {
              queueMessageId: task.id,
              queueAttempt: task.attempt,
            });
            ok(action.action === "retry" || action.action === "defer");
            strictEqual(action.delay, enqueueOptions[index]?.delay?.toString());
            deepStrictEqual(action.notBefore, task.gatewayNotBefore);
            if (action.notBefore != null) ok(Object.isFrozen(action.notBefore));
            strictEqual(
              report.attemptsStarted,
              index === 0 ? 3 : mode === "retry" ? 2 : 0,
            );
            deepStrictEqual(report.result, { type: "completed" });
          }
          deepStrictEqual(task, original);
          deepStrictEqual(message, original);
        } finally {
          fetchMock.hardReset();
        }
      });
    }
  }
});

test("fanout worker actions retain child enqueue settlement and replay identities", async (t) => {
  for (
    const mode of [
      "individual",
      "partial",
      "batch",
      "batch-rejected",
      "ordered",
      "bookkeeping",
    ] as const
  ) {
    await t.step(mode, async () => {
      const fanouts: Message[] = [];
      const submitted: OutboxMessage[] = [];
      const accepted: OutboxMessage[] = [];
      const reports: OutboundWorkerReport[] = [];
      const broadcasts: OutboundBroadcastEvent[] = [];
      const failure = Symbol(mode);
      const [meterProvider] = createTestMeterProvider();
      let batches = 0;
      const outbox: MessageQueue = {
        enqueue(message) {
          ok(message.type === "outbox");
          submitted.push(message);
          if (
            mode === "partial" && reports.length === 0 &&
            message.inbox.endsWith("/second")
          ) {
            return Promise.reject(failure);
          }
          accepted.push(message);
          return Promise.resolve();
        },
        listen: () => Promise.resolve(),
      };
      if (["batch", "batch-rejected", "ordered"].includes(mode)) {
        outbox.enqueueMany = (messages) => {
          batches++;
          for (const message of messages) {
            ok(message.type === "outbox");
            submitted.push(message);
          }
          // A rejected batch may already have accepted part of its input.
          accepted.push(
            ...submitted.slice(0, mode === "batch-rejected" ? 1 : 2),
          );
          return mode === "batch-rejected"
            ? Promise.reject(failure)
            : Promise.resolve();
        };
      }
      const federation = createFederation<void>({
        ...options,
        kv: new MemoryKvStore(),
        manuallyStartQueue: true,
        meterProvider,
        queue: {
          fanout: {
            enqueue(message) {
              fanouts.push(message);
              return Promise.resolve();
            },
            listen: () => Promise.resolve(),
          },
          outbox,
        },
      });
      federation.setOutboundObservers({
        onBroadcast(_ctx, event) {
          broadcasts.push(event);
        },
        onWorker(_ctx, report) {
          reports.push(report);
        },
      });
      await federation.createContext(new URL("https://example.com"), undefined)
        .sendActivity(
          sender,
          [
            recipient,
            recipient.clone({
              inbox: new URL("https://receiver.example/second"),
            }),
          ],
          activity,
          {
            fanout: "force",
            ...(mode === "ordered" ? { orderingKey: "conversation" } : {}),
          },
        );
      const task = fanouts[0];
      ok(task?.type === "fanout");
      const producerEvents = [...broadcasts];
      ok(federation instanceof FederationImpl);
      const metrics = federation.metrics;
      const original = metrics.recordQueueTaskEnqueued;
      if (mode === "bookkeeping") {
        Object.defineProperty(metrics, "recordQueueTaskEnqueued", {
          configurable: true,
          value: (...args: Parameters<typeof original>) => {
            original.call(metrics, ...args);
            throw failure;
          },
        });
      }
      try {
        for (
          let replay = 0;
          replay < (mode === "individual" || mode === "partial" ? 2 : 1);
          replay++
        ) {
          submitted.length = 0;
          accepted.length = 0;
          const processing = federation.processQueuedTask(
            undefined,
            structuredClone(task),
          );
          const rejected = mode === "partial" && replay === 0 ||
            mode === "batch-rejected" || mode === "bookkeeping";
          if (rejected) {
            await rejects(
              processing,
              (error: unknown) =>
                mode === "bookkeeping"
                  ? error instanceof AggregateError &&
                    error.errors.every((item) => item === failure)
                  : error === failure,
            );
          } else await processing;
          const report = reports[replay];
          strictEqual(report.result.type, rejected ? "failed" : "completed");
          strictEqual(report.attemptsStarted, 0);
          strictEqual(report.delivery, undefined);
          strictEqual(report.actions.length, 2);
          strictEqual(submitted.length, 2);
          strictEqual(
            accepted.length,
            mode === "partial" && replay === 0 || mode === "batch-rejected"
              ? 1
              : 2,
          );
          for (const child of submitted) {
            const action = report.actions.find((action) =>
              "queue" in action && action.queue.queueMessageId === child.id
            );
            ok(
              action?.type === "scheduled" || action?.type === "action-failed",
            );
            ok(action.action === "enqueue");
            deepStrictEqual(action.queue, {
              queueMessageId: child.id,
              queueAttempt: 0,
            });
            deepStrictEqual(action.inboxUrls, [child.inbox]);
            deepStrictEqual(
              action.delivery,
              task.inboxes[child.inbox].outbound,
            );
            deepStrictEqual(action.delivery, child.outbound);
            strictEqual("delay" in action, false);
            strictEqual(
              action.type,
              mode === "batch-rejected" ||
                mode === "partial" && replay === 0 &&
                  child.inbox.endsWith("/second")
                ? "action-failed"
                : "scheduled",
            );
            if (action.type === "action-failed") {
              strictEqual(action.acceptance, "unknown");
              strictEqual(action.error, failure);
            }
            if (replay > 0) {
              const earlier = reports[0].actions.find((earlier) =>
                "delivery" in earlier &&
                earlier.delivery?.destinationInbox === child.inbox
              );
              ok(
                (earlier?.type === "scheduled" ||
                  earlier?.type === "action-failed") &&
                  earlier.action === "enqueue",
              );
              notStrictEqual(
                action.queue.queueMessageId,
                earlier.queue.queueMessageId,
              );
              deepStrictEqual(action.delivery, earlier.delivery);
            }
          }
          deepStrictEqual(broadcasts, producerEvents);
        }
        strictEqual(
          batches,
          mode === "batch" || mode === "batch-rejected" ? 1 : 0,
        );
      } finally {
        if (mode === "bookkeeping") {
          Object.defineProperty(metrics, "recordQueueTaskEnqueued", {
            configurable: true,
            value: original,
          });
        }
      }
    });
  }
});

test("fanout worker actions preserve earlier direct entries across later setup failure", async (t) => {
  for (const queued of [false, true]) {
    await t.step(
      queued
        ? "prepare all children before enqueue"
        : "earlier send still settles",
      async () => {
        const fanouts: Message[] = [];
        const children: Message[] = [];
        const reports: OutboundWorkerReport[] = [];
        const attempts: OutboundAttemptReport[] = [];
        const broadcasts: OutboundBroadcastEvent[] = [];
        const queue = (messages: Message[]): MessageQueue => ({
          enqueue(message) {
            messages.push(message);
            return Promise.resolve();
          },
          listen: () => Promise.resolve(),
        });
        const federation = createFederation<void>({
          kv: new MemoryKvStore(),
          allowPrivateAddress: true,
          manuallyStartQueue: true,
          queue: {
            fanout: queue(fanouts),
            ...(queued ? { outbox: queue(children) } : {}),
          },
        });
        federation.setOutboundObservers({
          onBroadcast(_ctx, event) {
            broadcasts.push(event);
          },
          onWorker(_ctx, report) {
            reports.push(report);
          },
        });
        await federation.createContext(
          new URL("https://example.com"),
          undefined,
        )
          .sendActivity(
            sender,
            [
              recipient,
              recipient.clone({
                inbox: new URL("https://receiver.example/second"),
              }),
            ],
            activity,
            { fanout: "force" },
          );
        const originalTask = fanouts[0];
        ok(originalTask?.type === "fanout");
        const secondInbox = "https://receiver.example/second";
        const task: FanoutMessage = {
          ...originalTask,
          collectionSync: "https://example.com/followers",
          inboxes: {
            ...originalTask.inboxes,
            [secondInbox]: {
              ...originalTask.inboxes[secondInbox],
              actorIds: ["invalid actor URL"],
            },
          },
        };
        const producerEvents = [...broadcasts];
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        let observed!: () => void;
        const settled = new Promise<void>((resolve) => {
          observed = resolve;
        });
        federation.setOutboundObservers({
          onBroadcast(_ctx, event) {
            broadcasts.push(event);
          },
          onWorker(_ctx, report) {
            reports.push(report);
          },
          onAttempt(_ctx, report) {
            attempts.push(report);
            observed();
          },
        });
        fetchMock.mockGlobal().post(recipient.inboxId!.href, async () => {
          await gate;
          return 202;
        });
        try {
          let failure: unknown;
          await rejects(
            federation.processQueuedTask(undefined, task),
            (error: unknown) => {
              failure = error;
              return error instanceof TypeError;
            },
          );
          strictEqual(reports.length, 1);
          const report = reports[0];
          deepStrictEqual(report.result, {
            type: "preparation-failed",
            error: failure,
            failure: {
              kind: "local",
              phase: "request-preparation",
              error: failure,
            },
          });
          strictEqual(report.attemptsStarted, queued ? 0 : 1);
          strictEqual(children.length, 0);
          strictEqual(report.actions.length, queued ? 0 : 1);
          if (!queued) {
            const action = report.actions[0];
            ok(action.type === "handoff");
            strictEqual(action.action, "direct");
            deepStrictEqual(action.inboxUrls, [recipient.inboxId!.href]);
            deepStrictEqual(
              action.delivery,
              task.inboxes[recipient.inboxId!.href].outbound,
            );
            strictEqual(attempts.length, 0);
            release();
            await settled;
            strictEqual(attempts.length, 1);
            strictEqual(attempts[0].outcome.type, "succeeded");
            strictEqual(reports.length, 1);
          }
          deepStrictEqual(broadcasts, producerEvents);
        } finally {
          release();
          fetchMock.hardReset();
        }
      },
    );
  }
});

test("outbound header policies validate atomically and copy registration", async () => {
  const builder = createFederationBuilder<void>();
  ok(builder instanceof FederationBuilderImpl);
  const allow = ["X-Safe", "x-safe", "Content-Type"];
  const redact = ["X-Custom-Secret"];
  const policy = { allow, redact, maxBytes: 128 };
  const callback = () => {};
  builder.setOutboundObservers({
    requestHeaders: policy,
    onHttpExchange: callback,
  });
  const original = builder.outboundObservers;
  deepStrictEqual(original.requestHeaders, {
    allow: ["content-type", "x-safe"],
    redact: ["x-custom-secret"],
    maxBytes: 128,
  });
  ok(Object.isFrozen(original.requestHeaders));
  ok(Object.isFrozen(original.requestHeaders?.allow));
  ok(Object.isFrozen(original.requestHeaders?.redact));
  allow.push("authorization");
  redact.length = 0;
  policy.maxBytes = 1;
  const invalid = [
    [{ allow: ["safe"], maxBytes: 0 }, RangeError],
    [{ allow: ["safe"], maxBytes: -1 }, RangeError],
    [{ allow: ["safe"], maxBytes: 1.5 }, RangeError],
    [{ allow: ["safe"], maxBytes: Infinity }, RangeError],
    [{ allow: ["safe"], maxBytes: NaN }, RangeError],
    [{ allow: ["safe"], maxBytes: Number.MAX_SAFE_INTEGER + 1 }, RangeError],
    [{ allow: ["safe"] }, TypeError],
    [{ allow: ["safe"], maxBytes: "128" }, TypeError],
    [{ allow: ["*"], maxBytes: 128 }, TypeError],
    [{ allow: ["x-foo\nsecret"], maxBytes: 128 }, TypeError],
    [{ allow: ["ümlaut"], maxBytes: 128 }, TypeError],
    [{ allow: "x-safe", maxBytes: 128 }, TypeError],
    [{ allow: [12], maxBytes: 128 }, TypeError],
    [{ allow: [], redact: null, maxBytes: 128 }, TypeError],
    [null, TypeError],
  ] as const;
  for (const [value, error] of invalid) {
    throws(() =>
      builder.setOutboundObservers({
        requestHeaders: { allow: [], maxBytes: 1 },
        responseHeaders: value as never,
      }), error);
    strictEqual(builder.outboundObservers, original);
  }
  const federation = await builder.build(options);
  ok(federation instanceof FederationImpl);
  deepStrictEqual(
    federation.outboundObservers.requestHeaders,
    original.requestHeaders,
  );
  builder.setOutboundObservers({});
  strictEqual(federation.outboundObservers.onHttpExchange, callback);
  const registration = federation.outboundObservers;
  throws(
    () =>
      federation.setOutboundObservers({
        requestHeaders: { allow: [], maxBytes: 0 },
      }),
    RangeError,
  );
  strictEqual(federation.outboundObservers, registration);
  federation.setOutboundObservers({});
  strictEqual(federation.outboundObservers.requestHeaders, undefined);
});

test("outbound header snapshots redact secrets and budget complete UTF-8 entries", () => {
  const secrets = [
    "authorization",
    "proxy-authorization",
    "cookie",
    "set-cookie",
    "signature",
    "signature-input",
    "authentication-info",
    "proxy-authentication-info",
    "x-api-key",
    "x-auth-token",
  ];
  const headers = new Headers(secrets.map((name) => [name, "do-not-export"]));
  headers.append("X-Visible", "first");
  headers.append("x-visible", "second");
  headers.set("X-Custom", "also-secret");
  const policy = snapshotHeaderPolicy({
    allow: [...secrets, "X-Visible", "x-custom", "x-missing"],
    redact: ["X-Custom"],
    maxBytes: 4096,
  });
  ok(policy);
  const snapshot = snapshotHeaders(headers, policy);
  for (const [name, value] of snapshot.entries) {
    strictEqual(value, name === "x-visible" ? "first, second" : "[redacted]");
  }
  deepStrictEqual(
    snapshot.entries.map(([name]) => name),
    [...secrets, "x-visible", "x-custom"].sort(),
  );
  strictEqual(JSON.stringify(snapshot).includes("do-not-export"), false);
  strictEqual(JSON.stringify(snapshot).includes("also-secret"), false);
  ok(Object.isFrozen(snapshot));
  ok(Object.isFrozen(snapshot.entries));
  for (const entry of snapshot.entries) ok(Object.isFrozen(entry));
  headers.set("x-visible", "changed");
  strictEqual(
    snapshot.entries.find(([name]) => name === "x-visible")?.[1],
    "first, second",
  );
  const values = new Headers({ "a": "oversized value", "b": "é", "c": "z" });
  const capture = (maxBytes: number) =>
    snapshotHeaders(
      values,
      snapshotHeaderPolicy({ allow: ["c", "a", "b"], maxBytes })!,
    );
  // `b: é\r\n` is seven UTF-8 bytes; skip a large entry and keep considering later ones.
  deepStrictEqual(capture(7), { entries: [["b", "é"]], limitReached: true });
  deepStrictEqual(capture(6), { entries: [["c", "z"]], limitReached: true });
  deepStrictEqual(
    snapshotHeaders(
      new Headers({ b: "é" }),
      snapshotHeaderPolicy({ allow: ["b"], maxBytes: 7 })!,
    ),
    { entries: [["b", "é"]], limitReached: false },
  );
  deepStrictEqual(
    snapshotHeaders(values, snapshotHeaderPolicy({ allow: [], maxBytes: 1 })!),
    { entries: [], limitReached: false },
  );
  deepStrictEqual(
    snapshotHeaders(
      new Headers({ authorization: "very long secret" }),
      snapshotHeaderPolicy({ allow: ["authorization"], maxBytes: 27 })!,
    ),
    { entries: [["authorization", "[redacted]"]], limitReached: false },
  );
});

test("outbound header policies retain selected snapshots across unsigned redirects", async () => {
  const exchanges: OutboundHttpExchangeReport[] = [];
  const allow = ["X-Trace", "Content-Type", "Authorization"];
  const builder = createFederationBuilder<void>();
  let entered!: () => void;
  const observing = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  builder.setOutboundObservers({
    requestHeaders: { allow, maxBytes: 512 },
    responseHeaders: {
      allow: ["Location", "X-Reply", "Set-Cookie"],
      maxBytes: 512,
    },
    async onHttpExchange(_ctx, report) {
      exchanges.push(report);
      entered();
      await gate;
    },
  });
  const federation = await builder.build({
    kv: new MemoryKvStore(),
    allowPrivateAddress: true,
  });
  builder.setOutboundObservers({});
  const message = {
    ...continuationMessage(recipient.inboxId!.href, true),
    headers: {
      "X-Trace": "worker",
      "Authorization": "secret",
      "Content-Type": "application/activity+json",
    },
  };
  const next = new URL("/next", message.inbox).href;
  fetchMock.mockGlobal().post(message.inbox, {
    status: 303,
    headers: {
      Location: next,
      "X-Reply": "first",
      "Set-Cookie": "secret-cookie",
    },
  }).get(next, { status: 202, headers: { "X-Reply": "second" } });
  const processing = federation.processQueuedTask(undefined, message);
  try {
    await observing;
    allow.length = 0;
    federation.setOutboundObservers({
      onHttpExchange() {
        throw new Error("replacement must not run");
      },
    });
    release();
    await processing;
    strictEqual(exchanges.length, 2);
    for (const report of exchanges) {
      strictEqual(
        report.request.headers?.entries.find(([name]) =>
          name === "authorization"
        )?.[1],
        "[redacted]",
      );
      strictEqual(
        report.request.headers?.entries.find(([name]) => name === "x-trace")
          ?.[1],
        "worker",
      );
      ok(report.outcome.type === "response");
      ok(Object.isFrozen(report.outcome.response.headers));
      strictEqual(JSON.stringify(report).includes("secret-cookie"), false);
    }
    strictEqual(exchanges[1].request.method, "GET");
    strictEqual(
      exchanges[1].request.headers?.entries.some(([name]) =>
        name === "content-type"
      ),
      false,
    );
    ok(
      exchanges[0].outcome.type === "response" &&
        exchanges[1].outcome.type === "response",
    );
    deepStrictEqual(exchanges[0].outcome.response.headers?.entries, [
      ["location", next],
      ["set-cookie", "[redacted]"],
      ["x-reply", "first"],
    ]);
    deepStrictEqual(exchanges[1].outcome.response.headers?.entries, [[
      "x-reply",
      "second",
    ]]);
  } finally {
    release();
    await processing;
    fetchMock.hardReset();
  }
});

test("outbound header snapshots follow signed challenge and redirect requests", async () => {
  const ctx = createFederation<void>(options).createContext(
    new URL("https://example.com"),
    undefined,
  );
  const exchanges: OutboundHttpExchangeReport[] = [];
  const observation = new OutboundBroadcastObservation(ctx, {
    requestHeaders: snapshotHeaderPolicy({
      allow: ["content-digest", "signature", "signature-input"],
      maxBytes: 1024,
    }),
    responseHeaders: snapshotHeaderPolicy({
      allow: ["accept-signature", "location"],
      maxBytes: 1024,
    }),
    onHttpExchange(_ctx, report) {
      exchanges.push(report);
    },
  }, "send");
  const inbox = recipient.inboxId!.href;
  const next = new URL("/next", inbox).href;
  await observation.planDestinations({
    [inbox]: { actorIds: [], sharedInbox: false },
  });
  const responses: ResponseInit[] = [
    {
      status: 401,
      headers: {
        "Accept-Signature":
          'sig1=("@method" "@target-uri");created;nonce="observer-nonce"',
      },
    },
    { status: 307, headers: { Location: next } },
    { status: 202 },
  ];
  const requests: Request[] = [];
  await sendConcreteActivity({
    observation: observation.delivery(inbox),
    activity: { id: "https://example.com/activity" },
    keys: [sender],
    inbox: new URL(inbox),
    specDeterminer: { determineSpec: () => "rfc9421", rememberSpec() {} },
  }, {
    openHop: (url) =>
      Promise.resolve({
        url: new URL(url),
        fetch(input) {
          ok(input instanceof Request);
          requests.push(input);
          return Promise.resolve(
            new Response(null, responses[requests.length - 1]),
          );
        },
        close: () => Promise.resolve(),
      }),
  });
  strictEqual(exchanges.length, 3);
  for (const [index, report] of exchanges.entries()) {
    const expected = Array.from(requests[index].headers).filter(([name]) =>
      ["content-digest", "signature", "signature-input"].includes(name)
    ).map((
      [name, value],
    ) => [name, name.startsWith("signature") ? "[redacted]" : value]);
    deepStrictEqual(report.request.headers?.entries, expected);
    strictEqual(report.request.headers?.limitReached, false);
    ok(requests[index].headers.has("signature"));
    ok(report.outcome.type === "response");
    strictEqual(report.outcome.response.status, responses[index].status);
  }
  strictEqual(exchanges[2].request.url, next);
  ok(exchanges[0].outcome.type === "response");
  strictEqual(
    exchanges[0].outcome.response.headers?.entries[0][0],
    "accept-signature",
  );
});

test("outbound header capture keeps each side independent and disabled by default", async (t) => {
  for (const mode of ["disabled", "request", "response", "empty"] as const) {
    await t.step(mode, async () => {
      const reports: OutboundHttpExchangeReport[] = [];
      const federation = createFederation<void>({
        kv: new MemoryKvStore(),
        allowPrivateAddress: true,
      });
      federation.setOutboundObservers({
        ...(mode === "request" || mode === "empty"
          ? {
            requestHeaders: {
              allow: mode === "empty" ? [] : ["x-request"],
              maxBytes: 128,
            },
          }
          : {}),
        ...(mode === "response"
          ? { responseHeaders: { allow: ["x-response"], maxBytes: 128 } }
          : {}),
        onHttpExchange(_ctx, report) {
          reports.push(report);
        },
      });
      const message = {
        ...continuationMessage(recipient.inboxId!.href, false),
        headers: { "X-Request": "request" },
      };
      fetchMock.mockGlobal().post(message.inbox, {
        status: 202,
        headers: { "X-Response": "response" },
      });
      try {
        await federation.processQueuedTask(undefined, message);
        strictEqual(reports.length, 1);
        const report = reports[0];
        ok(report.outcome.type === "response");
        deepStrictEqual(
          report.request.headers,
          mode === "request"
            ? { entries: [["x-request", "request"]], limitReached: false }
            : mode === "empty"
            ? { entries: [], limitReached: false }
            : undefined,
        );
        deepStrictEqual(
          report.outcome.response.headers,
          mode === "response"
            ? { entries: [["x-response", "response"]], limitReached: false }
            : undefined,
        );
      } finally {
        fetchMock.hardReset();
      }
    });
  }
});
