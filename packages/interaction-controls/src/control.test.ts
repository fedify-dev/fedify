import assert from "node:assert/strict";
import { test } from "node:test";
import type { Context } from "@fedify/fedify";
import {
  type DocumentLoader,
  FetchError,
  parseIri,
  type PortableObjectVerifier,
  preloadedContexts,
  type RemoteDocument,
  UrlError,
  withGatewayHints,
} from "@fedify/vocab-runtime";
import {
  Delete,
  InteractionPolicy,
  InteractionRule,
  Like,
  LikeAuthorization,
  LikeRequest,
  Note,
  PUBLIC_COLLECTION,
} from "@fedify/vocab";
import { likeInteraction, quoteInteraction } from "./mod.ts";

const context = {} as Context<void>;
const actor = new URL("https://example.com/users/alice");
const author = new URL("https://example.net/users/bob");
const targetId = new URL("https://example.net/notes/1");
const likeId = new URL("https://example.com/likes/1");
const requestId = new URL("https://example.com/requests/1");
const authorizationId = new URL("https://example.net/authorizations/1");
const followers = new URL("https://example.net/users/bob/followers");
const following = new URL("https://example.net/users/bob/following");

function remoteDocument(url: URL | string, document: unknown): RemoteDocument {
  return { contextUrl: null, document, documentUrl: url.toString() };
}

function httpError(url: string, status: number): FetchError {
  return new FetchError(
    url,
    `HTTP ${status}`,
    new Response(null, { status }),
  );
}

/**
 * Serves the given documents and preloaded JSON-LD contexts, and throws the
 * given error for any other URL, without accessing the network.
 */
function documentLoader(
  documents: Record<string, unknown>,
  error: (url: string) => unknown = (url) => httpError(url, 404),
): DocumentLoader {
  return async (url: string) => {
    await Promise.resolve();
    if (url in documents) return remoteDocument(url, documents[url]);
    if (url in preloadedContexts) {
      return remoteDocument(url, preloadedContexts[url]);
    }
    throw error(url);
  };
}

function likeRequestWithInstrumentIri(): LikeRequest {
  return new LikeRequest({
    id: requestId,
    actor,
    object: new Note({ id: targetId, attribution: author }),
    instrument: likeId,
  });
}

test("verifyRequest() reports transient instrument fetch failures", async () => {
  const error = httpError(likeId.href, 503);

  const result = await likeInteraction.verifyRequest(context, {
    request: likeRequestWithInstrumentIri(),
    documentLoader: documentLoader({}, () => error),
  });

  assert.deepEqual(result.verified ? null : result.failure, {
    category: "unverifiable",
    type: "notDereferenceable",
    url: likeId,
    cause: error,
    transient: true,
  });
});

test("verifyRequest() reports permanent instrument fetch failures", async () => {
  for (
    const error of [
      httpError(likeId.href, 404),
      new UrlError("Disallowed private URL"),
    ]
  ) {
    const result = await likeInteraction.verifyRequest(context, {
      request: likeRequestWithInstrumentIri(),
      documentLoader: documentLoader({}, () => error),
    });

    if (result.verified || result.failure.category !== "unverifiable") {
      assert.fail(`unexpected result: ${String(result.verified)}`);
    }
    assert.equal(result.failure.type, "notDereferenceable");
    assert.equal(result.failure.transient, false);
  }
});

test("verifyRequest() reports DNS failures as transient", async () => {
  const result = await likeInteraction.verifyRequest(context, {
    request: likeRequestWithInstrumentIri(),
    documentLoader: documentLoader(
      {},
      () => new UrlError("DNS lookup failed", { reason: "dns" }),
    ),
  });

  assert.equal(result.verified, false);
  if (result.verified || result.failure.category !== "unverifiable") {
    assert.fail(`unexpected result: ${String(result.verified)}`);
  }
  assert.equal(result.failure.type, "notDereferenceable");
  assert.equal(result.failure.transient, true);
});

