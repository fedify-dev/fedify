import assert from "node:assert/strict";
import { test } from "node:test";
import type { Context } from "@fedify/fedify";
import {
  type DocumentLoader,
  getDocumentLoader,
  type RemoteDocument,
} from "@fedify/vocab-runtime";
import {
  Accept,
  Announce,
  InteractionPolicy,
  InteractionRule,
  Like,
  LikeAuthorization,
  LikeRequest,
  Note,
  PUBLIC_COLLECTION,
} from "@fedify/vocab";
import {
  formatAuthorizationKey,
  formatInteractionKey,
  likeInteraction,
} from "./mod.ts";

const context = {} as Context<void>;
const actor = new URL("https://example.com/users/alice");
const author = new URL("https://example.net/users/bob");
const targetId = new URL("https://example.net/notes/1");
const likeId = new URL("https://example.com/likes/1");
const authorizationId = new URL("https://example.net/authorizations/1");
const throwingDocumentLoader: DocumentLoader = async () => {
  await Promise.resolve();
  throw new Error("not dereferenceable");
};
const verifyAuthenticity = () => true;
const preloadedDocumentLoader = getDocumentLoader();

function remoteDocument(url: URL, document: unknown): RemoteDocument {
  return { contextUrl: null, document, documentUrl: url.href };
}

function withContextFallback(loader: DocumentLoader): DocumentLoader {
  return async (url: string) => {
    try {
      return await loader(url);
    } catch (error) {
      const preloaded = await preloadedDocumentLoader(url);
      if (preloaded != null) return preloaded;
      throw error;
    }
  };
}

test("likeInteraction creates typed requests", () => {
  const target = new Note({ id: targetId, attribution: author });
  const like = new Like({ id: likeId, actor, object: targetId });

  const request = likeInteraction.createRequest({
    id: new URL("https://example.com/requests/1"),
    actor,
    object: target,
    instrument: like,
    to: author,
  });

  assert.ok(request instanceof LikeRequest);
  assert.equal(request.actorId?.href, actor.href);
  assert.equal(request.objectId?.href, targetId.href);
  assert.equal(request.instrumentId?.href, likeId.href);
});

test("likeInteraction evaluates self and default policies", async () => {
  const target = new Note({ id: targetId, attribution: author });

  assert.deepEqual(
    await likeInteraction.evaluatePolicy(context, {
      subject: target,
      requester: author,
    }),
    {
      result: "automatic",
      reason: { type: "self" },
    },
  );

  assert.deepEqual(
    await likeInteraction.evaluatePolicy(context, {
      subject: target,
      requester: actor,
    }),
    {
      result: "automatic",
      reason: { type: "default", default: "publicAutomatic" },
    },
  );
});

test("likeInteraction evaluates explicit policy rules", async () => {
  const followers = new URL("https://example.net/users/bob/followers");
  const target = new Note({
    id: targetId,
    attribution: author,
    interactionPolicy: new InteractionPolicy({
      canLike: new InteractionRule({
        automaticApproval: followers,
        manualApproval: PUBLIC_COLLECTION,
      }),
    }),
  });

  assert.deepEqual(
    await likeInteraction.evaluatePolicy(context, {
      subject: target,
      requester: actor,
      matchesApprovalCollection: (collection, requester) =>
        collection.href === followers.href && requester.href === actor.href,
    }),
    {
      result: "automatic",
      reason: { type: "collection", collection: followers },
    },
  );

  assert.deepEqual(
    await likeInteraction.evaluatePolicy(context, {
      subject: target,
      requester: new URL("https://example.org/users/carol"),
    }),
    {
      result: "manual",
      reason: { type: "public" },
    },
  );
});

