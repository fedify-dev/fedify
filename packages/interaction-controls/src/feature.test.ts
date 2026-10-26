import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type Context,
  type InboxAuthenticationEvidence,
  verifyPortableObject,
} from "@fedify/fedify";
import {
  type DocumentLoader,
  encodeMultibase,
  exportDidKey,
  FetchError,
  getDocumentLoader,
  parseIri,
  preloadedContexts,
} from "@fedify/vocab-runtime";
import jsonld from "@fedify/vocab-runtime/jsonld";
import {
  FeatureAuthorization,
  FeaturedCollection,
  FeatureRequest,
  InteractionPolicy,
  InteractionRule,
  Note,
  Person,
  PUBLIC_COLLECTION,
} from "@fedify/vocab";
import { featureInteraction } from "./mod.ts";

const context = {} as Context<void>;
const actor = new URL("https://example.com/users/alice");
const targetId = new URL("https://example.net/users/bob");
const collectionId = new URL("https://example.com/users/alice/featured");
const authorizationId = new URL("https://example.net/authorizations/5");
const verifyAuthenticity = () => true;

interface ServedDocument {
  readonly document?: unknown;
  readonly documentUrl?: string;
  readonly error?: unknown;
}

/**
 * A context whose document loader serves the given documents, and Fedify's
 * preloaded JSON-LD contexts.
 */
function createServingContext(
  documents: Record<string, ServedDocument>,
  fetched: string[] = [],
): Context<void> {
  const preloaded = getDocumentLoader();
  const documentLoader: DocumentLoader = (url, options) => {
    fetched.push(url);
    const served = documents[url];
    if (served == null) {
      return url in preloadedContexts
        ? preloaded(url, options)
        : Promise.reject(
          new FetchError(
            new URL(url),
            "Not found",
            new Response(null, { status: 404 }),
          ),
        );
    }
    if (served.error !== undefined) return Promise.reject(served.error);
    return Promise.resolve({
      contextUrl: null,
      document: structuredClone(served.document),
      documentUrl: served.documentUrl ?? url,
    });
  };
  return {
    documentLoader,
    contextLoader: preloaded,
  } as unknown as Context<void>;
}

const CONTEXT = [
  "https://www.w3.org/ns/activitystreams",
  "https://w3id.org/fep/7aa9",
];

function collectionDocument(
  attributedTo: unknown = actor.href,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    "@context": CONTEXT,
    id: collectionId.href,
    type: "FeaturedCollection",
    name: "Cute cats",
    attributedTo,
    totalItems: 0,
    orderedItems: [],
    ...extra,
  };
}

const requestId = new URL("https://example.com/requests/5");

function mastodonRequestDocument(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    "@context": CONTEXT,
    id: requestId.href,
    type: "FeatureRequest",
    object: targetId.href,
    instrument: collectionId.href,
    ...extra,
  };
}

async function parseRequest(document: unknown): Promise<FeatureRequest> {
  return await FeatureRequest.fromJsonLd(document, {
    documentLoader: getDocumentLoader(),
    contextLoader: getDocumentLoader(),
  });
}

/**
 * Builds the evidence Fedify would pass to a listener for the given request
 * document, signed by the given principals.
 */
async function evidenceFor(
  document: unknown,
  documentSigners: readonly URL[],
  requestSigners: readonly URL[] = [],
): Promise<InboxAuthenticationEvidence> {
  const expandedActivity = await jsonld.expand(
    // deno-lint-ignore no-explicit-any
    document as any,
    // deno-lint-ignore no-explicit-any
    { documentLoader: getDocumentLoader() } as any,
  ) as Record<string, unknown>[];
  return {
    verified: true,
    requestSigners: requestSigners.map((id) => ({
      kind: "actor",
      id,
      mechanism: "http-signatures",
      keyId: new URL(`${id.href}#main-key`),
    })),
    documentSigners: documentSigners.map((id) => ({
      kind: "actor",
      id,
      mechanism: "linked-data-signatures",
      keyId: new URL(`${id.href}#main-key`),
    })),
    originAuthenticated: [],
    expandedActivity,
    baseUrl: null,
  };
}

const target = new Person({ id: targetId });

