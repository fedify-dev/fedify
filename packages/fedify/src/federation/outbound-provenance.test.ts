import { mockDocumentLoader, test } from "@fedify/fixture";
import { Create, Note, Person } from "@fedify/vocab";
import {
  computeDigestMultibase,
  exportDidKey,
  parseIri,
} from "@fedify/vocab-runtime";
import {
  configure,
  getLogger,
  type LogRecord,
  reset,
  withContext,
} from "@logtape/logtape";
import fetchMock from "fetch-mock";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  deepStrictEqual,
  notStrictEqual,
  ok,
  rejects,
  strictEqual,
} from "node:assert/strict";
import { signObject } from "../sig/proof.ts";
import {
  ed25519Multikey,
  ed25519PrivateKey,
  ed25519PublicKey,
  rsaPrivateKey2,
  rsaPublicKey2,
} from "../testing/keys.ts";
import type { Context, RequestContext } from "./context.ts";
import type { InboxRequestReport } from "./inbox-report.ts";
import { MemoryKvStore } from "./kv.ts";
import { ContextImpl, createFederation } from "./middleware.ts";
import type {
  OutboundBroadcastEvent,
  OutboundDeliveryEvent,
  OutboundProvenance,
} from "./outbound-report.ts";
import type { Message } from "./queue.ts";
import type { MessageQueue } from "./mq.ts";

