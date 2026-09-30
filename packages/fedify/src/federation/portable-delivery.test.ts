import { mockDocumentLoader, test } from "@fedify/fixture";
import { Create, Endpoints, Note, Person, type Recipient } from "@fedify/vocab";
import { parseIri } from "@fedify/vocab-runtime";
import fetchMock from "fetch-mock";
import { deepStrictEqual, ok, rejects, strictEqual } from "node:assert/strict";
import { rsaPrivateKey2, rsaPublicKey2 } from "../testing/keys.ts";
import { MemoryKvStore } from "./kv.ts";
import { FederationImpl, InboxContextImpl } from "./middleware.ts";
import type { MessageQueue } from "./mq.ts";
import { MAX_DELIVERY_GATEWAYS } from "./portable-delivery.ts";
import type { FanoutMessage, Message, OutboxMessage } from "./queue.ts";
import { extractInboxes, SendActivityError } from "./send.ts";

// cSpell: disable
const DID = "did:key:z6MkrJVnaZkeFzdQyMZu1cgjg7k1pZZ6pvBQ7XJPt4swbTQ2";
const OTHER_DID = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK";
// cSpell: enable
const PORTABLE_INBOX = `ap+ef61://${DID}/actor/inbox`;
// The internal form of the portable actor ID, as URL.href gives it:
const ACTOR_ID = `ap+ef61://${encodeURIComponent(DID)}/actor`;
const inboxOn = (gateway: string, did = DID) =>
  `${gateway}/.well-known/apgateway/${did}/actor/inbox`;

function portableActor(
  options: {
    did?: string;
    id?: string;
    inbox?: string;
    gateways?: string[];
    sharedInbox?: string;
  } = {},
): Person {
  const did = options.did ?? DID;
  return new Person({
    id: parseIri(options.id ?? `ap://${did}/actor`),
    inbox: parseIri(options.inbox ?? `ap://${did}/actor/inbox`),
    gateways: (options.gateways ?? []).map((g) => new URL(g)),
    endpoints: options.sharedInbox == null ? null : new Endpoints({
      sharedInbox: new URL(options.sharedInbox),
    }),
  });
}

