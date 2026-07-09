import assert from "node:assert/strict";
import { test } from "node:test";
import type { Context } from "@fedify/fedify";
import type { DocumentLoader } from "@fedify/vocab-runtime";
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
  });

  assert.equal(result.verified, true);
  assert.equal(result.authorizationId.href, authorizationId.href);

  const inferredResult = await likeInteraction.verifyAuthorization(context, {
    authorization,
    interactingObject: like,
    interactionTarget: target,
  });

  assert.equal(inferredResult.verified, true);
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
