import assert from "node:assert/strict";
import { test } from "node:test";
import type { Context } from "@fedify/fedify";
import {
  InteractionPolicy,
  InteractionRule,
  Note,
  PUBLIC_COLLECTION,
  ReplyAuthorization,
  ReplyRequest,
} from "@fedify/vocab";
import { replyInteraction } from "./mod.ts";

const context = {} as Context<void>;
const actor = new URL("https://example.com/users/alice");
const author = new URL("https://example.net/users/bob");
const targetId = new URL("https://example.net/notes/1");
const replyId = new URL("https://example.com/notes/2");
const authorizationId = new URL("https://example.net/authorizations/2");
const verifyAuthenticity = () => true;

test("replyInteraction creates and verifies requests", async () => {
  const target = new Note({ id: targetId, attribution: author });
  const reply = new Note({
    id: replyId,
    attribution: actor,
    replyTarget: targetId,
  });
  const request = replyInteraction.createRequest({
    id: new URL("https://example.com/requests/2"),
    actor,
    object: target,
    instrument: reply,
  });

  assert.ok(request instanceof ReplyRequest);

  const result = await replyInteraction.verifyRequest(context, { request });

  assert.equal(result.verified, true);
  assert.equal(result.requester.href, actor.href);
  assert.equal(result.interactingObjectId.href, replyId.href);
  assert.equal(result.interactionTargetId.href, targetId.href);
});

test("replyInteraction denies mismatched requesters", async () => {
  const target = new Note({ id: targetId, attribution: author });
  const reply = new Note({
    id: replyId,
    attribution: new URL("https://example.org/users/carol"),
    replyTarget: targetId,
  });
  const request = new ReplyRequest({
    id: new URL("https://example.com/requests/2"),
    actor,
    object: target,
    instrument: reply,
  });

  const result = await replyInteraction.verifyRequest(context, { request });

  assert.equal(result.verified, false);
  assert.equal(result.failure.type, "requesterMismatch");
});

test("replyInteraction evaluates canReply rules", async () => {
  const target = new Note({
    id: targetId,
    attribution: author,
    interactionPolicy: new InteractionPolicy({
      canReply: new InteractionRule({ manualApproval: PUBLIC_COLLECTION }),
    }),
  });

  assert.deepEqual(
    await replyInteraction.evaluatePolicy(context, {
      subject: target,
      requester: actor,
    }),
    {
      result: "manual",
      reason: { type: "public" },
    },
  );
});

test("replyInteraction creates and verifies authorizations", async () => {
  const target = new Note({ id: targetId, attribution: author });
  const reply = new Note({
    id: replyId,
    attribution: actor,
    replyTarget: targetId,
  });
  const authorization = replyInteraction.createAuthorization({
    id: authorizationId,
    attributedTo: author,
    interactingObject: reply,
    interactionTarget: target,
  });

  assert.ok(authorization instanceof ReplyAuthorization);

  const result = await replyInteraction.verifyAuthorization(context, {
    authorization,
    interactingObject: reply,
    interactionTarget: target,
    attributedTo: author,
    verifyAuthenticity,
  });

  assert.equal(result.verified, true);
});

test("replyInteraction recognizes bare reply objects", () => {
  const target = new Note({ id: targetId, attribution: author });
  const reply = new Note({
    id: replyId,
    attribution: actor,
    replyTarget: target,
  });

  const recognized = replyInteraction.recognizeImpolite(reply);

  assert.ok(recognized);
  assert.equal(recognized.requester.href, actor.href);
  assert.equal(recognized.interactingObjectId.href, replyId.href);
  assert.equal(recognized.interactionTargetId.href, targetId.href);
  assert.equal(recognized.evidence.type, "property");
});