test("verifyRequest() reports nullish loader rejections as transient", async () => {
  const result = await likeInteraction.verifyRequest(context, {
    request: likeRequestWithInstrumentIri(),
    documentLoader: () => Promise.reject(null),
  });

  if (result.verified || result.failure.type !== "notDereferenceable") {
    assert.fail(`unexpected result: ${String(result.verified)}`);
  }
  assert.equal(result.failure.url.href, likeId.href);
  assert.equal(result.failure.cause, null);
  assert.equal(result.failure.transient, true);
});

test("verifyRequest() reports null loader results as not dereferenceable", async () => {
  const result = await likeInteraction.verifyRequest(context, {
    request: likeRequestWithInstrumentIri(),
    documentLoader: async () => {
      await Promise.resolve();
      return null as unknown as RemoteDocument;
    },
  });

  assert.equal(result.verified, false);
  if (result.verified || result.failure.type !== "notDereferenceable") {
    assert.fail(`unexpected result: ${String(result.verified)}`);
  }
  assert.equal(result.failure.url.href, likeId.href);
  assert.equal(result.failure.transient, false);
});

test("verifyRequest() reports cross-origin instruments as permanent failures", async () => {
  const result = await likeInteraction.verifyRequest(context, {
    request: likeRequestWithInstrumentIri(),
    documentLoader: documentLoader({
      [likeId.href]: {
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Like",
        id: "https://evil.example/likes/1",
        actor: actor.href,
        object: targetId.href,
      },
    }),
  });

  assert.deepEqual(result.verified ? null : result.failure, {
    category: "unverifiable",
    type: "notDereferenceable",
    url: likeId,
    transient: false,
  });
});

test("verifyRequest() reports failed instrument contexts with their URLs", async () => {
  const contextUrl = "https://example.com/contexts/like";
  const error = httpError(contextUrl, 503);

  const result = await likeInteraction.verifyRequest(context, {
    request: likeRequestWithInstrumentIri(),
    documentLoader: documentLoader({
      [likeId.href]: {
        "@context": ["https://www.w3.org/ns/activitystreams", contextUrl],
        type: "Like",
        id: likeId.href,
        actor: actor.href,
        object: targetId.href,
      },
    }, () => error),
  });

  assert.equal(result.verified, false);
  if (result.verified || result.failure.type !== "notDereferenceable") {
    assert.fail(`unexpected result: ${String(result.verified)}`);
  }
  assert.equal(result.failure.url.href, contextUrl);
  assert.equal(result.failure.cause, error);
  assert.equal(result.failure.transient, true);
});

test("verifyRequest() reports nullish context loader rejections as transient", async () => {
  const contextUrl = "https://example.com/contexts/like";

  const result = await likeInteraction.verifyRequest(context, {
    request: likeRequestWithInstrumentIri(),
    documentLoader: documentLoader({
      [likeId.href]: {
        "@context": ["https://www.w3.org/ns/activitystreams", contextUrl],
        type: "Like",
        id: likeId.href,
        actor: actor.href,
        object: targetId.href,
      },
    }, () => null),
  });

  if (result.verified || result.failure.type !== "notDereferenceable") {
    assert.fail(`unexpected result: ${String(result.verified)}`);
  }
  assert.equal(result.failure.url.href, contextUrl);
  assert.equal(result.failure.cause, null);
  assert.equal(result.failure.transient, true);
});

test("verifyAuthorization() reports nullish context loader rejections as transient", async () => {
  const contextUrl = "https://example.net/contexts/authorization";

  const result = await likeInteraction.verifyAuthorization(context, {
    authorization: authorizationId,
    interactingObject: likeId,
    interactionTarget: targetId,
    attributedTo: author,
    documentLoader: documentLoader({
      [authorizationId.href]: {
        "@context": ["https://www.w3.org/ns/activitystreams", contextUrl],
        type: "https://gotosocial.org/ns#LikeApproval",
        id: authorizationId.href,
      },
    }, () => undefined),
  });

  if (result.verified || result.failure.type !== "notDereferenceable") {
    assert.fail(`unexpected result: ${String(result.verified)}`);
  }
  assert.equal(result.failure.url.href, contextUrl);
  assert.equal(result.failure.transient, true);
});