test("featureInteraction creates and verifies requests", async () => {
  const collection = new FeaturedCollection({
    id: collectionId,
    attribution: actor,
  });
  const request = featureInteraction.createRequest({
    id: requestId,
    actor,
    object: target,
    instrument: collection,
  });

  assert.ok(request instanceof FeatureRequest);

  const result = await featureInteraction.verifyRequest(
    createServingContext({
      [targetId.href]: {
        document: await target.toJsonLd({ contextLoader: getDocumentLoader() }),
      },
      [collectionId.href]: { document: collectionDocument() },
    }),
    { request },
  );

  assert.equal(result.verified, true);
  assert.equal(result.requester.href, actor.href);
  assert.equal(result.interactingObjectId.href, collectionId.href);
  assert.equal(result.interactionTargetId.href, targetId.href);
});

test("featureInteraction verifies Mastodon's actorless requests", async () => {
  const document = mastodonRequestDocument();
  const request = await parseRequest(document);
  const context = createServingContext({
    [targetId.href]: {
      document: await target.toJsonLd({ contextLoader: getDocumentLoader() }),
    },
    [collectionId.href]: { document: collectionDocument() },
  });

  for (
    const authentication of [
      await evidenceFor(document, [actor]),
      // Without document signatures, the HTTP request signer counts:
      await evidenceFor(document, [], [actor]),
    ]
  ) {
    const result = await featureInteraction.verifyRequest(context, {
      request,
      authentication,
    });
    assert.equal(result.verified, true);
    assert.equal(result.requester.href, actor.href);
    assert.equal(result.interactingObjectId.href, collectionId.href);
    assert.ok(result.interactingObject instanceof FeaturedCollection);
  }
});

test("featureInteraction requires authentication for actorless requests", async () => {
  const document = mastodonRequestDocument();
  const request = await parseRequest(document);
  const context = createServingContext({
    [targetId.href]: {
      document: await target.toJsonLd({ contextLoader: getDocumentLoader() }),
    },
    [collectionId.href]: { document: collectionDocument() },
  });

  const unauthenticated = await featureInteraction.verifyRequest(context, {
    request,
  });
  assert.equal(unauthenticated.verified, false);
  assert.equal(unauthenticated.failure.type, "missingActor");

  // A valid signature of someone else does not make them the requester:
  const carol = new URL("https://example.com/users/carol");
  const someoneElse = await featureInteraction.verifyRequest(context, {
    request,
    authentication: await evidenceFor(document, [carol]),
  });
  assert.equal(someoneElse.verified, false);
  assert.deepEqual(someoneElse.failure, {
    category: "unauthorized",
    type: "unauthenticated-requester",
    requester: actor,
  });

  // A relay's HTTP signature does not count when the document is signed:
  const relayed = await featureInteraction.verifyRequest(context, {
    request,
    authentication: await evidenceFor(document, [carol], [actor]),
  });
  assert.equal(relayed.verified, false);
  assert.equal(relayed.failure.type, "unauthenticated-requester");
});

test("featureInteraction requires the request's actor to be authenticated", async () => {
  const document = mastodonRequestDocument({ actor: actor.href });
  const request = await parseRequest(document);
  const result = await featureInteraction.verifyRequest(
    createServingContext({
      [targetId.href]: {
        document: await target.toJsonLd({ contextLoader: getDocumentLoader() }),
      },
      [collectionId.href]: { document: collectionDocument() },
    }),
    {
      request,
      authentication: await evidenceFor(document, [
        new URL("https://example.com/users/carol"),
      ]),
    },
  );
  assert.equal(result.verified, false);
  assert.equal(result.failure.type, "unauthenticated-requester");
});

test("featureInteraction ignores embedded collections", async () => {
  // The attacker embeds a collection whose ID is the victim's, attributing it
  // to themselves; the collection's own document names its real owner:
  const attacker = new URL("https://attacker.example/users/mallory");
  const request = new FeatureRequest({
    id: new URL("https://attacker.example/requests/1"),
    actor: attacker,
    object: target,
    instrument: new FeaturedCollection({
      id: collectionId,
      attribution: attacker,
    }),
  });
  const result = await featureInteraction.verifyRequest(
    createServingContext({
      [targetId.href]: {
        document: await target.toJsonLd({ contextLoader: getDocumentLoader() }),
      },
      [collectionId.href]: { document: collectionDocument() },
    }),
    { request },
  );
  assert.equal(result.verified, false);
  assert.equal(result.failure.type, "requesterMismatch");
});