const sender = { keyId: rsaPublicKey2.id!, privateKey: rsaPrivateKey2 };
const outgoing = new Create({
  id: new URL("https://example.com/outgoing"),
  actor: new URL("https://example.com/person2"),
});
const target = new Person({
  id: new URL("https://remote.example/bob"),
  inbox: new URL("https://remote.example/inbox"),
});
const loaders = {
  documentLoaderFactory: () => mockDocumentLoader,
  contextLoaderFactory: () => mockDocumentLoader,
  authenticatedDocumentLoaderFactory: () => mockDocumentLoader,
};
function post(path: string, body: unknown) {
  return new Request(`https://inbox.example:8443${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/activity+json",
      "X-Request-Id": "shared-external-label",
    },
    body: JSON.stringify(body),
  });
}
async function payload() {
  return await new Create({
    id: new URL("https://example.com/incoming"),
    actor: new URL("https://example.com/person2"),
  }).toJsonLd({ contextLoader: mockDocumentLoader });
}

test("outbound inbox provenance follows clones, conversions, loaders, sends, and forwarding", async (t) => {
  for (const path of ["/users/alice/inbox", "/inbox"]) {
    await t.step(path, async () => {
      const reports: InboxRequestReport[] = [];
      const events: (OutboundBroadcastEvent | OutboundDeliveryEvent)[] = [];
      const messages: Message[] = [];
      let retained: Context<void> | undefined;
      const federation = createFederation<void>({
        ...loaders,
        kv: new MemoryKvStore(),
        origin: "https://canonical.example",
        skipSignatureVerification: true,
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
      federation.setOutboundObservers({
        onBroadcast(_ctx, event) {
          events.push(event);
        },
        onDelivery(_ctx, event) {
          events.push(event);
        },
      });
      federation.setActorDispatcher("/users/{identifier}", () => new Person({}))
        .setKeyPairsDispatcher(async (ctx) => {
          await ctx.sendActivity(sender, [], outgoing);
          return [];
        });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .setSharedKeyDispatcher(async (ctx) => {
          await ctx.sendActivity(sender, [], outgoing);
          return sender;
        })
        .on(Create, async (ctx) => {
          ok(ctx instanceof ContextImpl);
          const clone = ctx.clone(undefined);
          ok(clone instanceof ContextImpl);
          const outbox = clone.toOutboxContext(
            "alice",
            {},
            outgoing.id!.href,
            Create.typeId.href,
          );
          const inbox = outbox.toInboxContext(
            null,
            {},
            outgoing.id!.href,
            Create.typeId.href,
          ).clone(undefined);
          // All derived contexts share a URL object; historical source facts must not.
          ctx.url.host = "changed.example:9443";
          retained = inbox;
          await clone.sendActivity(sender, target, outgoing);
          await outbox.clone(undefined).sendActivity(sender, target, outgoing);
          await inbox.forwardActivity(sender, target, {
            skipIfUnsigned: false,
          });
        })
        .onRequestFinished(async (ctx, report) => {
          reports.push(report);
          await ctx.clone(undefined).sendActivity(sender, [], outgoing);
        });
      const body = await payload();
      for (let index = 0; index < 2; index++) {
        const start = events.length;
        strictEqual(
          (await federation.fetch(post(path, body), { contextData: undefined }))
            .status,
          202,
        );
        const report = reports[index];
        ok(report.inboxRequestId);
        strictEqual(report.requestId, "shared-external-label");
        const observed = events.slice(start);
        ok(observed.length > 0);
        for (const event of observed) {
          const source = event.provenance.inboxRequest;
          ok(source);
          strictEqual(source.inboxRequestId, report.inboxRequestId);
          strictEqual(source.requestId, report.requestId);
          deepStrictEqual(source.context, {
            origin: "https://inbox.example:8443",
            host: "inbox.example:8443",
            hostname: "inbox.example",
            canonicalOrigin: "https://canonical.example",
          });
          ok(Object.isFrozen(event.provenance));
          ok(Object.isFrozen(source));
          ok(Object.isFrozen(source.context));
          ok(Object.isFrozen(event.local));
        }
      }
      notStrictEqual(reports[0].inboxRequestId, reports[1].inboxRequestId);
      strictEqual(messages.length, 3); // The repeated Activity is an inbox duplicate.
      ok(events.some((event) => event.local.host === "changed.example:9443"));
      ok(events.some((event) => event.local.host === "inbox.example:8443"));
      ok(
        events.some((event) =>
          "operation" in event && event.operation === "forward"
        ),
      );
      ok(retained);
      const count = events.length;
      await retained.sendActivity(sender, [], outgoing);
      strictEqual(
        events[count].provenance.inboxRequest?.inboxRequestId,
        reports[0].inboxRequestId,
      );
      // Same-looking Request URLs and programmatic inbox conversion establish no HTTP cause.
      for (
        const input of [new URL("https://inbox.example:8443"), post(path, body)]
      ) {
        const independent = input instanceof URL
          ? federation.createContext(input, undefined)
          : federation.createContext(input, undefined);
        ok(independent instanceof ContextImpl);
        await independent.toInboxContext(
          null,
          body,
          "https://example.com/manual",
          Create.typeId.href,
        ).sendActivity(sender, [], outgoing);
        deepStrictEqual(events.at(-1)!.provenance, {});
      }
    });
  }
});

test("outbound inbox provenance exists before loader preparation fails", async () => {
  const failure = new Error("loader construction failed");
  const reports: InboxRequestReport[] = [];
  const events: OutboundBroadcastEvent[] = [];
  const federation = createFederation<void>({
    ...loaders,
    kv: new MemoryKvStore(),
    contextLoaderFactory() {
      throw failure;
    },
  });
  federation.setOutboundObservers({
    onBroadcast(_ctx, event) {
      events.push(event);
    },
  });
  federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
    .onRequestFinished(async (ctx, report) => {
      reports.push(report);
      await ctx.sendActivity(sender, [], outgoing);
    });
  for (const path of ["/users/alice/inbox", "/inbox"]) {
    await rejects(
      federation.fetch(post(path, {}), { contextData: undefined }),
      (error) => error === failure,
    );
    const report = reports.at(-1)!;
    ok(report.inboxRequestId);
    strictEqual(report.requestId, "shared-external-label");
    strictEqual(report.outcome.type, "exception");
    strictEqual(
      events.at(-1)?.provenance.inboxRequest?.inboxRequestId,
      report.inboxRequestId,
    );
  }
  notStrictEqual(reports[0].inboxRequestId, reports[1].inboxRequestId);
});

test("outbound provenance keeps source log labels separate from current request labels", async () => {
  const records: LogRecord[] = [];
  await reset();
  await configure({
    sinks: { buffer: (record) => records.push(record) },
    loggers: [{ category: [], sinks: ["buffer"], lowestLevel: "info" }, {
      category: ["logtape", "meta"],
      sinks: [],
    }],
    contextLocalStorage: new AsyncLocalStorage(),
  });
  try {
    const events: OutboundBroadcastEvent[] = [];
    let retained: RequestContext<void> | undefined;
    let report: InboxRequestReport | undefined;
    const federation = createFederation<void>({
      ...loaders,
      kv: new MemoryKvStore(),
      skipSignatureVerification: true,
    });
    federation.setActorDispatcher("/users/{identifier}", async (ctx) => {
      await ctx.sendActivity(sender, [], outgoing);
      return new Person({});
    }).setKeyPairsDispatcher(() => []);
    federation.setOutboundObservers({
      onBroadcast(_ctx, event) {
        events.push(event);
        getLogger(["test", "provenance"]).info("outbound callback");
      },
    });
    federation.setInboxListeners("/users/{identifier}/inbox", "/inbox").on(
      Create,
      async () => {
        await withContext({
          sourceInboxRequestId: "ambient-inbox",
          sourceRequestId: "ambient-source",
        }, () =>
          federation.fetch(
            new Request("https://inbox.example/users/alice?nested=1", {
              headers: {
                Accept: "application/activity+json",
                "X-Request-Id": "nested-request",
              },
            }),
            { contextData: undefined },
          ));
      },
    )
      .onRequestFinished((ctx, value) => {
        retained = ctx;
        report = value;
        getLogger(["test", "provenance"]).info("inbox callback");
      });
    strictEqual(
      (await federation.fetch(post("/users/alice/inbox", await payload()), {
        contextData: undefined,
      })).status,
      202,
    );
    ok(retained && report?.inboxRequestId);
    const ingress = records.find((record) =>
      record.rawMessage === "inbox callback"
    );
    ok(ingress);
    strictEqual(ingress.properties.inboxRequestId, report.inboxRequestId);
    strictEqual(ingress.properties.requestId, report.requestId);
    const nested = records.find((record) =>
      record.properties.url === "https://inbox.example/users/alice?nested=1" &&
      record.properties.requestId === "nested-request"
    );
    ok(nested);
    strictEqual(nested.properties.inboxRequestId, undefined);
    strictEqual(nested.properties.sourceInboxRequestId, undefined);
    strictEqual(nested.properties.sourceRequestId, undefined);
    const original = records.find((record) =>
      record.properties.url ===
        "https://inbox.example:8443/users/alice/inbox" &&
      record.properties.status === 202
    );
    ok(original);
    strictEqual(original.properties.inboxRequestId, report.inboxRequestId);
    await withContext(
      { requestId: "unrelated-current" },
      () => retained!.sendActivity(sender, [], outgoing),
    );
    const descendant = records.filter((record) =>
      record.rawMessage === "outbound callback"
    ).at(-1);
    ok(descendant);
    strictEqual(descendant.properties.requestId, "unrelated-current");
    strictEqual(descendant.properties.sourceRequestId, report.requestId);
    strictEqual(
      descendant.properties.sourceInboxRequestId,
      report.inboxRequestId,
    );
    const independent = federation.createContext(
      new URL("https://inbox.example"),
      undefined,
    );
    await withContext({
      requestId: "independent-current",
      sourceRequestId: "ambient-source",
      sourceInboxRequestId: "ambient-inbox",
    }, () => independent.sendActivity(sender, [], outgoing));
    deepStrictEqual(events.at(-1)!.provenance, {});
    const independentLog = records.filter((record) =>
      record.rawMessage === "outbound callback"
    ).at(-1);
    ok(independentLog);
    strictEqual(independentLog.properties.requestId, "independent-current");
    strictEqual(independentLog.properties.sourceRequestId, undefined);
    strictEqual(independentLog.properties.sourceInboxRequestId, undefined);
    // Ordinary HTTP-derived work retains its logging label without an inbox cause.
    const start = events.length;
    await federation.fetch(
      new Request("https://inbox.example/users/alice", {
        headers: {
          Accept: "application/activity+json",
          "X-Request-Id": "actor-request",
        },
      }),
      { contextData: undefined },
    );
    ok(events.length > start);
    for (const event of events.slice(start)) {
      deepStrictEqual(event.provenance, {
        originatingRequestId: "actor-request",
      });
    }
  } finally {
    await reset();
  }
});

test("outbound provenance does not invent an inbox cause for programmatic routing", async () => {
  const events: OutboundBroadcastEvent[] = [];
  const federation = createFederation<void>({
    ...loaders,
    kv: new MemoryKvStore(),
  });
  federation.setOutboundObservers({
    onBroadcast(_ctx, event) {
      events.push(event);
    },
  });
  federation.setInboxListeners("/users/{identifier}/inbox", "/inbox").on(
    Create,
    async (ctx) => {
      await ctx.sendActivity(sender, [], outgoing);
    },
  );
  const ctx = federation.createContext(
    new URL("https://inbox.example"),
    undefined,
  );
  const signed = await signObject(
    new Create({
      id: new URL("https://example.com/programmatic"),
      actor: new URL("https://example.com/person2"),
    }),
    ed25519PrivateKey,
    ed25519Multikey.id!,
    { contextLoader: mockDocumentLoader },
  );
  strictEqual(await ctx.routeActivity(null, signed), true);
  strictEqual(events.length, 2);
  for (const event of events) deepStrictEqual(event.provenance, {});
});

test("outbound provenance retains request labels on gateway dispatchers", async (t) => {
  const did = await exportDidKey(ed25519PublicKey.publicKey);
  const digest = await computeDigestMultibase(
    new TextEncoder().encode("gateway media"),
  );
  for (const route of ["actor", "object", "collection", "media"] as const) {
    await t.step(route, async () => {
      const events: OutboundBroadcastEvent[] = [];
      const federation = createFederation<void>({
        ...loaders,
        kv: new MemoryKvStore(),
      });
      const send = (ctx: Context<void>) =>
        ctx.clone(undefined).sendActivity(sender, [], outgoing);
      federation.setOutboundObservers({
        onBroadcast(_ctx, event) {
          events.push(event);
        },
      });
      federation.setActorDispatcher("/users/{identifier}", async (ctx) => {
        await send(ctx);
        return route === "collection"
          ? new Person({
            id: parseIri(`ap+ef61://${did}/users/alice`),
            followers: parseIri(`ap+ef61://${did}/users/alice/followers`),
          })
          : null;
      });
      federation.setObjectDispatcher(Note, "/notes/{id}", async (ctx) => {
        await send(ctx);
        return null;
      });
      federation.setFollowersDispatcher(
        "/users/{identifier}/followers",
        async (ctx) => {
          await send(ctx);
          return { items: [] };
        },
      );
      federation.setHashlinkMediaDispatcher(async (ctx) => {
        await send(ctx);
        return null;
      });
      const suffix = route === "actor"
        ? `${did}/users/alice`
        : route === "object"
        ? `${did}/notes/1`
        : route === "collection"
        ? `${did}/users/alice/followers`
        : `hl:${digest}`;
      const response = await federation.fetch(
        new Request(`https://example.com/.well-known/apgateway/${suffix}`, {
          headers: {
            Accept: "application/activity+json",
            "X-Request-Id": `${route}-request`,
          },
        }),
        { contextData: undefined },
      );
      strictEqual(response.status, route === "collection" ? 200 : 404);
      strictEqual(events.length, route === "collection" ? 4 : 2);
      for (const event of events) {
        deepStrictEqual(event.provenance, {
          originatingRequestId: `${route}-request`,
        });
        strictEqual(event.local.host, "example.com");
      }
    });
  }
});

