import { mockDocumentLoader, test } from "@fedify/fixture";
import {
  Activity,
  Create,
  FeaturedCollection,
  FeatureRequest,
  Person,
} from "@fedify/vocab";
import { FetchError, UrlError } from "@fedify/vocab-runtime";
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

for (const status of [400, 401, 403, 404, 410, 408, 429, 503]) {
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

async function lookupFallbackCollection(
  candidate: FeaturedCollection | Person | Error,
  outage: Error,
): Promise<URL | null> {
  const fallbackUrl = "https://example.com/fallback-collection";
  const context = createRequestContext({
    federation: createFederation<void>({ kv: new MemoryKvStore() }),
    url: target,
    data: undefined,
    documentLoader: async (url) => {
      if (url === collectionId.href) throw outage;
      assertEquals(url, fallbackUrl);
      if (candidate instanceof Error) throw candidate;
      return {
        document: await candidate.toJsonLd(),
        documentUrl: url,
        contextUrl: null,
      };
    },
    contextLoader: mockDocumentLoader,
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(Response.json({
      subject: collectionId.href,
      links: [{
        rel: "self",
        type: "application/activity+json",
        href: fallbackUrl,
      }],
    }));
  try {
    return await resolveFeatureRequestActor(
      context,
      new FeatureRequest({ instrument: collectionId }),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

for (
  const [label, candidate] of [
    [
      "permanent HTTP failure",
      new FetchError(
        collectionId,
        "HTTP 404",
        new Response(null, { status: 404 }),
      ),
    ],
    ["wrong type", new Person({ id: collectionId })],
    [
      "wrong ID",
      new FeaturedCollection({
        id: new URL("https://example.com/wrong"),
        attribution: owner,
      }),
    ],
    ["missing owner", new FeaturedCollection({ id: collectionId })],
    [
      "multiple owners",
      new FeaturedCollection({
        id: collectionId,
        attributions: [owner, target],
      }),
    ],
  ] as const
) {
  test(`actorless FeatureRequest preserves an outage after fallback ${label}`, async () => {
    const outage = new Error("Collection temporarily unavailable");
    assertEquals(
      await assertRejects(() => lookupFallbackCollection(candidate, outage)),
      outage,
    );
  });
}

test("actorless FeatureRequest accepts a valid fallback despite an earlier outage", async () => {
  assertEquals(
    await lookupFallbackCollection(
      new FeaturedCollection({ id: collectionId, attribution: owner }),
      new Error("Collection temporarily unavailable"),
    ),
    owner,
  );
});

type Authentication = "http" | "ld" | "proof" | "mixed" | "unsigned";

async function deliver(
  authentication: Authentication,
  options: {
    collection?: FeaturedCollection | Person;
    request?: Activity;
    queued?: boolean;
    skip?: boolean;
    reparsedInstrument?: URL;
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
  let collectionLookedUp = false;
  const contextUrl = "https://example.com/changing-context";
  const contextLoader = async (url: string) => {
    if (url === contextUrl) {
      return {
        document: {
          "@context": {
            featured: collectionLookedUp
              ? new URL(".", options.reparsedInstrument!).href
              : new URL(".", collectionId).href,
          },
        },
        documentUrl: url,
        contextUrl: null,
      };
    }
    return await mockDocumentLoader(url);
  };
  const documentLoader = async (url: string) => {
    if (url === options.reparsedInstrument?.href) {
      return {
        document: await new FeaturedCollection({
          id: options.reparsedInstrument,
          attribution: new URL("https://example.com/person3"),
        }).toJsonLd(),
        documentUrl: url,
        contextUrl: null,
      };
    }
    if (url === collectionId.href) {
      collectionLookedUp = true;
      if (!collectionAvailable) throw new Error("Collection unavailable");
      return {
        document: await collection.toJsonLd(),
        documentUrl: url,
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
  const body = authentication === "mixed"
    ? await signJsonLd(
      await (await signObject(
        activity,
        ed25519PrivateKey,
        ed25519Multikey.id!,
        { contextLoader: mockDocumentLoader },
      )).toJsonLd(),
      rsaPrivateKey2,
      rsaPublicKey2.id!,
      { contextLoader: mockDocumentLoader },
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
        contextLoader: mockDocumentLoader,
      },
    )).toJsonLd()
    : await activity.toJsonLd();
  if (options.reparsedInstrument != null) {
    const document = body as Record<string, unknown>;
    document["@context"] = [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/fep/7aa9",
      contextUrl,
    ];
    document.instrument = "featured:1";
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