test("featureInteraction ignores resolved interacting objects", async () => {
  const document = mastodonRequestDocument();
  const result = await featureInteraction.verifyRequest(
    createServingContext({
      [targetId.href]: {
        document: await target.toJsonLd({ contextLoader: getDocumentLoader() }),
      },
      [collectionId.href]: { document: collectionDocument() },
    }),
    {
      request: await parseRequest(document),
      authentication: await evidenceFor(document, [
        new URL("https://example.org/users/carol"),
      ]),
      resolvedInteractingObject: new FeaturedCollection({
        id: collectionId,
        attribution: new URL("https://example.org/users/carol"),
      }),
    },
  );
  assert.equal(result.verified, false);
  assert.equal(result.failure.type, "unauthenticated-requester");
});

test("featureInteraction denies mismatched collection owners", async () => {
  const collection = new FeaturedCollection({
    id: collectionId,
    attribution: actor,
  });
  const request = new FeatureRequest({
    id: requestId,
    actor,
    object: target,
    instrument: collection,
  });

  const result = await featureInteraction.verifyRequest(
    createServingContext({
      [targetId.href]: {
        document: await target.toJsonLd({ contextLoader: getDocumentLoader() }),
      },
      [collectionId.href]: {
        document: collectionDocument("https://example.org/users/carol"),
      },
    }),
    { request },
  );

  assert.equal(result.verified, false);
  assert.equal(result.failure.type, "requesterMismatch");
});

for (
  const [label, attributedTo, valid] of [
    ["an anonymous attribution before the owner", [
      { type: "Person", name: "Anonymous" },
      actor.href,
    ], false],
    ["an anonymous attribution after the owner", [
      actor.href,
      { type: "Person", name: "Anonymous" },
    ], false],
    ["an untyped attribution before the owner", [
      { name: "Anonymous" },
      actor.href,
    ], false],
    ["a blank node attribution after the owner", [
      actor.href,
      { id: "_:b0" },
    ], false],
    ["a list with an anonymous attribution before the owner", {
      "@list": [{ type: "Person", name: "Anonymous" }, actor.href],
    }, false],
    ["a list with an anonymous attribution after the owner", {
      "@list": [actor.href, { type: "Person", name: "Anonymous" }],
    }, false],
    ["two owners", [actor.href, "https://example.com/users/carol"], false],
    ["no owner", [], false],
    ["a list with only the owner", { "@list": [actor.href] }, true],
  ] as const
) {
  test(`featureInteraction checks a collection with ${label}`, async () => {
    const document = mastodonRequestDocument();
    const result = await featureInteraction.verifyRequest(
      createServingContext({
        [targetId.href]: {
          document: await target.toJsonLd({
            contextLoader: getDocumentLoader(),
          }),
        },
        [collectionId.href]: {
          document: collectionDocument(attributedTo),
        },
      }),
      {
        request: await parseRequest(document),
        authentication: await evidenceFor(document, [actor]),
      },
    );
    if (valid) {
      assert.equal(result.verified, true);
    } else {
      assert.equal(result.verified, false);
      assert.deepEqual(result.failure, {
        category: "invalid",
        type: "invalid-interacting-object",
        reason: "attribution",
      });
    }
  });
}