test("likeInteraction denies failed collection policy checks", async () => {
  const followers = new URL("https://example.net/users/bob/followers");
  const target = new Note({
    id: targetId,
    attribution: author,
    interactionPolicy: new InteractionPolicy({
      canLike: new InteractionRule({ automaticApproval: followers }),
    }),
  });

  assert.deepEqual(
    await likeInteraction.evaluatePolicy(context, {
      subject: target,
      requester: actor,
      matchesApprovalCollection: () => {
        throw new Error("collection unavailable");
      },
    }),
    {
      result: "denied",
      reason: {
        type: "unverifiableCollection",
        collection: followers,
      },
    },
  );
});

test("likeInteraction checks later collections after earlier failures", async () => {
  const brokenFollowers = new URL(
    "https://example.net/users/bob/followers-unavailable",
  );
  const matchingFollowers = new URL(
    "https://example.net/users/bob/followers",
  );
  const target = new Note({
    id: targetId,
    attribution: author,
    interactionPolicy: new InteractionPolicy({
      canLike: new InteractionRule({
        automaticApprovals: [brokenFollowers, matchingFollowers],
      }),
    }),
  });

  assert.deepEqual(
    await likeInteraction.evaluatePolicy(context, {
      subject: target,
      requester: actor,
      matchesApprovalCollection: (collection) => {
        if (collection.href === brokenFollowers.href) {
          throw new Error("collection unavailable");
        }
        return collection.href === matchingFollowers.href;
      },
    }),
    {
      result: "automatic",
      reason: { type: "collection", collection: matchingFollowers },
    },
  );
});

test("likeInteraction evaluates actor rules before public rules", async () => {
  const target = new Note({
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
      subject: target,
      requester: actor,
    }),
    {
      result: "manual",
      reason: { type: "actor", actor },
    },
  );
});

test("likeInteraction tolerates missing parsed approval arrays", async () => {
  const rule = new InteractionRule({});
  Object.defineProperties(rule, {
    automaticApprovals: { value: null },
    manualApprovals: { value: null },
  });
  const target = new Note({
    id: targetId,
    attribution: author,
    interactionPolicy: new InteractionPolicy({ canLike: rule }),
  });

  assert.deepEqual(
    await likeInteraction.evaluatePolicy(context, {
      subject: target,
      requester: actor,
    }),
    {
      result: "automatic",
      reason: { type: "default", default: "publicAutomatic" },
    },
  );
});

test("likeInteraction reports no match for unmatched actor rules", async () => {
  const target = new Note({
    id: targetId,
    attribution: author,
    interactionPolicy: new InteractionPolicy({
      canLike: new InteractionRule({
        automaticApproval: new URL("https://example.org/users/carol"),
      }),
    }),
  });

  assert.deepEqual(
    await likeInteraction.evaluatePolicy(context, {
      subject: target,
      requester: actor,
    }),
    {
      result: "denied",
      reason: { type: "noMatch" },
    },
  );
});

test("likeInteraction creates and verifies authorizations", async () => {
  const target = new Note({ id: targetId, attribution: author });
  const like = new Like({ id: likeId, actor, object: target });

  const authorization = likeInteraction.createAuthorization({
    id: authorizationId,
    attributedTo: author,
    interactingObject: like,
    interactionTarget: target,
  });

  assert.ok(authorization instanceof LikeAuthorization);
  assert.equal(authorization.interactingObjectId?.href, likeId.href);
  assert.equal(authorization.interactionTargetId?.href, targetId.href);

  const result = await likeInteraction.verifyAuthorization(context, {
    authorization,
    interactingObject: like,
    interactionTarget: target,
    attributedTo: author,
    verifyAuthenticity,
  });

  assert.equal(result.verified, true);
  assert.equal(result.authorizationId.href, authorizationId.href);

  const inferredResult = await likeInteraction.verifyAuthorization(context, {
    authorization,
    interactingObject: like,
    interactionTarget: target,
    verifyAuthenticity,
  });

  assert.equal(inferredResult.verified, true);
});