test("verifyRequest() reports failed request contexts with their URLs", async () => {
  const contextUrl = "https://example.com/contexts/request";

  const result = await likeInteraction.verifyRequest(context, {
    request: requestId,
    documentLoader: documentLoader({
      [requestId.href]: {
        "@context": ["https://www.w3.org/ns/activitystreams", contextUrl],
        type: "https://gotosocial.org/ns#LikeRequest",
        id: requestId.href,
      },
    }),
  });

  assert.equal(result.verified, false);
  if (result.verified || result.failure.type !== "notDereferenceable") {
    assert.fail(`unexpected result: ${String(result.verified)}`);
  }
  assert.equal(result.failure.url.href, contextUrl);
  assert.equal(result.failure.transient, false);
});

test("verifyRequest() uses separate context loaders", async () => {
  const contextUrl = "https://example.com/contexts/like";
  const loadedContexts: string[] = [];

  const result = await likeInteraction.verifyRequest(context, {
    request: likeRequestWithInstrumentIri(),
    documentLoader: async (url: string) => {
      await Promise.resolve();
      assert.equal(url, likeId.href);
      return remoteDocument(url, {
        "@context": ["https://www.w3.org/ns/activitystreams", contextUrl],
        type: "Like",
        id: likeId.href,
        actor: actor.href,
        object: targetId.href,
      });
    },
    contextLoader: async (url: string) => {
      loadedContexts.push(url);
      if (url === contextUrl) return remoteDocument(url, { "@context": {} });
      return await documentLoader({})(url);
    },
  });

  assert.equal(result.verified, true);
  assert.ok(loadedContexts.includes(contextUrl));
});

test("verifyRequest() reports malformed instruments as invalid JSON-LD", async () => {
  const result = await likeInteraction.verifyRequest(context, {
    request: likeRequestWithInstrumentIri(),
    documentLoader: documentLoader({
      [likeId.href]: {
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Like",
        id: likeId.href,
        actor: actor.href,
        object: targetId.href,
        published: "not a date",
      },
    }),
  });

  assert.equal(result.verified, false);
  if (result.verified || result.failure.category !== "unverifiable") {
    assert.fail(`unexpected result: ${String(result.verified)}`);
  }
  assert.equal(result.failure.type, "invalidJsonLd");
  assert.equal(result.failure.transient, false);
});

test("verifyRequest() keeps loader errors of concurrent verifications apart", async () => {
  const [transient, permanent] = await Promise.all([
    likeInteraction.verifyRequest(context, {
      request: likeRequestWithInstrumentIri(),
      documentLoader: async (url: string) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        throw httpError(url, 503);
      },
    }),
    likeInteraction.verifyRequest(context, {
      request: likeRequestWithInstrumentIri(),
      documentLoader: async (url: string) => {
        await Promise.resolve();
        throw httpError(url, 404);
      },
    }),
  ]);

  assert.ok(
    !transient.verified && transient.failure.category === "unverifiable" &&
      transient.failure.transient === true,
  );
  assert.ok(
    !permanent.verified && permanent.failure.category === "unverifiable" &&
      permanent.failure.transient === false,
  );
});

const portableLikeId =
  "ap://did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK/likes/1";

function portableLikeRequest(
  gateways: readonly string[],
  verifyPortableObject: PortableObjectVerifier,
): LikeRequest {
  return new LikeRequest({
    id: requestId,
    actor,
    object: new Note({ id: targetId, attribution: author }),
    instrument: withGatewayHints(portableLikeId, gateways),
  }, { verifyPortableObject });
}

test("verifyRequest() reports any transient gateway failure as transient", async () => {
  for (
    const gateways of [
      ["https://unavailable.example/", "https://missing.example/"],
      ["https://missing.example/", "https://unavailable.example/"],
    ]
  ) {
    const result = await likeInteraction.verifyRequest(context, {
      request: portableLikeRequest(
        gateways,
        () => Promise.resolve({ verified: false }),
      ),
      documentLoader: documentLoader({}, (url) =>
        httpError(
          url,
          url.startsWith("https://unavailable.example/") ? 503 : 404,
        )),
    });

    assert.equal(result.verified, false);
    if (result.verified || result.failure.type !== "notDereferenceable") {
      assert.fail("expected a notDereferenceable failure");
    }
    assert.equal(result.failure.transient, true);
    assert.ok(result.failure.cause instanceof AggregateError);
    assert.equal(result.failure.url.origin, "https://unavailable.example");
  }
});