for (
  const [label, extra, property] of [
    ["an anonymous instrument before the collection", {
      instrument: [{ type: "Object", name: "x" }, collectionId.href],
    }, "instrument"],
    ["an anonymous instrument after the collection", {
      instrument: [collectionId.href, { type: "Object", name: "x" }],
    }, "instrument"],
    ["an untyped instrument before the collection", {
      instrument: [{ name: "x" }, collectionId.href],
    }, "instrument"],
    ["a list of instruments", {
      instrument: { "@list": [collectionId.href, { name: "x" }] },
    }, "instrument"],
    ["two objects", {
      object: [targetId.href, "https://example.net/users/dave"],
    }, "object"],
    ["an anonymous actor", { actor: { type: "Person", name: "x" } }, "actor"],
    ["a blank node actor", { actor: { id: "_:b0" } }, "actor"],
  ] as const
) {
  test(`featureInteraction rejects a request with ${label}`, async () => {
    const document = mastodonRequestDocument(extra);
    const result = await featureInteraction.verifyRequest(
      createServingContext({
        [targetId.href]: {
          document: await target.toJsonLd({
            contextLoader: getDocumentLoader(),
          }),
        },
        [collectionId.href]: { document: collectionDocument() },
      }),
      {
        request: await parseRequest(document),
        authentication: await evidenceFor(document, [actor]),
      },
    );
    assert.equal(result.verified, false);
    assert.deepEqual(result.failure, {
      category: "invalid",
      type: "ambiguous-request",
      property,
    });
  });
}

test("featureInteraction binds authentication to the verified request", async () => {
  const context = createServingContext({
    [targetId.href]: {
      document: await target.toJsonLd({ contextLoader: getDocumentLoader() }),
    },
    [collectionId.href]: { document: collectionDocument() },
  });
  const request = await parseRequest(mastodonRequestDocument());
  for (
    const [other, property] of [
      [mastodonRequestDocument({ type: "Offer" }), "type"],
      [mastodonRequestDocument({ id: "https://example.com/requests/6" }), "id"],
      [mastodonRequestDocument({ actor: actor.href }), "actor"],
      [
        mastodonRequestDocument({ instrument: "https://example.com/other" }),
        "instrument",
      ],
    ] as const
  ) {
    const result = await featureInteraction.verifyRequest(context, {
      request,
      authentication: await evidenceFor(other, [actor]),
    });
    assert.equal(result.verified, false);
    assert.deepEqual(result.failure, {
      category: "invalid",
      type: "ambiguous-request",
      property,
    });
  }
});

test("featureInteraction resolves relative references like the decoder", async () => {
  // Without a base URL, the decoder resolves references against the
  // activity's own ID:
  const document = mastodonRequestDocument({
    "@context": [...CONTEXT, { "@base": "https://example.com/requests/" }],
    id: "5",
    object: targetId.href,
    instrument: "/users/alice/featured",
  });
  const request = await parseRequest(document);
  assert.equal(request.instrumentId?.href, collectionId.href);
  const result = await featureInteraction.verifyRequest(
    createServingContext({
      [targetId.href]: {
        document: await target.toJsonLd({ contextLoader: getDocumentLoader() }),
      },
      [collectionId.href]: { document: collectionDocument() },
    }),
    { request, authentication: await evidenceFor(document, [actor]) },
  );
  assert.equal(result.verified, true);
});

test("featureInteraction rejects collections from other origins", async () => {
  const document = mastodonRequestDocument();
  const result = await featureInteraction.verifyRequest(
    createServingContext({
      [targetId.href]: {
        document: await target.toJsonLd({ contextLoader: getDocumentLoader() }),
      },
      // A redirect, e.g., an open redirect, to another origin that claims the
      // collection's ID:
      [collectionId.href]: {
        document: collectionDocument(),
        documentUrl: "https://attacker.example/featured",
      },
    }),
    {
      request: await parseRequest(document),
      authentication: await evidenceFor(document, [actor]),
    },
  );
  assert.equal(result.verified, false);
  assert.equal(result.failure.type, "notDereferenceable");
  assert.equal(
    result.failure.type === "notDereferenceable" && result.failure.transient,
    false,
  );
});

test("featureInteraction accepts same-origin redirects of collections", async () => {
  const document = mastodonRequestDocument();
  const result = await featureInteraction.verifyRequest(
    createServingContext({
      [targetId.href]: {
        document: await target.toJsonLd({ contextLoader: getDocumentLoader() }),
      },
      [collectionId.href]: {
        document: collectionDocument(),
        documentUrl: "https://example.com/collections/alice-featured",
      },
    }),
    {
      request: await parseRequest(document),
      authentication: await evidenceFor(document, [actor]),
    },
  );
  assert.equal(result.verified, true);
});

