import {
  createTestTracerProvider,
  mockDocumentLoader,
  test,
} from "@fedify/fixture";
import {
  Create,
  CryptographicKey,
  FeatureRequest,
  Person,
} from "@fedify/vocab";
import {
  type DocumentLoader,
  encodeMultibase,
  FetchError,
  preloadedContexts,
  type RemoteDocument,
} from "@fedify/vocab-runtime";
import serialize from "json-canon";
import { assert, assertEquals, assertFalse } from "@std/assert";
import { signRequest } from "../sig/http.ts";
import { signJsonLd } from "../sig/ld.ts";
import { signObject } from "../sig/proof.ts";
import {
  ed25519PrivateKey,
  rsaPrivateKey2,
  rsaPrivateKey3,
  rsaPublicKey2,
  rsaPublicKey3,
} from "../testing/keys.ts";
import type { InboxContext } from "./context.ts";
import {
  type InboxAuthenticationEvidence,
  isActorAuthenticated,
} from "./inbox-authentication.ts";
import { MemoryKvStore } from "./kv.ts";
import { KvKeyCache } from "./keycache.ts";
import type { InboxRequestReport } from "./inbox-report.ts";
import { expandDocument } from "./inbox-view.ts";
import { createFederation, type InboxContextImpl } from "./middleware.ts";
import type { MessageQueue } from "./mq.ts";
import type { InboxMessage, Message } from "./queue.ts";

const SIGNER = new URL("https://example.com/person2");
const RSA_KEY = new URL("https://example.com/person2#key3");
const ED25519_KEY = new URL("https://example.com/person2#key4");
const TARGET = new URL("https://example.com/users/alice");
const COLLECTION = new URL("https://example.com/person2/featured/1");
const MUTABLE_CONTEXT = "https://remote.example/contexts/mutable";
const RELAY = new URL("https://example.com/relay");
const RELAY_KEY = new URL("https://example.com/relay#main-key");
const { publicKeyPem: RELAY_PEM } = await rsaPublicKey2.toJsonLd({
  contextLoader: mockDocumentLoader,
}) as { publicKeyPem: string };

/** The document Mastodon sends, which declares no actor. */
function featureRequestDocument(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/fep/7aa9",
    ],
    id: "https://example.com/person2/featured/1/requests/1",
    type: "FeatureRequest",
    object: TARGET.href,
    instrument: COLLECTION.href,
    ...extra,
  };
}

interface Received {
  readonly activity: FeatureRequest;
  readonly authentication: InboxAuthenticationEvidence;
  readonly rawActivity: unknown;
}

class CapturingQueue implements MessageQueue {
  readonly messages: Message[] = [];
  readonly maxMessageSize?: number;

  constructor(maxMessageSize?: number) {
    this.maxMessageSize = maxMessageSize;
  }

  enqueue(message: Message): Promise<void> {
    this.messages.push(structuredClone(message));
    return Promise.resolve();
  }

  listen(): Promise<void> {
    return new Promise(() => {});
  }
}

interface SetupOptions {
  readonly unavailable?: readonly string[];
  readonly kv?: MemoryKvStore;
  readonly allowActorless?: boolean;
  readonly queue?: CapturingQueue;
  readonly contextLoads?: string[];
  readonly failOnce?: { failed: boolean };
}