test("verifyRequest() reports failures of portable references without gateways", async () => {
  const result = await likeInteraction.verifyRequest(context, {
    request: new LikeRequest({
      id: requestId,
      actor,
      object: new Note({ id: targetId, attribution: author }),
      instrument: parseIri(portableLikeId),
    }, { verifyPortableObject: () => Promise.resolve({ verified: false }) }),
    // FetchError cannot be constructed with a portable URL, so a network
    // failure is used:
    documentLoader: documentLoader({}, () => new TypeError("fetch failed")),
  });

  if (result.verified || result.failure.type !== "notDereferenceable") {
    assert.fail(`unexpected result: ${String(result.verified)}`);
  }
  assert.equal(result.failure.url.protocol, "ap+ef61:");
  assert.equal(result.failure.transient, true);
});

test("verification returns failures for unparseable context URLs", async () => {
  const document = {
    "@context": ["https://www.w3.org/ns/activitystreams", "::"],
    type: "Like",
    id: likeId.href,
    actor: actor.href,
    object: targetId.href,
  };
  const loader = documentLoader(
    { [likeId.href]: document },
    (url) => new TypeError(`Invalid URL: ${url}`),
  );

  const field = await likeInteraction.verifyRequest(context, {
    request: likeRequestWithInstrumentIri(),
    documentLoader: loader,
  });
  assert.equal(field.verified, false);

  const request = await likeInteraction.verifyRequest(context, {
    request: requestId,
    documentLoader: documentLoader({
      [requestId.href]: {
        ...document,
        type: "https://gotosocial.org/ns#LikeRequest",
        id: requestId.href,
      },
    }, (url) => new TypeError(`Invalid URL: ${url}`)),
  });
  assert.equal(request.verified, false);

  const authorization = await likeInteraction.verifyAuthorization(context, {
    authorization: authorizationId,
    interactingObject: likeId,
    interactionTarget: targetId,
    attributedTo: author,
    documentLoader: documentLoader({
      [authorizationId.href]: {
        "@context": ["https://www.w3.org/ns/activitystreams", "::"],
        type: "https://gotosocial.org/ns#LikeApproval",
        id: authorizationId.href,
      },
    }, (url) => new TypeError(`Invalid URL: ${url}`)),
  });
  assert.equal(authorization.verified, false);
});

test("verifyRequest() ignores gateway failures it recovered from", async () => {
  const result = await likeInteraction.verifyRequest(context, {
    request: portableLikeRequest(
      ["https://unavailable.example/", "https://available.example/"],
      () => Promise.resolve({ verified: true }),
    ),
    documentLoader: async (url: string) => {
      if (url.startsWith("https://unavailable.example/")) {
        throw httpError(url, 503);
      } else if (url.startsWith("https://available.example/")) {
        return remoteDocument(url, {
          "@context": "https://www.w3.org/ns/activitystreams",
          type: "Like",
          id: portableLikeId,
          actor: actor.href,
          object: targetId.href,
        });
      }
      return await documentLoader({})(url);
    },
  });

  assert.equal(result.verified, true);
});

test("verifyRequest() does not retry rejected portable objects", async () => {
  const result = await likeInteraction.verifyRequest(context, {
    request: portableLikeRequest(
      ["https://unavailable.example/", "https://forged.example/"],
      () => Promise.resolve({ verified: false }),
    ),
    documentLoader: async (url: string) => {
      if (url.startsWith("https://unavailable.example/")) {
        throw httpError(url, 503);
      } else if (url.startsWith("https://forged.example/")) {
        return remoteDocument(url, {
          "@context": "https://www.w3.org/ns/activitystreams",
          type: "Like",
          id: portableLikeId,
          actor: actor.href,
          object: targetId.href,
        });
      }
      return await documentLoader({})(url);
    },
  });

  assert.equal(result.verified, false);
  if (result.verified || result.failure.category !== "unverifiable") {
    assert.fail(`unexpected result: ${String(result.verified)}`);
  }
  assert.equal(result.failure.type, "notDereferenceable");
  assert.equal(result.failure.transient, false);
});