test("featureInteraction rejects collection URLs with credentials", async () => {
  const instrument = "https://user:pass@example.com/users/alice/featured";
  const document = mastodonRequestDocument({ instrument });
  const fetched: string[] = [];
  const result = await featureInteraction.verifyRequest(
    createServingContext({
      [targetId.href]: {
        document: await target.toJsonLd({ contextLoader: getDocumentLoader() }),
      },
    }, fetched),
    {
      request: await parseRequest(document),
      authentication: await evidenceFor(document, [actor]),
    },
  );
  assert.equal(result.verified, false);
  assert.equal(result.failure.type, "credentials-in-url");
  assert.ok(!fetched.includes(instrument));
});

test("featureInteraction tells transient collection failures", async () => {
  const document = mastodonRequestDocument();
  for (
    const [status, transient] of [
      [503, true],
      [429, true],
      [408, true],
      [404, false],
      [410, false],
    ] as const
  ) {
    const fetched: string[] = [];
    const result = await featureInteraction.verifyRequest(
      createServingContext({
        [targetId.href]: {
          document: await target.toJsonLd({
            contextLoader: getDocumentLoader(),
          }),
        },
        [collectionId.href]: {
          error: new FetchError(
            collectionId,
            `HTTP ${status}`,
            new Response(null, { status }),
          ),
        },
      }, fetched),
      {
        request: await parseRequest(document),
        authentication: await evidenceFor(document, [actor]),
      },
    );
    assert.equal(result.verified, false);
    assert.equal(result.failure.type, "notDereferenceable");
    assert.equal(
      result.failure.type === "notDereferenceable" && result.failure.transient,
      transient,
    );
    // WebFinger is never asked for the collection:
    assert.ok(fetched.every((url) => !url.includes(".well-known/webfinger")));
  }
});

test("featureInteraction rejects malformed collections", async () => {
  const document = mastodonRequestDocument();
  for (
    const extra of [
      { published: "not-a-date" },
      {
        attachment: {
          type: "Link",
          href: "https://x.example/",
          hreflang: "not a tag",
        },
      },
      {
        "@context": [...CONTEXT, "https://w3id.org/security/data-integrity/v1"],
        proof: {
          type: "DataIntegrityProof",
          cryptosuite: "eddsa-jcs-2022",
          verificationMethod: "https://example.com/users/alice#key",
          proofPurpose: "assertionMethod",
          proofValue: "!invalid-multibase",
          created: "2026-01-01T00:00:00Z",
        },
      },
    ]
  ) {
    const result = await featureInteraction.verifyRequest(
      createServingContext({
        [targetId.href]: {
          document: await target.toJsonLd({
            contextLoader: getDocumentLoader(),
          }),
        },
        [collectionId.href]: {
          document: collectionDocument(actor.href, extra),
        },
      }),
      {
        request: await parseRequest(document),
        authentication: await evidenceFor(document, [actor]),
      },
    );
    assert.equal(result.verified, false, JSON.stringify(extra));
    assert.equal(result.failure.type, "invalid-interacting-object");
    assert.equal(
      result.failure.type === "invalid-interacting-object" &&
        result.failure.reason,
      "decoding",
    );
  }
});

test("featureInteraction keeps the verified collection usable", async () => {
  const document = mastodonRequestDocument();
  const result = await featureInteraction.verifyRequest(
    createServingContext({
      [targetId.href]: {
        document: await target.toJsonLd({ contextLoader: getDocumentLoader() }),
      },
      [collectionId.href]: { document: collectionDocument() },
      [actor.href]: {
        document: {
          "@context": "https://www.w3.org/ns/activitystreams",
          id: actor.href,
          type: "Person",
          name: "Alice",
        },
      },
    }),
    {
      request: await parseRequest(document),
      authentication: await evidenceFor(document, [actor]),
    },
  );
  assert.equal(result.verified, true);
  const owner = await result.interactingObject.getAttribution();
  assert.equal(owner?.id?.href, actor.href);
});