test("likeInteraction verifies authorization URLs with context document loaders", async () => {
  const target = new Note({ id: targetId, attribution: author });
  const like = new Like({ id: likeId, actor, object: target });
  const authorization = new LikeAuthorization({
    id: authorizationId,
    attribution: author,
    interactingObject: likeId,
    interactionTarget: targetId,
  });
  const loaderContext = {
    documentLoader: withContextFallback(async (url: string) => {
      assert.equal(url, authorizationId.href);
      return remoteDocument(authorizationId, await authorization.toJsonLd());
    }),
  } as unknown as Context<void>;

  const result = await likeInteraction.verifyAuthorization(loaderContext, {
    authorization: authorizationId,
    interactingObject: like,
    interactionTarget: target,
  });

  assert.equal(result.verified, true);
  assert.equal(result.authorizationId.href, authorizationId.href);
});

test("likeInteraction rejects mismatched authorization URL origins before fetching", async () => {
  const target = new Note({ id: targetId, attribution: author });
  const like = new Like({ id: likeId, actor, object: target });
  const mismatchedAuthorizationId = new URL(
    "https://example.org/authorizations/1",
  );
  let called = false;

  const result = await likeInteraction.verifyAuthorization(context, {
    authorization: mismatchedAuthorizationId,
    interactingObject: like,
    interactionTarget: target,
    documentLoader: async () => {
      called = true;
      return remoteDocument(
        mismatchedAuthorizationId,
        await new LikeAuthorization({
          id: mismatchedAuthorizationId,
          attribution: author,
          interactingObject: likeId,
          interactionTarget: targetId,
        }).toJsonLd(),
      );
    },
  });

  assert.equal(called, false);
  assert.equal(result.verified, false);
  assert.equal(result.authorizationId?.href, mismatchedAuthorizationId.href);
  assert.equal(result.failure.type, "originMismatch");
  assert.equal(result.failure.expectedOrigin, author.origin);
  assert.equal(result.failure.actualOrigin, mismatchedAuthorizationId.origin);
});

test("likeInteraction rejects unknown authorization grantors before fetching", async () => {
  const like = new Like({ id: likeId, actor, object: targetId });
  let called = false;

  const result = await likeInteraction.verifyAuthorization(context, {
    authorization: authorizationId,
    interactingObject: like,
    interactionTarget: targetId,
    documentLoader: async () => {
      called = true;
      return remoteDocument(
        authorizationId,
        await new LikeAuthorization({
          id: authorizationId,
          attribution: author,
          interactingObject: likeId,
          interactionTarget: targetId,
        }).toJsonLd(),
      );
    },
  });

  assert.equal(called, false);
  assert.equal(result.verified, false);
  assert.equal(result.authorizationId?.href, authorizationId.href);
  assert.equal(result.failure.type, "missingAttribution");
});

test("likeInteraction verifies requests", async () => {
  const target = new Note({ id: targetId, attribution: author });
  const like = new Like({ id: likeId, actor, object: targetId });
  const request = new LikeRequest({
    id: new URL("https://example.com/requests/1"),
    actor,
    object: target,
    instrument: like,
  });

  const result = await likeInteraction.verifyRequest(context, { request });

  assert.equal(result.verified, true);
  assert.equal(result.requester.href, actor.href);
  assert.equal(result.interactingObjectId.href, likeId.href);
  assert.equal(result.interactionTargetId.href, targetId.href);
});

test("likeInteraction rejects dereferenced requests with mismatched IDs", async () => {
  const requestUrl = new URL("https://example.com/requests/1");
  const actualRequestId = new URL("https://example.com/requests/other");
  const target = new Note({ id: targetId, attribution: author });
  const like = new Like({ id: likeId, actor, object: targetId });
  const request = new LikeRequest({
    id: actualRequestId,
    actor,
    object: target,
    instrument: like,
  });

  const result = await likeInteraction.verifyRequest(context, {
    request: requestUrl,
    documentLoader: withContextFallback(async (url) => {
      assert.equal(url, requestUrl.href);
      return remoteDocument(requestUrl, await request.toJsonLd());
    }),
  });

  assert.equal(result.verified, false);
  assert.equal(result.requestId?.href, actualRequestId.href);
  assert.equal(result.failure.type, "idMismatch");
  assert.equal(result.failure.expected.href, requestUrl.href);
  assert.equal(result.failure.actual?.href, actualRequestId.href);
});