function setup(options: SetupOptions = {}) {
  const received: Received[] = [];
  const reports: InboxRequestReport[] = [];
  const [tracerProvider, spanExporter] = createTestTracerProvider();
  let mutableLoads = 0;
  // A remote context whose meaning changes every time it is loaded:
  const loader: DocumentLoader = async (url, loaderOptions) => {
    options.contextLoads?.push(url);
    if (options.unavailable?.includes(url)) {
      throw new FetchError(
        url,
        "Service unavailable",
        new Response(null, { status: 503 }),
      );
    }
    if (url === RELAY.href || url === RELAY_KEY.href) {
      // A relay on the same origin, with a key of its own:
      return {
        contextUrl: null,
        documentUrl: RELAY.href,
        document: {
          "@context": [
            "https://www.w3.org/ns/activitystreams",
            "https://w3id.org/security/v1",
          ],
          id: RELAY.href,
          type: "Service",
          publicKey: {
            id: RELAY_KEY.href,
            type: "CryptographicKey",
            owner: RELAY.href,
            publicKeyPem: RELAY_PEM,
          },
        },
      } satisfies RemoteDocument;
    }
    if (url === MUTABLE_CONTEXT) {
      mutableLoads++;
      return {
        contextUrl: null,
        documentUrl: url,
        document: {
          "@context": {
            tgt: mutableLoads % 2 === 1
              ? {
                "@id": "https://www.w3.org/ns/activitystreams#object",
                "@type": "@id",
              }
              : {
                "@id": "https://www.w3.org/ns/activitystreams#target",
                "@type": "@id",
              },
          },
        },
      } satisfies RemoteDocument;
    }
    return await mockDocumentLoader(url, loaderOptions);
  };
  const federation = createFederation<void>({
    kv: options.kv ?? new MemoryKvStore(),
    tracerProvider,
    documentLoaderFactory: () => loader,
    contextLoaderFactory: () => loader,
    authenticatedDocumentLoaderFactory: () => loader,
    queue: options.queue,
    manuallyStartQueue: true,
  });
  federation.setActorDispatcher(
    "/users/{identifier}",
    (ctx, identifier) =>
      new Person({
        id: ctx.getActorUri(identifier),
        inbox: ctx.getInboxUri(identifier),
      }),
  ).setKeyPairsDispatcher(() => [
    { privateKey: rsaPrivateKey2, publicKey: rsaPublicKey2.publicKey! },
  ]);
  federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
    .on(FeatureRequest, (ctx: InboxContext<void>, activity) => {
      if (options.failOnce != null && !options.failOnce.failed) {
        options.failOnce.failed = true;
        throw new Error("Temporary failure.");
      }
      received.push({
        activity,
        authentication: ctx.authentication,
        rawActivity: (ctx as InboxContextImpl<void>).activity,
      });
    }, { allowActorless: options.allowActorless ?? true })
    .on(Create, () => {})
    .onRequestFinished((_ctx, report) => {
      reports.push(report);
    });
  return { federation, received, reports, spanExporter };
}

function post(body: unknown): Request {
  return new Request("https://example.com/users/alice/inbox", {
    method: "POST",
    headers: { "Content-Type": "application/activity+json" },
    body: JSON.stringify(body),
  });
}

async function postSigned(body: unknown): Promise<Request> {
  return await signRequest(post(body), rsaPrivateKey3, RSA_KEY);
}

async function withLds(
  document: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const signed = await signJsonLd(document, rsaPrivateKey3, RSA_KEY, {
    contextLoader: mockDocumentLoader,
  });
  return signed as unknown as Record<string, unknown>;
}

async function withProof(
  document: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const activity = await FeatureRequest.fromJsonLd(document, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  const signed = await signObject(activity, ed25519PrivateKey, ED25519_KEY, {
    contextLoader: mockDocumentLoader,
  });
  return await signed.toJsonLd({
    format: "compact",
    contextLoader: mockDocumentLoader,
  }) as Record<string, unknown>;
}

/**
 * Signs a JSON document as is with an `eddsa-jcs-2022` proof, so that values
 * typed parsing would drop are covered by the proof as well.
 */
async function withRawProof(
  document: Record<string, unknown>,
  proofProperty = "proof",
): Promise<Record<string, unknown>> {
  const contexts = Array.isArray(document["@context"])
    ? document["@context"]
    : [document["@context"]];
  const unsecured = {
    ...document,
    "@context": [
      ...contexts,
      "https://w3id.org/security/data-integrity/v1",
      ...(proofProperty === "proof" ? [] : [{
        [proofProperty]: {
          "@id": "https://w3id.org/security#proof",
          "@type": "@id",
          "@container": "@graph",
        },
      }]),
    ],
  };
  const created = "2026-10-01T00:00:00Z";
  const proofConfig = {
    "@context": unsecured["@context"],
    type: "DataIntegrityProof",
    cryptosuite: "eddsa-jcs-2022",
    verificationMethod: ED25519_KEY.href,
    proofPurpose: "assertionMethod",
    created,
  };
  const digest = async (value: unknown) =>
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(serialize(value)),
      ),
    );
  const signed = new Uint8Array(
    await crypto.subtle.sign(
      "Ed25519",
      ed25519PrivateKey,
      new Uint8Array([
        ...await digest(proofConfig),
        ...await digest(unsecured),
      ]),
    ),
  );
  const { "@context": _, ...proof } = proofConfig;
  return {
    ...unsecured,
    [proofProperty]: {
      ...proof,
      proofValue: new TextDecoder().decode(
        encodeMultibase("base58btc", signed),
      ),
    },
  };
}

