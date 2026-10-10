import { mockDocumentLoader, test } from "@fedify/fixture";
import {
  Activity,
  Create,
  FeaturedCollection,
  FeatureRequest,
  Object as ActivityObject,
  Person,
} from "@fedify/vocab";
import {
  type DocumentLoader,
  exportDidKey,
  FetchError,
  getDocumentLoader,
  UrlError,
} from "@fedify/vocab-runtime";
import { assert, assertEquals, assertRejects } from "@std/assert";
import { signRequest } from "../sig/http.ts";
import { signJsonLd, verifyJsonLd } from "../sig/ld.ts";
import { signObject, verifyObject } from "../sig/proof.ts";
import {
  ed25519Multikey,
  ed25519PrivateKey,
  rsaPrivateKey2,
  rsaPrivateKey3,
  rsaPublicKey2,
  rsaPublicKey3,
} from "../testing/keys.ts";
import {
  createInboxContext,
  createRequestContext,
} from "../testing/context.ts";
import { ActivityListenerSet } from "./activity-listener.ts";
import type { InboxContext } from "./context.ts";
import { handleInbox } from "./handler.ts";
import { MemoryKvStore } from "./kv.ts";
import { createFederation } from "./middleware.ts";
import type { MessageQueue } from "./mq.ts";
import type { InboxMessage } from "./queue.ts";
import {
  hasFeatureRequestSignature,
  resolveFeatureRequestActor,
} from "./feature-request.ts";
import type { InboxVerificationAttempt } from "../sig/verification.ts";

const owner = new URL("https://example.com/person2");
const collectionId = new URL("https://example.com/featured/1");
const target = new URL("https://receiver.example/users/bob");