test("likeInteraction verifies request URLs with context document loaders", async () => {
  const requestUrl = new URL("https://example.com/requests/1");
  const target = new Note({ id: targetId, attribution: author });
  const like = new Like({ id: likeId, actor, object: targetId });
  const request = new LikeRequest({
    id: requestUrl,
    actor,
    object: target,
    instrument: like,
  });
  const loaderContext = {
    documentLoader: withContextFallback(async (url: string) => {
      if (url === requestUrl.href) {
        return remoteDocument(requestUrl, await request.toJsonLd());
      }
      assert.equal(url, targetId.href);
      return remoteDocument(targetId, await target.toJsonLd());
    }),
  } as unknown as Context<void>;

  const result = await likeInteraction.verifyRequest(loaderContext, {
    request: requestUrl,
  });

  assert.equal(result.verified, true);
  assert.equal(result.requestId.href, requestUrl.href);
});

test("likeInteraction uses request loaders for remote contexts", async () => {
  const requestUrl = new URL("https://example.com/requests/1");
  const contextUrl = new URL("https://example.com/contexts/interaction");
  const target = new Note({ id: targetId, attribution: author });
  const like = new Like({ id: likeId, actor, object: targetId });
  let loadedContext = false;
  const loaderContext = {
    documentLoader: withContextFallback(async (url: string) => {
      switch (url) {
        case requestUrl.href:
          return remoteDocument(requestUrl, {
            "@context": contextUrl.href,
            id: requestUrl.href,
            type: "LikeRequest",
            actor: actor.href,
            object: targetId.href,
            instrument: likeId.href,
          });
        case contextUrl.href:
          loadedContext = true;
          return remoteDocument(contextUrl, {
            "@context": {
              id: "@id",
              type: "@type",
              LikeRequest: "https://gotosocial.org/ns#LikeRequest",
              actor: {
                "@id": "https://www.w3.org/ns/activitystreams#actor",
                "@type": "@id",
              },
              object: {
                "@id": "https://www.w3.org/ns/activitystreams#object",
                "@type": "@id",
              },
              instrument: {
                "@id": "https://www.w3.org/ns/activitystreams#instrument",
                "@type": "@id",
              },
            },
          });
        case targetId.href:
          return remoteDocument(targetId, await target.toJsonLd());
        case likeId.href:
          return remoteDocument(likeId, await like.toJsonLd());
        default:
          throw new Error(`Unexpected document load: ${url}`);
      }
    }),
  } as unknown as Context<void>;

  const result = await likeInteraction.verifyRequest(loaderContext, {
    request: requestUrl,
  });

  assert.equal(loadedContext, true);
  assert.equal(result.verified, true);
  assert.equal(result.requestId.href, requestUrl.href);
});

test("likeInteraction dereferences request fields with context loaders", async () => {
  const request = new LikeRequest({
    id: new URL("https://example.com/requests/1"),
    actor,
    object: targetId,
    instrument: new Like({ id: likeId, actor, object: targetId }),
  });
  const loaderContext = {
    documentLoader: async (url: string) => {
      assert.equal(url, targetId.href);
      return remoteDocument(
        targetId,
        await new Note({ id: targetId, attribution: author }).toJsonLd(),
      );
    },
  } as unknown as Context<void>;

  const result = await likeInteraction.verifyRequest(loaderContext, {
    request,
  });

  assert.equal(result.verified, true);
  assert.equal(result.interactionTargetId.href, targetId.href);
});