async function processQueue(
  federation: ReturnType<typeof setup>["federation"],
  queue: CapturingQueue,
): Promise<void> {
  while (queue.messages.length > 0) {
    const message = queue.messages.shift()!;
    await federation.processQueuedTask(undefined, message);
  }
}

test("Actorless FeatureRequest authenticated by HTTP Signatures", async () => {
  const { federation, received } = setup();
  const response = await federation.fetch(
    await postSigned(featureRequestDocument()),
    { contextData: undefined },
  );
  assertEquals(response.status, 202);
  assertEquals(received.length, 1);
  const [{ activity, authentication, rawActivity }] = received;
  assertEquals(activity.actorId, null);
  assertEquals(activity.instrumentId, COLLECTION);
  assertEquals(authentication.verified, true);
  assertEquals(authentication.documentSigners, []);
  assertEquals(
    authentication.requestSigners.map((p) => [p.kind, p.id.href, p.mechanism]),
    [["actor", SIGNER.href, "http-signatures"]],
  );
  assert(isActorAuthenticated(authentication, SIGNER));
  assertFalse(
    isActorAuthenticated(authentication, SIGNER, { scope: "document" }),
  );
  // No actor is synthesized anywhere:
  assertEquals(rawActivity, featureRequestDocument());
});

test("Actorless FeatureRequest authenticated by Linked Data Signatures", async () => {
  const { federation, received } = setup();
  const document = await withLds(featureRequestDocument());
  const response = await federation.fetch(post(document), {
    contextData: undefined,
  });
  assertEquals(response.status, 202);
  assertEquals(received.length, 1);
  assertEquals(
    received[0].authentication.documentSigners.map((p) => [
      p.id.href,
      p.mechanism,
    ]),
    [[SIGNER.href, "linked-data-signatures"]],
  );
  // The original signed payload is kept for forwarding:
  assertEquals(received[0].rawActivity, document);
});

test("Actorless FeatureRequest authenticated by Object Integrity Proofs", async () => {
  const { federation, received } = setup();
  const document = await withProof(featureRequestDocument());
  const response = await federation.fetch(post(document), {
    contextData: undefined,
  });
  assertEquals(response.status, 202);
  assertEquals(received.length, 1);
  assertEquals(
    received[0].authentication.documentSigners.map((p) => [
      p.kind,
      p.id.href,
      p.mechanism,
      p.keyId?.href,
    ]),
    [["actor", SIGNER.href, "object-integrity-proofs", ED25519_KEY.href]],
  );
});

test("Actorless activities need a listener that allows them", async () => {
  const { federation, received } = setup({ allowActorless: false });
  const response = await federation.fetch(
    await postSigned(featureRequestDocument()),
    { contextData: undefined },
  );
  assertEquals(response.status, 400);
  assertEquals(await response.text(), "Missing actor.");
  assertEquals(received, []);
});

test("Actorless activities need an authenticated principal", async () => {
  const { federation, received } = setup();
  // No signature at all, and a successful verification of zero proofs is not
  // an authentication either:
  const response = await federation.fetch(post(featureRequestDocument()), {
    contextData: undefined,
  });
  assertEquals(response.status, 401);
  assertEquals(received, []);
});

test("Actorless activities need the same origin as their signer", async () => {
  const { federation, received, reports, spanExporter } = setup();
  const response = await federation.fetch(
    await postSigned(
      featureRequestDocument({ id: "https://other.example/requests/1" }),
    ),
    { contextData: undefined },
  );
  assertEquals(response.status, 401);
  assertEquals(received, []);
  assertEquals(reports[0].authentication, {
    status: "rejected",
    reason: {
      type: "activity-origin-mismatch",
      activityId: new URL("https://other.example/requests/1"),
      actorIds: [SIGNER],
    },
  });
  assertEquals(
    spanExporter.getSpans("activitypub.inbox")[0]
      .attributes["activitypub.verification.failure_reason"],
    "activity-origin-mismatch",
  );
});