test("featureInteraction authenticates fetched requests by their origin", async () => {
  const fetchedRequest = new URL("https://example.com/requests/5");
  const context = createServingContext({
    [targetId.href]: {
      document: await target.toJsonLd({ contextLoader: getDocumentLoader() }),
    },
    [collectionId.href]: { document: collectionDocument() },
    [fetchedRequest.href]: {
      document: mastodonRequestDocument({ actor: actor.href }),
    },
    // The attacker serves a request that claims to be the victim's:
    "https://attacker.example/requests/1": {
      document: mastodonRequestDocument({
        id: "https://attacker.example/requests/1",
        actor: actor.href,
      }),
    },
    // The victim's URL redirects to the attacker's request:
    "https://example.com/requests/redirect": {
      document: mastodonRequestDocument({
        id: "https://example.com/requests/redirect",
        actor: actor.href,
      }),
      documentUrl: "https://attacker.example/requests/redirect",
    },
  });
  const ok = await featureInteraction.verifyRequest(context, {
    request: fetchedRequest,
  });
  assert.equal(ok.verified, true);
  for (
    const url of [
      "https://attacker.example/requests/1",
      "https://example.com/requests/redirect",
    ]
  ) {
    const result = await featureInteraction.verifyRequest(context, {
      request: new URL(url),
    });
    assert.equal(result.verified, false);
    assert.equal(result.failure.type, "unauthenticated-requester");
  }
});

test("featureInteraction rejects non-actor request targets", async () => {
  const target = new Note({ id: targetId });
  const collection = new FeaturedCollection({
    id: collectionId,
    attribution: actor,
  });
  const request = new FeatureRequest({
    id: requestId,
    actor,
    object: target,
    instrument: collection,
  });

  const result = await featureInteraction.verifyRequest(
    createServingContext({
      [collectionId.href]: { document: collectionDocument() },
    }),
    { request },
  );

  assert.equal(result.verified, false);
  assert.equal(result.failure.type, "wrongObjectType");
});

test("featureInteraction denies missing canFeature by default", async () => {
  const target = new Person({ id: targetId });

  assert.deepEqual(
    await featureInteraction.evaluatePolicy(context, {
      subject: target,
      requester: actor,
    }),
    {
      result: "denied",
      reason: { type: "missingPolicy" },
    },
  );
});

test("featureInteraction evaluates canFeature rules", async () => {
  const target = new Person({
    id: targetId,
    interactionPolicy: new InteractionPolicy({
      canFeature: new InteractionRule({ manualApproval: PUBLIC_COLLECTION }),
    }),
  });

  assert.deepEqual(
    await featureInteraction.evaluatePolicy(context, {
      subject: target,
      requester: actor,
    }),
    {
      result: "manual",
      reason: { type: "public" },
    },
  );
});

test("featureInteraction grants self approval to the featured actor", async () => {
  const target = new Person({ id: targetId });

  assert.deepEqual(
    await featureInteraction.evaluatePolicy(context, {
      subject: target,
      requester: targetId,
    }),
    {
      result: "automatic",
      reason: { type: "self" },
    },
  );
});

test("featureInteraction creates and verifies authorizations", async () => {
  const target = new Person({ id: targetId });
  const collection = new FeaturedCollection({
    id: collectionId,
    attribution: actor,
  });
  const authorization = featureInteraction.createAuthorization({
    id: authorizationId,
    attributedTo: targetId,
    interactingObject: collection,
    interactionTarget: target,
  });

  assert.ok(authorization instanceof FeatureAuthorization);

  const result = await featureInteraction.verifyAuthorization(context, {
    authorization,
    interactingObject: collection,
    interactionTarget: target,
    attributedTo: targetId,
    verifyAuthenticity,
  });

  assert.equal(result.verified, true);

  const inferredResult = await featureInteraction.verifyAuthorization(context, {
    authorization,
    interactingObject: collection,
    interactionTarget: target,
    verifyAuthenticity,
  });

  assert.equal(inferredResult.verified, true);
});