test("likeInteraction reports null remote documents as not dereferenceable", async () => {
  const requestUrl = new URL("https://example.com/requests/1");
  let called = false;

  const result = await likeInteraction.verifyRequest(context, {
    request: requestUrl,
    documentLoader: async () => {
      await Promise.resolve();
      called = true;
      return null as unknown as RemoteDocument;
    },
  });

  assert.equal(called, true);
  assert.equal(result.verified, false);
  assert.equal(result.failure.type, "notDereferenceable");
  assert.equal(result.failure.url.href, requestUrl.href);
});

test("likeInteraction rejects wrong request instrument types", async () => {
  const target = new Note({ id: targetId, attribution: author });
  const announce = new Announce({ id: likeId, actor, object: targetId });
  const request = new LikeRequest({
    id: new URL("https://example.com/requests/1"),
    actor,
    object: target,
    instrument: announce,
  });

  const result = await likeInteraction.verifyRequest(context, { request });

  assert.equal(result.verified, false);
  assert.equal(result.failure.type, "wrongInstrumentType");
});

test("likeInteraction returns failures for dereferenceable object errors", async () => {
  const like = new Like({ id: likeId, actor, object: targetId });
  const request = new LikeRequest({
    id: new URL("https://example.com/requests/1"),
    actor,
    object: targetId,
    instrument: like,
  });

  const result = await likeInteraction.verifyRequest(context, {
    request,
    documentLoader: throwingDocumentLoader,
  });

  assert.equal(result.verified, false);
  assert.equal(result.failure.type, "missingObject");
});

test("likeInteraction returns failures for dereferenceable instrument errors", async () => {
  const target = new Note({ id: targetId, attribution: author });
  const request = new LikeRequest({
    id: new URL("https://example.com/requests/1"),
    actor,
    object: target,
    instrument: likeId,
  });

  const result = await likeInteraction.verifyRequest(context, {
    request,
    documentLoader: throwingDocumentLoader,
  });

  assert.equal(result.verified, false);
  assert.equal(result.failure.type, "missingInstrument");
});

test("likeInteraction rejects id-less request objects", async () => {
  const target = new Note({ attribution: author });
  const like = new Like({ id: likeId, actor, object: targetId });
  const request = new LikeRequest({
    id: new URL("https://example.com/requests/1"),
    actor,
    object: target,
    instrument: like,
  });

  const result = await likeInteraction.verifyRequest(context, { request });

  assert.equal(result.verified, false);
  assert.equal(result.failure.type, "missingObjectId");
});

test("likeInteraction rejects id-less request instruments", async () => {
  const target = new Note({ id: targetId, attribution: author });
  const like = new Like({ actor, object: targetId });
  const request = new LikeRequest({
    id: new URL("https://example.com/requests/1"),
    actor,
    object: target,
    instrument: like,
  });

  const result = await likeInteraction.verifyRequest(context, { request });

  assert.equal(result.verified, false);
  assert.equal(result.failure.type, "missingInstrumentId");
});

test("likeInteraction rejects unverifiable authorization grantors", async () => {
  const target = new Note({ id: targetId, attribution: author });
  const like = new Like({ id: likeId, actor, object: target });
  const authorization = new LikeAuthorization({
    id: new URL("https://example.org/authorizations/1"),
    attribution: new URL("https://example.org/users/carol"),
    interactingObject: likeId,
    interactionTarget: targetId,
  });

  const result = await likeInteraction.verifyAuthorization(context, {
    authorization,
    interactingObject: like,
    interactionTarget: target,
  });

  assert.equal(result.verified, false);
  assert.equal(result.failure.type, "attributionMismatch");
});