test("Actorless activities reject a verified key with no authenticated principal", async () => {
  const kv = new MemoryKvStore();
  // A valid cached key can verify the request without identifying an owner.
  // This exercises the post-verification public rejection, rather than the
  // earlier path for an unsigned or cryptographically invalid request.
  await new KvKeyCache(kv, ["_fedify", "publicKey"], {
    contextLoader: mockDocumentLoader,
  }).set(
    RSA_KEY,
    new CryptographicKey({
      id: RSA_KEY,
      publicKey: rsaPublicKey3.publicKey,
    }),
  );
  const { federation, received, reports, spanExporter } = setup({ kv });
  const response = await federation.fetch(
    await postSigned(featureRequestDocument()),
    { contextData: undefined },
  );
  assertEquals(response.status, 401);
  assertEquals(
    await response.text(),
    "No principal is authenticated for the activity.",
  );
  assertEquals(received, []);
  assertEquals(reports[0].authentication, {
    status: "rejected",
    reason: { type: "no-authenticated-principal" },
  });
  assertEquals(reports[0].attempts.at(-1)?.status, "verified");
  assertEquals(
    spanExporter.getSpans("activitypub.inbox")[0]
      .attributes["activitypub.verification.failure_reason"],
    "no-authenticated-principal",
  );
});

for (
  const [label, actor] of [
    ["an anonymous actor", { type: "Person", name: "Anonymous" }],
    ["an untyped actor", { name: "Anonymous" }],
    ["a blank node actor", { id: "_:b0" }],
  ] as const
) {
  for (const mechanism of ["http", "lds", "proof"] as const) {
    test(`Activities with ${label} are not actorless (${mechanism})`, async () => {
      const queue = new CapturingQueue();
      const { federation, received } = setup({ queue });
      const document = featureRequestDocument({ actor });
      const response = await federation.fetch(
        mechanism === "http" ? await postSigned(document) : post(
          mechanism === "lds"
            ? await withLds(document)
            : await withRawProof(document),
        ),
        { contextData: undefined },
      );
      assert(response.status >= 400, `${response.status}`);
      await processQueue(federation, queue);
      assertEquals(received, []);
    });
  }
}

test("Queued actorless activities keep their interpretation and evidence", async () => {
  const queue = new CapturingQueue();
  const contextLoads: string[] = [];
  const failOnce = { failed: false };
  const { federation, received } = setup({ queue, contextLoads, failOnce });
  const document = featureRequestDocument({
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/fep/7aa9",
      MUTABLE_CONTEXT,
    ],
    object: undefined,
    tgt: TARGET.href,
  });
  delete document.object;
  const response = await federation.fetch(await postSigned(document), {
    contextData: undefined,
  });
  assertEquals(response.status, 202);
  assertEquals(queue.messages.length, 1);
  const message = queue.messages[0] as InboxMessage;
  assertEquals(message.activity, document);
  assertEquals(message.verifiedView?.source, "activity");
  // The worker, and the retry after the listener fails once, replay the
  // interpretation without loading the context again:
  const loadsBefore = contextLoads.filter((url) => url === MUTABLE_CONTEXT)
    .length;
  await processQueue(federation, queue);
  assertEquals(
    contextLoads.filter((url) => url === MUTABLE_CONTEXT).length,
    loadsBefore,
  );
  assert(failOnce.failed);
  assertEquals(received.length, 1);
  assertEquals(received[0].activity.objectId, TARGET);
  assertEquals(received[0].activity.targetId, null);
  assertEquals(
    received[0].authentication.requestSigners.map((p) => p.id.href),
    [SIGNER.href],
  );
  assertEquals(received[0].authentication.expandedActivity.length, 1);
});

test("Queued actorless activities are dropped without evidence", async () => {
  const queue = new CapturingQueue();
  const { federation, received } = setup({ queue });
  const response = await federation.fetch(
    await postSigned(featureRequestDocument()),
    { contextData: undefined },
  );
  assertEquals(response.status, 202);
  const message = queue.messages.shift() as InboxMessage;
  // A message queued by an older version of Fedify has no evidence:
  const { authentication: _, verifiedView: __, ...legacy } = message;
  await federation.processQueuedTask(undefined, legacy);
  assertEquals(received, []);
  // A message whose evidence names nobody is not processed either:
  await federation.processQueuedTask(undefined, {
    ...message,
    authentication: {
      verified: true,
      requestSigners: [],
      documentSigners: [],
      originAuthenticated: [],
    },
  });
  assertEquals(received, []);
  // A message whose view is malformed is never replayed any other way:
  await federation.processQueuedTask(undefined, {
    ...message,
    verifiedView: { version: 2 } as unknown as InboxMessage["verifiedView"],
  });
  assertEquals(received, []);
  await federation.processQueuedTask(undefined, message);
  assertEquals(received.length, 1);
});