test("evaluatePolicy() uses fallback rules", async () => {
  const fallbackRule = new InteractionRule({
    automaticApproval: PUBLIC_COLLECTION,
  });

  for (
    const subject of [
      new Note({ id: targetId, attribution: author }),
      new Note({
        id: targetId,
        attribution: author,
        interactionPolicy: new InteractionPolicy({
          canLike: new InteractionRule({ automaticApproval: author }),
        }),
      }),
    ]
  ) {
    assert.deepEqual(
      await quoteInteraction.evaluatePolicy(context, {
        subject,
        requester: actor,
        fallbackRule,
      }),
      { result: "automatic", reason: { type: "public" } },
    );
  }

  const quotable = new Note({
    id: targetId,
    attribution: author,
    interactionPolicy: new InteractionPolicy({
      canQuote: new InteractionRule({ manualApproval: PUBLIC_COLLECTION }),
    }),
  });
  assert.deepEqual(
    await quoteInteraction.evaluatePolicy(context, {
      subject: quotable,
      requester: actor,
      fallbackRule,
    }),
    { result: "manual", reason: { type: "public" } },
  );
  assert.deepEqual(
    await quoteInteraction.evaluatePolicy(context, {
      subject: new Note({ id: targetId, attribution: author }),
      requester: actor,
      fallbackRule: new InteractionRule({}),
    }),
    { result: "denied", reason: { type: "missingPolicy" } },
  );
  assert.deepEqual(
    await quoteInteraction.evaluatePolicy(context, {
      subject: new Note({ id: targetId, attribution: author }),
      requester: actor,
      fallbackRule: new InteractionRule({ automaticApproval: author }),
    }),
    { result: "denied", reason: { type: "noMatch" } },
  );
});

test("evaluatePolicy() can give automatic approval precedence", async () => {
  const subject = new Note({
    id: targetId,
    attribution: author,
    interactionPolicy: new InteractionPolicy({
      canLike: new InteractionRule({
        automaticApproval: PUBLIC_COLLECTION,
        manualApproval: actor,
      }),
    }),
  });

  assert.deepEqual(
    await likeInteraction.evaluatePolicy(context, {
      subject,
      requester: actor,
    }),
    { result: "manual", reason: { type: "actor", actor } },
  );
  assert.deepEqual(
    await likeInteraction.evaluatePolicy(context, {
      subject,
      requester: actor,
      precedence: "automatic",
    }),
    { result: "automatic", reason: { type: "public" } },
  );
});

test("evaluatePolicy() combines precedence with collection error handling", async () => {
  const subject = new Note({
    id: targetId,
    attribution: author,
    interactionPolicy: new InteractionPolicy({
      canLike: new InteractionRule({
        automaticApproval: followers,
        manualApproval: PUBLIC_COLLECTION,
      }),
    }),
  });
  const error = new Error("database unavailable");
  const matchesApprovalCollection = () => {
    throw error;
  };

  assert.deepEqual(
    await likeInteraction.evaluatePolicy(context, {
      subject,
      requester: actor,
      matchesApprovalCollection,
    }),
    { result: "manual", reason: { type: "public" } },
  );
  assert.deepEqual(
    await likeInteraction.evaluatePolicy(context, {
      subject,
      requester: actor,
      matchesApprovalCollection,
      precedence: "automatic",
    }),
    {
      result: "denied",
      reason: {
        type: "unverifiableCollection",
        collection: followers,
        cause: error,
      },
    },
  );
  assert.deepEqual(
    await likeInteraction.evaluatePolicy(context, {
      subject: new Note({
        id: targetId,
        attribution: author,
        interactionPolicy: new InteractionPolicy({
          canLike: new InteractionRule({ manualApproval: followers }),
        }),
      }),
      requester: actor,
      matchesApprovalCollection,
      precedence: "automatic",
    }),
    {
      result: "denied",
      reason: {
        type: "unverifiableCollection",
        collection: followers,
        cause: error,
      },
    },
  );
  for (const precedence of ["actor", "automatic"] as const) {
    await assert.rejects(
      likeInteraction.evaluatePolicy(context, {
        subject,
        requester: actor,
        matchesApprovalCollection,
        precedence,
        collectionErrors: "throw",
      }),
      error,
    );
  }
});