test("extractInboxes() resolves portable inboxes", async (t) => {
  await t.step("through the recipient's gateways", () => {
    const inboxes = extractInboxes({
      recipients: [
        portableActor({
          gateways: ["https://gw1.example", "https://gw2.example"],
        }),
      ],
    });
    deepStrictEqual(inboxes, {
      [inboxOn("https://gw1.example")]: {
        actorIds: new Set([ACTOR_ID]),
        sharedInbox: false,
        portableInbox: PORTABLE_INBOX,
        gatewayInboxes: [
          inboxOn("https://gw1.example"),
          inboxOn("https://gw2.example"),
        ],
      },
    });
  });

  await t.step("through @gateway hints of the inbox", () => {
    const hints = "?@gateway=https%3A%2F%2Fhint1.example" +
      "&@gateway=https%3A%2F%2Fhint2.example";
    const inboxes = extractInboxes({
      recipients: [portableActor({ inbox: `ap://${DID}/actor/inbox${hints}` })],
    });
    deepStrictEqual(Object.keys(inboxes), [inboxOn("https://hint1.example")]);
    deepStrictEqual(inboxes[inboxOn("https://hint1.example")].gatewayInboxes, [
      inboxOn("https://hint1.example"),
      inboxOn("https://hint2.example"),
    ]);
  });

  await t.step("preferring gateways to hints", () => {
    const inboxes = extractInboxes({
      recipients: [
        portableActor({
          inbox: `ap://${DID}/actor/inbox?@gateway=https%3A%2F%2Fhint.example`,
          gateways: ["https://gw.example"],
        }),
      ],
    });
    deepStrictEqual(inboxes[inboxOn("https://gw.example")].gatewayInboxes, [
      inboxOn("https://gw.example"),
    ]);
  });

  await t.step("skipping a recipient without gateways", () => {
    deepStrictEqual(extractInboxes({ recipients: [portableActor()] }), {});
  });

  await t.step("skipping invalid gateways", () => {
    const recipient: Recipient = {
      id: parseIri(`ap://${DID}/actor`),
      inboxId: parseIri(`ap://${DID}/actor/inbox`),
      gateways: [
        new URL("https://bad.example/path"),
        new URL("https://gw.example"),
      ],
    };
    const inboxes = extractInboxes({ recipients: [recipient] });
    deepStrictEqual(Object.keys(inboxes), [inboxOn("https://gw.example")]);
  });

  await t.step("capping the number of gateways", () => {
    const gateways = Array.from(
      { length: MAX_DELIVERY_GATEWAYS + 3 },
      (_, i) => `https://gw${i}.example`,
    );
    const inboxes = extractInboxes({
      recipients: [portableActor({ gateways })],
    });
    strictEqual(
      inboxes[inboxOn("https://gw0.example")].gatewayInboxes?.length,
      MAX_DELIVERY_GATEWAYS,
    );
  });

  await t.step("merging spellings of the same portable inbox", () => {
    const inboxes = extractInboxes({
      recipients: [
        portableActor({ gateways: ["https://gw1.example"] }),
        portableActor({
          id: `ap+ef61://${encodeURIComponent(DID)}/actor`,
          inbox: `ap+ef61://${encodeURIComponent(DID)}/actor/inbox`,
          gateways: ["https://gw2.example", "https://gw1.example"],
        }),
      ],
    });
    deepStrictEqual(Object.keys(inboxes), [inboxOn("https://gw1.example")]);
    deepStrictEqual(inboxes[inboxOn("https://gw1.example")].gatewayInboxes, [
      inboxOn("https://gw1.example"),
      inboxOn("https://gw2.example"),
    ]);
  });

  await t.step("merging with a compatible identifier inbox", () => {
    const compatible: Recipient = {
      id: new URL(`https://gw1.example/.well-known/apgateway/${DID}/actor`),
      inboxId: new URL(inboxOn("https://gw1.example")),
    };
    const portable = portableActor({
      gateways: ["https://gw1.example", "https://gw2.example"],
    });
    for (const recipients of [[compatible, portable], [portable, compatible]]) {
      const inboxes = extractInboxes({ recipients });
      deepStrictEqual(inboxes, {
        [inboxOn("https://gw1.example")]: {
          actorIds: new Set(recipients.map((r) => r.id!.href)),
          sharedInbox: false,
          portableInbox: PORTABLE_INBOX,
          gatewayInboxes: [
            inboxOn("https://gw1.example"),
            inboxOn("https://gw2.example"),
          ],
        },
      });
    }
  });

  await t.step("merging with an inbox on a later gateway", () => {
    const compatible: Recipient = {
      id: new URL(`https://gw2.example/.well-known/apgateway/${DID}/actor`),
      inboxId: new URL(inboxOn("https://gw2.example")),
    };
    const portable = portableActor({
      gateways: ["https://gw1.example", "https://gw2.example"],
    });
    for (const recipients of [[compatible, portable], [portable, compatible]]) {
      const inboxes = extractInboxes({ recipients });
      const keys = Object.keys(inboxes);
      strictEqual(keys.length, 1);
      const entry = inboxes[keys[0]];
      strictEqual(entry.gatewayInboxes?.[0], keys[0]);
      deepStrictEqual(
        new Set(entry.gatewayInboxes),
        new Set([
          inboxOn("https://gw1.example"),
          inboxOn("https://gw2.example"),
        ]),
      );
      strictEqual(entry.portableInbox, PORTABLE_INBOX);
      strictEqual(entry.actorIds.size, 2);
    }
  });

  await t.step("merging with a shared inbox of the same URL", () => {
    const shared: Recipient = {
      id: new URL("https://other.example/users/bob"),
      inboxId: new URL("https://other.example/users/bob/inbox"),
      endpoints: { sharedInbox: new URL(inboxOn("https://gw1.example")) },
    };
    const portable = portableActor({ gateways: ["https://gw1.example"] });
    for (const recipients of [[shared, portable], [portable, shared]]) {
      const inboxes = extractInboxes({ recipients, preferSharedInbox: true });
      strictEqual(inboxes[inboxOn("https://gw1.example")].sharedInbox, false);
      strictEqual(
        inboxes[inboxOn("https://gw1.example")].portableInbox,
        PORTABLE_INBOX,
      );
      strictEqual(inboxes[inboxOn("https://gw1.example")].actorIds.size, 2);
    }
  });

  await t.step("not preferring the shared inbox of a portable inbox", () => {
    const inboxes = extractInboxes({
      recipients: [
        portableActor({
          gateways: ["https://gw.example"],
          sharedInbox: "https://gw.example/inbox",
        }),
      ],
      preferSharedInbox: true,
    });
    deepStrictEqual(Object.keys(inboxes), [inboxOn("https://gw.example")]);
    strictEqual(inboxes[inboxOn("https://gw.example")].sharedInbox, false);
  });

  await t.step("excluding gateways by excludeBaseUris", () => {
    const recipients = [
      portableActor({
        gateways: ["https://gw1.example", "https://gw2.example"],
      }),
    ];
    let inboxes = extractInboxes({
      recipients,
      excludeBaseUris: [new URL("https://gw1.example/")],
    });
    deepStrictEqual(inboxes[inboxOn("https://gw2.example")].gatewayInboxes, [
      inboxOn("https://gw2.example"),
    ]);
    inboxes = extractInboxes({
      recipients,
      excludeBaseUris: [
        new URL("https://gw1.example/"),
        new URL("https://gw2.example/foo"),
      ],
    });
    deepStrictEqual(inboxes, {});
  });

  await t.step("keeping ordinary inboxes unchanged", () => {
    const inboxes = extractInboxes({
      recipients: [
        new Person({
          id: new URL("https://example.com/alice"),
          inbox: new URL("https://example.com/alice/inbox"),
        }),
      ],
    });
    deepStrictEqual(inboxes, {
      "https://example.com/alice/inbox": {
        actorIds: new Set(["https://example.com/alice"]),
        sharedInbox: false,
      },
    });
  });
});