test("queued provenance survives inbox retries, fanout, and outbox worker reconstruction", async (t) => {
  const records: LogRecord[] = [];
  await reset();
  await configure({
    sinks: { buffer: (record) => records.push(record) },
    loggers: [{ category: [], sinks: ["buffer"], lowestLevel: "info" }, {
      category: ["logtape", "meta"],
      sinks: [],
    }],
    contextLocalStorage: new AsyncLocalStorage(),
  });
  try {
    // Source propagation covers both retry owners. Legacy absence is
    // independent of retry ownership, so one legacy execution is sufficient.
    for (
      const { legacy, native } of [
        { legacy: false, native: false },
        { legacy: false, native: true },
        { legacy: true, native: false },
      ]
    ) {
      await t.step(
        `${legacy ? "legacy" : "source"}: ${
          native ? "native redelivery" : "scheduled retry"
        }`,
        async () => {
          const messages: Message[] = [];
          const events: (OutboundBroadcastEvent | OutboundDeliveryEvent)[] = [];
          const reports: InboxRequestReport[] = [];
          const queue: MessageQueue = {
            nativeRetrial: native,
            enqueue(message) {
              messages.push(message);
              return Promise.resolve();
            },
            listen: () => Promise.resolve(),
          };
          const federation = createFederation<void>({
            ...loaders,
            kv: new MemoryKvStore(),
            origin: "https://canonical.example",
            skipSignatureVerification: true,
            manuallyStartQueue: true,
            queue: { inbox: queue, fanout: queue, outbox: queue },
          });
          federation.setActorDispatcher(
            "/users/{identifier}",
            () => new Person({}),
          ).setKeyPairsDispatcher(async (ctx) => {
            await ctx.sendActivity(sender, [], outgoing);
            return [];
          });
          let calls = 0;
          const failure = new Error("retry listener");
          federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
            .setSharedKeyDispatcher(async (ctx) => {
              await ctx.sendActivity(sender, [], outgoing);
              return sender;
            })
            .on(Create, async (ctx) => {
              getLogger(["test", "queued-source"]).info("queued listener");
              await ctx.sendActivity(sender, [], outgoing);
              if (++calls === 1) throw failure;
              ok(ctx instanceof ContextImpl);
              const clone = ctx.clone(undefined);
              await clone.sendActivity(sender, target, outgoing, {
                fanout: "force",
              });
              const outbox = ctx.toOutboxContext(
                "alice",
                {},
                outgoing.id!.href,
                Create.typeId.href,
              ).clone(undefined);
              await outbox.sendActivity(sender, target, outgoing, {
                fanout: "skip",
              });
              await clone.forwardActivity(sender, target, {
                skipIfUnsigned: false,
              });
            }).onRequestFinished((_ctx, report) => {
              reports.push(report);
            });
          // Producer metadata must not depend on observer registration.
          strictEqual(
            (await federation.fetch(
              post(native ? "/inbox" : "/users/alice/inbox", await payload()),
              { contextData: undefined },
            )).status,
            202,
          );
          const produced = messages[0];
          ok(produced.type === "inbox");
          ok(produced.provenance?.inboxRequest);
          strictEqual(
            produced.provenance.inboxRequest.inboxRequestId,
            reports[0].inboxRequestId,
          );
          deepStrictEqual(
            JSON.parse(JSON.stringify(produced.provenance)),
            produced.provenance,
          );
          const task = JSON.parse(
            JSON.stringify(produced),
          ) as typeof produced;
          if (legacy) delete (task as { provenance?: unknown }).provenance;
          const expected: OutboundProvenance = task.provenance ?? {};
          federation.setOutboundObservers({
            onBroadcast(_ctx, event) {
              events.push(event);
            },
            onDelivery(_ctx, event) {
              events.push(event);
            },
          });
          const execute = (message: Message) =>
            withContext({
              requestId: "worker-current",
              inboxRequestId: "unrelated-inbox",
              sourceInboxRequestId: "ambient-source",
              sourceRequestId: "ambient-label",
            }, () => federation.processQueuedTask(undefined, message));
          messages.length = 0;
          const logStart = records.length;
          if (native) {
            await rejects(execute(task), (error) => error === failure);
          } else await execute(task);
          const retry = native
            ? task
            : messages.find((message) => message.type === "inbox");
          ok(retry?.type === "inbox");
          deepStrictEqual(retry.provenance ?? {}, expected);
          strictEqual(retry.attempt, native ? 0 : 1);
          await execute({
            ...structuredClone(retry),
            id: crypto.randomUUID(),
          });
          strictEqual(calls, 2);
          const fanout = messages.find((message) => message.type === "fanout");
          ok(fanout?.type === "fanout");
          deepStrictEqual(fanout.provenance ?? {}, expected);
          await execute(JSON.parse(JSON.stringify(fanout)));
          const outgoingTasks = messages.filter((message) =>
            message.type === "outbox"
          );
          strictEqual(outgoingTasks.length, 3);
          for (const message of outgoingTasks) {
            deepStrictEqual(message.provenance ?? {}, expected);
            strictEqual("provenance" in message, !legacy);
          }
          const consumer = createFederation<void>({
            kv: new MemoryKvStore(),
            allowPrivateAddress: true,
            origin: "https://consumer.example",
            manuallyStartQueue: true,
            queue: { outbox: queue },
          });
          consumer.setOutboundObservers({
            onBroadcast(_ctx, event) {
              events.push(event);
            },
          });
          let permanent = 0;
          consumer.setOutboxPermanentFailureHandler(async (ctx) => {
            permanent++;
            getLogger(["test", "queued-source"]).info("permanent callback");
            await ctx.clone(undefined).sendActivity(sender, [], outgoing);
          });
          fetchMock.mockGlobal().post(target.inboxId!.href, 410);
          try {
            await withContext({
              requestId: "worker-current",
              sourceInboxRequestId: "ambient-source",
              sourceRequestId: "ambient-label",
            }, () =>
              consumer.processQueuedTask(undefined, {
                ...structuredClone(outgoingTasks[0]),
                baseUrl: "https://worker.example",
              }));
          } finally {
            fetchMock.hardReset();
          }
          strictEqual(permanent, 1);
          ok(events.length > 0);
          for (const event of events) {
            deepStrictEqual(event.provenance, expected);
            ok(Object.isFrozen(event.provenance));
            if (!legacy) {
              ok(Object.isFrozen(event.provenance.inboxRequest?.context));
            }
          }
          strictEqual(events.at(-1)!.local.host, "worker.example");
          strictEqual(
            events.at(-1)!.local.canonicalOrigin,
            "https://consumer.example",
          );
          const workerLogs = records.slice(logStart).filter((record) =>
            record.rawMessage === "queued listener" ||
            record.rawMessage === "permanent callback"
          );
          strictEqual(workerLogs.length, 3);
          for (const record of workerLogs) {
            strictEqual(record.properties.requestId, "worker-current");
            strictEqual(record.properties.inboxRequestId, undefined);
            strictEqual(
              record.properties.sourceInboxRequestId,
              expected.inboxRequest?.inboxRequestId,
            );
            strictEqual(
              record.properties.sourceRequestId,
              expected.inboxRequest?.requestId,
            );
          }
        },
      );
    }
  } finally {
    await reset();
  }
});