test("Actorless activities too large to enqueue are processed immediately", async () => {
  const queue = new CapturingQueue(512);
  const { federation, received } = setup({ queue });
  const response = await federation.fetch(
    await postSigned(featureRequestDocument()),
    { contextData: undefined },
  );
  assertEquals(response.status, 202);
  assertEquals(queue.messages, []);
  assertEquals(received.length, 1);
});

test("Activities processed by older queue workers are not processed again", async () => {
  const kv = new MemoryKvStore();
  const document = featureRequestDocument({ actor: SIGNER.href });
  await kv.set(
    [
      "_fedify",
      "activityIdempotence",
      "https://example.com",
      document.id as string,
    ],
    true,
  );
  const federation = createFederation<void>({
    kv,
    documentLoaderFactory: () => mockDocumentLoader,
    contextLoaderFactory: () => mockDocumentLoader,
    authenticatedDocumentLoaderFactory: () => mockDocumentLoader,
  });
  federation.setActorDispatcher(
    "/users/{identifier}",
    (ctx, identifier) => new Person({ id: ctx.getActorUri(identifier) }),
  ).setKeyPairsDispatcher(() => [
    { privateKey: rsaPrivateKey2, publicKey: rsaPublicKey2.publicKey! },
  ]);
  let calls = 0;
  federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
    .on(FeatureRequest, () => {
      calls++;
    });
  const response = await federation.fetch(await postSigned(document), {
    contextData: undefined,
  });
  assertEquals(response.status, 202);
  assertEquals(calls, 0);
});

test("Activities with an actor expose their evidence", async () => {
  const { federation, received } = setup();
  const response = await federation.fetch(
    await postSigned(featureRequestDocument({ actor: SIGNER.href })),
    { contextData: undefined },
  );
  assertEquals(response.status, 202);
  assertEquals(received.length, 1);
  assertEquals(
    received[0].authentication.requestSigners.map((p) => [
      p.id.href,
      p.mechanism,
      p.keyId?.href,
    ]),
    [[SIGNER.href, "http-signatures", RSA_KEY.href]],
  );
});

test("An author's proof is preferred to a relay's Linked Data Signature", async () => {
  const { federation, received } = setup();
  // The author signs the document with an Object Integrity Proof, and a relay
  // on the same origin adds its Linked Data Signature:
  const relayKey = RELAY_KEY;
  const document = await signJsonLd(
    await withRawProof(featureRequestDocument()),
    rsaPrivateKey2,
    relayKey,
    { contextLoader: mockDocumentLoader },
  ) as unknown as Record<string, unknown>;
  const response = await federation.fetch(post(document), {
    contextData: undefined,
  });
  assertEquals(response.status, 202);
  assertEquals(received.length, 1);
  assertEquals(
    received[0].authentication.documentSigners.map((p) => [
      p.id.href,
      p.mechanism,
    ]),
    [[SIGNER.href, "object-integrity-proofs"]],
  );
});

test("A proof that cannot be verified for now is not superseded", async () => {
  const { federation, received } = setup({
    unavailable: [
      "https://example.com/person2",
      "https://example.com/person2#key4",
    ],
  });
  const relayKey = RELAY_KEY;
  const document = await signJsonLd(
    await withRawProof(featureRequestDocument()),
    rsaPrivateKey2,
    relayKey,
    { contextLoader: mockDocumentLoader },
  ) as unknown as Record<string, unknown>;
  let status: number | undefined;
  try {
    const response = await federation.fetch(post(document), {
      contextData: undefined,
    });
    status = response.status;
  } catch {
    // An error thrown out of the inbox is retryable as well.
  }
  assert(status == null || status >= 500, `${status}`);
  assertEquals(received, []);
});