test("featureInteraction verifies actorless authorizations", async () => {
  const target = new Person({ id: targetId });
  const collection = new FeaturedCollection({
    id: collectionId,
    attribution: actor,
  });
  const authorization = new FeatureAuthorization({
    id: authorizationId,
    interactingObject: collectionId,
    interactionTarget: targetId,
  });

  const result = await featureInteraction.verifyAuthorization(context, {
    authorization,
    interactingObject: collection,
    interactionTarget: target,
    attributedTo: targetId,
    verifyAuthenticity,
  });

  assert.equal(result.verified, true);
});

test("featureInteraction checks actorless authorization origins", async () => {
  const target = new Person({ id: targetId });
  const collection = new FeaturedCollection({
    id: collectionId,
    attribution: actor,
  });
  const authorization = new FeatureAuthorization({
    id: new URL("https://example.org/authorizations/5"),
    interactingObject: collectionId,
    interactionTarget: targetId,
  });

  const result = await featureInteraction.verifyAuthorization(context, {
    authorization,
    interactingObject: collection,
    interactionTarget: target,
    attributedTo: targetId,
  });

  assert.equal(result.verified, false);
  assert.equal(result.failure.type, "originMismatch");
});

test("featureInteraction does not recognize standalone featured items", () => {
  const target = new Person({ id: targetId });

  assert.equal(featureInteraction.recognizeImpolite(target), null);
});

const portableKeyPair = await crypto.subtle.generateKey("Ed25519", true, [
  "sign",
  "verify",
]) as CryptoKeyPair;
const portableDid = await exportDidKey(portableKeyPair.publicKey);
const portableActor = `ap://${portableDid}/actor`;
const portableCollection = `ap://${portableDid}/featured`;
const PORTABLE_CONTEXT = [
  "https://www.w3.org/ns/activitystreams",
  "https://w3id.org/security/data-integrity/v1",
  "https://w3id.org/fep/ef61",
  "https://w3id.org/fep/7aa9",
];

function compatibleId(gateway: string, id: string): string {
  return `${gateway}/.well-known/apgateway/${id.replace(/^ap:\/\//, "")}`;
}

/** RFC 8785 canonical JSON, enough for the plain documents of these tests. */
function serialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(serialize).join(",")}]`;
  if (value != null && typeof value === "object") {
    return `{${
      Object.keys(value).sort().map((key) =>
        `${JSON.stringify(key)}:${
          serialize((value as Record<string, unknown>)[key])
        }`
      ).join(",")
    }}`;
  }
  return JSON.stringify(value);
}

async function signPortable(
  document: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const proofConfig = {
    "@context": document["@context"],
    type: "DataIntegrityProof",
    cryptosuite: "eddsa-jcs-2022",
    verificationMethod: `${portableDid}#${portableDid.slice(8)}`,
    proofPurpose: "assertionMethod",
    created: "2026-01-01T00:00:00Z",
  };
  const digest = async (value: unknown) =>
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(serialize(value)),
      ),
    );
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "Ed25519",
      portableKeyPair.privateKey,
      new Uint8Array([
        ...await digest(proofConfig),
        ...await digest(document),
      ]),
    ),
  );
  return {
    ...document,
    proof: {
      ...proofConfig,
      proofValue: new TextDecoder().decode(
        encodeMultibase("base58btc", signature),
      ),
    },
  };
}

function createPortableContext(
  documents: Record<string, ServedDocument>,
): Context<void> {
  const context = createServingContext(documents);
  return {
    ...context,
    verifyPortableObject: (document: unknown, options: object) =>
      verifyPortableObject(document, {
        documentLoader: context.documentLoader,
        contextLoader: context.contextLoader,
        ...options,
      }),
  } as unknown as Context<void>;
}