async function lookupFailingCollection(error: Error): Promise<URL | null> {
  const context = createRequestContext({
    federation: createFederation<void>({ kv: new MemoryKvStore() }),
    url: target,
    data: undefined,
    documentLoader: () => Promise.reject(error),
    contextLoader: mockDocumentLoader,
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(new Response(null, { status: 404 }));
  try {
    return await resolveFeatureRequestActor(
      context,
      new FeatureRequest({ instrument: collectionId }),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("actorless FeatureRequest preserves collection lookup failures for retry", async () => {
  const outage = new Error("Collection temporarily unavailable");
  assertEquals(
    await assertRejects(() => lookupFailingCollection(outage)),
    outage,
  );
});

for (const status of [200, 204, 206, 400, 401, 403, 404, 410, 408, 429, 503]) {
  test(`actorless FeatureRequest classifies collection HTTP ${status}`, async () => {
    const error = new FetchError(
      collectionId,
      `HTTP ${status}`,
      new Response(null, { status }),
    );
    if (status === 408 || status === 429 || status >= 500) {
      assertEquals(
        await assertRejects(() => lookupFailingCollection(error)),
        error,
      );
    } else {
      assertEquals(await lookupFailingCollection(error), null);
    }
  });
}

test("actorless FeatureRequest rejects disallowed collection URLs", async () => {
  assertEquals(
    await lookupFailingCollection(new UrlError("Private address")),
    null,
  );
});

test("actorless FeatureRequest preserves collection DNS failures for retry", async () => {
  const error = new UrlError("DNS lookup failed", { reason: "dns" });
  assertEquals(
    await assertRejects(() => lookupFailingCollection(error)),
    error,
  );
});

for (const failure of ["503", "network"] as const) {
  test(`actorless FeatureRequest does not use WebFinger after a collection 404 (${failure})`, async () => {
    const error = new FetchError(
      collectionId,
      "HTTP 404",
      new Response(null, { status: 404 }),
    );
    const context = createRequestContext({
      federation: createFederation<void>({ kv: new MemoryKvStore() }),
      url: target,
      data: undefined,
      documentLoader: () => Promise.reject(error),
      contextLoader: mockDocumentLoader,
    });
    let fetches = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => {
      fetches++;
      return failure === "503"
        ? Promise.resolve(new Response(null, { status: 503 }))
        : Promise.reject(new Error("WebFinger unavailable"));
    };
    try {
      assertEquals(
        await resolveFeatureRequestActor(
          context,
          new FeatureRequest({ instrument: collectionId }),
        ),
        null,
      );
      assertEquals(fetches, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}

type Authentication = "http" | "ld" | "proof" | "mixed" | "unsigned";

async function deliver(
  authentication: Authentication,
  options: {
    collection?: FeaturedCollection | Person;
    collectionDocumentUrl?: string;
    collectionLoader?: DocumentLoader;
    relayObject?: URL;
    relayContextLoads?: number[];
    proofKeyId?: URL;
    uncoveredAttributionAt?: number;
    relayInstrument?: URL;
    replayedObject?: URL;
    request?: Activity;
    queued?: boolean;
    skip?: boolean;
    reparsedInstrument?: URL;
    replayedInstrument?: URL;
    onCollectionLookup?: () => void;
  } = {},
) {
  const collection = options.collection ?? new FeaturedCollection({
    id: collectionId,
    attribution: owner,
  });
  const activity = options.request ?? new FeatureRequest({
    id: new URL("https://example.com/requests/1"),
    object: target,
    instrument: collectionId,
  });
  let collectionAvailable = true;
  let contextLoads = 0;
  let replayContextLoads = 0;
  const contextUrl = "https://example.com/changing-context";
  const contextLoader = async (url: string) => {
    if (url === contextUrl) {
      contextLoads++;
      if (!collectionAvailable) replayContextLoads++;
      return {
        document: {
          "@context": {
            ...(options.proofKeyId != null
              ? {
                request: {
                  "@id": `ap+ef61://${
                    options.proofKeyId.href.split("#")[0]
                  }/requests/`,
                  "@prefix": true,
                },
              }
              : {}),
            ...(options.proofKeyId != null &&
                contextLoads === options.uncoveredAttributionAt
              ? {
                object: {
                  "@id": "https://www.w3.org/ns/activitystreams#attributedTo",
                  "@type": "@id",
                },
              }
              : {}),
            receiver: new URL(
              ".",
              (options.relayContextLoads?.includes(contextLoads) ??
                  contextLoads % 2 === 1) && options.relayObject != null
                ? options.relayObject
                : !collectionAvailable && options.replayedObject != null
                ? options.replayedObject
                : target,
            ).href,
            featured: new URL(
              ".",
              (options.relayContextLoads?.includes(contextLoads) ??
                  contextLoads % 2 === 1) && options.relayInstrument != null
                ? options.relayInstrument
                : !collectionAvailable && options.replayedInstrument != null
                ? options.replayedInstrument
                : contextLoads > 1 && options.reparsedInstrument != null
                ? options.reparsedInstrument
                : collectionId,
            ).href,
          },
        },
        documentUrl: url,
        contextUrl: null,
      };
    }
    if (
      (url.startsWith("https://example.com/collection-context") ||
        url === "https://[invalid") &&
      options.collectionLoader != null
    ) {
      return await options.collectionLoader(url);
    }
    return await mockDocumentLoader(url);
  };
  const documentLoader = async (url: string) => {
    if (
      url === options.reparsedInstrument?.href ||
      url === options.relayInstrument?.href
    ) {
      return {
        document: await new FeaturedCollection({
          id: new URL(url),
          attribution: new URL("https://example.com/person3"),
        }).toJsonLd(),
        documentUrl: url,
        contextUrl: null,
      };
    }
    if (url === collectionId.href) {
      options.onCollectionLookup?.();
      if (options.collectionLoader != null) {
        return await options.collectionLoader(url);
      }
      if (!collectionAvailable) throw new Error("Collection unavailable");
      return {
        document: await collection.toJsonLd(),
        documentUrl: options.collectionDocumentUrl ?? url,
        contextUrl: null,
      };
    }
    if (url === rsaPublicKey2.id!.href) {
      return {
        document: await rsaPublicKey2.clone({
          owner: new URL("https://example.com/person"),
        }).toJsonLd(),
        documentUrl: url,
        contextUrl: null,
      };
    }
    return await mockDocumentLoader(url);
  };
  const relayContext = [
    "https://www.w3.org/ns/activitystreams",
    "https://w3id.org/security/data-integrity/v1",
    "https://w3id.org/fep/7aa9",
    contextUrl,
  ];
  const ownerContextLoader: DocumentLoader = (url) =>
    url === contextUrl
      ? Promise.resolve({
        document: {
          "@context": {
            ...(options.proofKeyId != null
              ? {
                request: {
                  "@id": `ap+ef61://${
                    options.proofKeyId.href.split("#")[0]
                  }/requests/`,
                  "@prefix": true,
                },
              }
              : {}),
            receiver: new URL(".", target).href,
            featured: new URL(".", collectionId).href,
          },
        },
        documentUrl: url,
        contextUrl: null,
      })
      : mockDocumentLoader(url);
  const relayContextLoader: DocumentLoader = (url) =>
    url === contextUrl
      ? Promise.resolve({
        document: {
          "@context": {
            ...(options.proofKeyId != null
              ? {
                request: {
                  "@id": `ap+ef61://${
                    options.proofKeyId.href.split("#")[0]
                  }/requests/`,
                  "@prefix": true,
                },
              }
              : {}),
            receiver: new URL(".", options.relayObject ?? target).href,
            featured:
              new URL(".", options.relayInstrument ?? collectionId).href,
          },
        },
        documentUrl: url,
        contextUrl: null,
      })
      : mockDocumentLoader(url);
  const changingRelay = options.relayObject != null ||
    options.relayInstrument != null;
  const body = authentication === "mixed"
    ? await signJsonLd(
      await (await signObject(
        activity,
        ed25519PrivateKey,
        options.proofKeyId ?? ed25519Multikey.id!,
        {
          contextLoader: changingRelay
            ? ownerContextLoader
            : mockDocumentLoader,
          context: changingRelay ? relayContext : undefined,
        },
      )).toJsonLd({
        format: "compact",
        contextLoader: changingRelay ? ownerContextLoader : mockDocumentLoader,
        context: changingRelay ? relayContext : undefined,
      }),
      rsaPrivateKey2,
      rsaPublicKey2.id!,
      {
        contextLoader: changingRelay ? relayContextLoader : mockDocumentLoader,
      },
    )
    : authentication === "ld"
    ? await signJsonLd(
      await activity.toJsonLd(),
      rsaPrivateKey3,
      rsaPublicKey3.id!,
      {
        contextLoader: mockDocumentLoader,
      },
    )
    : authentication === "proof"
    ? await (await signObject(
      activity,
      ed25519PrivateKey,
      ed25519Multikey.id!,
      {
        contextLoader,
        context:
          options.replayedInstrument != null || options.replayedObject != null
            ? [
              "https://www.w3.org/ns/activitystreams",
              "https://w3id.org/security/data-integrity/v1",
              "https://w3id.org/fep/7aa9",
              contextUrl,
            ]
            : undefined,
      },
    )).toJsonLd({
      format: "compact",
      contextLoader,
      context:
        options.replayedInstrument != null || options.replayedObject != null
          ? [
            "https://www.w3.org/ns/activitystreams",
            "https://w3id.org/security/data-integrity/v1",
            "https://w3id.org/fep/7aa9",
            contextUrl,
          ]
          : undefined,
    })
    : await activity.toJsonLd();
  if (
    authentication !== "proof" &&
    (options.reparsedInstrument != null || options.replayedInstrument != null ||
      options.replayedObject != null)
  ) {
    const document = body as Record<string, unknown>;
    document["@context"] = [
      ...(Array.isArray(document["@context"])
        ? document["@context"]
        : [document["@context"]]),
      contextUrl,
    ];
    document.instrument = "featured:1";
    if (options.replayedObject != null) document.object = "receiver:bob";
  }
  let request = new Request("https://receiver.example/inbox", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (authentication === "http") {
    request = await signRequest(request, rsaPrivateKey3, rsaPublicKey3.id!);
  }
  const messages: InboxMessage[] = [];
  const queue: MessageQueue | undefined = options.queued
    ? {
      enqueue(message) {
        assertEquals(message.type, "inbox");
        messages.push(message as InboxMessage);
        return Promise.resolve();
      },
      async listen() {},
    }
    : undefined;
  const kv = new MemoryKvStore();
  const federation = createFederation<void>({
    kv,
    queue,
    documentLoaderFactory: () => documentLoader,
    contextLoaderFactory: () => contextLoader,
  });
  const received: Activity[] = [];
  const originals: unknown[] = [];
  let failOnce = false;
  const listener = (
    context: InboxContext<void>,
    receivedActivity: Activity,
  ) => {
    received.push(receivedActivity);
    if ("activity" in context) originals.push(context.activity);
    if (failOnce) {
      failOnce = false;
      throw new Error("Retry this request");
    }
  };
  federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
    .on(FeatureRequest, listener);
  const context = createRequestContext({
    federation,
    request,
    url: new URL(request.url),
    data: undefined,
    documentLoader,
    contextLoader,
  });
  const listeners = new ActivityListenerSet<InboxContext<void>>();
  listeners.add(FeatureRequest, listener);
  listeners.add(Create, listener);
  const response = await handleInbox(request, {
    recipient: null,
    context,
    inboxContextFactory(recipient, original, activityId, activityType) {
      return {
        ...createInboxContext({ ...context, clone: undefined, recipient }),
        activity: original,
        activityId,
        activityType,
      };
    },
    kv,
    kvPrefixes: {
      activityIdempotence: ["_fedify", "activityIdempotence"],
      publicKey: ["_fedify", "publicKey"],
      acceptSignatureNonce: ["_fedify", "acceptSignatureNonce"],
    },
    actorDispatcher: () => new Person({ id: target }),
    inboxListeners: listeners,
    onNotFound: () => new Response(null, { status: 404 }),
    queue,
    signatureTimeWindow: { minutes: 5 },
    skipSignatureVerification: options.skip ?? false,
  });
  return {
    response,
    received,
    originals,
    body,
    messages,
    get replayContextLoads() {
      return replayContextLoads;
    },
    async replay(retry = false) {
      collectionAvailable = false;
      failOnce = retry;
      await federation.processQueuedTask(undefined, messages[0]);
      if (retry) {
        assertEquals(messages.length, 2);
        await federation.processQueuedTask(undefined, messages[1]);
      }
    },
  };
}

test("actorless FeatureRequest binds HTTP signer to the reparsed collection owner", async () => {
  const result = await deliver("http", {
    reparsedInstrument: new URL("https://example.com/other-featured/1"),
  });
  assertEquals(result.response.status, 401);
  assertEquals(result.received, []);
});

for (const authentication of ["http", "proof"] as const) {
  for (
    const malformed of [
      "collection JSON",
      "context JSON",
      "context definition",
      "context URL",
    ] as const
  ) {
    test(`actorless FeatureRequest rejects malformed ${malformed} with ${authentication} authentication`, async () => {
      const document = await new FeaturedCollection({
        id: collectionId,
        attribution: owner,
      }).toJsonLd() as Record<string, unknown>;
      const contexts = Array.isArray(document["@context"])
        ? document["@context"]
        : [document["@context"]];
      if (malformed === "context JSON") {
        document["@context"] = [
          ...contexts,
          "https://example.com/collection-context",
        ];
      } else if (malformed === "context definition") {
        document["@context"] = [...contexts, { broken: 42 }];
      } else if (malformed === "context URL") {
        document["@context"] = [...contexts, "https://[invalid"];
      }
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (input) => {
        const url = input instanceof Request ? input.url : String(input);
        return Promise.resolve(
          new Response(
            malformed === "collection JSON" ||
              url === "https://example.com/collection-context"
              ? "{"
              : JSON.stringify(document),
            { headers: { "Content-Type": "application/activity+json" } },
          ),
        );
      };
      try {
        const result = await deliver(authentication, {
          collectionLoader: getDocumentLoader({ allowPrivateAddress: true }),
        });
        assertEquals(result.response.status, 400);
        assertEquals(result.received, []);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  }
}

for (
  const error of [new TypeError("fetch failed"), new TypeError("loader bug")]
) {
  test(`actorless FeatureRequest preserves collection TypeError for retry: ${error.message}`, async () => {
    assertEquals(
      await assertRejects(() => lookupFailingCollection(error)),
      error,
    );
  });
}

for (
  const error of [new TypeError("fetch failed"), new TypeError("loader bug")]
) {
  test(`actorless FeatureRequest preserves context TypeError for retry: ${error.message}`, async () => {
    const document = await new FeaturedCollection({
      id: collectionId,
      attribution: owner,
    }).toJsonLd() as Record<string, unknown>;
    const contexts = Array.isArray(document["@context"])
      ? document["@context"]
      : [document["@context"]];
    document["@context"] = [
      ...contexts,
      "https://example.com/collection-context",
    ];
    assertEquals(
      await assertRejects(() =>
        deliver("http", {
          collectionLoader: (url) =>
            url === collectionId.href
              ? Promise.resolve({
                document,
                documentUrl: url,
                contextUrl: null,
              })
              : Promise.reject(error),
        })
      ),
      error,
    );
  });
}

for (
  const error of [
    new TypeError("Invalid JSON-LD: null."),
    new TypeError("Invalid URL"),
  ]
) {
  test(`actorless FeatureRequest rejects collection validation errors: ${error.message}`, async () => {
    assertEquals(await lookupFailingCollection(error), null);
  });
}

test("actorless FeatureRequest preserves wrapped remote context failures for retry", async () => {
  const error = Object.assign(
    new Error("Remote context temporarily unavailable"),
    {
      name: "jsonld.SyntaxError",
      details: { code: "loading remote context failed" },
    },
  );
  assertEquals(
    await assertRejects(() => lookupFailingCollection(error)),
    error,
  );
});

for (const queued of [false, true]) {
  for (const field of ["object", "instrument"] as const) {
    test(`actorless FeatureRequest uses the owner's proof view after relay ${field} changes (${queued ? "queued" : "direct"})`, async () => {
      const result = await deliver("mixed", {
        queued,
        ...(field === "object"
          ? { relayObject: new URL("https://attacker.example/users/bob") }
          : {
            relayInstrument: new URL("https://example.com/other-featured/1"),
          }),
      });
      assertEquals(result.response.status, 202);
      if (queued) await result.replay(true);
      assertEquals(
        result.received.map((activity) => activity.objectId),
        queued ? [target, target] : [target],
      );
      assertEquals(
        result.received.map((activity) => activity.instrumentId),
        queued ? [collectionId, collectionId] : [collectionId],
      );
      assertEquals(
        result.received.map((activity) => activity.actorId),
        queued ? [owner, owner] : [owner],
      );
      if (queued) assertEquals(result.messages[1].activity, result.body);
      assertEquals(result.originals[0], result.body);
    });
  }
}

for (const authentication of ["http", "proof"] as const) {
  for (const field of ["published", "duration"] as const) {
    test(`actorless FeatureRequest rejects malformed temporal collection ${field} with ${authentication} authentication`, async () => {
      const document = await new FeaturedCollection({
        id: collectionId,
        attribution: owner,
      }).toJsonLd() as Record<string, unknown>;
      document[field] = { "@value": "not-a-temporal-value" };
      const result = await deliver(authentication, {
        collectionLoader: (url) =>
          Promise.resolve({ document, documentUrl: url, contextUrl: null }),
      });
      assertEquals(result.response.status, 400);
      assertEquals(result.received, []);
    });
  }
}

test("actorless FeatureRequest preserves collection loader RangeError for retry", async () => {
  const error = new RangeError("Loader temporarily failed");
  assertEquals(
    await assertRejects(() => lookupFailingCollection(error)),
    error,
  );
});

test("actorless FeatureRequest preserves context loader RangeError despite malformed temporal fields", async () => {
  const error = new RangeError("Context loader temporarily failed");
  const document = await new FeaturedCollection({
    id: collectionId,
    attribution: owner,
  }).toJsonLd() as Record<string, unknown>;
  const contexts = Array.isArray(document["@context"])
    ? document["@context"]
    : [document["@context"]];
  document["@context"] = [
    ...contexts,
    "https://example.com/collection-context",
  ];
  document.published = { "@value": "not-a-date" };
  assertEquals(
    await assertRejects(() =>
      deliver("http", {
        collectionLoader: (url) =>
          url === collectionId.href
            ? Promise.resolve({ document, documentUrl: url, contextUrl: null })
            : Promise.reject(error),
      })
    ),
    error,
  );
});

for (const authentication of ["http", "proof"] as const) {
  for (
    const kind of ["recursive context inclusion", "context overflow"] as const
  ) {
    test(`actorless FeatureRequest rejects ${kind} with ${authentication} authentication`, async () => {
      const document = await new FeaturedCollection({
        id: collectionId,
        attribution: owner,
      }).toJsonLd() as Record<string, unknown>;
      const contexts = Array.isArray(document["@context"])
        ? document["@context"]
        : [document["@context"]];
      const firstContext = "https://example.com/collection-context/0";
      document["@context"] = [...contexts, firstContext];
      let loads = 0;
      const result = await deliver(authentication, {
        collectionLoader: (url) => {
          if (url === collectionId.href) {
            return Promise.resolve({
              document,
              documentUrl: url,
              contextUrl: null,
            });
          }
          loads++;
          assert(loads <= 20);
          const nextContext = kind === "recursive context inclusion"
            ? firstContext
            : `https://example.com/collection-context/${loads}`;
          return Promise.resolve({
            document: { "@context": nextContext },
            documentUrl: url,
            contextUrl: null,
          });
        },
      });
      assertEquals(result.response.status, 400);
      assertEquals(result.received, []);
    });
  }
}

test("actorless FeatureRequest rejects cross-origin collection redirects", async () => {
  const result = await deliver("http", {
    collectionDocumentUrl: "https://attacker.example/forged-collection",
  });
  assertEquals(result.response.status, 400);
  assertEquals(result.received, []);
});

test("actorless FeatureRequest accepts same-origin collection redirects", async () => {
  const result = await deliver("http", {
    collectionDocumentUrl: "https://example.com/redirected-collection",
  });
  assertEquals(result.response.status, 202);
});

for (const authentication of ["http", "proof"] as const) {
  for (const field of ["instrument", "object"] as const) {
    test(`actorless FeatureRequest freezes ${authentication} ${field} across changing queue contexts`, async () => {
      const result = await deliver(authentication, {
        queued: true,
        ...(field === "instrument"
          ? {
            replayedInstrument: new URL("https://example.com/other-featured/1"),
          }
          : { replayedObject: new URL("https://attacker.example/users/bob") }),
      });
      assertEquals(result.response.status, 202);
      await result.replay(true);
      assertEquals(result.received.map((activity) => activity.instrumentId), [
        collectionId,
        collectionId,
      ]);
      assertEquals(result.received.map((activity) => activity.objectId), [
        target,
        target,
      ]);
      assertEquals(result.received.map((activity) => activity.actorId), [
        owner,
        owner,
      ]);
      assertEquals(result.messages[1].activity, result.body);
      assertEquals(result.replayContextLoads, 0);
      if (authentication === "proof") {
        assert(await result.received[0].getProof() != null);
      }
    });
  }
}

for (const authentication of ["http", "ld", "proof", "mixed"] as const) {
  test(`actorless FeatureRequest accepts ${authentication} authentication`, async () => {
    const result = await deliver(authentication);
    assertEquals(result.response.status, 202);
    assertEquals(result.received.length, 1);
    assertEquals(result.received[0].actorId, owner);
    assertEquals(result.originals, [result.body]);
    assertEquals((result.body as { actor?: unknown }).actor, undefined);
    if (authentication === "ld") {
      assert(
        await verifyJsonLd(result.body, {
          documentLoader: mockDocumentLoader,
          contextLoader: mockDocumentLoader,
        }),
      );
    } else if (authentication === "proof" || authentication === "mixed") {
      const { signature: _, ...withoutSignature } = result.body as Record<
        string,
        unknown
      >;
      assert(
        await verifyObject(Activity, withoutSignature, {
          documentLoader: mockDocumentLoader,
          contextLoader: mockDocumentLoader,
        }) != null,
      );
    }
  });

  test(`actorless FeatureRequest rejects ${authentication} signer/owner mismatch`, async () => {
    const result = await deliver(authentication, {
      collection: new FeaturedCollection({
        id: collectionId,
        attribution: new URL("https://example.com/person3"),
      }),
    });
    assertEquals(result.response.status, 401);
    assertEquals(result.received, []);
  });

  test(`actorless FeatureRequest preserves ${authentication} actor and raw payload through queue retry`, async () => {
    const result = await deliver(authentication, { queued: true });
    assertEquals(result.response.status, 202);
    assertEquals(result.received, []);
    assertEquals(result.messages[0].featureRequestActor, owner.href);
    assertEquals(result.messages[0].activity, result.body);
    await result.replay(true);
    assertEquals(result.received.map((activity) => activity.actorId), [
      owner,
      owner,
    ]);
    assertEquals(result.messages[1].featureRequestActor, owner.href);
    assertEquals(result.messages[1].activity, result.body);
  });
}

test("actorless FeatureRequest does not fetch a collection before authentication", async () => {
  let lookups = 0;
  const result = await deliver("unsigned", {
    onCollectionLookup: () => lookups++,
  });
  assertEquals(result.response.status, 401);
  assertEquals(lookups, 0);
  assertEquals(result.received, []);
});

test("actorless FeatureRequest requires an actual signature, not an empty proof set", async () => {
  const result = await deliver("unsigned");
  assertEquals(result.response.status, 401);
  assertEquals(result.received, []);
});

test("actorless FeatureRequest respects explicit signature verification bypass", async () => {
  const result = await deliver("unsigned", { skip: true });
  assertEquals(result.response.status, 202);
  assertEquals(result.received[0].actorId, owner);
});

for (
  const [name, collection] of [
    ["missing owner", new FeaturedCollection({ id: collectionId })],
    [
      "multiple owners",
      new FeaturedCollection({
        id: collectionId,
        attributions: [owner, target],
      }),
    ],
    [
      "wrong id",
      new FeaturedCollection({
        id: new URL("https://example.com/other"),
        attribution: owner,
      }),
    ],
    ["wrong type", new Person({ id: collectionId })],
  ] as const
) {
  test(`actorless FeatureRequest rejects a collection with ${name}`, async () => {
    const result = await deliver("http", { collection });
    assertEquals(result.response.status, 400);
    assertEquals(result.received, []);
  });
}

test("actorless FeatureRequest does not trust an embedded collection owner", async () => {
  const result = await deliver("http", {
    collection: new FeaturedCollection({
      id: collectionId,
      attribution: target,
    }),
    request: new FeatureRequest({
      id: new URL("https://example.com/requests/1"),
      object: target,
      instrument: new FeaturedCollection({
        id: collectionId,
        attribution: owner,
      }),
    }),
  });
  assertEquals(result.response.status, 401);
  assertEquals(result.received, []);
});

test("actorless FeatureRequest cannot use a signature from a rejected proof attempt", async () => {
  const result = await deliver("proof", {
    request: new FeatureRequest({
      id: new URL("https://example.com/requests/1"),
      object: target,
      instrument: collectionId,
      attribution: target,
    }),
  });
  assertEquals(result.response.status, 401);
  assertEquals(result.received, []);
});

test("actorless activity types other than FeatureRequest still fail", async () => {
  const result = await deliver("ld", {
    request: new Create({ id: new URL("https://example.com/requests/1") }),
  });
  assertEquals(result.response.status, 400);
  assertEquals(result.received, []);
});

test("actorful FeatureRequest retains existing actor authentication", async () => {
  const result = await deliver("http", {
    request: new FeatureRequest({
      id: new URL("https://example.com/requests/1"),
      actor: target,
      object: target,
      instrument: collectionId,
    }),
  });
  assertEquals(result.response.status, 401);
  assertEquals(result.received, []);
});

test("actorless FeatureRequest portable authentication requires the owner's DID key", () => {
  const did = "did:key:z6MknSLrJoTcukLrE435h2FyQkJnv8cGxvgxU1xJ3zKSu8jL";
  const actor = new URL(`ap://${encodeURIComponent(did)}/actor`);
  const attempts = (keyId: URL): InboxVerificationAttempt[] => [{
    mechanism: "objectIntegrity",
    subject: { id: null, pointer: "" },
    status: "verified",
    checks: [],
    signatures: [{
      mechanism: "objectIntegrity",
      proofId: null,
      proofIndex: 0,
      declaredKeyId: keyId.href,
      triedKeys: [],
      status: "verified",
      key: {
        type: "multikey",
        id: keyId,
        controllerId: actor,
        publicKey: ed25519Multikey.publicKey,
      },
    }],
  }];
  assert(
    !hasFeatureRequestSignature(
      attempts(new URL("https://gateway.example/key")),
      actor,
      "objectIntegrity",
    ),
  );
  assert(
    hasFeatureRequestSignature(
      attempts(new URL(`${did}#key`)),
      actor,
      "objectIntegrity",
    ),
  );
  assert(
    !hasFeatureRequestSignature(
      attempts(new URL(`${did}#key`)),
      actor,
      "linkedData",
    ),
  );
});

for (const queued of [false, true]) {
  test(`actorless FeatureRequest rejects stale portable proof evidence (${queued ? "queued" : "direct"})`, async () => {
    const did = await exportDidKey(ed25519Multikey.publicKey!);
    const result = await deliver("mixed", {
      queued,
      proofKeyId: new URL(`${did}#${did.substring("did:key:".length)}`),
      request: new FeatureRequest({
        id: new URL(`ap://${encodeURIComponent(did)}/requests/1`),
        object: target,
        instrument: collectionId,
      }),
      relayObject: new URL("https://attacker.example/users/bob"),
      // The discarded portable attempt verifies the owner's view; the
      // authoritative retry adds an uncovered attribution and returns null.
      // LDS normalization loads once; the discarded portable verification
      // loads 12 times. The memoized owner-proof retry starts at load 14.
      relayContextLoads: [1, 14],
      uncoveredAttributionAt: 14,
      collection: new FeaturedCollection({
        id: collectionId,
        attribution: new URL(`ap://${encodeURIComponent(did)}/actor`),
      }),
    });
    assertEquals(result.response.status, 401);
    assertEquals(result.received, []);
    assertEquals(result.messages, []);
  });
}

for (const authentication of ["http", "proof"] as const) {
  test(`actorless FeatureRequest rejects oversized collection responses with ${authentication} authentication`, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(null, {
          headers: {
            "Content-Type": "application/activity+json",
            "Content-Length": String(16 * 1024 * 1024 + 1),
          },
        }),
      );
    try {
      const result = await deliver(authentication, {
        collectionLoader: getDocumentLoader({ allowPrivateAddress: true }),
      });
      assertEquals(result.response.status, 400);
      assertEquals(result.received, []);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}

test("actorless FeatureRequest preserves collection FetchError without a response for retry", async () => {
  const error = new FetchError(collectionId, "Connection lost");
  assertEquals(
    await assertRejects(() => lookupFailingCollection(error)),
    error,
  );
});

for (const authentication of ["http", "proof"] as const) {
  for (const resource of ["collection", "context"] as const) {
    for (const oversized of [false, true]) {
      test(`actorless FeatureRequest rejects ${oversized ? "oversized" : "invalid"} HTML ${resource} responses with ${authentication} authentication`, async () => {
        const document = await new FeaturedCollection({
          id: collectionId,
          attribution: owner,
        }).toJsonLd() as Record<string, unknown>;
        const contextUrl = "https://example.com/collection-context/html";
        if (resource === "context") {
          const contexts = Array.isArray(document["@context"])
            ? document["@context"]
            : [document["@context"]];
          document["@context"] = [...contexts, contextUrl];
        }
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (input) => {
          const url = input instanceof Request ? input.url : String(input);
          const html = resource === "collection" || url === contextUrl;
          return Promise.resolve(
            new Response(
              html
                ? "<html><body>No ActivityPub document</body></html>"
                : JSON.stringify(document),
              {
                headers: {
                  "Content-Type": html
                    ? "text/html"
                    : "application/activity+json",
                  ...(html && oversized
                    ? { "Content-Length": String(16 * 1024 * 1024 + 1) }
                    : {}),
                },
              },
            ),
          );
        };
        try {
          const result = await deliver(authentication, {
            collectionLoader: getDocumentLoader({ allowPrivateAddress: true }),
          });
          assertEquals(result.response.status, 400);
          assertEquals(result.received, []);
        } finally {
          globalThis.fetch = originalFetch;
        }
      });
    }
  }
}

for (const authentication of ["http", "ld", "proof"] as const) {
  for (const anonymousFirst of [false, true]) {
    test(`actorless FeatureRequest rejects an anonymous instrument ${anonymousFirst ? "before" : "after"} the collection with ${authentication} authentication`, async () => {
      let lookups = 0;
      const anonymous = new ActivityObject({ name: "No collection ID" });
      const result = await deliver(authentication, {
        request: new FeatureRequest({
          id: new URL("https://example.com/requests/ambiguous"),
          object: target,
          instruments: anonymousFirst
            ? [anonymous, collectionId]
            : [collectionId, anonymous],
        }),
        onCollectionLookup: () => {
          lookups++;
        },
      });
      assertEquals(result.response.status, 400);
      assertEquals(result.received, []);
      assertEquals(lookups, 0);
    });
  }
}