test("likeInteraction rejects authorization grantors without origins", async () => {
  const opaqueAuthor = new URL("urn:example:users:bob");
  const target = new Note({ id: targetId, attribution: opaqueAuthor });
  const like = new Like({ id: likeId, actor, object: target });
  const authorization = new LikeAuthorization({
    id: authorizationId,
    attribution: opaqueAuthor,
    interactingObject: likeId,
    interactionTarget: targetId,
  });

  const result = await likeInteraction.verifyAuthorization(context, {
    authorization,
    interactingObject: like,
    interactionTarget: target,
    verifyAuthenticity,
  });

  assert.equal(result.verified, false);
  assert.equal(result.failure.type, "originMismatch");
});

test("likeInteraction rejects authorization IDs without origins", async () => {
  const target = new Note({ id: targetId, attribution: author });
  const like = new Like({ id: likeId, actor, object: target });
  const authorization = new LikeAuthorization({
    id: new URL("urn:example:authorizations:1"),
    attribution: author,
    interactingObject: likeId,
    interactionTarget: targetId,
  });

  const result = await likeInteraction.verifyAuthorization(context, {
    authorization,
    interactingObject: like,
    interactionTarget: target,
    verifyAuthenticity,
  });

  assert.equal(result.verified, false);
  assert.equal(result.failure.type, "originMismatch");
});

test("likeInteraction accepts matching portable authorization origins", async () => {
  const portableAuthor = new URL("ap://did%3Akey%3Az6Mkabc/users/bob");
  const portableTargetId = new URL("ap://did%3Akey%3Az6Mkabc/notes/1");
  const portableAuthorizationId = new URL(
    "ap://did%3Akey%3Az6Mkabc/authorizations/1",
  );
  const target = new Note({
    id: portableTargetId,
    attribution: portableAuthor,
  });
  const like = new Like({ id: likeId, actor, object: target });
  const authorization = new LikeAuthorization({
    id: portableAuthorizationId,
    attribution: portableAuthor,
    interactingObject: likeId,
    interactionTarget: portableTargetId,
  });

  const result = await likeInteraction.verifyAuthorization(context, {
    authorization,
    interactingObject: like,
    interactionTarget: target,
    verifyAuthenticity,
  });

  assert.equal(result.verified, true);
  assert.equal(result.authorizationId.href, portableAuthorizationId.href);
});

test("likeInteraction rejects mismatched portable authorization origins", async () => {
  const portableAuthor = new URL("ap://did%3Akey%3Az6Mkabc/users/bob");
  const portableTargetId = new URL("ap://did%3Akey%3Az6Mkabc/notes/1");
  const portableAuthorizationId = new URL(
    "ap://did%3Akey%3Az6Mkdef/authorizations/1",
  );
  const target = new Note({
    id: portableTargetId,
    attribution: portableAuthor,
  });
  const like = new Like({ id: likeId, actor, object: target });
  const authorization = new LikeAuthorization({
    id: portableAuthorizationId,
    attribution: portableAuthor,
    interactingObject: likeId,
    interactionTarget: portableTargetId,
  });

  const result = await likeInteraction.verifyAuthorization(context, {
    authorization,
    interactingObject: like,
    interactionTarget: target,
    verifyAuthenticity,
  });

  assert.equal(result.verified, false);
  assert.equal(result.failure.type, "originMismatch");
  assert.equal(result.failure.expectedOrigin, "did:key:z6Mkabc");
  assert.equal(result.failure.actualOrigin, "did:key:z6Mkdef");
});

test("likeInteraction rejects missing authorization grantors", async () => {
  const target = new Note({ id: targetId });
  const like = new Like({ id: likeId, actor, object: target });
  const authorization = new LikeAuthorization({
    id: authorizationId,
    interactingObject: likeId,
    interactionTarget: targetId,
  });

  const result = await likeInteraction.verifyAuthorization(context, {
    authorization,
    interactingObject: like,
    interactionTarget: target,
  });

  assert.equal(result.verified, false);
  assert.equal(result.failure.type, "missingAttribution");
});