test("evaluatePolicy() stops at the first collection error when throwing", async () => {
  const subject = new Note({
    id: targetId,
    attribution: author,
    interactionPolicy: new InteractionPolicy({
      canLike: new InteractionRule({
        automaticApprovals: [followers, following],
      }),
    }),
  });
  const error = new Error("database unavailable");
  const checked: string[] = [];
  const matchesApprovalCollection = (collection: URL) => {
    checked.push(collection.href);
    if (collection.href === followers.href) throw error;
    return true;
  };

  await assert.rejects(
    likeInteraction.evaluatePolicy(context, {
      subject,
      requester: actor,
      matchesApprovalCollection,
      collectionErrors: "throw",
    }),
    error,
  );
  assert.deepEqual(checked, [followers.href]);

  assert.deepEqual(
    await likeInteraction.evaluatePolicy(context, {
      subject,
      requester: actor,
      matchesApprovalCollection,
    }),
    {
      result: "automatic",
      reason: { type: "collection", collection: following },
    },
  );
});

function likeAuthorization(id: URL = authorizationId): LikeAuthorization {
  return new LikeAuthorization({
    id,
    attribution: author,
    interactingObject: likeId,
    interactionTarget: targetId,
  });
}

test("verifyAuthorization() checks expected IDs of authorization objects", async () => {
  const like = new Like({ id: likeId, actor, object: targetId });
  const target = new Note({ id: targetId, attribution: author });
  const otherId = new URL("https://example.net/authorizations/2");

  const mismatched = await likeInteraction.verifyAuthorization(context, {
    authorization: likeAuthorization(),
    authorizationId: otherId,
    interactingObject: like,
    interactionTarget: target,
    verifyAuthenticity: () => true,
  });
  assert.deepEqual(mismatched.verified ? null : mismatched.failure, {
    category: "unauthorized",
    type: "idMismatch",
    expected: otherId,
    actual: authorizationId,
  });

  const matched = await likeInteraction.verifyAuthorization(context, {
    authorization: likeAuthorization(),
    authorizationId,
    interactingObject: like,
    interactionTarget: target,
    verifyAuthenticity: () => true,
  });
  assert.equal(matched.verified, true);

  const unauthenticated = await likeInteraction.verifyAuthorization(context, {
    authorization: likeAuthorization(),
    authorizationId,
    interactingObject: like,
    interactionTarget: target,
  });
  assert.equal(
    unauthenticated.verified ? null : unauthenticated.failure.type,
    "notAuthentic",
  );
});

test("verifyAuthorization() checks expected IDs of authorization URLs before fetching", async () => {
  const otherId = new URL("https://example.net/authorizations/2");

  const result = await likeInteraction.verifyAuthorization(context, {
    authorization: otherId,
    authorizationId,
    interactingObject: likeId,
    interactionTarget: targetId,
    attributedTo: author,
    documentLoader: () => assert.fail("must not fetch"),
  });

  assert.deepEqual(result.verified ? null : result.failure, {
    category: "unauthorized",
    type: "idMismatch",
    expected: authorizationId,
    actual: otherId,
  });
});

test("verifyAuthorization() accepts off-origin authorizations only when allowed and authentic", async () => {
  const aliasId = new URL("https://alias.example/authorizations/1");
  const options = {
    authorization: likeAuthorization(aliasId),
    interactingObject: likeId,
    interactionTarget: targetId,
    attributedTo: author,
  };

  const disallowed = await likeInteraction.verifyAuthorization(context, {
    ...options,
    verifyAuthenticity: () => true,
  });
  assert.equal(
    disallowed.verified ? null : disallowed.failure.type,
    "originMismatch",
  );

  const withoutVerifier = await likeInteraction.verifyAuthorization(context, {
    ...options,
    allowOffOrigin: true,
  });
  assert.equal(
    withoutVerifier.verified ? null : withoutVerifier.failure.type,
    "originMismatch",
  );

  const notAuthentic = await likeInteraction.verifyAuthorization(context, {
    ...options,
    allowOffOrigin: true,
    verifyAuthenticity: () => false,
  });
  assert.equal(
    notAuthentic.verified ? null : notAuthentic.failure.type,
    "notAuthentic",
  );

  const allowed = await likeInteraction.verifyAuthorization(context, {
    ...options,
    allowOffOrigin: true,
    verifyAuthenticity: () => true,
  });
  assert.equal(allowed.verified, true);

  const wrongTarget = await likeInteraction.verifyAuthorization(context, {
    ...options,
    interactionTarget: new URL("https://example.net/notes/2"),
    allowOffOrigin: true,
    verifyAuthenticity: () => true,
  });
  assert.equal(
    wrongTarget.verified ? null : wrongTarget.failure.type,
    "targetMismatch",
  );
});