test("Context.routeActivity() exposes the evidence of verified proofs", async () => {
  const { federation, received } = setup();
  const document = await withRawProof(
    featureRequestDocument({ actor: SIGNER.href }),
  );
  const activity = await FeatureRequest.fromJsonLd(document, {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  const context = federation.createContext(
    new URL("https://example.com/"),
    undefined,
  );
  assert(await context.routeActivity("alice", activity));
  assertEquals(received.length, 1);
  assertEquals(
    received[0].authentication.documentSigners.map((p) => [
      p.id.href,
      p.mechanism,
    ]),
    [[SIGNER.href, "object-integrity-proofs"]],
  );
  assertEquals(received[0].authentication.originAuthenticated, []);
});

test("An author's aliased proof is preferred to a relay's signature", async () => {
  const { federation, received } = setup();
  const document = await signJsonLd(
    await withRawProof(featureRequestDocument(), "integrity"),
    rsaPrivateKey2,
    RELAY_KEY,
    { contextLoader: mockDocumentLoader },
  ) as unknown as Record<string, unknown>;
  const response = await federation.fetch(post(document), {
    contextData: undefined,
  });
  assertEquals(response.status, 202);
  assertEquals(received.length, 1);
  assertEquals(
    received[0].authentication.documentSigners.map((p) => [
      p.id.href,
      p.mechanism,
    ]),
    [[SIGNER.href, "object-integrity-proofs"]],
  );
});

for (const queued of [false, true]) {
  test(`Context.routeActivity() keeps the fetched interpretation (queued: ${queued})`, async () => {
    const queue = queued ? new CapturingQueue() : undefined;
    const { federation, received } = setup({ queue });
    const activityId = "https://example.com/person2/activities/fetched";
    const fetchedDocument = {
      "@context": [
        "https://www.w3.org/ns/activitystreams",
        "https://w3id.org/fep/7aa9",
      ],
      id: activityId,
      type: "FeatureRequest",
      actor: SIGNER.href,
      object: TARGET.href,
      instrument: COLLECTION.href,
    };
    // The caller's context loader overrides the ActivityStreams context so
    // that `object` means something else; the fetched activity is parsed
    // with the bundled one regardless:
    const overriding: DocumentLoader = async (url, options) => {
      if (url === "https://www.w3.org/ns/activitystreams") {
        return {
          contextUrl: null,
          documentUrl: url,
          document: {
            "@context": {
              ...(preloadedContexts[url] as {
                "@context": Record<string, unknown>;
              })["@context"],
              object: {
                "@id": "https://www.w3.org/ns/activitystreams#target",
                "@type": "@id",
              },
            },
          },
        };
      }
      return await mockDocumentLoader(url, options);
    };
    const context = federation.createContext(
      new URL("https://example.com/"),
      undefined,
    );
    const activity = await FeatureRequest.fromJsonLd(fetchedDocument, {
      documentLoader: mockDocumentLoader,
      contextLoader: mockDocumentLoader,
    });
    assert(
      await context.routeActivity("alice", activity, {
        contextLoader: overriding,
        documentLoader: async (url, options) =>
          url === activityId
            ? {
              contextUrl: null,
              documentUrl: url,
              document: structuredClone(fetchedDocument),
            }
            : await mockDocumentLoader(url, options),
      }),
    );
    if (queue != null) await processQueue(federation, queue);
    assertEquals(received.length, 1);
    const [{ activity: dispatched, authentication }] = received;
    const root = authentication.expandedActivity[0];
    assertEquals(
      (root["https://www.w3.org/ns/activitystreams#object"] as
        | { "@id": string }[]
        | undefined)?.[0]?.["@id"],
      dispatched.objectId?.href,
    );
    assertEquals(dispatched.objectId, TARGET);
    assertEquals(
      authentication.originAuthenticated.map((p) => p.id.href),
      [SIGNER.href],
    );
  });
}

test("Activities whose contexts cannot be kept are processed immediately", async () => {
  const queue = new CapturingQueue();
  const { federation, received } = setup({ queue });
  const cached = "https://remote.example/contexts/static-shared";
  // Some other code expanded a document with a loader that tags this context
  // "static", so jsonld.js keeps it in a cache shared across operations, and
  // the inbox never asks its loader for it:
  await expandDocument(
    { "@context": cached, "z": "z" },
    (url, options) =>
      url === cached
        ? Promise.resolve({
          contextUrl: null,
          documentUrl: url,
          document: { "@context": { z: "https://example.com/z" } },
          tag: "static",
        } as RemoteDocument)
        : mockDocumentLoader(url, options),
  );
  const document = featureRequestDocument({
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/fep/7aa9",
      cached,
    ],
  });
  const response = await federation.fetch(await postSigned(document), {
    contextData: undefined,
  });
  assertEquals(response.status, 202);
  assertEquals(queue.messages, []);
  assertEquals(received.length, 1);
});