interface Queued {
  message: Message;
  options: Parameters<MessageQueue["enqueue"]>[1];
}

function createQueue(
  options: Pick<MessageQueue, "nativeRetrial"> = {},
): { queue: MessageQueue; queued: Queued[] } {
  const queued: Queued[] = [];
  const queue: MessageQueue = {
    nativeRetrial: options.nativeRetrial,
    enqueue(message, options) {
      // Round-trips through JSON, as persistent queues do:
      queued.push({ message: JSON.parse(JSON.stringify(message)), options });
      return Promise.resolve();
    },
    listen() {
      return Promise.resolve();
    },
  };
  return { queue, queued };
}

const sender = { keyId: rsaPublicKey2.id!, privateKey: rsaPrivateKey2 };

function createActivity(id = "https://example.com/activities/1"): Create {
  return new Create({
    id: new URL(id),
    actor: new URL("https://example.com/person2"),
    object: new Note({
      id: new URL(`${id}/note`),
      content: "Hello",
    }),
  });
}

test("Context.sendActivity() to a portable inbox", async (t) => {
  fetchMock.spyGlobal();

  await t.step("immediately", async () => {
    fetchMock.hardReset();
    fetchMock.spyGlobal();
    const requests: string[] = [];
    fetchMock.post("begin:https://gw1.example/", (call) => {
      requests.push(call.url);
      return 202;
    });
    const federation = new FederationImpl<void>({
      kv: new MemoryKvStore(),
      allowPrivateAddress: true,
    });
    const ctx = federation.createContext(new URL("https://example.com/"));
    await ctx.sendActivity(
      sender,
      portableActor({ gateways: ["https://gw1.example"] }),
      createActivity(),
      { immediate: true },
    );
    deepStrictEqual(requests, [inboxOn("https://gw1.example")]);
  });

  await t.step("immediately, failing over to the next gateway", async () => {
    fetchMock.hardReset();
    fetchMock.spyGlobal();
    const requests: string[] = [];
    fetchMock.post("begin:https://gw1.example/", (call) => {
      requests.push(call.url);
      return 404;
    });
    fetchMock.post("begin:https://gw2.example/", (call) => {
      requests.push(call.url);
      return 202;
    });
    const federation = new FederationImpl<void>({
      kv: new MemoryKvStore(),
      allowPrivateAddress: true,
    });
    const ctx = federation.createContext(new URL("https://example.com/"));
    await ctx.sendActivity(
      sender,
      portableActor({
        gateways: ["https://gw1.example", "https://gw2.example"],
      }),
      createActivity(),
      { immediate: true },
    );
    // Double-knocking may repeat a failed request:
    deepStrictEqual([...new Set(requests)], [
      inboxOn("https://gw1.example"),
      inboxOn("https://gw2.example"),
    ]);
  });

  await t.step("immediately, failing on every gateway", async () => {
    fetchMock.hardReset();
    fetchMock.spyGlobal();
    fetchMock.post("begin:https://gw1.example/", 500);
    fetchMock.post("begin:https://gw2.example/", 404);
    const federation = new FederationImpl<void>({
      kv: new MemoryKvStore(),
      allowPrivateAddress: true,
    });
    const ctx = federation.createContext(new URL("https://example.com/"));
    await rejects(
      () =>
        ctx.sendActivity(
          sender,
          portableActor({
            gateways: ["https://gw1.example", "https://gw2.example"],
          }),
          createActivity(),
          { immediate: true },
        ),
      (error) =>
        error instanceof SendActivityError && error.statusCode === 404 &&
        error.inbox.href === inboxOn("https://gw2.example"),
    );
  });

  await t.step("rejecting private gateways", async () => {
    fetchMock.hardReset();
    fetchMock.spyGlobal();
    let requests = 0;
    fetchMock.post("begin:http://127.0.0.1/", () => {
      requests++;
      return 202;
    });
    const federation = new FederationImpl<void>({ kv: new MemoryKvStore() });
    const ctx = federation.createContext(new URL("https://example.com/"));
    await rejects(() =>
      ctx.sendActivity(
        sender,
        portableActor({ gateways: ["http://127.0.0.1"] }),
        createActivity(),
        { immediate: true },
      )
    );
    strictEqual(requests, 0);
  });

  await t.step("through the queue", async () => {
    fetchMock.hardReset();
    fetchMock.spyGlobal();
    const requests: string[] = [];
    fetchMock.post("begin:https://gw1.example/", (call) => {
      requests.push(call.url);
      return 404;
    });
    fetchMock.post("begin:https://gw2.example/", (call) => {
      requests.push(call.url);
      return 202;
    });
    const { queue, queued } = createQueue();
    const federation = new FederationImpl<void>({
      kv: new MemoryKvStore(),
      queue,
      manuallyStartQueue: true,
      allowPrivateAddress: true,
    });
    const ctx = federation.createContext(new URL("https://example.com/"));
    await ctx.sendActivity(
      sender,
      [
        portableActor({
          gateways: ["https://gw1.example", "https://gw2.example"],
        }),
        portableActor({ did: OTHER_DID, gateways: ["https://gw1.example"] }),
      ],
      createActivity(),
      { orderingKey: "key", fanout: "skip" },
    );
    strictEqual(queued.length, 2);
    const messages = queued.map((q) => q.message as OutboxMessage);
    deepStrictEqual(messages.map((m) => m.inbox), [
      inboxOn("https://gw1.example"),
      inboxOn("https://gw1.example", OTHER_DID),
    ]);
    deepStrictEqual(messages[0].gatewayInboxes, [
      inboxOn("https://gw1.example"),
      inboxOn("https://gw2.example"),
    ]);
    strictEqual(messages[0].portableInbox, PORTABLE_INBOX);
    // Ordering keys tell portable inboxes apart by their DIDs:
    deepStrictEqual(queued.map((q) => q.options?.orderingKey), [
      `key\n${DID}`,
      `key\n${OTHER_DID}`,
    ]);
    queued.length = 0;
    await federation.processQueuedTask(undefined, messages[0]);
    // Double-knocking may repeat a failed request:
    deepStrictEqual([...new Set(requests)], [
      inboxOn("https://gw1.example"),
      inboxOn("https://gw2.example"),
    ]);
    strictEqual(queued.length, 0);
  });

  await t.step("through the fanout queue", async () => {
    fetchMock.hardReset();
    fetchMock.spyGlobal();
    const { queue, queued } = createQueue();
    const federation = new FederationImpl<void>({
      kv: new MemoryKvStore(),
      queue,
      manuallyStartQueue: true,
      allowPrivateAddress: true,
    });
    const ctx = federation.createContext(new URL("https://example.com/"));
    await ctx.sendActivity(
      sender,
      portableActor({
        gateways: ["https://gw1.example", "https://gw2.example"],
      }),
      createActivity(),
      { fanout: "force" },
    );
    strictEqual(queued.length, 1);
    const fanout = queued[0].message as FanoutMessage;
    deepStrictEqual(fanout.inboxes, {
      [inboxOn("https://gw1.example")]: {
        actorIds: [ACTOR_ID],
        sharedInbox: false,
        portableInbox: PORTABLE_INBOX,
        gatewayInboxes: [
          inboxOn("https://gw1.example"),
          inboxOn("https://gw2.example"),
        ],
      },
    });
    queued.length = 0;
    await federation.processQueuedTask(undefined, fanout);
    strictEqual(queued.length, 1);
    const outbox = queued[0].message as OutboxMessage;
    strictEqual(outbox.inbox, inboxOn("https://gw1.example"));
    deepStrictEqual(outbox.gatewayInboxes, [
      inboxOn("https://gw1.example"),
      inboxOn("https://gw2.example"),
    ]);
  });

  fetchMock.hardReset();
});