test("verifyAuthorization() fetches allowed off-origin authorization URLs", async () => {
  const aliasId = new URL("https://alias.example/authorizations/1");

  const result = await likeInteraction.verifyAuthorization(context, {
    authorization: aliasId,
    interactingObject: likeId,
    interactionTarget: targetId,
    attributedTo: author,
    allowOffOrigin: true,
    verifyAuthenticity: (authorization) =>
      authorization.id?.href === aliasId.href,
    documentLoader: documentLoader({
      [aliasId.href]: await likeAuthorization(aliasId).toJsonLd(),
    }),
  });

  assert.equal(result.verified, true);
});

test("verifyAuthorization() reports transient authorization fetch failures", async () => {
  const result = await likeInteraction.verifyAuthorization(context, {
    authorization: authorizationId,
    interactingObject: likeId,
    interactionTarget: targetId,
    attributedTo: author,
    documentLoader: documentLoader({}, (url) => httpError(url, 502)),
  });

  assert.equal(result.verified, false);
  if (result.verified || result.failure.type !== "notDereferenceable") {
    assert.fail(`unexpected result: ${String(result.verified)}`);
  }
  assert.equal(result.failure.url.href, authorizationId.href);
  assert.equal(result.failure.transient, true);
});

test("response constructors do not require IDs or recipients", async () => {
  const request = likeRequestWithInstrumentIri();

  const accept = likeInteraction.createAccept({
    mode: "polite",
    actor: author,
    request,
    authorization: authorizationId,
  });
  const reject = likeInteraction.createReject({
    mode: "polite",
    actor: author,
    request,
  });
  const revocation = likeInteraction.createRevocation({
    actor: author,
    authorization: authorizationId,
  });

  for (const activity of [accept, reject, revocation]) {
    assert.equal(activity.id, null);
    assert.deepEqual(activity.toIds, []);
    assert.deepEqual(activity.ccIds, []);
  }
  assert.equal(
    (await revocation.toJsonLd() as Record<string, unknown>).object,
    authorizationId.href,
  );
});

test("createRevocation() can embed authorizations without leaking objects", async () => {
  const authorization = new LikeAuthorization({
    id: authorizationId,
    attribution: author,
    interactingObject: new Like({ id: likeId, actor, object: targetId }),
    interactionTarget: new Note({
      id: targetId,
      attribution: author,
      content: "secret",
    }),
  });

  const embedded = likeInteraction.createRevocation({
    id: new URL("https://example.net/deletes/1"),
    actor: author,
    authorization,
    to: actor,
    embedAuthorization: true,
  });

  assert.ok(embedded instanceof Delete);
  const json = await embedded.toJsonLd() as Record<string, unknown>;
  assert.deepEqual(json.object, {
    type: "LikeAuthorization",
    id: authorizationId.href,
    attributedTo: author.href,
    interactingObject: likeId.href,
    interactionTarget: targetId.href,
  });
  assert.ok(authorization.interactionTargetId != null);
  assert.ok(
    !(await authorization.getInteractionTarget() instanceof URL),
    "the given authorization must be left untouched",
  );

  const referenced = likeInteraction.createRevocation({
    actor: author,
    authorization,
  });
  assert.equal(
    (await referenced.toJsonLd() as Record<string, unknown>).object,
    authorizationId.href,
  );

  assert.throws(
    () =>
      likeInteraction.createRevocation({
        actor: author,
        authorization: new LikeAuthorization({
          id: authorizationId,
          attribution: author,
          interactingObject: new Like({ actor, object: targetId }),
          interactionTarget: targetId,
        }),
        embedAuthorization: true,
      }),
    TypeError,
  );
});