test("queued provenance retains a non-inbox HTTP request label without inventing an inbox cause", async () => {
  const messages: Message[] = [];
  const queue: MessageQueue = {
    enqueue(message) {
      messages.push(message);
      return Promise.resolve();
    },
    listen: () => Promise.resolve(),
  };
  const federation = createFederation<void>({
    ...loaders,
    kv: new MemoryKvStore(),
    manuallyStartQueue: true,
    queue: { fanout: queue, outbox: queue },
  });
  federation.setActorDispatcher("/users/{identifier}", async (ctx) => {
    await ctx.sendActivity(sender, target, outgoing, { fanout: "force" });
    return null;
  });
  strictEqual(
    (await federation.fetch(
      new Request("https://example.com/users/alice", {
        headers: {
          Accept: "application/activity+json",
          "X-Request-Id": "original-http-label",
        },
      }),
      { contextData: undefined },
    )).status,
    404,
  );
  const message = messages[0];
  ok(message?.type === "fanout");
  deepStrictEqual(message.provenance, {
    originatingRequestId: "original-http-label",
  });
  const events: OutboundDeliveryEvent[] = [];
  federation.setOutboundObservers({
    onDelivery(_ctx, event) {
      events.push(event);
    },
  });
  await withContext(
    { requestId: "worker-current", sourceInboxRequestId: "unrelated-inbox" },
    () =>
      federation.processQueuedTask(
        undefined,
        JSON.parse(JSON.stringify(message)),
      ),
  );
  strictEqual(events.length, 1);
  deepStrictEqual(events[0].provenance, message.provenance);
  const child = messages[1];
  ok(child?.type === "outbox");
  deepStrictEqual(child.provenance, message.provenance);
});