test("likeInteraction rejects unauthenticated embedded authorizations", async () => {
  const target = new Note({ id: targetId, attribution: author });
  const like = new Like({ id: likeId, actor, object: target });
  const authorization = new LikeAuthorization({
    id: authorizationId,
    attribution: author,
    interactingObject: likeId,
    interactionTarget: targetId,
  });

  const result = await likeInteraction.verifyAuthorization(context, {
    authorization,
    interactingObject: like,
    interactionTarget: target,
  });

  assert.equal(result.verified, false);
  assert.equal(result.failure.type, "notAuthentic");
});

test("likeInteraction reports authenticity verification errors", async () => {
  const target = new Note({ id: targetId, attribution: author });
  const like = new Like({ id: likeId, actor, object: target });
  const authorization = new LikeAuthorization({
    id: authorizationId,
    attribution: author,
    interactingObject: likeId,
    interactionTarget: targetId,
  });
  const cause = new Error("bad proof");

  const result = await likeInteraction.verifyAuthorization(context, {
    authorization,
    interactingObject: like,
    interactionTarget: target,
    verifyAuthenticity: () => {
      throw cause;
    },
  });

  assert.equal(result.verified, false);
  assert.equal(result.failure.type, "notAuthentic");
  assert.equal(result.failure.cause, cause);
});

test("likeInteraction builds responses and revocations", () => {
  const target = new Note({ id: targetId, attribution: author });
  const like = new Like({ id: likeId, actor, object: targetId });
  const authorization = new LikeAuthorization({
    id: authorizationId,
    attribution: author,
    interactingObject: likeId,
    interactionTarget: targetId,
  });

  const accept = likeInteraction.createAccept({
    mode: "impolite",
    id: new URL("https://example.net/accepts/1"),
    actor: author,
    interactingObject: like,
    interactionTarget: target,
    authorization,
    to: actor,
    cc: PUBLIC_COLLECTION,
  });

  assert.ok(accept instanceof Accept);
  assert.equal(accept.objectId?.href, likeId.href);
  assert.equal(accept.targetId?.href, targetId.href);
  assert.equal(accept.resultId?.href, authorizationId.href);

  const reject = likeInteraction.createReject({
    mode: "impolite",
    id: new URL("https://example.net/rejects/1"),
    actor: author,
    interactingObject: like,
    interactionTarget: target,
    to: actor,
  });

  assert.equal(reject.objectId?.href, likeId.href);
  assert.equal(reject.targetId?.href, targetId.href);

  const revocation = likeInteraction.createRevocation({
    id: new URL("https://example.net/deletes/1"),
    actor: author,
    authorization,
    to: actor,
  });

  assert.equal(revocation.objectId?.href, authorizationId.href);
});

test("likeInteraction recognizes impolite Like activities", () => {
  const target = new Note({ id: targetId, attribution: author });
  const like = new Like({ id: likeId, actor, object: target });

  const recognized = likeInteraction.recognizeImpolite(like);

  assert.ok(recognized);
  assert.equal(recognized.requester.href, actor.href);
  assert.equal(recognized.interactingObjectId.href, likeId.href);
  assert.equal(recognized.interactionTargetId.href, targetId.href);
  assert.equal(recognized.evidence.type, "activity");
});

test("likeInteraction derives stable keys", () => {
  const target = new Note({ id: targetId, attribution: author });
  const like = new Like({ id: likeId, actor, object: target });
  const authorization = new LikeAuthorization({
    id: authorizationId,
    attribution: author,
    interactingObject: likeId,
    interactionTarget: targetId,
  });

  const interactionKey = likeInteraction.getInteractionKey({
    requester: actor,
    interactingObject: like,
    interactionTarget: target,
  });
  const authorizationKey = likeInteraction.getAuthorizationKey({
    authorization,
  });

  assert.equal(
    formatInteractionKey(interactionKey),
    JSON.stringify(["like", actor.href, likeId.href, targetId.href]),
  );
  assert.equal(
    formatAuthorizationKey(authorizationKey),
    JSON.stringify(["like", authorizationId.href]),
  );
});