test("InboxContext.forwardActivity() to a portable inbox", async (t) => {
  fetchMock.spyGlobal();
  const activity = {
    "@context": "https://www.w3.org/ns/activitystreams",
    type: "Create",
    id: "https://example.com/activities/1",
    actor: "https://example.com/person2",
  };
  const recipient = portableActor({
    gateways: ["https://gw1.example", "https://gw2.example"],
  });

  function createInboxContext(federation: FederationImpl<void>) {
    return new InboxContextImpl(
      null,
      activity,
      activity.id,
      "https://www.w3.org/ns/activitystreams#Create",
      {
        data: undefined,
        federation,
        url: new URL("https://example.com/"),
        documentLoader: mockDocumentLoader,
        contextLoader: mockDocumentLoader,
      },
    );
  }

  await t.step("immediately", async () => {
    fetchMock.hardReset();
    fetchMock.spyGlobal();
    const requests: string[] = [];
    fetchMock.post("begin:https://gw1.example/", (call) => {
      requests.push(call.url);
      return 500;
    });
    fetchMock.post("begin:https://gw2.example/", (call) => {
      requests.push(call.url);
      return 202;
    });
    const federation = new FederationImpl<void>({
      kv: new MemoryKvStore(),
      allowPrivateAddress: true,
    });
    await createInboxContext(federation).forwardActivity(sender, recipient, {
      immediate: true,
      skipIfUnsigned: false,
    });
    deepStrictEqual([...new Set(requests)], [
      inboxOn("https://gw1.example"),
      inboxOn("https://gw2.example"),
    ]);
  });

  await t.step("through the queue", async () => {
    fetchMock.hardReset();
    fetchMock.spyGlobal();
    const { queue, queued } = createQueue();
    const federation = new FederationImpl<void>({
      kv: new MemoryKvStore(),
      queue,
      manuallyStartQueue: true,
      allowPrivateAddress: true,
    });
    await createInboxContext(federation).forwardActivity(sender, recipient, {
      orderingKey: "key",
      skipIfUnsigned: false,
    });
    strictEqual(queued.length, 1);
    const message = queued[0].message as OutboxMessage;
    strictEqual(message.inbox, inboxOn("https://gw1.example"));
    strictEqual(message.portableInbox, PORTABLE_INBOX);
    deepStrictEqual(message.gatewayInboxes, [
      inboxOn("https://gw1.example"),
      inboxOn("https://gw2.example"),
    ]);
    strictEqual(queued[0].options?.orderingKey, `key\n${DID}`);
  });

  fetchMock.hardReset();
});