for (
  const [label, attributedTo, valid] of [
    ["its owner", portableActor, true],
    ["an anonymous attribution before its owner", [
      { type: "Person", name: "Anonymous" },
      portableActor,
    ], false],
    ["an anonymous attribution after its owner", [
      portableActor,
      { name: "Anonymous" },
    ], false],
  ] as const
) {
  test(`featureInteraction checks a portable collection with ${label}`, async () => {
    const instrument = compatibleId("https://gw.example", portableCollection);
    const document = mastodonRequestDocument({ instrument });
    const collection = await signPortable({
      "@context": PORTABLE_CONTEXT,
      id: portableCollection,
      type: "FeaturedCollection",
      name: "Portable cats",
      attributedTo,
      totalItems: 0,
    });
    const result = await featureInteraction.verifyRequest(
      createPortableContext({
        [targetId.href]: {
          document: await target.toJsonLd({
            contextLoader: getDocumentLoader(),
          }),
        },
        [instrument]: { document: collection },
      }),
      {
        request: await parseRequest(document),
        // The requester is authenticated by a proof of the owner's DID:
        authentication: {
          ...await evidenceFor(document, []),
          documentSigners: [{
            kind: "portable-authority",
            id: new URL(portableDid),
            mechanism: "object-integrity-proofs",
            keyId: null,
          }],
        },
      },
    );
    if (valid) {
      assert.equal(result.verified, true);
      assert.equal(
        result.verified && result.requester.href,
        parseIri(portableActor).href,
      );
    } else {
      assert.equal(result.verified, false);
      assert.deepEqual(result.failure, {
        category: "invalid",
        type: "invalid-interacting-object",
        reason: "attribution",
      });
    }
  });
}

test("featureInteraction rejects an unsigned portable collection", async () => {
  const instrument = compatibleId("https://gw.example", portableCollection);
  const document = mastodonRequestDocument({ instrument });
  const result = await featureInteraction.verifyRequest(
    createPortableContext({
      [targetId.href]: {
        document: await target.toJsonLd({ contextLoader: getDocumentLoader() }),
      },
      [instrument]: {
        document: {
          "@context": PORTABLE_CONTEXT,
          id: portableCollection,
          type: "FeaturedCollection",
          attributedTo: portableActor,
        },
      },
    }),
    {
      request: await parseRequest(document),
      authentication: await evidenceFor(document, [parseIri(portableActor)]),
    },
  );
  assert.equal(result.verified, false);
  assert.notEqual(result.failure.category, "unauthorized");
});

test("featureInteraction tells an unavailable portable collection owner", async () => {
  const instrument = compatibleId("https://gw.example", portableCollection);
  const document = mastodonRequestDocument({ instrument });
  const context = createPortableContext({
    [targetId.href]: {
      document: await target.toJsonLd({ contextLoader: getDocumentLoader() }),
    },
    // An unsecured portable collection is accepted only if its owner lists
    // the gateway, so the owner has to be fetched, and its gateway is down:
    [instrument]: {
      document: {
        "@context": PORTABLE_CONTEXT,
        id: portableCollection,
        type: ["OrderedCollection", "FeaturedCollection"],
        attributedTo: portableActor,
        totalItems: 0,
      },
    },
    [compatibleId("https://gw.example", portableActor)]: {
      error: new FetchError(
        compatibleId("https://gw.example", portableActor),
        "Unavailable",
        new Response(null, { status: 503 }),
      ),
    },
  });
  const result = await featureInteraction.verifyRequest(context, {
    request: await parseRequest(document),
    authentication: await evidenceFor(document, [parseIri(portableActor)]),
  });
  assert.equal(result.verified, false);
  assert.equal(result.failure.type, "notDereferenceable");
  assert.equal(
    result.failure.type === "notDereferenceable" && result.failure.transient,
    true,
  );
});

test("featureInteraction treats empty evidence as no evidence", async () => {
  // An activity queued by an older version of Fedify has no evidence:
  const empty: InboxAuthenticationEvidence = {
    verified: false,
    requestSigners: [],
    documentSigners: [],
    originAuthenticated: [],
    expandedActivity: [],
    baseUrl: null,
  };
  const context = createServingContext({
    [targetId.href]: {
      document: await target.toJsonLd({ contextLoader: getDocumentLoader() }),
    },
    [collectionId.href]: { document: collectionDocument() },
  });
  const actorful = await featureInteraction.verifyRequest(context, {
    request: await parseRequest(mastodonRequestDocument({ actor: actor.href })),
    authentication: empty,
  });
  assert.equal(actorful.verified, true);
  const actorless = await featureInteraction.verifyRequest(context, {
    request: await parseRequest(mastodonRequestDocument()),
    authentication: empty,
  });
  assert.equal(actorless.verified, false);
  assert.equal(actorless.failure.type, "missingActor");
});