test("processQueuedTask() with portable inbox gateways", async (t) => {
  fetchMock.spyGlobal();

  function createMessage(
    gateways: string[],
    overrides: Partial<OutboxMessage> = {},
  ): OutboxMessage {
    const gatewayInboxes = gateways.map((g) => inboxOn(g));
    return {
      type: "outbox",
      id: crypto.randomUUID(),
      baseUrl: "https://example.com",
      keys: [],
      activity: {
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Create",
        id: "https://example.com/activities/1",
        actor: "https://example.com/person2",
        object: { type: "Note", content: "test" },
      },
      activityId: "https://example.com/activities/1",
      activityType: "https://www.w3.org/ns/activitystreams#Create",
      inbox: gatewayInboxes[0],
      sharedInbox: false,
      actorIds: [`ap+ef61://${DID}/actor`],
      started: new Date().toISOString(),
      attempt: 0,
      headers: {},
      orderingKey: `key\n${DID}`,
      portableInbox: PORTABLE_INBOX,
      gatewayInboxes,
      traceContext: {},
      ...overrides,
    };
  }

  function setup(
    options: Partial<ConstructorParameters<typeof FederationImpl<void>>[0]> =
      {},
    queueOptions: Pick<MessageQueue, "nativeRetrial"> = {},
  ) {
    const { queue, queued } = createQueue(queueOptions);
    const permanentFailures: { inbox: URL; statusCode: number }[] = [];
    const federation = new FederationImpl<void>({
      kv: new MemoryKvStore(),
      queue,
      manuallyStartQueue: true,
      allowPrivateAddress: true,
      ...options,
    });
    federation.setOutboxPermanentFailureHandler((_ctx, values) => {
      permanentFailures.push({
        inbox: values.inbox,
        statusCode: values.statusCode,
      });
    });
    return { federation, queued, permanentFailures };
  }

  function mockGateways(responses: Record<string, number | Response>) {
    fetchMock.hardReset();
    fetchMock.spyGlobal();
    const requests: string[] = [];
    for (const [gateway, response] of Object.entries(responses)) {
      fetchMock.post(`begin:${gateway}/`, (call) => {
        const { origin } = new URL(call.url);
        // Double-knocking may repeat a failed request:
        if (requests.at(-1) !== origin) requests.push(origin);
        return response instanceof Response ? response.clone() : response;
      });
    }
    return requests;
  }

  await t.step("fails over from a transport error", async () => {
    fetchMock.hardReset();
    fetchMock.spyGlobal();
    const requests: string[] = [];
    fetchMock.post("begin:https://gw1.example/", () => {
      requests.push("https://gw1.example");
      throw new TypeError("network error");
    });
    fetchMock.post("begin:https://gw2.example/", () => {
      requests.push("https://gw2.example");
      return 202;
    });
    const { federation, queued } = setup();
    await federation.processQueuedTask(
      undefined,
      createMessage(["https://gw1.example", "https://gw2.example"]),
    );
    deepStrictEqual(requests, ["https://gw1.example", "https://gw2.example"]);
    strictEqual(queued.length, 0);
  });

  await t.step("retries the remaining gateways as one attempt", async () => {
    const requests = mockGateways({
      "https://gw1.example": 500,
      "https://gw2.example": 404,
      "https://gw3.example": 502,
    });
    const { federation, queued, permanentFailures } = setup();
    await federation.processQueuedTask(
      undefined,
      createMessage([
        "https://gw1.example",
        "https://gw2.example",
        "https://gw3.example",
      ]),
    );
    deepStrictEqual(requests, [
      "https://gw1.example",
      "https://gw2.example",
      "https://gw3.example",
    ]);
    strictEqual(permanentFailures.length, 0);
    strictEqual(queued.length, 1);
    const retry = queued[0].message as OutboxMessage;
    strictEqual(retry.attempt, 1);
    strictEqual(retry.inbox, inboxOn("https://gw1.example"));
    deepStrictEqual(retry.gatewayInboxes, [
      inboxOn("https://gw1.example"),
      inboxOn("https://gw3.example"),
    ]);
    strictEqual(queued[0].options?.orderingKey, `key\n${DID}`);
    ok(queued[0].options?.delay != null);
  });

  await t.step("reports a permanent failure once", async () => {
    mockGateways({
      "https://gw1.example": 410,
      "https://gw2.example": 404,
    });
    const { federation, queued, permanentFailures } = setup();
    await federation.processQueuedTask(
      undefined,
      createMessage(["https://gw1.example", "https://gw2.example"]),
    );
    strictEqual(queued.length, 0);
    deepStrictEqual(permanentFailures, [{
      inbox: new URL(inboxOn("https://gw2.example")),
      statusCode: 404,
    }]);
  });

  await t.step("respects custom permanent failure statuses", async () => {
    mockGateways({
      "https://gw1.example": 404,
      "https://gw2.example": 500,
    });
    const { federation, queued, permanentFailures } = setup({
      permanentFailureStatusCodes: [500],
    });
    await federation.processQueuedTask(
      undefined,
      createMessage(["https://gw1.example", "https://gw2.example"]),
    );
    strictEqual(permanentFailures.length, 0);
    deepStrictEqual((queued[0].message as OutboxMessage).gatewayInboxes, [
      inboxOn("https://gw1.example"),
    ]);
  });

  await t.step("gives up when the retry policy does", async () => {
    mockGateways({
      "https://gw1.example": 500,
      "https://gw2.example": 500,
    });
    const { federation, queued, permanentFailures } = setup({
      outboxRetryPolicy: () => null,
    });
    await federation.processQueuedTask(
      undefined,
      createMessage(["https://gw1.example", "https://gw2.example"]),
    );
    strictEqual(queued.length, 0);
    strictEqual(permanentFailures.length, 0);
  });

  await t.step("throws with a natively retrying queue", async () => {
    mockGateways({
      "https://gw1.example": 500,
      "https://gw2.example": 502,
    });
    const { federation, queued } = setup({}, { nativeRetrial: true });
    await rejects(
      () =>
        federation.processQueuedTask(
          undefined,
          createMessage(["https://gw1.example", "https://gw2.example"]),
        ),
      (error) => error instanceof SendActivityError && error.statusCode === 502,
    );
    strictEqual(queued.length, 0);
  });

  await t.step("excludes permanent failures from native retries", async () => {
    mockGateways({
      "https://gw1.example": 404,
      "https://gw2.example": 500,
    });
    const { federation, queued } = setup({}, { nativeRetrial: true });
    await federation.processQueuedTask(
      undefined,
      createMessage(["https://gw1.example", "https://gw2.example"]),
    );
    strictEqual(queued.length, 1);
    const retry = queued[0].message as OutboxMessage;
    strictEqual(retry.attempt, 1);
    deepStrictEqual(retry.gatewayInboxes, [inboxOn("https://gw2.example")]);
  });

  await t.step("drops a held delivery deferred by Retry-After", async () => {
    const requests = mockGateways({
      "https://gw1.example": 202,
      "https://gw2.example": 202,
    });
    const { federation, queued } = setup({
      circuitBreaker: { heldActivityTtl: { hours: 1 } },
    });
    const later = Temporal.Now.instant().add({ hours: 9 }).toString();
    await federation.processQueuedTask(
      undefined,
      createMessage(["https://gw1.example", "https://gw2.example"], {
        circuitHeld: true,
        circuitHeldSince: Temporal.Now.instant().subtract({ hours: 1 })
          .toString(),
        gatewayNotBefore: {
          [inboxOn("https://gw1.example")]: later,
          [inboxOn("https://gw2.example")]: later,
        },
      }),
    );
    deepStrictEqual(requests, []);
    strictEqual(queued.length, 0);
  });

  await t.step("keeps the longest Retry-After", async () => {
    mockGateways({
      "https://gw1.example": new Response(null, {
        status: 429,
        headers: { "Retry-After": "60" },
      }),
      "https://gw2.example": new Response(null, {
        status: 503,
        headers: { "Retry-After": "3600" },
      }),
    });
    const { federation, queued } = setup();
    await federation.processQueuedTask(
      undefined,
      createMessage(["https://gw1.example", "https://gw2.example"]),
    );
    strictEqual(queued.length, 1);
    const retry = queued[0].message as OutboxMessage;
    strictEqual(retry.attempt, 1);
    deepStrictEqual(
      Object.keys(retry.gatewayNotBefore ?? {}),
      [inboxOn("https://gw1.example"), inboxOn("https://gw2.example")],
    );
    strictEqual(Math.round(queued[0].options!.delay!.total("second")), 3600);
  });

  await t.step("ignores a Retry-After too long to honor", async () => {
    const requests = mockGateways({
      "https://gw1.example": new Response(null, {
        status: 429,
        headers: { "Retry-After": "9000000000000" },
      }),
      "https://gw2.example": 202,
    });
    const { federation, queued } = setup();
    await federation.processQueuedTask(
      undefined,
      createMessage(["https://gw1.example", "https://gw2.example"]),
    );
    deepStrictEqual(requests, ["https://gw1.example", "https://gw2.example"]);
    strictEqual(queued.length, 0);
  });

  await t.step("skips gateways that are not to be tried yet", async () => {
    const requests = mockGateways({
      "https://gw1.example": 202,
      "https://gw2.example": 202,
    });
    const { federation, queued } = setup();
    await federation.processQueuedTask(
      undefined,
      createMessage(["https://gw1.example", "https://gw2.example"], {
        gatewayNotBefore: {
          [inboxOn("https://gw1.example")]: Temporal.Now.instant().add({
            hours: 1,
          }).toString(),
        },
      }),
    );
    deepStrictEqual(requests, ["https://gw2.example"]);
    strictEqual(queued.length, 0);
  });

  await t.step("holds when every gateway is held", async () => {
    const requests = mockGateways({
      "https://gw1.example": 202,
      "https://gw2.example": 202,
    });
    const { federation, queued } = setup();
    const inAnHour = Temporal.Now.instant().add({ hours: 1 }).toString();
    const inAMinute = Temporal.Now.instant().add({ minutes: 1 }).toString();
    await federation.processQueuedTask(
      undefined,
      createMessage(["https://gw1.example", "https://gw2.example"], {
        gatewayNotBefore: {
          [inboxOn("https://gw1.example")]: inAnHour,
          [inboxOn("https://gw2.example")]: inAMinute,
        },
      }),
    );
    deepStrictEqual(requests, []);
    strictEqual(queued.length, 1);
    const held = queued[0].message as OutboxMessage;
    strictEqual(held.attempt, 0);
    strictEqual(held.circuitHeld, undefined);
    ok(queued[0].options!.delay!.total("second") <= 60);
    ok(queued[0].options!.delay!.total("second") > 50);
  });

  await t.step("skips a gateway whose circuit is open", async () => {
    const requests = mockGateways({
      "https://gw1.example": 500,
      "https://gw2.example": 202,
    });
    const { federation, queued } = setup({
      circuitBreaker: { failureThreshold: 1, recoveryDelay: { hours: 1 } },
    });
    // Opens the circuit of gw1:
    await federation.processQueuedTask(
      undefined,
      createMessage(["https://gw1.example", "https://gw2.example"]),
    );
    deepStrictEqual(requests, ["https://gw1.example", "https://gw2.example"]);
    strictEqual(queued.length, 0);
    requests.length = 0;
    await federation.processQueuedTask(
      undefined,
      createMessage(["https://gw1.example", "https://gw2.example"]),
    );
    deepStrictEqual(requests, ["https://gw2.example"]);
    strictEqual(queued.length, 0);
  });

  await t.step("holds a permanent failure and an open circuit", async () => {
    const requests = mockGateways({
      "https://gw1.example": 500,
      "https://gw2.example": 404,
    });
    const { federation, queued, permanentFailures } = setup({
      circuitBreaker: { failureThreshold: 1, recoveryDelay: { hours: 1 } },
    });
    // Opens the circuit of gw1, and removes gw2:
    await federation.processQueuedTask(
      undefined,
      createMessage(["https://gw1.example", "https://gw2.example"]),
    );
    deepStrictEqual(requests, ["https://gw1.example", "https://gw2.example"]);
    strictEqual(permanentFailures.length, 0);
    strictEqual(queued.length, 1);
    const held = queued[0].message as OutboxMessage;
    strictEqual(held.attempt, 0);
    strictEqual(held.circuitHeld, true);
    ok(held.circuitHeldSince != null);
    strictEqual(held.inbox, inboxOn("https://gw1.example"));
    deepStrictEqual(held.gatewayInboxes, [inboxOn("https://gw1.example")]);
    strictEqual(Math.round(queued[0].options!.delay!.total("minute")), 60);
  });

  await t.step("preserves when the delivery was first held", async () => {
    mockGateways({
      "https://gw1.example": 500,
      "https://gw2.example": 500,
    });
    const { federation, queued } = setup({
      circuitBreaker: { failureThreshold: 10 },
    });
    const heldSince = Temporal.Now.instant().subtract({ hours: 1 }).toString();
    await federation.processQueuedTask(
      undefined,
      createMessage(["https://gw1.example", "https://gw2.example"], {
        circuitHeld: true,
        circuitHeldSince: heldSince,
      }),
    );
    strictEqual(queued.length, 1);
    const retry = queued[0].message as OutboxMessage;
    strictEqual(retry.attempt, 1);
    strictEqual(retry.circuitHeld, undefined);
    strictEqual(retry.circuitHeldSince, heldSince);
  });

  await t.step("drops a delivery held for too long", async () => {
    const requests = mockGateways({
      "https://gw1.example": 202,
      "https://gw2.example": 202,
    });
    const { federation, queued } = setup({
      circuitBreaker: { heldActivityTtl: { hours: 1 } },
    });
    await federation.processQueuedTask(
      undefined,
      createMessage(["https://gw1.example", "https://gw2.example"], {
        circuitHeld: true,
        circuitHeldSince: Temporal.Now.instant().subtract({ hours: 2 })
          .toString(),
      }),
    );
    deepStrictEqual(requests, []);
    strictEqual(queued.length, 0);
  });

  await t.step("falls back to the ordinary path for one gateway", async () => {
    const requests = mockGateways({ "https://gw1.example": 404 });
    const { federation, queued, permanentFailures } = setup();
    await federation.processQueuedTask(
      undefined,
      createMessage(["https://gw1.example"]),
    );
    deepStrictEqual(requests, ["https://gw1.example"]);
    strictEqual(queued.length, 0);
    strictEqual(permanentFailures.length, 1);
  });

  fetchMock.hardReset();
});
